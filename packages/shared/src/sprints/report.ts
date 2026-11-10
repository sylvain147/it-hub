/**
 * Revue de sprint : à partir des tickets et de leur historique (changements de statut et de sprint), le code calcule
 * tous les chiffres (périmètre, clôtures, mouvements, temps par statut, points d'attention). L'IA ne reçoit que ces
 * chiffres (`sprintReportToMarkdown`) pour rédiger le compte rendu.
 *
 * Partagé entre l'API (calcul à la lecture, entrée de l'IA) et les tests.
 */
import { ticketKey, type TicketStatus, type TicketView } from '../project.js';
import { isRecordedPastSprint, type Sprint } from './sprint.js';

/** Libellés des statuts (paramétrage). */
export type StatusLabels = Record<TicketStatus, string>;

/** Statuts dans l'ordre d'empilement des graphiques (terminé → à faire). */
export const SPRINT_GROUPS = ['termine', 'recette', 'en_cours', 'attente', 'a_faire'] as const satisfies readonly TicketStatus[];
export type SprintGroup = TicketStatus;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const parisDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Jour (AAAA-MM-JJ, heure de Paris) d'un instant ISO. */
export function parisDay(iso: string | number): string {
  return parisDayFmt.format(new Date(iso));
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** « 16/10 ». */
export function shortDay(day: string): string {
  return day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '';
}

const ms = (iso: string) => Date.parse(iso);
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Historique d'un ticket
// ---------------------------------------------------------------------------

export interface Timeline {
  /** Sprint du ticket à un instant donné (null : backlog, ou pas encore créé). */
  sprintAt(t: number): number | null;
  statusAt(t: number): TicketStatus;
}

export function timeline(t: Pick<TicketView, 'createdAt' | 'sprintId' | 'status' | 'sprintChanges' | 'statusChanges'>): Timeline {
  const sc = [...t.sprintChanges].sort((a, b) => a.at.localeCompare(b.at));
  const st = [...t.statusChanges].sort((a, b) => a.at.localeCompare(b.at));
  const created = ms(t.createdAt);
  const initialSprint = sc.length ? sc[0]!.from : t.sprintId;
  const initialStatus = st.length ? st[0]!.from : t.status;
  return {
    sprintAt(at) {
      if (at < created) return null;
      let cur = initialSprint;
      for (const c of sc) {
        if (ms(c.at) > at) break;
        cur = c.to;
      }
      return cur;
    },
    statusAt(at) {
      let cur = initialStatus;
      for (const c of st) {
        if (ms(c.at) > at) break;
        cur = c.to;
      }
      return cur;
    },
  };
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

export type SprintMovement =
  | { kind: 'lancement' }
  | { kind: 'report'; from: string }
  | { kind: 'ajout'; at: string }
  | { kind: 'cree'; at: string }
  | { kind: 'retire'; at: string; to: string };

export function movementLabel(m: SprintMovement): string {
  switch (m.kind) {
    case 'lancement':
      return 'Au lancement';
    case 'report':
      return `Reporté de ${m.from}`;
    case 'ajout':
      return `Ajouté le ${shortDay(m.at)}`;
    case 'cree':
      return `Créé le ${shortDay(m.at)}`;
    case 'retire':
      return `Retiré le ${shortDay(m.at)} → ${m.to}`;
  }
}

export interface SprintReportIssue {
  id: string;
  key: string;
  summary: string;
  projectId: string;
  project: string;
  assignee: string;
  /** Statut à la date d'arrêt des données. */
  status: TicketStatus;
  /** Encore dans le sprint à la date d'arrêt (sinon : retiré). */
  active: boolean;
  movement: SprintMovement;
  dueDate: string;
  overdue: boolean;
  /** Jour de clôture (passage au statut « terminé »). */
  doneDay: string | null;
  /** Jour d'entrée dans le statut actuel. */
  statusSince: string | null;
  /** Jours passés en attente pendant le sprint. */
  waitingDays: number;
}

export interface SprintAlert {
  level: 'critique' | 'attention' | 'info';
  title: string;
  text: string;
  keys: string[];
}

export interface SprintReport {
  sprint: Sprint;
  /** Instant d'arrêt des données : clôture du sprint, sinon maintenant. */
  asOf: string;
  asOfDay: string;
  startDay: string;
  endDay: string | null;
  /** Jours écoulés depuis le lancement / durée prévue. */
  elapsedDays: number;
  plannedDays: number | null;
  team: string[];
  counts: {
    /** Tickets passés par le sprint (actifs + retirés). */
    total: number;
    active: number;
    removed: number;
    atStart: number;
    added: number;
    addedDone: number;
    done: number;
    recette: number;
    overdue: number;
  };
  /** Tickets actifs par statut, dans l'ordre d'empilement. */
  byStatus: { status: TicketStatus; count: number }[];
  byAssignee: { assignee: string; total: number; groups: Record<TicketStatus, number> }[];
  /** Périmètre actif et clôtures cumulées, jour par jour. */
  timeline: { day: string; active: number; done: number; events: string[] }[];
  /** Temps-ticket par statut pendant le sprint, hors « terminé » (jours). */
  timeByGroup: { group: TicketStatus; days: number; share: number }[];
  medianCloseDays: number | null;
  closeDaysRange: [number, number] | null;
  lastCloseDay: string | null;
  issues: SprintReportIssue[];
  attention: SprintAlert[];
}

export interface ReportInput {
  sprint: Sprint;
  /** Tickets susceptibles d'être passés par le sprint (les autres sont ignorés). */
  tickets: TicketView[];
  /** Noms des sprints, par numéro. */
  sprintNames: Record<number, string>;
  /** Instant présent (ISO). */
  now: string;
  labels: StatusLabels;
}

export const emptyGroups = (): Record<TicketStatus, number> => ({ termine: 0, recette: 0, en_cours: 0, attente: 0, a_faire: 0 });

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const keysList = (xs: { key: string }[]) => xs.map((x) => x.key).join(', ');

/** Instant d'arrêt des chiffres d'un sprint : sa clôture, sinon maintenant. */
export function sprintAsOf(sprint: Pick<Sprint, 'completedAt'>, now: string): string {
  return sprint.completedAt && sprint.completedAt < now ? sprint.completedAt : now;
}

/**
 * Sprint passé enregistré après coup : ses tickets y ont été planifiés, et souvent terminés, après ses dates. Sa revue
 * reprend les tickets présents dans le sprint à l'instant de l'enregistrement (avant que les non terminés ne le
 * quittent), comme présents dès le lancement, avec leur statut de cet instant : les changements de statut faits entre
 * la fin du sprint et l'enregistrement comptent au dernier instant du sprint.
 */
function recordedSnapshot(sprint: Sprint, tickets: TicketView[], startMs: number, asOfMs: number, now: string): TicketView[] {
  const id = sprint.id;
  const end = ms(sprint.completedAt!);
  // Anciens sprints enregistrés sans l'instant : premier départ d'un ticket après la clôture, sinon maintenant.
  const exits = tickets.flatMap((t) => t.sprintChanges.filter((c) => c.from === id && ms(c.at) > end).map((c) => ms(c.at)));
  const recMs = sprint.recordedAt ? ms(sprint.recordedAt) : exits.length ? Math.min(...exits) : ms(now);
  const iso = (at: number) => new Date(at).toISOString();
  return tickets
    .filter((t) => timeline(t).sprintAt(recMs - 1) === id)
    .map((t) => {
      const createdMs = ms(t.createdAt);
      return {
        ...t,
        sprintId: id,
        sprintChanges: [],
        createdAt: createdMs > startMs && createdMs <= asOfMs ? t.createdAt : iso(Math.min(createdMs, startMs)),
        statusChanges: t.statusChanges.filter((c) => ms(c.at) < recMs).map((c) => (ms(c.at) > asOfMs ? { ...c, at: iso(asOfMs) } : c)),
      };
    });
}

export function buildSprintReport(input: ReportInput): SprintReport {
  const { sprint, labels } = input;
  const id = sprint.id;
  const asOf = sprintAsOf(sprint, input.now);
  // À la clôture, les tickets non terminés quittent le sprint à l'instant même : les chiffres s'arrêtent juste avant.
  const asOfMs = ms(asOf) - (asOf === sprint.completedAt ? 1 : 0);
  const startMs = sprint.startedAt ? Math.min(ms(sprint.startedAt), asOfMs) : asOfMs;
  const tickets = isRecordedPastSprint(sprint) ? recordedSnapshot(sprint, input.tickets, startMs, asOfMs, input.now) : input.tickets;
  const startDay = parisDay(startMs);
  const asOfDay = parisDay(asOfMs);
  const name = (sid: number | null) => (sid === null ? 'Backlog' : (input.sprintNames[sid] ?? `Sprint ${sid}`));
  const label = (s: TicketStatus) => labels[s] ?? s;

  type Row = SprintReportIssue & { t: TicketView; tl: Timeline; entryMs: number; exitMs: number; doneMs: number | null; startedIn: boolean; moves: { day: string; sign: '+' | '−' }[] };
  const rows: Row[] = [];

  for (const t of tickets) {
    const tl = timeline(t);
    const createdMs = ms(t.createdAt);
    const inAt = (at: number) => tl.sprintAt(at) === id;
    const sc = [...t.sprintChanges].sort((a, b) => a.at.localeCompare(b.at));
    const inAtStart = inAt(startMs);
    // Instants d'entrée et de sortie du sprint pendant la période observée.
    const entries = sc.filter((c) => c.from !== id && c.to === id && ms(c.at) > startMs && ms(c.at) <= asOfMs).map((c) => ms(c.at));
    const createdInside = createdMs > startMs && createdMs <= asOfMs && (sc.length ? sc[0]!.from : t.sprintId) === id;
    if (createdInside) entries.unshift(createdMs);
    if (!inAtStart && !entries.length) continue; // jamais dans ce sprint pendant la période
    const active = inAt(asOfMs);
    const entryMs = inAtStart ? startMs : Math.min(...entries);
    const exits = sc.filter((c) => c.from === id && c.to !== id && ms(c.at) > startMs && ms(c.at) <= asOfMs);
    const lastExit = exits.at(-1);
    const exitMs = active ? asOfMs : lastExit ? ms(lastExit.at) : asOfMs;

    let movement: SprintMovement;
    if (!active && lastExit) {
      movement = { kind: 'retire', at: parisDay(lastExit.at), to: name(lastExit.to) };
    } else if (inAtStart) {
      // Arrivé d'un autre sprint (report à la clôture du précédent) ou du backlog.
      const arrival = sc.filter((c) => c.to === id && ms(c.at) <= startMs).at(-1);
      movement = arrival && arrival.from !== null ? { kind: 'report', from: name(arrival.from) } : { kind: 'lancement' };
    } else if (createdInside && entryMs === createdMs) {
      movement = { kind: 'cree', at: parisDay(createdMs) };
    } else {
      movement = { kind: 'ajout', at: parisDay(entryMs) };
    }

    const status = tl.statusAt(asOfMs);
    // Clôture : dernier passage au statut « terminé » avant l'arrêt des données.
    let doneMs: number | null = null;
    if (status === 'termine') {
      const into = t.statusChanges.filter((c) => ms(c.at) <= asOfMs && c.to === 'termine' && c.from !== 'termine').map((c) => ms(c.at));
      doneMs = into.length ? Math.max(...into) : createdMs;
    }
    const since = t.statusChanges.filter((c) => ms(c.at) <= asOfMs).map((c) => ms(c.at));
    const statusSinceMs = since.length ? Math.max(...since) : createdMs;

    rows.push({
      id: t.id,
      key: ticketKey(t),
      summary: t.title,
      projectId: t.projectId,
      project: t.projectName,
      assignee: t.assignee || 'Non assigné',
      status,
      active,
      movement,
      dueDate: t.dueDate,
      overdue: active && status !== 'termine' && !!t.dueDate && t.dueDate < asOfDay,
      doneDay: doneMs === null ? null : parisDay(doneMs),
      statusSince: parisDay(statusSinceMs),
      waitingDays: 0,
      t,
      tl,
      entryMs,
      exitMs,
      doneMs,
      startedIn: inAtStart,
      moves: [...entries.map((at) => ({ day: parisDay(at), sign: '+' as const })), ...exits.map((c) => ({ day: parisDay(c.at), sign: '−' as const }))],
    });
  }

  const order = (r: Row) => (r.active ? 0 : 1) * 10 + SPRINT_GROUPS.indexOf(r.status as (typeof SPRINT_GROUPS)[number]);
  rows.sort((a, b) => order(a) - order(b) || a.key.localeCompare(b.key, 'fr', { numeric: true }));
  const active = rows.filter((r) => r.active);
  const removed = rows.filter((r) => !r.active);
  const done = active.filter((r) => r.status === 'termine');

  // ---- Temps par statut (segments de statut × présence dans le sprint) ----
  const timeMs = emptyGroups();
  for (const r of active) {
    const cuts = [r.entryMs, ...r.t.statusChanges.map((c) => ms(c.at)).filter((at) => at > r.entryMs && at < r.exitMs), r.exitMs].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const g = r.tl.statusAt(cuts[i]!);
      const d = cuts[i + 1]! - cuts[i]!;
      timeMs[g] += d;
      if (g === 'attente') r.waitingDays += d / DAY_MS;
    }
    r.waitingDays = round1(r.waitingDays);
  }
  const openGroups = SPRINT_GROUPS.filter((g) => g !== 'termine');
  const openTime = openGroups.reduce((n, g) => n + timeMs[g], 0);
  const timeByGroup = openGroups.map((g) => ({
    group: g,
    days: round1(timeMs[g] / DAY_MS),
    share: openTime ? Math.round((timeMs[g] / openTime) * 100) : 0,
  }));

  // ---- Chronologie jour par jour ----
  const days: string[] = [];
  for (let d = startDay; d <= asOfDay && days.length < 120; d = addDays(d, 1)) days.push(d);
  const timelineRows = days.map((day) => {
    // Fin de journée à Paris (approximation à l'heure près, sans effet sur un décompte quotidien).
    const at = Math.min(asOfMs, Date.parse(`${day}T22:00:00Z`));
    const activeAt = rows.filter((r) => r.tl.sprintAt(at) === id);
    const events = rows.flatMap((r) => r.moves.filter((m) => m.day === day).map((m) => `${m.sign} ${r.key}`));
    return { day, active: activeAt.length, done: activeAt.filter((r) => r.tl.statusAt(at) === 'termine').length, events };
  });

  // ---- Délais de clôture ----
  const closeDays = done.filter((r) => r.doneMs !== null).map((r) => Math.max(0, Math.round((r.doneMs! - r.entryMs) / DAY_MS)));
  const lastCloseDay = done.map((r) => r.doneDay!).sort().at(-1) ?? null;

  // ---- Regroupements ----
  const byStatus = SPRINT_GROUPS.map((s) => ({ status: s, count: active.filter((r) => r.status === s).length }));
  const people = new Map<string, { assignee: string; total: number; groups: Record<TicketStatus, number> }>();
  for (const r of active) {
    const p = people.get(r.assignee) ?? { assignee: r.assignee, total: 0, groups: emptyGroups() };
    p.total++;
    p.groups[r.status]++;
    people.set(r.assignee, p);
  }
  const byAssignee = [...people.values()].sort((a, b) => b.total - a.total || a.assignee.localeCompare(b.assignee, 'fr'));

  const added = active.filter((r) => !r.startedIn);
  const atStart = rows.filter((r) => r.startedIn).length;
  const overdue = active.filter((r) => r.overdue);
  const recette = active.filter((r) => r.status === 'recette');

  // ---- Points d'attention ----
  const attention: SprintAlert[] = [];
  for (const r of overdue) {
    const late = Math.round((Date.parse(`${asOfDay}T12:00:00Z`) - Date.parse(`${r.dueDate}T12:00:00Z`)) / DAY_MS);
    attention.push({
      level: 'critique',
      title: `${r.key} ${r.summary}`,
      text: `${label(r.status)}, échéance du ${shortDay(r.dueDate)} dépassée de ${late} jour${late > 1 ? 's' : ''}.`,
      keys: [r.key],
    });
  }
  if (added.length) {
    const addedDone = added.filter((r) => r.status === 'termine').length;
    attention.push({
      level: added.length >= Math.max(2, atStart * 0.25) ? 'attention' : 'info',
      title: 'Ajouts en cours de sprint',
      text: `${added.length} ticket${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''} après le lancement (${keysList(added)})${atStart ? `, +${Math.round((added.length / atStart) * 100)} % par rapport aux ${atStart} du lancement` : ''} ; ${addedDone ? `${addedDone} clôturé${addedDone > 1 ? 's' : ''}` : 'aucun clôturé'}.`,
      keys: added.map((r) => r.key),
    });
  }
  const openActive = active.filter((r) => r.status !== 'termine');
  if (sprint.state === 'active' && openActive.length && lastCloseDay && addDays(lastCloseDay, 5) < asOfDay) {
    attention.push({ level: 'attention', title: `Aucune clôture depuis le ${shortDay(lastCloseDay)}`, text: `${openActive.length} ticket(s) restent ouverts.`, keys: [] });
  }
  if (recette.length >= 3 || (recette.length && sprint.endDate && addDays(sprint.endDate, -2) <= asOfDay)) {
    attention.push({
      level: 'attention',
      title: `Tickets ${label('recette').toLowerCase()}`,
      text: `${recette.length} ticket${recette.length > 1 ? 's' : ''} : ${recette.map((r) => `${r.key} depuis le ${shortDay(r.statusSince ?? '')}`).join(', ')}.`,
      keys: recette.map((r) => r.key),
    });
  }
  const waitShare = timeByGroup.find((t) => t.group === 'attente')?.share ?? 0;
  if (waitShare >= 10) {
    const top = active.filter((r) => r.waitingDays >= 1).sort((a, b) => b.waitingDays - a.waitingDays).slice(0, 5);
    attention.push({
      level: 'attention',
      title: 'Dépendances et attentes',
      text: `${waitShare} % du temps des tickets ouverts passé au statut « ${label('attente')} »${top.length ? ` : ${top.map((r) => `${r.key} (${r.waitingDays.toLocaleString('fr-FR')} j)`).join(', ')}` : ''}.`,
      keys: top.map((r) => r.key),
    });
  }
  for (const r of removed) {
    attention.push({ level: 'info', title: `Sorti du sprint : ${r.key}`, text: `${r.summary} — ${movementLabel(r.movement).replace(/^R/, 'r')}.`, keys: [r.key] });
  }

  const endDay = sprint.endDate || null;
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

  return {
    sprint,
    asOf,
    asOfDay,
    startDay,
    endDay,
    elapsedDays: dayDiff(startDay, asOfDay),
    plannedDays: endDay ? dayDiff(startDay, endDay) : null,
    team: [...new Set(active.map((r) => r.assignee))].filter((a) => a !== 'Non assigné').sort((a, b) => a.localeCompare(b, 'fr')),
    counts: {
      total: rows.length,
      active: active.length,
      removed: removed.length,
      atStart,
      added: added.length,
      addedDone: added.filter((r) => r.status === 'termine').length,
      done: done.length,
      recette: recette.length,
      overdue: overdue.length,
    },
    byStatus,
    byAssignee,
    timeline: timelineRows,
    timeByGroup,
    medianCloseDays: median(closeDays),
    closeDaysRange: closeDays.length ? [Math.min(...closeDays), Math.max(...closeDays)] : null,
    lastCloseDay,
    issues: rows.map(({ t: _t, tl: _l, entryMs: _e, exitMs: _x, doneMs: _d, startedIn: _s, moves: _m, ...r }) => r),
    attention,
  };
}

/** Chiffres du sprint en Markdown compact : seule entrée du modèle pour le compte rendu. */
export function sprintReportToMarkdown(r: SprintReport, labels: StatusLabels): string {
  const L: string[] = [];
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');
  const label = (s: TicketStatus) => labels[s] ?? s;
  const c = r.counts;
  L.push(`# ${r.sprint.name} (${r.sprint.state === 'closed' ? 'clos' : r.sprint.state === 'active' ? 'en cours' : 'à venir'})`);
  if (r.sprint.goal.trim()) L.push(`Objectif du sprint : ${r.sprint.goal.trim()}`);
  L.push(`- Lancé le ${shortDay(r.startDay)}${r.endDay ? `, fin prévue le ${shortDay(r.endDay)}` : ''} ; données arrêtées au ${shortDay(r.asOfDay)} (${r.elapsedDays} j écoulés${r.plannedDays ? ` sur ${r.plannedDays}` : ''})`);
  L.push(`- Équipe : ${r.team.join(', ') || '—'}`);
  L.push(`- Tickets : ${c.active} actifs (${c.atStart} au lancement, ${c.added} ajoutés en cours de sprint dont ${c.addedDone} clôturés), ${c.removed} retirés`);
  L.push(`- Clôturés : ${c.done} / ${c.active} (${pct(c.done, c.active)}) ; avec « ${label('recette')} » : ${c.done + c.recette} / ${c.active} (${pct(c.done + c.recette, c.active)})`);
  L.push(`- Échéances dépassées : ${c.overdue}`);
  if (r.medianCloseDays !== null) L.push(`- Délai médian de clôture : ${r.medianCloseDays} j (de ${r.closeDaysRange![0]} à ${r.closeDaysRange![1]} j) ; dernière clôture le ${shortDay(r.lastCloseDay ?? '')}`);
  L.push('\n## Répartition par statut');
  for (const g of r.byStatus.filter((x) => x.count)) L.push(`- ${label(g.status)} : ${g.count} ticket(s)`);
  L.push('\n## Temps des tickets ouverts par statut');
  for (const t of r.timeByGroup) L.push(`- ${label(t.group)} : ${t.share} %`);
  L.push('\n## Charge par personne');
  for (const p of r.byAssignee) L.push(`- ${p.assignee} : ${p.total} ticket(s) — ${SPRINT_GROUPS.filter((g) => p.groups[g]).map((g) => `${p.groups[g]} ${label(g).toLowerCase()}`).join(', ')}`);
  L.push('\n## Tickets');
  for (const i of r.issues) {
    L.push(
      `- ${i.key} « ${i.summary} »${i.project ? ` [${i.project}]` : ''} — ${i.assignee} · ${label(i.status)}${i.active ? '' : ' (retiré)'} · ${movementLabel(i.movement)}${i.dueDate ? ` · échéance ${shortDay(i.dueDate)}${i.overdue ? ' DÉPASSÉE' : ''}` : ''}${i.waitingDays >= 1 ? ` · ${i.waitingDays} j en attente` : ''}`,
    );
  }
  if (r.attention.length) {
    L.push('\n## Points d’attention détectés');
    for (const a of r.attention) L.push(`- [${a.level}] ${a.title} : ${a.text}`);
  }
  return L.join('\n');
}
