import { Hono, type Context } from 'hono';
import {
  jiraBoardsBody,
  jiraConfigBody,
  JIRA_DEMO_SITE,
  linkJiraTasksBody,
  normalizeJiraSite,
  publishSprintDocBody,
  saveSprintDocBody,
  shortDay,
  sprintDocKinds,
  SPRINT_DOC_KINDS,
  SPRINT_DOC_LABELS,
  SPRINT_GROUP_LABELS,
  type SprintDocKind,
  type SprintPromptExport,
  type SprintReport,
} from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { body } from '../lib/http.js';
import { HttpError, newId, nowIso } from '../lib/util.js';
import { startJob } from '../jobs/runner.js';
import { blobKeys } from '../db/schema.js';
import { blobs } from '../storage/blobs.js';
import { renderMarkdownDocx } from '../export/docx.js';
import * as pr from '../projects/repo.js';
import { JiraClient } from './client.js';
import * as repo from './repo.js';
import { JOB_OF_DOC, sprintDocCall } from './jobs.js';
import { captureBedrockRequest } from '../ai/bedrock.js';
import { importBoards, listBoards, testConnection } from './sync.js';
import { overview, sprintDetail, taskViews } from './views.js';

function idParam(c: Context, name: string): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `Paramètre ${name} invalide`);
  return n;
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

function kindParam(c: Context): SprintDocKind {
  const k = c.req.param('kind') as SprintDocKind;
  if (!SPRINT_DOC_KINDS.includes(k)) throw new HttpError(404, 'Type de document inconnu');
  return k;
}

async function client(): Promise<{ jira: JiraClient; conf: repo.JiraConf }> {
  const conf = await repo.requireConf();
  return { jira: new JiraClient(conf), conf };
}

/** Note du journal pour un compte rendu : chiffres clés + compte rendu. */
function reviewContent(r: SprintReport, markdown: string): string {
  const c = r.counts;
  const figures = [
    `- **Tickets** : ${c.done} clôturés sur ${c.active} (${c.recette} en recette) ; ${c.added} ajoutés en cours de sprint, ${c.removed} retirés`,
    `- **Story points** : ${r.points.done} livrés sur ${r.points.active}`,
    c.overdue ? `- **Échéances dépassées** : ${r.issues.filter((i) => i.overdue).map((i) => i.key).join(', ')}` : '',
    `- **Répartition** : ${r.byGroup.filter((g) => g.count).map((g) => `${SPRINT_GROUP_LABELS[g.group].toLowerCase()} ${g.count}`).join(', ')}`,
  ].filter(Boolean);
  return `*Revue du ${r.sprint.name} — données arrêtées au ${shortDay(r.asOfDay)}.*\n\n${figures.join('\n')}\n\n${markdown}`;
}

/** Routes du module Jira (montées sous /api/jira). */
export function jiraRoutes() {
  const r = new Hono();

  // ---- Connexion ---------------------------------------------------------------

  r.get('/config', async (c) => c.json(repo.confInfo(await repo.getConf())));

  /** Enregistre la connexion après l'avoir testée (le compte et les champs détectés sont mémorisés). */
  r.put('/config', async (c) => {
    const b = await body(c, jiraConfigBody);
    const site = normalizeJiraSite(b.site)!;
    if (site === JIRA_DEMO_SITE && config.runtime === 'aws') throw new HttpError(400, 'Le site de démonstration n’est disponible qu’en local.');
    const before = await repo.getConf();
    const token = b.token || (before?.site === site ? before.token : '');
    if (site !== JIRA_DEMO_SITE && (!b.email || !token)) throw new HttpError(400, 'L’e-mail du compte et le jeton d’API sont obligatoires.');
    const jira = new JiraClient({ site, email: b.email, token });
    const { sprintField, ...test } = await testConnection(jira, b);
    await repo.putConf({
      site,
      email: b.email,
      token,
      storyPoints: test.storyPoints,
      deskRef: test.deskRef,
      sprintField,
      accountName: test.accountName,
      updatedAt: nowIso(),
      updatedBy: userName(c),
    });
    return c.json({ config: repo.confInfo(await repo.getConf()), test });
  });

  r.get('/fields', async (c) => {
    const { jira, conf } = await client();
    const { sprintField: _s, ...test } = await testConnection(jira, { storyPointsField: conf.storyPoints?.id ?? '', deskRefField: conf.deskRef?.id ?? '' });
    return c.json(test);
  });

  // ---- Tableaux suivis et import ---------------------------------------------------

  r.get('/boards', async (c) => {
    const { jira } = await client();
    return c.json(await listBoards(jira, (c.req.query('project') ?? '').trim().toUpperCase()));
  });

  /** Choisit les tableaux dont les sprints et le backlog sont importés (Scrum, ou projet géré par l'équipe). */
  r.put('/boards', async (c) => {
    const b = await body(c, jiraBoardsBody);
    const { jira } = await client();
    const all = await listBoards(jira, '');
    const boards = [...new Set(b.boardIds)].map((id) => {
      const board = all.find((x) => x.id === id);
      if (!board) throw new HttpError(404, `Tableau Jira ${id} introuvable (ou inaccessible au compte du hub).`);
      return board;
    });
    await repo.setBoards(boards);
    return c.json(await overview());
  });

  r.get('/overview', async (c) => c.json(await overview()));

  /** Importe les sprints récents (avec l'historique de leurs tickets) et le backlog ouvert des tableaux suivis. */
  r.post('/import', async (c) => {
    const { jira, conf } = await client();
    if (!conf.boards?.length) throw new HttpError(400, 'Choisissez d’abord les tableaux Jira à importer.');
    const res = await importBoards(jira, {
      site: conf.site,
      boards: conf.boards,
      storyPointsField: conf.storyPoints?.id ?? null,
      deskRefField: conf.deskRef?.id ?? null,
      sprintField: conf.sprintField,
    });
    await repo.saveImport(res, userName(c));
    return c.json(await overview());
  });

  // ---- Tickets : rattachement aux projets du hub ----------------------------------------

  r.get('/tasks', async (c) => {
    const projectId = c.req.query('projectId') || undefined;
    return c.json(await taskViews(await repo.getImport(), { projectId }));
  });

  /**
   * Relie des tickets à un projet, les détache, ou les rend au rattachement automatique par l'épopée (`projectId` « auto »).
   * Les tickets eux-mêmes ne se modifient que dans Jira.
   */
  r.put('/links', async (c) => {
    const b = await body(c, linkJiraTasksBody);
    if (b.projectId && b.projectId !== repo.AUTO_LINK) await pr.requireProject(b.projectId);
    await repo.setLinks([...new Set(b.keys)], b.projectId, userName(c));
    return c.json({ updated: b.keys.length });
  });

  // ---- Sprints et documents ---------------------------------------------------------------

  r.get('/sprints/:sprintId', async (c) => c.json(await sprintDetail(idParam(c, 'sprintId'))));

  r.post('/sprints/:sprintId/documents/:kind', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const kind = kindParam(c);
    const { snapshot } = await repo.getSprint(sprintId);
    if (!sprintDocKinds(snapshot.sprint.state).includes(kind)) {
      throw new HttpError(400, kind === 'compte_rendu' ? 'Ce sprint n’a pas encore démarré : préparez-le plutôt.' : 'Ce sprint est clos : rédigez plutôt son compte rendu.');
    }
    return c.json(await startJob(JOB_OF_DOC[kind], String(sprintId), userName(c), {}), 202);
  });

  /**
   * Tests : requête exacte qui serait envoyée à Bedrock pour ce document, sans appel au modèle (aucun coût),
   * pour la rejouer sur une IA locale.
   */
  r.get('/sprints/:sprintId/documents/:kind/prompt', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const kind = kindParam(c);
    const call = await sprintDocCall(kind, sprintId, { user: userName(c), cdcId: String(sprintId) });
    const model = call.tier === 'fast' ? config.modelFast : config.modelSmart;
    const req = await captureBedrockRequest(call, model);
    const res: SprintPromptExport = { model, url: req.url, body: req.body, text: promptText(model, req.body) };
    return c.json(res);
  });

  r.put('/sprints/:sprintId/documents/:kind', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const kind = kindParam(c);
    const b = await body(c, saveSprintDocBody);
    const { item, activeJobId } = await repo.getSprint(sprintId);
    if (activeJobId) throw new HttpError(409, 'Un document de ce sprint est en cours de rédaction. Attendez la fin du traitement.');
    const user = userName(c);
    const before = repo.sprintDocs(item)[kind];
    await repo.setDocument(sprintId, kind, before ? { ...before, markdown: b.markdown, editedAt: nowIso(), editedBy: user } : repo.newDocument(b.markdown, user));
    return c.json(await sprintDetail(sprintId));
  });

  /** Ajoute le document au journal d'un projet. */
  r.post('/sprints/:sprintId/documents/:kind/journal', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const kind = kindParam(c);
    const b = await body(c, publishSprintDocBody);
    const detail = await sprintDetail(sprintId);
    const doc = detail.documents[kind];
    if (!doc?.markdown.trim()) throw new HttpError(400, 'Rédigez d’abord le document.');
    await pr.requireProject(b.projectId);
    const { snapshot } = await repo.getSprint(sprintId);
    const name = snapshot.sprint.name;
    const review = kind === 'compte_rendu' && detail.report;
    const note = await pr.createItem(
      b.projectId,
      'notes',
      {
        kind: review ? 'compte_rendu' : 'info',
        title: review ? `Revue du ${name}` : `Préparation du ${name}`,
        date: review ? detail.report!.asOfDay : detail.syncedAt.slice(0, 10),
        content: (review ? reviewContent(detail.report!, doc.markdown) : `*Préparation du ${name} — données Jira du ${shortDay(detail.syncedAt.slice(0, 10))}.*\n\n${doc.markdown}`).slice(0, 60_000),
      },
      userName(c),
      { extra: { origin: doc.editedAt ? 'manuel' : 'ia' } },
    );
    return c.json(note, 201);
  });

  /** Document au format Word. */
  r.post('/sprints/:sprintId/documents/:kind/word', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const kind = kindParam(c);
    const { item } = await repo.getSprint(sprintId);
    const doc = repo.sprintDocs(item)[kind];
    if (!doc?.markdown.trim()) throw new HttpError(400, 'Rédigez d’abord le document.');
    const title = `${SPRINT_DOC_LABELS[kind]} — ${item.sprint.name}`;
    const subtitle = `Données Jira du ${shortDay(item.syncedAt.slice(0, 10))}/${item.syncedAt.slice(0, 4)}`;
    const buffer = await renderMarkdownDocx(title, subtitle, doc.markdown);
    const fileName = `${title.replace(/[\\/:*?"<>|]+/g, '-')}.docx`;
    const key = blobKeys.export(`jira-${sprintId}`, `${newId()}.docx`);
    await blobs().put(key, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName);
    return c.json({ url: await blobs().downloadUrl(key, { fileName, expiresIn: 300 }), fileName });
  });

  return r;
}
