/**
 * Validation d'un cahier des charges par d'autres personnes (du hub ou non).
 *
 *  pk              sk                 contenu
 *  CDC#<id>        REVIEW#<empreinte>  demande de validation (destinataire, version, réponse)
 *  REVIEW#<empr.>  REVIEW              renvoi vers le CDC (lecture du lien sans connaître le CDC)
 *
 * Le lien envoyé contient un jeton aléatoire ; seule son empreinte (SHA-256) est enregistrée. La page publique du
 * lien (`/api/public/validation/…`, sans connexion) demande l'adresse du destinataire avant de montrer le CDC, en
 * lecture seule, à la version demandée. La réponse (validé ou non, commentaire) n'est pas bloquante.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  answerReviewBody,
  docToMarkdown,
  maskEmail,
  openReviewBody,
  REVIEW_DECISION_LABELS,
  requestCdcReviewBody,
  type CdcReview,
  type PublicReviewDocument,
  type PublicReviewInfo,
  type RequestCdcReviewResult,
} from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import * as repo from '../db/repo.js';
import { body } from '../lib/http.js';
import { escapeHtml, sendMail } from '../lib/mail.js';
import { HttpError, notFound, nowIso } from '../lib/util.js';
import * as pr from '../projects/repo.js';
import * as users from '../users/repo.js';

const T = () => config.tableName;
const reviewKey = (cdcId: string, id: string) => ({ pk: `CDC#${cdcId}`, sk: `REVIEW#${id}` });
const tokenKey = (id: string) => ({ pk: `REVIEW#${id}`, sk: 'REVIEW' });
const hash = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 40);

type Item = CdcReview & { pk: string; sk: string };
const strip = ({ pk: _pk, sk: _sk, ...r }: Item): CdcReview => r;

export async function listReviews(cdcId: string): Promise<CdcReview[]> {
  const items = await queryAll<Item>({ KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': `CDC#${cdcId}`, ':s': 'REVIEW#' } });
  return items.map(strip).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.email.localeCompare(b.email));
}

async function putReview(r: CdcReview) {
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...reviewKey(r.cdcId, r.id), ...r } }));
}

/** Demande désignée par le jeton d'un lien. */
async function reviewOfToken(token: string): Promise<CdcReview> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound('Demande de validation');
  const id = hash(token);
  const ref = (await ddb().send(new GetCommand({ TableName: T(), Key: tokenKey(id) }))).Item as { cdcId?: string } | undefined;
  if (!ref?.cdcId) throw notFound('Demande de validation');
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: reviewKey(ref.cdcId, id) }));
  if (!res.Item) throw notFound('Demande de validation');
  return strip(res.Item as Item);
}

/** Adresse du hub pour les liens : celle de la page d'où part la demande. */
function appUrl(c: Context): string {
  const origin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer')!).origin : '');
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new HttpError(400, 'Adresse de l’application inconnue : impossible de construire le lien de validation.');
  return origin;
}

function mailOf(r: CdcReview, title: string, from: string, link: string) {
  const subject = `Validation du cahier des charges « ${title} »`;
  const lines = [
    `Bonjour,`,
    `${from} vous demande de valider le cahier des charges « ${title} » (version ${r.versionLabel}).`,
    ...(r.message ? [`Son message : ${r.message}`] : []),
    `Pour le lire et donner votre avis (validé ou non, avec un commentaire), ouvrez ce lien et saisissez votre adresse e-mail (${r.email}) :`,
    link,
    `Vous ne pourrez pas modifier le document. Votre réponse est transmise à ${from}.`,
    `— Hobbit, le hub de l’équipe IT`,
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d2433">
<p>Bonjour,</p>
<p><strong>${escapeHtml(from)}</strong> vous demande de valider le cahier des charges <strong>« ${escapeHtml(title)} »</strong> (version ${escapeHtml(r.versionLabel)}).</p>
${r.message ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #3f7a32;background:#f5f7fa">${escapeHtml(r.message).replace(/\n/g, '<br>')}</blockquote>` : ''}
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#3f7a32;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Lire et valider le cahier des charges</a></p>
<p style="color:#667085;font-size:12px">Vous devrez saisir votre adresse e-mail (${escapeHtml(r.email)}). Vous ne pourrez pas modifier le document ; votre réponse est transmise à ${escapeHtml(from)}.<br>Lien : ${escapeHtml(link)}</p>
</div>`;
  return { subject, text: lines.join('\n\n'), html };
}

/** Routes de validation, connectées (montées sous /api/cdcs/:id/validations). */
export function cdcReviewRoutes() {
  const r = new Hono();

  r.get('/:id/validations', async (c) => c.json(await listReviews(c.req.param('id'))));

  /** Envoie une demande à chaque adresse (utilisateurs du hub ou personnes extérieures), pour la version courante. */
  r.post('/:id/validations', async (c) => {
    const cdcId = c.req.param('id');
    const user = userName(c);
    const b = await body(c, requestCdcReviewBody);
    const cdc = await repo.getCdcDetail(cdcId);
    const all = await users.listUsers();
    const from = all.find((u) => u.email === user)?.name ?? user;
    const base = appUrl(c);
    const out: RequestCdcReviewResult = { reviews: [] };
    for (const email of b.emails) {
      const token = randomBytes(24).toString('base64url');
      const id = hash(token);
      const link = `${base}/validation/${token}`;
      const review: CdcReview = {
        id,
        cdcId,
        email,
        name: all.find((u) => u.email === email)?.name ?? '',
        versionSeq: cdc.currentVersion.seq,
        versionLabel: cdc.currentVersion.label,
        message: b.message,
        requestedBy: user,
        requestedAt: nowIso(),
        sentAt: null,
        sendError: '',
        decision: null,
        comment: '',
        answeredAt: null,
      };
      await ddb().send(new PutCommand({ TableName: T(), Item: { ...tokenKey(id), cdcId } }));
      try {
        if (await sendMail({ to: email, ...mailOf(review, cdc.title, from, link) })) review.sentAt = nowIso();
      } catch (e) {
        console.error('Envoi de la demande de validation', e);
        review.sendError = `L’e-mail n’a pas pu partir (${(e as Error).message}). Transmettez le lien vous-même.`;
      }
      await putReview(review);
      out.reviews.push({ ...review, link });
    }
    if (cdc.projectId) {
      const project = await pr.requireProject(cdc.projectId).catch(() => null);
      if (project) await pr.logActivity(project.id, project.name, user, `a demandé la validation du cahier des charges « ${cdc.title} » à ${b.emails.length} personne${b.emails.length > 1 ? 's' : ''}`);
    }
    return c.json(out, 201);
  });

  r.delete('/:id/validations/:reviewId', async (c) => {
    const { id, reviewId } = c.req.param();
    await ddb().send(new DeleteCommand({ TableName: T(), Key: reviewKey(id, reviewId) }));
    await ddb().send(new DeleteCommand({ TableName: T(), Key: tokenKey(reviewId) }));
    return c.body(null, 204);
  });

  return r;
}

/** Vérifie l'adresse saisie sur la page du lien. */
function assertEmail(r: CdcReview, email: string) {
  if (email !== r.email) throw new HttpError(403, 'Cette adresse ne correspond pas à celle à qui la demande a été envoyée.');
}

async function infoOf(r: CdcReview): Promise<PublicReviewInfo & { title: string }> {
  const cdc = await repo.requireCdc(r.cdcId);
  const requester = (await users.listUsers()).find((u) => u.email === r.requestedBy);
  return { title: cdc.title, cdcTitle: cdc.title, versionLabel: r.versionLabel, requestedByName: requester?.name ?? r.requestedBy, requestedAt: r.requestedAt, emailHint: maskEmail(r.email) };
}

/** Page publique de validation (montée sous /api/public/validation, sans connexion). */
export function publicReviewRoutes() {
  const r = new Hono();

  r.get('/:token', async (c) => {
    const review = await reviewOfToken(c.req.param('token'));
    const { title: _t, ...info } = await infoOf(review);
    return c.json(info satisfies PublicReviewInfo);
  });

  /** Ouvre le CDC (version demandée) une fois l'adresse saisie. */
  r.post('/:token/ouvrir', async (c) => {
    const review = await reviewOfToken(c.req.param('token'));
    assertEmail(review, (await body(c, openReviewBody)).email);
    const { title: _t, ...info } = await infoOf(review);
    const { document } = await repo.getVersion(review.cdcId, review.versionSeq);
    const doc: PublicReviewDocument = {
      ...info,
      message: review.message,
      projet: document.meta.projet,
      prestataire: document.meta.prestataire,
      // Les images du CDC ne sont servies qu'aux utilisateurs connectés : elles sont signalées sans être montrées.
      sections: document.sections.map((s) => ({ title: s.title, markdown: docToMarkdown(s.content).replace(/!\[([^\]]*)\]\(asset:[^)]+\)/g, (_m, alt: string) => `*(image${alt ? ` « ${alt} »` : ''} non reproduite ici)*`) })),
      decision: review.decision,
      comment: review.comment,
      answeredAt: review.answeredAt,
    };
    return c.json(doc);
  });

  /** Réponse : validé ou non, avec un commentaire ; on peut changer d'avis tant que la demande existe. */
  r.post('/:token/reponse', async (c) => {
    const review = await reviewOfToken(c.req.param('token'));
    const b = await body(c, answerReviewBody);
    assertEmail(review, b.email);
    const next: CdcReview = { ...review, decision: b.decision, comment: b.comment, answeredAt: nowIso() };
    await putReview(next);
    const cdc = await repo.requireCdc(review.cdcId);
    if (cdc.projectId) {
      const project = await pr.requireProject(cdc.projectId).catch(() => null);
      const who = review.name || review.email;
      if (project) await pr.logActivity(project.id, project.name, review.email, `${b.decision === 'valide' ? 'a validé' : 'n’a pas validé'} le cahier des charges « ${cdc.title} » (v${review.versionLabel})${review.name ? '' : ` — ${who}`}`);
    }
    return c.json({ decision: next.decision, comment: next.comment, answeredAt: next.answeredAt, label: REVIEW_DECISION_LABELS[b.decision] });
  });

  return r;
}
