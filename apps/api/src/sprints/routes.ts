import { Hono, type Context } from 'hono';
import {
  addDays,
  closeSprintBody,
  createSprintBody,
  DEFAULT_SPRINT_DAYS,
  isPastSprint,
  isRecordedPastSprint,
  pastSprintTimes,
  parisDay,
  planProjectBody,
  publishSprintDocBody,
  saveSprintDocBody,
  shortDay,
  sprintDocKinds,
  sprintInputSchema,
  SPRINT_DOC_KINDS,
  SPRINT_DOC_LABELS,
  type SprintDocKind,
  type SprintPromptExport,
  type SprintReport,
  type StatusLabels,
} from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { body } from '../lib/http.js';
import { HttpError, newId, nowIso } from '../lib/util.js';
import { startJob } from '../jobs/runner.js';
import { blobKeys } from '../db/schema.js';
import { blobs } from '../storage/blobs.js';
import { renderMarkdownDocx } from '../export/docx.js';
import { captureBedrockRequest } from '../ai/bedrock.js';
import * as pr from '../projects/repo.js';
import * as repo from './repo.js';
import { JOB_OF_DOC, sprintDocCall } from './jobs.js';
import { overview, sprintDetail, ticketLabels } from './views.js';

function idParam(c: Context): number {
  const n = Number(c.req.param('sprintId'));
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Numéro de sprint invalide');
  return n;
}

function kindParam(c: Context): SprintDocKind {
  const k = c.req.param('kind') as SprintDocKind;
  if (!SPRINT_DOC_KINDS.includes(k)) throw new HttpError(404, 'Type de document inconnu');
  return k;
}

/** Version texte d'une requête Messages : ce que voit le modèle, dans l'ordre. */
function promptText(model: string, body: Record<string, unknown>): string {
  const system = (body.system as { text: string }[] | undefined) ?? [];
  const messages = (body.messages as { role: string; content: string }[] | undefined) ?? [];
  const out = body.output_config as { effort?: string; format?: { schema?: unknown } } | undefined;
  return [
    `<!-- Requête Bedrock : modèle ${model}, max_tokens ${String(body.max_tokens)}, effort ${out?.effort ?? '—'} -->`,
    '',
    '=== SYSTÈME ===',
    system.map((b) => b.text).join('\n\n'),
    '',
    ...messages.flatMap((m) => [`=== ${m.role === 'user' ? 'UTILISATEUR' : 'ASSISTANT'} ===`, m.content, '']),
    '=== FORMAT DE RÉPONSE ===',
    'Bedrock impose ce format par output_config.format (il ne fait pas partie du texte envoyé) ; pour une IA locale :',
    'réponds uniquement par un objet JSON conforme à ce schéma JSON.',
    JSON.stringify(out?.format?.schema ?? {}, null, 2),
  ].join('\n');
}

/** Note du journal pour un compte rendu : chiffres clés + compte rendu. */
function reviewContent(r: SprintReport, labels: StatusLabels, markdown: string): string {
  const c = r.counts;
  const figures = [
    `- **Tickets** : ${c.done} clôturés sur ${c.active} (${c.recette} ${labels.recette.toLowerCase()}) ; ${c.added} ajoutés en cours de sprint, ${c.removed} retirés`,
    c.overdue ? `- **Échéances dépassées** : ${r.issues.filter((i) => i.overdue).map((i) => i.key).join(', ')}` : '',
    `- **Répartition** : ${r.byStatus.filter((g) => g.count).map((g) => `${labels[g.status].toLowerCase()} ${g.count}`).join(', ')}`,
  ].filter(Boolean);
  return `*Revue du ${r.sprint.name} — données arrêtées au ${shortDay(r.asOfDay)}.*\n\n${figures.join('\n')}\n\n${markdown}`;
}

/** Routes du module Sprints (montées sous /api/sprints). Les tickets se modifient par les routes des projets. */
export function sprintRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await overview()));

  /** Nouveau sprint, à la suite du dernier : « Sprint N », deux semaines. Déjà terminé (fin passée) : enregistré clos. */
  r.post('/', async (c) => {
    const b = await body(c, createSprintBody);
    const last = (await repo.listSprintItems()).filter((s) => s.state !== 'closed').at(-1);
    const today = parisDay(Date.now());
    const startDate = b.startDate || (last?.endDate && last.endDate >= today ? addDays(last.endDate, 1) : today);
    const endDate = b.endDate || addDays(startDate, DEFAULT_SPRINT_DAYS - 1);
    if (endDate < startDate) throw new HttpError(400, 'La fin du sprint doit suivre son début.');
    return c.json(await repo.createSprint({ ...b, startDate, endDate }, userName(c), endDate < today), 201);
  });

  r.get('/:sprintId', async (c) => c.json(await sprintDetail(idParam(c))));

  r.put('/:sprintId', async (c) => {
    const id = idParam(c);
    const b = await body(c, sprintInputSchema);
    const it = await repo.requireSprintItem(id);
    if (b.startDate && b.endDate && b.endDate < b.startDate) throw new HttpError(400, 'La fin du sprint doit suivre son début.');
    // Sprint passé enregistré après coup : son lancement et sa clôture suivent ses dates.
    const past = isRecordedPastSprint(repo.toSprint(it));
    if (past && !b.endDate) throw new HttpError(400, 'Un sprint passé garde une date de fin.');
    await repo.setSprintFields(id, past ? { ...b, ...pastSprintTimes(b.startDate, b.endDate) } : b, userName(c));
    return c.json(await sprintDetail(id));
  });

  /** Lance un sprint à venir. Un seul sprint est en cours à la fois. */
  r.post('/:sprintId/start', async (c) => {
    const id = idParam(c);
    const it = await repo.requireSprintItem(id);
    if (it.state !== 'future') throw new HttpError(400, `Le sprint « ${it.name} » est déjà ${it.state === 'active' ? 'en cours' : 'clos'}.`);
    const current = (await repo.listSprintItems()).find((s) => s.state === 'active');
    if (current) throw new HttpError(409, `Le sprint « ${current.name} » est en cours : clôturez-le d’abord.`);
    const today = parisDay(Date.now());
    const startDate = it.startDate && it.startDate <= today ? it.startDate : today;
    const endDate = it.endDate && it.endDate >= startDate ? it.endDate : addDays(startDate, DEFAULT_SPRINT_DAYS - 1);
    await repo.setSprintFields(id, { state: 'active', startedAt: nowIso(), startDate, endDate }, userName(c));
    return c.json(await sprintDetail(id));
  });

  /** Clôture le sprint en cours : ses tickets non terminés partent dans le sprint choisi (à venir) ou au backlog. */
  r.post('/:sprintId/close', async (c) => {
    const id = idParam(c);
    const b = await body(c, closeSprintBody);
    const user = userName(c);
    const it = await repo.requireSprintItem(id);
    if (it.state !== 'active') throw new HttpError(400, `Le sprint « ${it.name} » n’est pas en cours.`);
    if (b.moveTo !== null) {
      const dest = await repo.getSprintItem(b.moveTo);
      if (!dest || dest.state !== 'future') throw new HttpError(400, 'Choisissez un sprint à venir, ou le backlog, pour les tickets non terminés.');
    }
    // La clôture précède les déplacements : les chiffres du sprint s'arrêtent avant que ses tickets ne le quittent.
    await repo.setSprintFields(id, { state: 'closed', completedAt: nowIso() }, user);
    const open = (await pr.ticketsOfSprint(id)).filter((t) => !t.done);
    for (const t of open) await pr.updateItem(t.projectId, 'tasks', t.id, { sprintId: b.moveTo }, user);
    return c.json({ moved: open.length, detail: await sprintDetail(id) });
  });

  /**
   * Classe comme sprint passé un sprint à venir dont la fin est dépassée (créé après coup pour l'historique) : il est
   * clos à ses dates, sans passer par « en cours ». Ses tickets non terminés partent comme à une clôture.
   */
  r.post('/:sprintId/past', async (c) => {
    const id = idParam(c);
    const b = await body(c, closeSprintBody);
    const user = userName(c);
    const it = await repo.requireSprintItem(id);
    if (it.state !== 'future') throw new HttpError(400, `Le sprint « ${it.name} » est ${it.state === 'active' ? 'en cours : clôturez-le' : 'déjà clos'}.`);
    if (!isPastSprint(it, parisDay(Date.now()))) throw new HttpError(400, `Le sprint « ${it.name} » n’est pas terminé : sa date de fin n’est pas passée.`);
    if (b.moveTo !== null) {
      const dest = await repo.getSprintItem(b.moveTo);
      if (!dest || dest.state === 'closed' || dest.id === id) throw new HttpError(400, 'Choisissez un sprint en cours ou à venir, ou le backlog, pour les tickets non terminés.');
    }
    await repo.setSprintFields(id, { state: 'closed', ...pastSprintTimes(it.startDate, it.endDate), recordedAt: nowIso() }, user);
    const open = (await pr.ticketsOfSprint(id)).filter((t) => !t.done);
    for (const t of open) await pr.updateItem(t.projectId, 'tasks', t.id, { sprintId: b.moveTo }, user);
    return c.json({ moved: open.length, detail: await sprintDetail(id) });
  });

  /** Planifie dans le sprint tous les tickets ouverts d'un projet (ou hors projet) restés au backlog. */
  r.post('/:sprintId/plan-project', async (c) => {
    const id = idParam(c);
    const b = await body(c, planProjectBody);
    const user = userName(c);
    await repo.assertPlannable(id);
    const backlog = (await pr.listTickets()).filter((t) => t.projectId === b.projectId && t.sprintId === null && !t.done);
    if (!backlog.length) throw new HttpError(400, 'Aucun ticket ouvert de ce projet au backlog.');
    for (const t of backlog) await pr.updateItem(t.projectId, 'tasks', t.id, { sprintId: id }, user);
    return c.json({ planned: backlog.length });
  });

  /** Supprime un sprint à venir : ses tickets reviennent au backlog. */
  r.delete('/:sprintId', async (c) => {
    const id = idParam(c);
    const user = userName(c);
    const it = await repo.requireSprintItem(id);
    if (it.state !== 'future') throw new HttpError(400, 'Seul un sprint à venir peut être supprimé.');
    if (repo.activeJob(it)) throw new HttpError(409, 'Un document de ce sprint est en cours de rédaction. Attendez la fin du traitement.');
    for (const t of await pr.ticketsOfSprint(id)) await pr.updateItem(t.projectId, 'tasks', t.id, { sprintId: null }, user);
    await repo.deleteSprint(id);
    return c.body(null, 204);
  });

  // ---- Documents ---------------------------------------------------------------------------

  r.post('/:sprintId/documents/:kind', async (c) => {
    const id = idParam(c);
    const kind = kindParam(c);
    const it = await repo.requireSprintItem(id);
    if (!sprintDocKinds(it.state).includes(kind)) {
      throw new HttpError(400, kind === 'compte_rendu' ? 'Ce sprint n’a pas encore démarré : préparez-le plutôt.' : 'Ce sprint est clos : rédigez plutôt son compte rendu.');
    }
    return c.json(await startJob(JOB_OF_DOC[kind], String(id), userName(c), {}), 202);
  });

  /**
   * Tests : requête exacte qui serait envoyée à Bedrock pour ce document, sans appel au modèle (aucun coût),
   * pour la rejouer sur une IA locale.
   */
  r.get('/:sprintId/documents/:kind/prompt', async (c) => {
    const id = idParam(c);
    const call = await sprintDocCall(kindParam(c), id, { user: userName(c), cdcId: String(id) });
    const model = call.tier === 'fast' ? config.modelFast : config.modelSmart;
    const req = await captureBedrockRequest(call, model);
    const res: SprintPromptExport = { model, url: req.url, body: req.body, text: promptText(model, req.body) };
    return c.json(res);
  });

  r.put('/:sprintId/documents/:kind', async (c) => {
    const id = idParam(c);
    const kind = kindParam(c);
    const b = await body(c, saveSprintDocBody);
    const it = await repo.requireSprintItem(id);
    if (repo.activeJob(it)) throw new HttpError(409, 'Un document de ce sprint est en cours de rédaction. Attendez la fin du traitement.');
    const user = userName(c);
    const before = repo.sprintDocs(it)[kind];
    await repo.setDocument(id, kind, before ? { ...before, markdown: b.markdown, editedAt: nowIso(), editedBy: user } : repo.newDocument(b.markdown, user));
    return c.json(await sprintDetail(id));
  });

  /** Ajoute le document au journal d'un projet. */
  r.post('/:sprintId/documents/:kind/journal', async (c) => {
    const id = idParam(c);
    const kind = kindParam(c);
    const b = await body(c, publishSprintDocBody);
    const detail = await sprintDetail(id);
    const doc = detail.documents[kind];
    if (!doc?.markdown.trim()) throw new HttpError(400, 'Rédigez d’abord le document.');
    await pr.requireProject(b.projectId);
    const name = detail.sprint.name;
    const review = kind === 'compte_rendu' && detail.report;
    const note = await pr.createItem(
      b.projectId,
      'notes',
      {
        kind: review ? 'compte_rendu' : 'info',
        title: review ? `Revue du ${name}` : `Préparation du ${name}`,
        date: review ? detail.report!.asOfDay : parisDay(detail.asOf),
        content: (review ? reviewContent(detail.report!, await ticketLabels(), doc.markdown) : `*Préparation du ${name} — données du ${shortDay(parisDay(detail.asOf))}.*\n\n${doc.markdown}`).slice(0, 60_000),
      },
      userName(c),
      { extra: { origin: doc.editedAt ? 'manuel' : 'ia' } },
    );
    return c.json(note, 201);
  });

  /** Document au format Word. */
  r.post('/:sprintId/documents/:kind/word', async (c) => {
    const id = idParam(c);
    const kind = kindParam(c);
    const it = await repo.requireSprintItem(id);
    const doc = repo.sprintDocs(it)[kind];
    if (!doc?.markdown.trim()) throw new HttpError(400, 'Rédigez d’abord le document.');
    const title = `${SPRINT_DOC_LABELS[kind]} — ${it.name}`;
    const day = parisDay(doc.createdAt);
    const buffer = await renderMarkdownDocx(title, `Rédigé le ${shortDay(day)}/${day.slice(0, 4)}`, doc.markdown);
    const fileName = `${title.replace(/[\\/:*?"<>|]+/g, '-')}.docx`;
    const key = blobKeys.export(`sprint-${id}`, `${newId()}.docx`);
    await blobs().put(key, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName);
    return c.json({ url: await blobs().downloadUrl(key, { fileName, expiresIn: 300 }), fileName });
  });

  return r;
}
