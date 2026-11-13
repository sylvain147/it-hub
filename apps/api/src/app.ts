import { Hono, type Context } from 'hono';
import {
  addSourceBody,
  attachCdcBody,
  assetRef,
  cdcDocumentSchema,
  cdcMetaSchema,
  createAssetBody,
  createCdcBody,
  emptyDoc,
  exportBody,
  HUB_ASSET_SCOPE,
  integrateAnswersBody,
  parseAssetRef,
  resolveAssetsBody,
  restoreVersionBody,
  reworkSectionBody,
  saveCdcBody,
  translateBody,
  updateQuestionBody,
  validationErrorsForStatus,
  can,
  type CdcDocument,
} from '@samm/shared';
import { authMiddleware, userName } from './auth.js';
import { body, intParam } from './lib/http.js';
import { fileTypeRoutes } from './filetypes/routes.js';
import { tmaRoutes } from './tma/routes.js';
import { settingsRoutes } from './settings/routes.js';
import { projectRoutes } from './projects/routes.js';
import { sprintRoutes } from './sprints/routes.js';
import { meHandler, meRoutes, todoRoutes, userRoutes } from './users/routes.js';
import { feedbackRoutes } from './feedback/routes.js';
import { notificationRoutes } from './notifications/routes.js';
import { noteRoutes } from './notes/routes.js';
import { assistantRoutes } from './assistant/routes.js';
import { anneauRoutes } from './anneau/routes.js';
import { ideaRoutes } from './ideas/routes.js';
import { patchRoutes } from './patch/routes.js';
import { cdcReviewRoutes, publicReviewRoutes } from './cdcReviews/routes.js';
import * as pr from './projects/repo.js';
import { config } from './config.js';
import { HttpError, newId, nowIso, monthOf } from './lib/util.js';
import * as repo from './db/repo.js';
import { blobKeys } from './db/schema.js';
import { blobs } from './storage/blobs.js';
import { startJob } from './jobs/runner.js';
import { sectionId } from './ai/pipeline.js';
import { exportFileName, loadImages } from './export/common.js';
import { renderDocx } from './export/docx.js';
import { renderPdf } from './export/pdf.js';

async function assertNoActiveJob(cdcId: string) {
  const cdc = await repo.requireCdc(cdcId);
  if (cdc.activeJobId) throw new HttpError(409, 'Une tâche IA est en cours sur ce cahier des charges. Attendez la fin du traitement.');
  return cdc;
}

/** Les transcriptions peuvent dépasser la taille maximale d'un élément DynamoDB : elles transitent par le bucket. */
async function stashText(text: string): Promise<string> {
  const key = blobKeys.pendingText(newId());
  await blobs().put(key, text, 'text/plain; charset=utf-8');
  return key;
}

function skeleton(meta: Partial<CdcDocument['meta']>): CdcDocument {
  return {
    meta: cdcMetaSchema.parse({ status: 'brouillon', ...meta, title: meta.title?.trim() || 'Nouveau cahier des charges' }),
    sections: [{ id: sectionId(), kind: 'contexte', title: 'Contexte', content: emptyDoc() }],
  };
}

export function createApp() {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status);
    console.error(err);
    return c.json({ error: 'Erreur interne. Réessayez ; si le problème persiste, contactez l’administrateur.' }, 500);
  });

  const api = new Hono();
  api.use('*', authMiddleware);

  api.get('/me', async (c) => c.json(await meHandler(userName(c))));
  api.route('/me', meRoutes());

  // ---- Cahiers des charges ----------------------------------------------------

  api.get('/cdcs', async (c) => c.json(await repo.listCdcs()));

  api.post('/cdcs', async (c) => {
    const b = await body(c, createCdcBody);
    const user = userName(c);
    const doc = skeleton(b.meta);
    const { id } = await repo.createCdc(doc, user);
    let job = null;
    if (b.transcript?.trim()) {
      job = await startJob('create_from_transcript', id, user, { textKey: await stashText(b.transcript), title: b.transcriptTitle ?? b.meta.title ?? '' });
    }
    return c.json({ id, job }, 201);
  });

  api.get('/cdcs/:id', async (c) => c.json(await repo.getCdcDetail(c.req.param('id'))));

  api.put('/cdcs/:id', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, saveCdcBody);
    b.document.meta.jalons = b.document.meta.jalons.filter((j) => j.label.trim() || j.date);
    await assertNoActiveJob(id);
    const errors = validationErrorsForStatus(b.document);
    if (errors.length) throw new HttpError(422, `Impossible de passer à ce statut : ${errors.join(' ')}`, errors);
    const version = await repo.saveVersion(id, b.baseSeq, b.document, { user: userName(c), origin: 'manuel', comment: b.comment });
    return c.json({ version, detail: await repo.getCdcDetail(id) });
  });

  api.patch('/cdcs/:id/project', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, attachCdcBody);
    const cdc = await repo.requireCdc(id);
    const user = userName(c);
    if (b.projectId) {
      const project = await pr.requireProject(b.projectId);
      await pr.logActivity(project.id, project.name, user, `a rattaché le cahier des charges « ${cdc.title} »`);
    }
    if (cdc.projectId && cdc.projectId !== b.projectId) {
      const previous = await pr.requireProject(cdc.projectId).catch(() => null);
      if (previous) await pr.logActivity(previous.id, previous.name, user, `a détaché le cahier des charges « ${cdc.title} »`);
    }
    await repo.setCdcProject(id, b.projectId);
    return c.json(await repo.getCdcDetail(id));
  });

  // ---- Versions ------------------------------------------------------------

  api.get('/cdcs/:id/versions', async (c) => {
    await repo.requireCdc(c.req.param('id'));
    return c.json(await repo.listVersions(c.req.param('id')));
  });

  api.get('/cdcs/:id/versions/:seq', async (c) => c.json(await repo.getVersion(c.req.param('id'), intParam(c, 'seq'))));

  api.post('/cdcs/:id/versions/:seq/restore', async (c) => {
    const id = c.req.param('id');
    const seq = intParam(c, 'seq');
    const b = await body(c, restoreVersionBody);
    await assertNoActiveJob(id);
    const { info, document } = await repo.getVersion(id, seq);
    const restored = cdcDocumentSchema.parse(document);
    const version = await repo.saveVersion(id, b.baseSeq, restored, {
      user: userName(c),
      origin: 'restauration',
      comment: `Restauration de la version ${info.label}`,
    });
    return c.json({ version, detail: await repo.getCdcDetail(id) });
  });

  // ---- Questions -----------------------------------------------------------

  api.get('/cdcs/:id/questions', async (c) => {
    await repo.requireCdc(c.req.param('id'));
    const qs = await repo.listQuestions(c.req.param('id'));
    return c.json(qs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  });

  api.patch('/cdcs/:id/questions/:qid', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, updateQuestionBody);
    const q = await repo.getQuestion(id, c.req.param('qid'));
    const answer = b.answer ?? q.answer;
    let status = b.status ?? q.status;
    // Saisir une réponse sur une question ouverte la passe en « répondue » ; l'effacer la rouvre.
    if (b.answer !== undefined && !b.status) {
      if (answer.trim() && status === 'ouverte') status = 'repondue';
      if (!answer.trim() && status === 'repondue') status = 'ouverte';
    }
    const updated = { ...q, answer, status, answeredBy: answer.trim() ? userName(c) : '', updatedAt: nowIso() };
    await repo.putQuestions(id, [updated]);
    return c.json(updated);
  });

  api.post('/cdcs/:id/questions/integrate', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, integrateAnswersBody);
    const answered = (await repo.listQuestions(id)).filter((q) => q.status === 'repondue' && q.answer.trim());
    if (!answered.length) throw new HttpError(400, 'Répondez à au moins une question avant de lancer l’intégration.');
    return c.json(await startJob('integrate_answers', id, userName(c), { baseSeq: b.baseSeq }), 202);
  });

  // ---- Transcriptions --------------------------------------------------------

  api.get('/cdcs/:id/sources', async (c) => {
    await repo.requireCdc(c.req.param('id'));
    const sources = await repo.listSources(c.req.param('id'));
    return c.json(sources.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });

  api.get('/cdcs/:id/sources/:sid/text', async (c) => c.text(await repo.getSourceText(c.req.param('id'), c.req.param('sid'))));

  api.post('/cdcs/:id/sources', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, addSourceBody);
    return c.json(await startJob('add_transcript', id, userName(c), { baseSeq: b.baseSeq, title: b.title, textKey: await stashText(b.text) }), 202);
  });

  // ---- Retravail d'une section -------------------------------------------------

  api.post('/cdcs/:id/sections/:sectionId/rework', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, reworkSectionBody);
    const detail = await repo.getCdcDetail(id);
    if (!detail.document.sections.some((s) => s.id === c.req.param('sectionId'))) throw new HttpError(404, 'Section introuvable');
    return c.json(
      await startJob('rework_section', id, userName(c), { baseSeq: b.baseSeq, sectionId: c.req.param('sectionId'), instruction: b.instruction }),
      202,
    );
  });

  // ---- Traductions -----------------------------------------------------------

  api.get('/cdcs/:id/translations', async (c) => {
    const cdc = await repo.requireCdc(c.req.param('id'));
    return c.json(await repo.listTranslations(cdc.id, cdc.currentVersion.seq));
  });

  api.post('/cdcs/:id/translations', async (c) => {
    const b = await body(c, translateBody);
    return c.json(await startJob('translate', c.req.param('id'), userName(c), { lang: b.lang }), 202);
  });

  // ---- Exports ---------------------------------------------------------------

  api.post('/cdcs/:id/exports', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, exportBody);
    const cdc = await repo.requireCdc(id);
    let doc: CdcDocument;
    let label: string;
    if (b.lang === 'fr') {
      const v = b.seq ? await repo.getVersion(id, b.seq) : null;
      doc = v ? v.document : (await repo.getCdcDetail(id)).document;
      label = v ? v.info.label : cdc.currentVersion.label;
    } else {
      const tr = await repo.getTranslation(id, b.lang);
      if (!tr) throw new HttpError(404, 'Aucune traduction dans cette langue. Lancez d’abord la traduction.');
      doc = tr.document;
      label = tr.info.versionLabel;
    }
    const images = await loadImages(doc);
    const buffer = b.format === 'docx' ? await renderDocx(doc, label, b.lang, images) : await renderPdf(doc, label, b.lang, images);
    const fileName = exportFileName(doc, label, b.lang, b.format);
    const key = blobKeys.export(id, `${newId()}.${b.format}`);
    const contentType = b.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    await blobs().put(key, buffer, contentType, fileName);
    return c.json({ url: await blobs().downloadUrl(key, { fileName, expiresIn: 300 }), fileName });
  });

  // ---- Images ----------------------------------------------------------------

  api.post('/cdcs/:id/assets', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, createAssetBody);
    await repo.requireCdc(id);
    const assetId = newId();
    const upload = await blobs().uploadUrl(blobKeys.asset(id, assetId), b.contentType, b.size);
    return c.json({ ref: assetRef(id, assetId), upload });
  });

  // Images des autres textes du hub (description d'un ticket…), indépendantes d'un CDC.
  api.post('/images', async (c) => {
    const b = await body(c, createAssetBody);
    const assetId = newId();
    const upload = await blobs().uploadUrl(blobKeys.asset(HUB_ASSET_SCOPE, assetId), b.contentType, b.size);
    return c.json({ ref: assetRef(HUB_ASSET_SCOPE, assetId), upload });
  });

  api.post('/assets/resolve', async (c) => {
    const b = await body(c, resolveAssetsBody);
    const urls: Record<string, string> = {};
    await Promise.all(
      b.refs.map(async (ref) => {
        const p = parseAssetRef(ref);
        if (p) urls[ref] = await blobs().downloadUrl(blobKeys.asset(p.cdcId, p.assetId), { expiresIn: 3600 });
      }),
    );
    return c.json(urls);
  });

  // ---- Jobs & consommation -----------------------------------------------------

  api.get('/jobs/:id', async (c) => {
    const job = await repo.getJob(c.req.param('id'));
    if (!job) throw new HttpError(404, 'Tâche introuvable');
    return c.json(repo.jobInfo(job));
  });

  api.get('/usage', async (c) => {
    const month = c.req.query('month') ?? monthOf(nowIso());
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Mois invalide (AAAA-MM)');
    return c.json(await repo.usageReport(month));
  });

  api.route('/filetypes', fileTypeRoutes());
  api.route('/tma', tmaRoutes());
  api.route('/settings', settingsRoutes());
  api.route('/projects', projectRoutes());
  api.route('/sprints', sprintRoutes());
  api.route('/users', userRoutes());
  api.route('/todos', todoRoutes());
  api.route('/notes', noteRoutes());
  api.route('/assistant', assistantRoutes());
  api.route('/feedback', feedbackRoutes());
  api.route('/notifications', notificationRoutes());
  api.route('/anneau', anneauRoutes());
  api.route('/idees', ideaRoutes());
  api.route('/patch', patchRoutes());
  api.route('/cdcs', cdcReviewRoutes());

  // Activité récente des projets (accueil).
  api.get('/activity', async (c) => c.json(await pr.recentActivity(Math.min(Number(c.req.query('limit') ?? 30) || 30, 100))));

  // Pages publiques (sans connexion) : validation d'un CDC par un lien reçu par e-mail. Avant l'authentification.
  app.route('/api/public/validation', publicReviewRoutes());
  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'Route inconnue' }, 404));
  return app;
}
