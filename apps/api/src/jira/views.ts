/** Vues du module Jira : synthèse de l'import, tickets avec leur projet, détail d'un sprint. */
import {
  buildSprintPreparation,
  buildSprintReport,
  type DeskLink,
  type JiraOverview,
  type JiraSprintInfo,
  type JiraTaskView,
  type SprintDetail,
  type SprintPreparation,
} from '@samm/shared';
import * as tma from '../tma/repo.js';
import * as pr from '../projects/repo.js';
import * as repo from './repo.js';

async function projectNames(): Promise<Map<string, string>> {
  return new Map((await pr.listProjects()).map((p) => [p.id, p.name]));
}

/** Tickets importés avec leur projet (un rattachement vers un projet supprimé est ignoré). */
export async function taskViews(imp: repo.StoredImport | null, filter: { projectId?: string } = {}): Promise<JiraTaskView[]> {
  if (!imp) return [];
  const [links, names] = await Promise.all([repo.listLinks(), projectNames()]);
  const out: JiraTaskView[] = [];
  for (const t of imp.tasks) {
    const pid = links.get(t.key);
    const projectId = pid && names.has(pid) ? pid : null;
    if (filter.projectId && projectId !== filter.projectId) continue;
    out.push({ ...t, projectId, projectName: projectId ? names.get(projectId)! : '' });
  }
  return out;
}

export async function overview(): Promise<JiraOverview> {
  const [conf, imp] = await Promise.all([repo.getConf(), repo.getImport()]);
  const info = repo.confInfo(conf);
  const flags = await repo.sprintDocFlags((imp?.sprints ?? []).map((s) => s.id));
  return {
    configured: info.configured,
    site: imp?.site ?? info.site,
    boards: conf?.boards ?? [],
    syncedAt: imp?.syncedAt ?? null,
    syncedBy: imp?.syncedBy ?? null,
    warnings: imp?.warnings ?? [],
    sprints: (imp?.sprints ?? []).map((s) => ({ ...s, hasCompteRendu: !!flags.get(s.id)?.compteRendu, hasPreparation: !!flags.get(s.id)?.preparation })),
    tasks: await taskViews(imp),
  };
}

/** Éléments de préparation d'un sprint, calculés à partir du dernier import. */
export async function sprintPreparation(sprint: JiraSprintInfo, imp?: repo.StoredImport | null): Promise<SprintPreparation | null> {
  imp ??= await repo.getImport();
  if (!imp) return null;
  const known = imp.sprints.find((s) => s.id === sprint.id);
  const boardId = known?.boardId ?? sprint.boardId;
  const views = await taskViews(imp);
  const tasks = views.filter((t) => t.boardId === boardId || t.sprintIds.includes(sprint.id));
  return buildSprintPreparation({
    sprint: known ? { id: known.id, name: known.name, state: known.state, startDate: known.startDate, endDate: known.endDate, completeDate: known.completeDate, goal: known.goal, boardId } : sprint,
    boardName: known?.boardName ?? imp.boards.find((b) => b.id === boardId)?.name ?? '',
    tasks,
    sprints: imp.sprints.filter((s) => s.boardId === boardId),
    history: imp.history[boardId] ?? [],
    projects: Object.fromEntries(tasks.filter((t) => t.projectName).map((t) => [t.key, t.projectName])),
    asOf: imp.syncedAt,
  });
}

export async function sprintDetail(id: number | string): Promise<SprintDetail> {
  const { item, snapshot, activeJobId } = await repo.getSprint(id);
  const imp = await repo.getImport();
  const state = snapshot.sprint.state;
  const report = state === 'future' ? null : buildSprintReport(snapshot);
  const preparation = state === 'closed' ? null : await sprintPreparation(snapshot.sprint, imp);

  const refs = new Set((report?.issues ?? []).map((i) => i.deskRef).filter(Boolean));
  const desk: Record<string, DeskLink> = {};
  if (refs.size) {
    for (const t of await tma.listTickets()) if (refs.has(t.id)) desk[t.id] = { subject: t.subject, status: t.status, theme: t.theme };
  }

  // Projets du hub reliés aux tickets du sprint : proposés pour publier un document dans leur journal.
  const keys = new Set([...snapshot.issues.map((i) => i.key), ...(preparation?.planned ?? []).map((i) => i.key)]);
  const counts = new Map<string, { id: string; name: string; count: number }>();
  for (const t of await taskViews(imp)) {
    if (!t.projectId || !keys.has(t.key)) continue;
    const c = counts.get(t.projectId) ?? { id: t.projectId, name: t.projectName, count: 0 };
    c.count++;
    counts.set(t.projectId, c);
  }

  return {
    site: snapshot.site,
    boardName: imp?.sprints.find((s) => s.id === snapshot.sprint.id)?.boardName ?? '',
    syncedAt: item.syncedAt,
    syncedBy: item.syncedBy,
    report,
    preparation,
    documents: repo.sprintDocs(item),
    activeJobId,
    desk,
    projects: [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr')),
  };
}
