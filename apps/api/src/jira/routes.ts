import { Hono, type Context } from 'hono';
import {
  buildSprintReport,
  jiraConfigBody,
  JIRA_DEMO_SITE,
  normalizeJiraSite,
  publishCompteRenduBody,
  saveCompteRenduBody,
  shortDay,
  syncSprintBody,
  SPRINT_GROUP_LABELS,
  type DeskLink,
  type JiraSprintListItem,
  type SprintDetail,
  type SprintReport,
} from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { body } from '../lib/http.js';
import { HttpError, nowIso } from '../lib/util.js';
import { startJob } from '../jobs/runner.js';
import * as tma from '../tma/repo.js';
import * as pr from '../projects/repo.js';
import { JiraClient } from './client.js';
import * as repo from './repo.js';
import { fetchSprintSnapshot, listBoards, listSprints, testConnection } from './sync.js';

function idParam(c: Context, name: string): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `Paramètre ${name} invalide`);
  return n;
}

async function client(): Promise<{ jira: JiraClient; conf: repo.JiraConf }> {
  const conf = await repo.requireConf();
  return { jira: new JiraClient(conf), conf };
}

async function sprintDetail(id: number): Promise<SprintDetail> {
  const { item, snapshot, activeJobId } = await repo.getSprint(id);
  const report = buildSprintReport(snapshot);
  const refs = new Set(report.issues.map((i) => i.deskRef).filter(Boolean));
  const desk: Record<string, DeskLink> = {};
  if (refs.size) {
    for (const t of await tma.listTickets()) if (refs.has(t.id)) desk[t.id] = { subject: t.subject, status: t.status, theme: t.theme };
  }
  return { site: snapshot.site, syncedAt: item.syncedAt, syncedBy: item.syncedBy, report, compteRendu: item.compteRendu, activeJobId, desk };
}

/** Note du journal : chiffres clés + compte rendu. */
function journalContent(r: SprintReport, markdown: string): string {
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

  // ---- Tableaux et sprints -------------------------------------------------------

  r.get('/boards', async (c) => {
    const { jira } = await client();
    return c.json(await listBoards(jira, (c.req.query('project') ?? '').trim().toUpperCase()));
  });

  r.get('/boards/:boardId/sprints', async (c) => {
    const boardId = idParam(c, 'boardId');
    const { jira } = await client();
    const [live, stored] = await Promise.all([listSprints(jira, boardId), repo.listBoardSprints(boardId)]);
    const byId = new Map(stored.map((s) => [s.sprint.id, s]));
    const list: JiraSprintListItem[] = live.map((s) => {
      const st = byId.get(s.id);
      return { ...s, syncedAt: st?.syncedAt ?? null, issueCount: st?.issueCount ?? null, hasCompteRendu: !!st?.compteRendu };
    });
    // Le plus récent d'abord : sprints à venir, en cours, puis clos.
    const rank = { future: 0, active: 1, closed: 2 } as const;
    list.sort((a, b) => rank[a.state] - rank[b.state] || (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.id - a.id);
    return c.json(list);
  });

  r.post('/sprints/:sprintId/sync', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const b = await body(c, syncSprintBody);
    const { jira, conf } = await client();
    const snap = await fetchSprintSnapshot(jira, {
      site: conf.site,
      boardId: b.boardId,
      sprintId,
      projectKey: b.projectKey.toUpperCase(),
      storyPointsField: conf.storyPoints?.id ?? null,
      deskRefField: conf.deskRef?.id ?? null,
      sprintField: conf.sprintField,
    });
    await repo.saveSnapshot(b.boardId, snap, userName(c));
    return c.json(await sprintDetail(sprintId));
  });

  r.get('/sprints/:sprintId', async (c) => c.json(await sprintDetail(idParam(c, 'sprintId'))));

  // ---- Compte rendu -----------------------------------------------------------------

  r.post('/sprints/:sprintId/compte-rendu', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    await repo.getSprint(sprintId);
    return c.json(await startJob('jira_sprint_review', String(sprintId), userName(c), {}), 202);
  });

  r.put('/sprints/:sprintId/compte-rendu', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const b = await body(c, saveCompteRenduBody);
    const { item, activeJobId } = await repo.getSprint(sprintId);
    if (activeJobId) throw new HttpError(409, 'Le compte rendu est en cours de rédaction. Attendez la fin du traitement.');
    const user = userName(c);
    const cr = item.compteRendu ? { ...item.compteRendu, markdown: b.markdown, editedAt: nowIso(), editedBy: user } : repo.newCompteRendu(b.markdown, user);
    await repo.setCompteRendu(sprintId, cr);
    return c.json(await sprintDetail(sprintId));
  });

  /** Ajoute le compte rendu au journal d'un projet. */
  r.post('/sprints/:sprintId/journal', async (c) => {
    const sprintId = idParam(c, 'sprintId');
    const b = await body(c, publishCompteRenduBody);
    const detail = await sprintDetail(sprintId);
    if (!detail.compteRendu?.markdown.trim()) throw new HttpError(400, 'Rédigez d’abord le compte rendu du sprint.');
    await pr.requireProject(b.projectId);
    const note = await pr.createItem(
      b.projectId,
      'notes',
      {
        kind: 'compte_rendu',
        title: `Revue du ${detail.report.sprint.name}`,
        date: detail.report.asOfDay,
        content: journalContent(detail.report, detail.compteRendu.markdown).slice(0, 60_000),
      },
      userName(c),
      { extra: { origin: detail.compteRendu.editedAt ? 'manuel' : 'ia' } },
    );
    return c.json(note, 201);
  });

  return r;
}
