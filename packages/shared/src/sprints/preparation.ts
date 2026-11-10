/**
 * Préparation d'un sprint (à venir ou en cours) : à partir des tickets, le code calcule le périmètre prévu, la charge
 * par personne, le rythme des derniers sprints, les reports probables, les candidats du backlog et les points à
 * clarifier. L'IA ne reçoit que ces éléments (`sprintPreparationToMarkdown`) pour rédiger le document de préparation.
 */
import { ticketKey, type TicketStatus, type TicketView } from '../project.js';
import { parisDay, shortDay, type SprintAlert, type StatusLabels } from './report.js';
import type { Sprint } from './sprint.js';

export interface PreparationIssue {
  id: string;
  key: string;
  summary: string;
  assignee: string;
  status: TicketStatus;
  dueDate: string;
  projectId: string;
  project: string;
  /** Ticket Desk du prestataire (vide : aucun). */
  deskId: string;
}

export interface SprintHistoryEntry {
  name: string;
  /** Tickets clôturés dans le sprint. */
  done: number;
  /** Tickets actifs en fin de sprint. */
  active: number;
}

export interface SprintPreparation {
  sprint: Sprint;
  asOfDay: string;
  planned: PreparationIssue[];
  totals: { count: number; open: number; unassigned: number };
  byAssignee: { assignee: string; count: number }[];
  /** Derniers sprints clos (du plus récent au plus ancien). */
  history: SprintHistoryEntry[];
  /** Tickets clôturés en moyenne par sprint. */
  velocity: number | null;
  /** Tickets non terminés du sprint en cours, probablement à reporter (préparation d'un sprint à venir). */
  carryOver: PreparationIssue[];
  carryOverFrom: string | null;
  /** Tickets ouverts du backlog, les plus urgents d'abord. */
  backlog: PreparationIssue[];
  backlogTotal: number;
  alerts: SprintAlert[];
}

export interface PreparationInput {
  sprint: Sprint;
  /** Tous les tickets des sprints non clos et du backlog. */
  tickets: TicketView[];
  sprints: Sprint[];
  /** Derniers sprints clos, du plus récent au plus ancien. */
  history: SprintHistoryEntry[];
  /** Instant présent (ISO). */
  now: string;
  labels: StatusLabels;
}

const MAX_BACKLOG = 15;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const keysList = (xs: { key: string }[]) => xs.map((x) => x.key).join(', ');

/** Échéance la plus proche d'abord (sans échéance à la fin), puis ancienneté. */
const byUrgency = (a: TicketView, b: TicketView) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.number - b.number;

export function buildSprintPreparation(input: PreparationInput): SprintPreparation {
  const { sprint } = input;
  const asOfDay = parisDay(input.now);
  const toIssue = (t: TicketView): PreparationIssue => ({
    id: t.id,
    key: ticketKey(t),
    summary: t.title,
    assignee: t.assignee || 'Non assigné',
    status: t.status,
    dueDate: t.dueDate,
    projectId: t.projectId,
    project: t.projectName,
    deskId: t.deskId,
  });

  const planned = input.tickets.filter((t) => t.sprintId === sprint.id).sort(byUrgency).map(toIssue);
  const open = planned.filter((i) => i.status !== 'termine');
  const startDay = sprint.startDate || null;
  const endDay = sprint.endDate || null;

  // Reports probables : préparer le sprint suivant pendant que le sprint en cours se termine.
  const current = sprint.state === 'future' ? input.sprints.find((s) => s.state === 'active') : undefined;
  const carryOver = current ? input.tickets.filter((t) => t.sprintId === current.id && !t.done).sort(byUrgency).map(toIssue) : [];

  const backlogAll = input.tickets.filter((t) => t.sprintId === null && !t.done).sort(byUrgency);
  const backlog = backlogAll.slice(0, MAX_BACKLOG).map(toIssue);

  const people = new Map<string, { assignee: string; count: number }>();
  for (const i of open) {
    const p = people.get(i.assignee) ?? { assignee: i.assignee, count: 0 };
    p.count++;
    people.set(i.assignee, p);
  }
  const byAssignee = [...people.values()].sort((a, b) => b.count - a.count || a.assignee.localeCompare(b.assignee, 'fr'));

  const history = input.history.slice(0, 3);
  const velocity = avg(history.map((h) => h.done));
  const totals = { count: planned.length, open: open.length, unassigned: open.filter((i) => i.assignee === 'Non assigné').length };

  // ---- Points à clarifier ----
  const alerts: SprintAlert[] = [];
  if (!sprint.goal.trim()) alerts.push({ level: 'info', title: 'Objectif non défini', text: 'Le sprint n’a pas encore d’objectif.', keys: [] });
  if (sprint.state === 'future' && (!startDay || !endDay)) alerts.push({ level: 'info', title: 'Dates à fixer', text: 'Les dates de début et de fin du sprint ne sont pas encore renseignées.', keys: [] });
  if (!planned.length) alerts.push({ level: 'attention', title: 'Sprint vide', text: 'Aucun ticket n’est encore prévu dans ce sprint.', keys: [] });
  if (velocity && totals.open > velocity * 1.3) {
    alerts.push({ level: 'attention', title: 'Beaucoup de tickets', text: `${totals.open} tickets ouverts prévus pour ${velocity} clôturés en moyenne sur les derniers sprints.`, keys: [] });
  }
  const unassigned = open.filter((i) => i.assignee === 'Non assigné');
  if (unassigned.length) alerts.push({ level: 'attention', title: 'Tickets sans responsable', text: `${keysList(unassigned)}.`, keys: unassigned.map((i) => i.key) });
  const late = open.filter((i) => i.dueDate && i.dueDate < (startDay ?? asOfDay));
  if (late.length) alerts.push({ level: 'critique', title: 'Échéances déjà dépassées', text: `${late.map((i) => `${i.key} (${shortDay(i.dueDate)})`).join(', ')}.`, keys: late.map((i) => i.key) });
  const urgentBacklog = backlogAll.filter((t) => t.dueDate && endDay && t.dueDate <= endDay).map(toIssue);
  if (urgentBacklog.length) {
    alerts.push({
      level: 'attention',
      title: 'Échéances restées au backlog',
      text: `${urgentBacklog.length} ticket${urgentBacklog.length > 1 ? 's' : ''} hors sprint à échéance avant la fin du sprint : ${keysList(urgentBacklog.slice(0, 8))}${urgentBacklog.length > 8 ? '…' : ''}.`,
      keys: urgentBacklog.map((i) => i.key),
    });
  }
  if (carryOver.length) {
    alerts.push({
      level: 'info',
      title: `Reports probables du ${current!.name}`,
      text: `${carryOver.length} ticket${carryOver.length > 1 ? 's' : ''} non terminé${carryOver.length > 1 ? 's' : ''} : ${keysList(carryOver)}.`,
      keys: carryOver.map((i) => i.key),
    });
  }
  const top = byAssignee[0];
  if (top && byAssignee.length > 1 && totals.open >= 4 && top.count / totals.open >= 0.5 && top.assignee !== 'Non assigné') {
    alerts.push({ level: 'info', title: 'Charge concentrée', text: `${top.assignee} porte ${Math.round((top.count / totals.open) * 100)} % des tickets ouverts du sprint.`, keys: [] });
  }

  return {
    sprint,
    asOfDay,
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

function issueLine(i: PreparationIssue, labels: StatusLabels): string {
  return `- ${i.key} « ${i.summary} »${i.project ? ` [${i.project}]` : ''} — ${i.assignee} · ${labels[i.status] ?? i.status}${i.dueDate ? ` · échéance ${shortDay(i.dueDate)}` : ''}`;
}

/** Éléments de préparation en Markdown compact : seule entrée du modèle pour le document de préparation. */
export function sprintPreparationToMarkdown(p: SprintPreparation, labels: StatusLabels): string {
  const L: string[] = [];
  const s = p.sprint;
  L.push(`# ${s.name} (${s.state === 'future' ? 'à venir' : s.state === 'active' ? 'en cours' : 'clos'})`);
  L.push(s.goal.trim() ? `Objectif saisi : ${s.goal.trim()}` : 'Objectif : non renseigné');
  L.push(`- Dates : ${s.startDate ? `du ${shortDay(s.startDate)}` : 'début non fixé'}${s.endDate ? ` au ${shortDay(s.endDate)}` : ', fin non fixée'} ; données du ${shortDay(p.asOfDay)}`);
  const t = p.totals;
  L.push(`- Prévu : ${t.count} ticket(s) dont ${t.open} ouvert(s) ; ${t.unassigned} sans responsable`);
  if (p.history.length) {
    L.push(`- Rythme moyen : ${p.velocity ?? '—'} tickets clôturés par sprint`);
    for (const h of p.history) L.push(`  - ${h.name} : ${h.done} tickets clôturés sur ${h.active}`);
  } else {
    L.push('- Rythme : aucun sprint clos');
  }
  L.push('\n## Charge par personne (tickets ouverts prévus)');
  for (const a of p.byAssignee) L.push(`- ${a.assignee} : ${a.count} ticket(s)`);
  if (!p.byAssignee.length) L.push('- (aucun ticket ouvert)');
  L.push('\n## Tickets prévus dans le sprint');
  for (const i of p.planned) L.push(`${issueLine(i, labels)}${i.status === 'termine' ? ' (déjà terminé)' : ''}`);
  if (!p.planned.length) L.push('- (aucun)');
  if (p.carryOverFrom) {
    L.push(`\n## Tickets non terminés du ${p.carryOverFrom} (reports probables)`);
    for (const i of p.carryOver) L.push(issueLine(i, labels));
    if (!p.carryOver.length) L.push('- (aucun)');
  }
  L.push(`\n## Backlog : ${p.backlog.length} ticket(s) les plus urgents sur ${p.backlogTotal} ouverts`);
  for (const i of p.backlog) L.push(issueLine(i, labels));
  if (p.alerts.length) {
    L.push('\n## Points détectés');
    for (const a of p.alerts) L.push(`- [${a.level}] ${a.title} : ${a.text}`);
  }
  return L.join('\n');
}
