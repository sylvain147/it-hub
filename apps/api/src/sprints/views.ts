/** Vues du module Sprints : liste des sprints et tickets à planifier, détail chiffré d'un sprint. */
import {
  buildSprintPreparation,
  buildSprintReport,
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

/** En cours, puis à venir (dans l'ordre), puis clos du plus récent au plus ancien. */
function sprintOrder(a: Sprint, b: Sprint): number {
  const rank = { active: 0, future: 1, closed: 2 } as const;
  return rank[a.state] - rank[b.state] || (a.state === 'closed' ? b.id - a.id : a.id - b.id);
}

export async function overview(): Promise<SprintsOverview> {
  const [items, tickets] = await Promise.all([repo.listSprintItems(), pr.listTickets()]);
  const open = new Set(items.filter((s) => s.state !== 'closed').map((s) => s.id));
  return {
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
    .sort((a, b) => b.id - a.id)
    .slice(0, 3)
    .map((s) => {
      const r = buildSprintReport({ sprint: s, tickets, sprintNames: names, now, labels });
      return { name: s.name, done: r.counts.done, active: r.counts.active };
    });
}

export async function sprintNumbers(sprint: Sprint): Promise<{ report: SprintReport | null; preparation: SprintPreparation | null; tickets: TicketView[]; labels: StatusLabels }> {
  const [items, tickets, labels] = await Promise.all([repo.listSprintItems(), pr.listTickets(), ticketLabels()]);
  const sprints = items.map(repo.toSprint);
  const now = nowIso();
  const report = sprint.state === 'future' ? null : buildSprintReport({ sprint, tickets, sprintNames: Object.fromEntries(sprints.map((s) => [s.id, s.name])), now, labels });
  const preparation = sprint.state === 'closed' ? null : buildSprintPreparation({ sprint, tickets, sprints, history: history(sprints, tickets, labels, now), now, labels });
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
    if (!ids.has(t.id)) continue;
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
