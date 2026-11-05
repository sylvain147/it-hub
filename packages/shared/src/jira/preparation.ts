/**
 * Préparation d'un sprint Jira (à venir ou en cours) : à partir des tickets importés, le code calcule le périmètre
 * prévu, la charge par personne, la vélocité des derniers sprints, les reports probables, les candidats du backlog
 * et les points à clarifier. L'IA ne reçoit que ces éléments (`sprintPreparationToMarkdown`) pour rédiger le
 * document de préparation.
 */
import type { JiraTask } from './api.js';
import { parisDay, shortDay, SPRINT_GROUP_LABELS, statusGroup, type JiraSprintInfo, type SprintAlert, type SprintGroup } from './sprint.js';

export interface PreparationIssue {
  key: string;
  summary: string;
  type: string;
  priority: string;
  assignee: string;
  status: string;
  group: SprintGroup;
  points: number | null;
  dueDate: string;
  parent: string;
  /** Projet du hub auquel le ticket est relié. */
  project: string;
}

export interface SprintHistoryEntry {
  name: string;
  /** Tickets clôturés et story points livrés. */
  done: number;
  points: number;
  /** Tickets actifs en fin de sprint. */
  active: number;
}

export interface SprintPreparation {
  sprint: JiraSprintInfo;
  boardName: string;
  asOfDay: string;
  startDay: string | null;
  endDay: string | null;
  planned: PreparationIssue[];
  totals: { count: number; open: number; points: number; withPoints: number; unassigned: number; unestimated: number };
  byAssignee: { assignee: string; count: number; points: number }[];
  /** Derniers sprints clos du tableau (du plus récent au plus ancien). */
  history: SprintHistoryEntry[];
  velocity: { points: number | null; done: number | null };
  /** Tickets non terminés du sprint en cours, probablement à reporter (préparation d'un sprint à venir). */
  carryOver: PreparationIssue[];
  carryOverFrom: string | null;
  /** Tickets ouverts du backlog les plus prioritaires. */
  backlog: PreparationIssue[];
  backlogTotal: number;
  alerts: SprintAlert[];
}

export interface PreparationInput {
  sprint: JiraSprintInfo;
  boardName: string;
  /** Tickets importés du tableau. */
  tasks: JiraTask[];
  /** Sprints importés du tableau. */
  sprints: JiraSprintInfo[];
  history: SprintHistoryEntry[];
  /** Nom du projet du hub par clé de ticket. */
  projects?: Record<string, string>;
  /** Instant de référence (ISO) : date de l'import. */
  asOf: string;
}

const MAX_BACKLOG = 15;

/** Rang d'une priorité Jira (0 = la plus urgente), quel que soit le libellé (anglais ou français). */
export function priorityRank(p: string): number {
  if (/highest|critique|bloquant|blocker|urgent|majeure/i.test(p)) return 0;
  if (/high|haute|élevée|elevee/i.test(p)) return 1;
  if (/lowest|tr[èe]s basse|minime/i.test(p)) return 4;
  if (/low|basse|faible|mineure/i.test(p)) return 3;
  return 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const sumPts = (xs: { points: number | null }[]) => round1(xs.reduce((n, x) => n + (x.points ?? 0), 0));
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const keysList = (xs: { key: string }[]) => xs.map((x) => x.key).join(', ');

export function buildSprintPreparation(input: PreparationInput): SprintPreparation {
  const { sprint } = input;
  const projects = input.projects ?? {};
  const asOfDay = parisDay(input.asOf);
  const toIssue = (t: JiraTask): PreparationIssue => ({
    key: t.key,
    summary: t.summary,
    type: t.type,
    priority: t.priority,
    assignee: t.assignee || 'Non assigné',
    status: t.status,
    group: statusGroup(t.status, t.statusCategory),
    points: t.storyPoints,
    dueDate: t.dueDate,
    parent: t.parent,
    project: projects[t.key] ?? '',
  });
  const byPriority = (a: PreparationIssue, b: PreparationIssue) =>
    priorityRank(a.priority) - priorityRank(b.priority) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');

  const planned = input.tasks.filter((t) => t.sprintIds.includes(sprint.id)).map(toIssue).sort(byPriority);
  const open = planned.filter((i) => i.group !== 'termine');
  const startDay = sprint.startDate ? parisDay(sprint.startDate) : null;
  const endDay = sprint.endDate ? parisDay(sprint.endDate) : null;

  // Reports probables : préparer le sprint suivant pendant que le sprint en cours se termine.
  const current = sprint.state === 'future' ? input.sprints.find((s) => s.state === 'active' && s.id !== sprint.id) : undefined;
  const carryOver = current
    ? input.tasks.filter((t) => t.sprintIds.includes(current.id) && !t.sprintIds.includes(sprint.id) && t.statusCategory !== 'done').map(toIssue).sort(byPriority)
    : [];

  const backlogAll = input.tasks.filter((t) => !t.sprintIds.length && t.statusCategory !== 'done').map(toIssue);
  const backlog = [...backlogAll].sort(byPriority).slice(0, MAX_BACKLOG);

  const people = new Map<string, { assignee: string; count: number; points: number }>();
  for (const i of open) {
    const p = people.get(i.assignee) ?? { assignee: i.assignee, count: 0, points: 0 };
    p.count++;
    p.points = round1(p.points + (i.points ?? 0));
    people.set(i.assignee, p);
  }
  const byAssignee = [...people.values()].sort((a, b) => b.points - a.points || b.count - a.count || a.assignee.localeCompare(b.assignee, 'fr'));

  const history = input.history.slice(0, 3);
  const velocity = { points: avg(history.filter((h) => h.points > 0).map((h) => h.points)), done: avg(history.map((h) => h.done)) };
  const totals = {
    count: planned.length,
    open: open.length,
    points: sumPts(open),
    withPoints: open.filter((i) => i.points !== null).length,
    unassigned: open.filter((i) => i.assignee === 'Non assigné').length,
    unestimated: open.filter((i) => i.points === null).length,
  };

  // ---- Points à clarifier ----
  const alerts: SprintAlert[] = [];
  if (!sprint.goal.trim()) alerts.push({ level: 'info', title: 'Objectif non défini', text: 'Le sprint n’a pas encore d’objectif dans Jira.', keys: [] });
  if (sprint.state === 'future' && (!sprint.startDate || !sprint.endDate)) alerts.push({ level: 'info', title: 'Dates à fixer', text: 'Les dates de début et de fin du sprint ne sont pas encore renseignées.', keys: [] });
  if (!planned.length) alerts.push({ level: 'attention', title: 'Sprint vide', text: 'Aucun ticket n’est encore prévu dans ce sprint.', keys: [] });
  if (velocity.points && totals.points > velocity.points * 1.15) {
    alerts.push({
      level: 'attention',
      title: 'Charge supérieure à la vélocité',
      text: `${totals.points} SP prévus pour une vélocité moyenne de ${velocity.points} SP sur les derniers sprints (+${Math.round((totals.points / velocity.points - 1) * 100)} %).`,
      keys: [],
    });
  }
  if (velocity.done && totals.open > velocity.done * 1.3 && !velocity.points) {
    alerts.push({ level: 'attention', title: 'Beaucoup de tickets', text: `${totals.open} tickets ouverts prévus pour ${velocity.done} clôturés en moyenne sur les derniers sprints.`, keys: [] });
  }
  const unestimated = open.filter((i) => i.points === null);
  if (unestimated.length) {
    alerts.push({
      level: unestimated.length > open.length / 3 ? 'attention' : 'info',
      title: 'Tickets à estimer',
      text: `${unestimated.length} ticket${unestimated.length > 1 ? 's' : ''} sans story points : ${keysList(unestimated)}.`,
      keys: unestimated.map((i) => i.key),
    });
  }
  const unassigned = open.filter((i) => i.assignee === 'Non assigné');
  if (unassigned.length) {
    alerts.push({ level: 'attention', title: 'Tickets sans responsable', text: `${keysList(unassigned)}.`, keys: unassigned.map((i) => i.key) });
  }
  const big = velocity.points ? open.filter((i) => i.points && i.points >= velocity.points! * 0.4) : [];
  for (const i of big) {
    alerts.push({ level: 'attention', title: `Ticket volumineux : ${i.key}`, text: `${i.points} SP, soit ${Math.round((i.points! / velocity.points!) * 100)} % de la vélocité moyenne : à découper.`, keys: [i.key] });
  }
  const late = open.filter((i) => i.dueDate && i.dueDate < (startDay ?? asOfDay));
  if (late.length) alerts.push({ level: 'critique', title: 'Échéances déjà dépassées', text: `${late.map((i) => `${i.key} (${shortDay(i.dueDate)})`).join(', ')}.`, keys: late.map((i) => i.key) });
  const urgentBacklog = backlogAll.filter((i) => priorityRank(i.priority) <= 1 || (i.dueDate && endDay && i.dueDate <= endDay));
  if (urgentBacklog.length) {
    alerts.push({
      level: 'attention',
      title: 'Urgences restées au backlog',
      text: `${urgentBacklog.length} ticket${urgentBacklog.length > 1 ? 's' : ''} prioritaire${urgentBacklog.length > 1 ? 's' : ''} ou à échéance avant la fin du sprint hors sprint : ${keysList(urgentBacklog.slice(0, 8))}${urgentBacklog.length > 8 ? '…' : ''}.`,
      keys: urgentBacklog.map((i) => i.key),
    });
  }
  if (carryOver.length) {
    alerts.push({
      level: 'info',
      title: `Reports probables du ${current!.name}`,
      text: `${carryOver.length} ticket${carryOver.length > 1 ? 's' : ''} non terminé${carryOver.length > 1 ? 's' : ''} (${sumPts(carryOver)} SP) : ${keysList(carryOver)}.`,
      keys: carryOver.map((i) => i.key),
    });
  }
  const top = byAssignee[0];
  if (top && byAssignee.length > 1 && totals.points && top.points / totals.points >= 0.5 && top.assignee !== 'Non assigné') {
    alerts.push({ level: 'info', title: 'Charge concentrée', text: `${top.assignee} porte ${Math.round((top.points / totals.points) * 100)} % des points du sprint.`, keys: [] });
  }

  return {
    sprint,
    boardName: input.boardName,
    asOfDay,
    startDay,
    endDay,
    planned,
    totals,
    byAssignee,
    history,
    velocity,
    carryOver,
    carryOverFrom: current?.name ?? null,
    backlog,
    backlogTotal: backlogAll.length,
    alerts,
  };
}

function issueLine(i: PreparationIssue): string {
  return `- ${i.key} « ${i.summary} » — ${i.assignee} · ${i.type} · ${i.priority || '?'} · ${i.points ?? '–'} SP · ${i.status}${i.dueDate ? ` · échéance ${shortDay(i.dueDate)}` : ''}${i.parent ? ` · parent ${i.parent}` : ''}${i.project ? ` · projet « ${i.project} »` : ''}`;
}

/** Éléments de préparation en Markdown compact : seule entrée du modèle pour le document de préparation. */
export function sprintPreparationToMarkdown(p: SprintPreparation): string {
  const L: string[] = [];
  const s = p.sprint;
  L.push(`# ${s.name} (${s.state === 'future' ? 'à venir' : s.state === 'active' ? 'en cours' : 'clos'}) — tableau ${p.boardName}`);
  L.push(s.goal.trim() ? `Objectif saisi dans Jira : ${s.goal.trim()}` : 'Objectif : non renseigné dans Jira');
  L.push(`- Dates : ${p.startDay ? `du ${shortDay(p.startDay)}` : 'début non fixé'}${p.endDay ? ` au ${shortDay(p.endDay)}` : ', fin non fixée'} ; données du ${shortDay(p.asOfDay)}`);
  const t = p.totals;
  L.push(`- Prévu : ${t.count} ticket(s) dont ${t.open} ouvert(s), ${t.points} SP (estimés sur ${t.withPoints} tickets ouverts sur ${t.open}) ; ${t.unassigned} sans responsable`);
  if (p.history.length) {
    L.push(`- Vélocité moyenne : ${p.velocity.points ?? '—'} SP et ${p.velocity.done ?? '—'} tickets clôturés par sprint`);
    for (const h of p.history) L.push(`  - ${h.name} : ${h.done} tickets clôturés sur ${h.active}, ${h.points} SP livrés`);
  } else {
    L.push('- Vélocité : aucun sprint clos importé');
  }
  L.push('\n## Charge par personne (tickets ouverts prévus)');
  for (const a of p.byAssignee) L.push(`- ${a.assignee} : ${a.count} ticket(s), ${a.points} SP`);
  if (!p.byAssignee.length) L.push('- (aucun ticket ouvert)');
  L.push('\n## Tickets prévus dans le sprint');
  for (const i of p.planned) L.push(`${issueLine(i)}${i.group === 'termine' ? ' (déjà terminé)' : ''}`);
  if (!p.planned.length) L.push('- (aucun)');
  if (p.carryOverFrom) {
    L.push(`\n## Tickets non terminés du ${p.carryOverFrom} (reports probables)`);
    for (const i of p.carryOver) L.push(`${issueLine(i)} · ${SPRINT_GROUP_LABELS[i.group].toLowerCase()}`);
    if (!p.carryOver.length) L.push('- (aucun)');
  }
  L.push(`\n## Backlog : ${p.backlog.length} ticket(s) les plus prioritaires sur ${p.backlogTotal} ouverts`);
  for (const i of p.backlog) L.push(issueLine(i));
  if (p.alerts.length) {
    L.push('\n## Points détectés');
    for (const a of p.alerts) L.push(`- [${a.level}] ${a.title} : ${a.text}`);
  }
  return L.join('\n');
}
