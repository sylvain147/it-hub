/** Vues du module Sprints : liste des sprints et tickets à planifier, détail chiffré d'un sprint. */
import {
  boardOf,
  buildSprintPreparation,
  buildSprintReport,
  NO_PROJECT_ID,
  statusLabels,
  type Sprint,
  type SprintDetail,
  type SprintHistoryEntry,
  type SprintPreparation,
  type SprintReport,
  type SprintsOverview,
  type StatusLabels,
  type TicketView,
} from '@samm/shared';
import { nowIso } from '../lib/util.js';
import { getLists } from '../settings/repo.js';
import * as pr from '../projects/repo.js';
import * as repo from './repo.js';

export async function ticketLabels(): Promise<StatusLabels> {
  return statusLabels(await getLists(), 'ticket') as StatusLabels;
}

/** Clos : du plus récent au plus ancien, selon la clôture (un sprint passé créé après coup se range à sa date). */
const byRecentClosure = (a: Sprint, b: Sprint) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.id - a.id;

/** En cours, puis à venir (dans l'ordre), puis clos du plus récent au plus ancien. */
function sprintOrder(a: Sprint, b: Sprint): number {
  const rank = { active: 0, future: 1, closed: 2 } as const;
  return rank[a.state] - rank[b.state] || (a.state === 'closed' ? byRecentClosure(a, b) : a.id - b.id);
}

/** Sprints d'un tableau et ses tickets à planifier. */
export async function overview(boardId: string): Promise<SprintsOverview> {
  const [items, all] = await Promise.all([repo.listSprintItems(boardId), pr.listTickets()]);
  const tickets = all.filter((t) => boardOf(t) === boardId);
  const open = new Set(items.filter((s) => s.state !== 'closed').map((s) => s.id));
  return {
    boardId,
    sprints: items
      .map((it) => {
        const of = tickets.filter((t) => t.sprintId === it.id);
        return { ...repo.toSprint(it), ticketCount: of.length, openCount: of.filter((t) => !t.done).length, hasCompteRendu: !!it.compteRendu, hasPreparation: !!it.preparation };
      })
      .sort(sprintOrder),
    tickets: tickets.filter((t) => (t.sprintId !== null && open.has(t.sprintId)) || (t.sprintId === null && !t.done)).sort((a, b) => a.number - b.number),
  };
}

/** Bilan des derniers sprints clos (du plus récent au plus ancien), pour estimer le rythme de l'équipe. */
function history(sprints: Sprint[], tickets: TicketView[], labels: StatusLabels, now: string): SprintHistoryEntry[] {
  const names = Object.fromEntries(sprints.map((s) => [s.id, s.name]));
  return sprints
    .filter((s) => s.state === 'closed')
    .sort(byRecentClosure)
    .slice(0, 3)
    .map((s) => {
      const r = buildSprintReport({ sprint: s, tickets, sprintNames: names, now, labels });
      return { name: s.name, done: r.counts.done, active: r.counts.active };
    });
}

/** Chiffres d'un sprint ; la préparation ne regarde que son tableau (sprints, rythme, backlog). */
export async function sprintNumbers(sprint: Sprint): Promise<{ report: SprintReport | null; preparation: SprintPreparation | null; tickets: TicketView[]; labels: StatusLabels }> {
  const [items, tickets, labels] = await Promise.all([repo.listSprintItems(), pr.listTickets(), ticketLabels()]);
  const sprints = items.map(repo.toSprint);
  const now = nowIso();
  const report = sprint.state === 'future' ? null : buildSprintReport({ sprint, tickets, sprintNames: Object.fromEntries(sprints.map((s) => [s.id, s.name])), now, labels });
  const board = sprints.filter((s) => s.boardId === sprint.boardId);
  const boardTickets = tickets.filter((t) => boardOf(t) === sprint.boardId || t.sprintId === sprint.id);
  const preparation = sprint.state === 'closed' ? null : buildSprintPreparation({ sprint, tickets: boardTickets, sprints: board, history: history(board, tickets, labels, now), now, labels });
  return { report, preparation, tickets, labels };
}

export async function sprintDetail(id: number): Promise<SprintDetail> {
  const item = await repo.requireSprintItem(id);
  const sprint = repo.toSprint(item);
  const { report, preparation, tickets } = await sprintNumbers(sprint);

  // Projets des tickets du sprint : proposés pour publier un document dans leur journal.
  const ids = new Set([...(report?.issues ?? []).map((i) => i.id), ...(preparation?.planned ?? []).map((i) => i.id)]);
  const counts = new Map<string, { id: string; name: string; count: number }>();
  for (const t of tickets) {
    if (!ids.has(t.id) || t.projectId === NO_PROJECT_ID) continue;
    const c = counts.get(t.projectId) ?? { id: t.projectId, name: t.projectName, count: 0 };
    c.count++;
    counts.set(t.projectId, c);
  }

  return {
    sprint,
    asOf: report?.asOf ?? nowIso(),
    report,
    preparation,
    documents: repo.sprintDocs(item),
    activeJobId: repo.activeJob(item),
    projects: [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr')),
  };
}
