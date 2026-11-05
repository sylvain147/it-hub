/**
 * Revue de sprint Jira : à partir d'un instantané du sprint (tickets, historique des sprints et des statuts),
 * le code calcule tous les chiffres (périmètre, clôtures, story points, mouvements, temps par statut, points
 * d'attention, qualité des données). L'IA ne reçoit que ces chiffres pour rédiger le compte rendu.
 *
 * Partagé entre l'API (calcul à la lecture, entrée de l'IA) et les tests.
 */

/** Catégorie de statut Jira (`statusCategory.key`). */
export type JiraStatusCategory = 'new' | 'indeterminate' | 'done';

export interface JiraSprintInfo {
  id: number;
  name: string;
  state: 'future' | 'active' | 'closed';
  /** Dates ISO (UTC), ou null pour un sprint pas encore démarré. */
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
  goal: string;
  boardId: number;
}

/** Changement du champ Sprint d'un ticket (identifiants des sprints avant / après). */
export interface SprintFieldChange {
  at: string;
  from: number[];
  to: number[];
}

export interface StatusChange {
  at: string;
  from: string;
  to: string;
}

/** Ticket tel qu'enregistré dans l'instantané : seuls les champs utiles, sans description ni commentaires. */
export interface SprintIssue {
  key: string;
  summary: string;
  type: string;
  priority: string;
  assignee: string;
  status: string;
  storyPoints: number | null;
  /** Échéance AAAA-MM-JJ, ou chaîne vide. */
  dueDate: string;
  created: string;
  resolutionDate: string | null;
  timeSpentSeconds: number | null;
  remainingSeconds: number | null;
  /** Référence du ticket Desk (suivi TMA) portée par le ticket Jira, sans « # ». */
  deskRef: string;
  /** Sprints actuels du ticket (champ Sprint). */
  sprints: number[];
  sprintChanges: SprintFieldChange[];
  statusChanges: StatusChange[];
}

export interface SprintSnapshot {
  site: string;
  sprint: JiraSprintInfo;
  syncedAt: string;
  /** Catégorie de chaque statut connu (par nom). */
  statusCategories: Record<string, JiraStatusCategory>;
  /** Noms des sprints cités par les tickets. */
  sprintNames: Record<string, string>;
  /** Le champ « story points » est-il configuré ? */
  hasStoryPoints: boolean;
  issues: SprintIssue[];
}

// ---------------------------------------------------------------------------
// Regroupement des statuts
// ---------------------------------------------------------------------------

/** Groupes de statuts, dans l'ordre d'empilement des graphiques. */
export const SPRINT_GROUPS = ['termine', 'recette', 'en_cours', 'attente', 'a_faire'] as const;
export type SprintGroup = (typeof SPRINT_GROUPS)[number];
export const SPRINT_GROUP_LABELS: Record<SprintGroup, string> = {
  termine: 'Terminé',
  recette: 'En recette',
  en_cours: 'En cours',
  attente: 'En attente',
  a_faire: 'À faire',
};

const WAITING_RE = /attente|bloqu|suspendu|wait|hold|block|pending/i;
const TESTING_RE = /recette|test|\bqa\b|valid|review|revue|uat|v[ée]rif|homolog/i;

/**
 * Groupe d'un statut. Les catégories Jira ne distinguent que « à faire / en cours / terminé » :
 * la recette et l'attente se reconnaissent au nom du statut.
 */
export function statusGroup(status: string, category: JiraStatusCategory | undefined): SprintGroup {
  if (category === 'done') return 'termine';
  if (WAITING_RE.test(status)) return 'attente';
  if (TESTING_RE.test(status)) return 'recette';
  if (category === 'new') return 'a_faire';
  return 'en_cours';
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const parisDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Jour (AAAA-MM-JJ, heure de Paris) d'un instant ISO. */
export function parisDay(iso: string | number): string {
  return parisDayFmt.format(new Date(iso));
}

function addDays(day: string, n: number): string {
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

interface Timeline {
  /** Sprints du ticket à un instant donné. */
  sprintsAt(t: number): number[];
  statusAt(t: number): string;
}

function timeline(issue: SprintIssue): Timeline {
  const sc = [...issue.sprintChanges].sort((a, b) => a.at.localeCompare(b.at));
  const st = [...issue.statusChanges].sort((a, b) => a.at.localeCompare(b.at));
  const created = ms(issue.created);
  const initialSprints = sc.length ? sc[0]!.from : issue.sprints;
  const initialStatus = st.length ? st[0]!.from : issue.status;
  return {
    sprintsAt(t) {
      if (t < created) return [];
      let cur = initialSprints;
      for (const c of sc) {
        if (ms(c.at) > t) break;
        cur = c.to;
      }
      return cur;
    },
    statusAt(t) {
      let cur = initialStatus;
      for (const c of st) {
        if (ms(c.at) > t) break;
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
  key: string;
  summary: string;
  type: string;
  assignee: string;
  priority: string;
  points: number | null;
  /** Statut à la date d'arrêt des données. */
  status: string;
  group: SprintGroup;
  /** Encore dans le sprint à la date d'arrêt (sinon : retiré). */
  active: boolean;
  movement: SprintMovement;
  dueDate: string;
  overdue: boolean;
  /** Jour de clôture (passage dans un statut « terminé »). */
  doneDay: string | null;
  /** Jour d'entrée dans le statut actuel. */
  statusSince: string | null;
  deskRef: string;
  /** Jours passés en attente pendant le sprint. */
  waitingDays: number;
}

export interface SprintAlert {
  level: 'critique' | 'attention' | 'info';
  title: string;
  text: string;
  keys: string[];
}

export interface SprintGroupCount {
  group: SprintGroup;
  /** Statuts Jira regroupés (« Clôturé », « En recette »…). */
  statuses: string[];
  count: number;
  points: number;
}

export interface SprintReport {
  sprint: JiraSprintInfo;
  /** Instant d'arrêt des données : fin du sprint s'il est clos, sinon date de synchronisation. */
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
    withPoints: number;
  };
  points: { active: number; done: number; removed: number };
  byGroup: SprintGroupCount[];
  byAssignee: { assignee: string; total: number; points: number; groups: Record<SprintGroup, number> }[];
  /** Périmètre actif et clôtures cumulées, jour par jour. */
  timeline: { day: string; active: number; done: number; events: string[] }[];
  /** Temps-ticket par groupe de statut pendant le sprint, hors « terminé » (jours). */
  timeByGroup: { group: SprintGroup; days: number; share: number }[];
  medianCloseDays: number | null;
  closeDaysRange: [number, number] | null;
  lastCloseDay: string | null;
  issues: SprintReportIssue[];
  attention: SprintAlert[];
  dataQuality: SprintAlert[];
}

const emptyGroups = (): Record<SprintGroup, number> => ({ termine: 0, recette: 0, en_cours: 0, attente: 0, a_faire: 0 });

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const fmtPts = (n: number) => `${round1(n).toLocaleString('fr-FR')} SP`;
const keysList = (xs: { key: string }[]) => xs.map((x) => x.key).join(', ');

export function buildSprintReport(snap: SprintSnapshot): SprintReport {
  const { sprint } = snap;
  const id = sprint.id;
  const asOfMs = Math.min(ms(sprint.completeDate ?? snap.syncedAt), ms(snap.syncedAt));
  const asOf = new Date(asOfMs).toISOString();
  const startMs = sprint.startDate ? Math.min(ms(sprint.startDate), asOfMs) : asOfMs;
  const startDay = parisDay(startMs);
  const asOfDay = parisDay(asOfMs);
  const name = (sid: number) => snap.sprintNames[String(sid)] ?? `Sprint ${sid}`;
  const groupOf = (status: string) => statusGroup(status, snap.statusCategories[status]);

  type Row = SprintReportIssue & { tl: Timeline; entryMs: number; exitMs: number; doneMs: number | null; startedIn: boolean; moves: { day: string; sign: '+' | '−' }[] };
  const rows: Row[] = [];

  for (const issue of snap.issues) {
    const tl = timeline(issue);
    const createdMs = ms(issue.created);
    const inAt = (t: number) => tl.sprintsAt(t).includes(id);
    const sc = [...issue.sprintChanges].sort((a, b) => a.at.localeCompare(b.at));
    const inAtStart = inAt(startMs);
    // Instants d'entrée et de sortie du sprint pendant la période observée.
    const entries = sc.filter((c) => !c.from.includes(id) && c.to.includes(id) && ms(c.at) > startMs && ms(c.at) <= asOfMs).map((c) => ms(c.at));
    const createdInside = createdMs > startMs && createdMs <= asOfMs && (sc.length ? sc[0]!.from : issue.sprints).includes(id);
    if (createdInside) entries.unshift(createdMs);
    if (!inAtStart && !entries.length) continue; // jamais dans ce sprint pendant la période
    const active = inAt(asOfMs);
    const entryMs = inAtStart ? startMs : Math.min(...entries);
    const exits = sc.filter((c) => c.from.includes(id) && !c.to.includes(id) && ms(c.at) > startMs && ms(c.at) <= asOfMs);
    const lastExit = exits.at(-1);
    const exitMs = active ? asOfMs : lastExit ? ms(lastExit.at) : asOfMs;

    let movement: SprintMovement;
    if (!active && lastExit) {
      const added = lastExit.to.filter((s) => !lastExit.from.includes(s) && s !== id);
      movement = { kind: 'retire', at: parisDay(lastExit.at), to: added.length ? name(added.at(-1)!) : 'Backlog' };
    } else if (inAtStart) {
      const others = tl.sprintsAt(startMs).filter((s) => s !== id);
      movement = others.length ? { kind: 'report', from: name(others.at(-1)!) } : { kind: 'lancement' };
    } else if (createdInside && entryMs === createdMs) {
      movement = { kind: 'cree', at: parisDay(createdMs) };
    } else {
      movement = { kind: 'ajout', at: parisDay(entryMs) };
    }

    const status = tl.statusAt(asOfMs);
    const group = groupOf(status);
    // Clôture : dernier passage dans un statut « terminé » avant l'arrêt des données.
    let doneMs: number | null = null;
    if (group === 'termine') {
      const into = issue.statusChanges.filter((c) => ms(c.at) <= asOfMs && groupOf(c.to) === 'termine' && groupOf(c.from) !== 'termine').map((c) => ms(c.at));
      doneMs = into.length ? Math.max(...into) : issue.resolutionDate ? ms(issue.resolutionDate) : createdMs;
    }
    const since = issue.statusChanges.filter((c) => ms(c.at) <= asOfMs).map((c) => ms(c.at));
    const statusSinceMs = since.length ? Math.max(...since) : createdMs;

    // Temps passé dans chaque groupe de statut pendant la présence dans le sprint.
    rows.push({
      key: issue.key,
      summary: issue.summary,
      type: issue.type,
      assignee: issue.assignee || 'Non assigné',
      priority: issue.priority,
      points: issue.storyPoints,
      status,
      group,
      active,
      movement,
      dueDate: issue.dueDate,
      overdue: active && group !== 'termine' && !!issue.dueDate && issue.dueDate < asOfDay,
      doneDay: doneMs === null ? null : parisDay(doneMs),
      statusSince: parisDay(statusSinceMs),
      deskRef: issue.deskRef,
      waitingDays: 0,
      tl,
      entryMs,
      exitMs,
      doneMs,
      startedIn: inAtStart,
      moves: [...entries.map((t) => ({ day: parisDay(t), sign: '+' as const })), ...exits.map((c) => ({ day: parisDay(c.at), sign: '−' as const }))],
    });
  }

  const order = (r: Row) => (r.active ? 0 : 1) * 10 + SPRINT_GROUPS.indexOf(r.group);
  rows.sort((a, b) => order(a) - order(b) || a.key.localeCompare(b.key, 'fr', { numeric: true }));
  const active = rows.filter((r) => r.active);
  const removed = rows.filter((r) => !r.active);
  const done = active.filter((r) => r.group === 'termine');
  const sumPts = (xs: Row[]) => xs.reduce((n, r) => n + (r.points ?? 0), 0);

  // ---- Temps par statut (segments de statut × présence dans le sprint) ----
  const timeMs = emptyGroups();
  for (const r of active) {
    const issue = snap.issues.find((i) => i.key === r.key)!;
    const cuts = [r.entryMs, ...issue.statusChanges.map((c) => ms(c.at)).filter((t) => t > r.entryMs && t < r.exitMs), r.exitMs].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const g = groupOf(r.tl.statusAt(cuts[i]!));
      const d = cuts[i + 1]! - cuts[i]!;
      timeMs[g] += d;
      if (g === 'attente') r.waitingDays += d / DAY_MS;
    }
    r.waitingDays = round1(r.waitingDays);
  }
  const openTime = SPRINT_GROUPS.filter((g) => g !== 'termine').reduce((n, g) => n + timeMs[g], 0);
  const timeByGroup = SPRINT_GROUPS.filter((g) => g !== 'termine').map((g) => ({
    group: g,
    days: round1(timeMs[g] / DAY_MS),
    share: openTime ? Math.round((timeMs[g] / openTime) * 100) : 0,
  }));

  // ---- Chronologie jour par jour ----
  const days: string[] = [];
  for (let d = startDay; d <= asOfDay && days.length < 120; d = addDays(d, 1)) days.push(d);
  const timelineRows = days.map((day) => {
    // Fin de journée à Paris (approximation à l'heure près, sans effet sur un décompte quotidien).
    const t = Math.min(asOfMs, Date.parse(`${day}T22:00:00Z`));
    const activeAt = rows.filter((r) => r.tl.sprintsAt(t).includes(id));
    const events = rows.flatMap((r) => r.moves.filter((m) => m.day === day).map((m) => `${m.sign} ${r.key}`));
    return { day, active: activeAt.length, done: activeAt.filter((r) => groupOf(r.tl.statusAt(t)) === 'termine').length, events };
  });

  // ---- Délais de clôture ----
  const closeDays = done.filter((r) => r.doneMs !== null).map((r) => Math.max(0, Math.round((r.doneMs! - r.entryMs) / DAY_MS)));
  const lastCloseDay = done.map((r) => r.doneDay!).sort().at(-1) ?? null;

  // ---- Regroupements ----
  const byGroup: SprintGroupCount[] = SPRINT_GROUPS.map((g) => {
    const xs = active.filter((r) => r.group === g);
    return { group: g, statuses: [...new Set(xs.map((r) => r.status))], count: xs.length, points: round1(sumPts(xs)) };
  });
  const people = new Map<string, { assignee: string; total: number; points: number; groups: Record<SprintGroup, number> }>();
  for (const r of active) {
    const p = people.get(r.assignee) ?? { assignee: r.assignee, total: 0, points: 0, groups: emptyGroups() };
    p.total++;
    p.points = round1(p.points + (r.points ?? 0));
    p.groups[r.group]++;
    people.set(r.assignee, p);
  }
  const byAssignee = [...people.values()].sort((a, b) => b.total - a.total || a.assignee.localeCompare(b.assignee, 'fr'));

  const added = active.filter((r) => !r.startedIn);
  const atStart = rows.filter((r) => r.startedIn).length;
  const pointsActive = round1(sumPts(active));
  const overdue = active.filter((r) => r.overdue);
  const recette = active.filter((r) => r.group === 'recette');

  // ---- Points d'attention ----
  const attention: SprintAlert[] = [];
  for (const r of overdue) {
    const late = Math.round((Date.parse(`${asOfDay}T12:00:00Z`) - Date.parse(`${r.dueDate}T12:00:00Z`)) / DAY_MS);
    attention.push({
      level: 'critique',
      title: `${r.key} ${r.summary}`,
      text: `${SPRINT_GROUP_LABELS[r.group]}, échéance du ${shortDay(r.dueDate)} dépassée de ${late} jour${late > 1 ? 's' : ''}${r.points ? ` (${fmtPts(r.points)})` : ', sans story points'}.`,
      keys: [r.key],
    });
  }
  for (const r of active.filter((x) => x.group !== 'termine' && x.points && pointsActive && x.points / pointsActive >= 0.4)) {
    attention.push({
      level: 'attention',
      title: `Ticket volumineux : ${r.key}`,
      text: `${fmtPts(r.points!)}, soit ${Math.round((r.points! / pointsActive) * 100)} % des points du sprint, encore ${SPRINT_GROUP_LABELS[r.group].toLowerCase()}. Un découpage permettrait de livrer par morceaux.`,
      keys: [r.key],
    });
  }
  if (added.length) {
    const addedDone = added.filter((r) => r.group === 'termine').length;
    attention.push({
      level: added.length >= Math.max(2, atStart * 0.25) ? 'attention' : 'info',
      title: 'Ajouts en cours de sprint',
      text: `${added.length} ticket${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''} après le lancement (${keysList(added)})${atStart ? `, +${Math.round((added.length / atStart) * 100)} % par rapport aux ${atStart} du lancement` : ''} ; ${addedDone ? `${addedDone} clôturé${addedDone > 1 ? 's' : ''}` : 'aucun clôturé'}.`,
      keys: added.map((r) => r.key),
    });
  }
  const openActive = active.filter((r) => r.group !== 'termine');
  if (sprint.state === 'active' && openActive.length && lastCloseDay && addDays(lastCloseDay, 5) < asOfDay) {
    attention.push({ level: 'attention', title: `Aucune clôture depuis le ${shortDay(lastCloseDay)}`, text: `${openActive.length} ticket(s) restent ouverts.`, keys: [] });
  }
  if (recette.length >= 3 || (recette.length && sprint.endDate && addDays(parisDay(sprint.endDate), -2) <= asOfDay)) {
    attention.push({
      level: 'attention',
      title: 'Tickets en recette',
      text: `${recette.length} ticket${recette.length > 1 ? 's' : ''} en recette : ${recette.map((r) => `${r.key} depuis le ${shortDay(r.statusSince ?? '')}`).join(', ')}.`,
      keys: recette.map((r) => r.key),
    });
  }
  const waitShare = timeByGroup.find((t) => t.group === 'attente')?.share ?? 0;
  if (waitShare >= 10) {
    const top = active.filter((r) => r.waitingDays >= 1).sort((a, b) => b.waitingDays - a.waitingDays).slice(0, 5);
    attention.push({
      level: 'attention',
      title: 'Dépendances et attentes',
      text: `${waitShare} % du temps des tickets ouverts passé en attente${top.length ? ` : ${top.map((r) => `${r.key} (${r.waitingDays.toLocaleString('fr-FR')} j)`).join(', ')}` : ''}.`,
      keys: top.map((r) => r.key),
    });
  }
  for (const r of removed) {
    attention.push({
      level: /high|haute|critique|highest|urgent|bloquant/i.test(r.priority) ? 'attention' : 'info',
      title: `Sorti du sprint : ${r.key}`,
      text: `${r.summary} (priorité ${r.priority || 'non renseignée'}) — ${movementLabel(r.movement).replace(/^R/, 'r')}.`,
      keys: [r.key],
    });
  }

  // ---- Qualité des données Jira ----
  const dataQuality: SprintAlert[] = [];
  if (!snap.hasStoryPoints) {
    dataQuality.push({ level: 'info', title: 'Story points non suivis', text: 'Aucun champ « story points » n’est configuré (Paramétrage → Jira).', keys: [] });
  } else {
    const noPts = active.filter((r) => r.points === null);
    if (noPts.length) {
      dataQuality.push({
        level: noPts.length > active.length / 3 ? 'attention' : 'info',
        title: 'Tickets sans story points',
        text: `${noPts.length} ticket${noPts.length > 1 ? 's' : ''} actif${noPts.length > 1 ? 's' : ''} sur ${active.length} sans estimation (${keysList(noPts)}) : la vélocité réelle reste invisible.`,
        keys: noPts.map((r) => r.key),
      });
    }
  }
  const resolutionGap = done.filter((r) => {
    const res = snap.issues.find((i) => i.key === r.key)!.resolutionDate;
    return res && r.doneMs !== null && Math.abs(ms(res) - r.doneMs) > DAY_MS;
  });
  if (resolutionGap.length) {
    dataQuality.push({
      level: 'info',
      title: 'Date de résolution incohérente',
      text: `${keysList(resolutionGap)} : la date de résolution diffère de plus d’un jour du passage au statut terminé. La synthèse retient la date de transition.`,
      keys: resolutionGap.map((r) => r.key),
    });
  }
  const remaining = done.filter((r) => (snap.issues.find((i) => i.key === r.key)!.remainingSeconds ?? 0) > 0);
  if (remaining.length) {
    const h = (k: string) => Math.round((snap.issues.find((i) => i.key === k)!.remainingSeconds ?? 0) / 3600);
    dataQuality.push({
      level: 'info',
      title: 'Reste à faire non soldé',
      text: `${remaining.map((r) => `${r.key} (${h(r.key)} h)`).join(', ')} : clôturé${remaining.length > 1 ? 's' : ''} avec une estimation restante non remise à zéro.`,
      keys: remaining.map((r) => r.key),
    });
  }
  const logged = active.filter((r) => (snap.issues.find((i) => i.key === r.key)!.timeSpentSeconds ?? 0) > 0);
  if (active.length >= 4 && logged.length < active.length / 2) {
    const hours = Math.round(logged.reduce((n, r) => n + (snap.issues.find((i) => i.key === r.key)!.timeSpentSeconds ?? 0), 0) / 3600);
    dataQuality.push({
      level: 'info',
      title: 'Temps passé peu renseigné',
      text: logged.length ? `Saisi sur ${logged.length} ticket${logged.length > 1 ? 's' : ''} seulement (${hours} h au total).` : 'Aucun temps saisi sur les tickets du sprint.',
      keys: logged.map((r) => r.key),
    });
  }
  const types = new Set(rows.map((r) => r.type));
  const bugLike = rows.filter((r) => /\bbug|anomalie|erreur|incident|plantage/i.test(r.summary) && !/bug|anomalie|incident/i.test(r.type));
  if (rows.length >= 5 && types.size === 1 && bugLike.length) {
    dataQuality.push({
      level: 'info',
      title: `Type unique « ${[...types][0]} »`,
      text: `Tous les tickets ont le même type, y compris ${bugLike.map((r) => `${r.key} « ${r.summary} »`).join(', ')} : impossible de distinguer anomalies et évolutions.`,
      keys: bugLike.map((r) => r.key),
    });
  }

  const endDay = sprint.endDate ? parisDay(sprint.endDate) : null;
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
      addedDone: added.filter((r) => r.group === 'termine').length,
      done: done.length,
      recette: recette.length,
      overdue: overdue.length,
      withPoints: active.filter((r) => r.points !== null).length,
    },
    points: { active: pointsActive, done: round1(sumPts(done)), removed: round1(sumPts(removed)) },
    byGroup,
    byAssignee,
    timeline: timelineRows,
    timeByGroup,
    medianCloseDays: median(closeDays),
    closeDaysRange: closeDays.length ? [Math.min(...closeDays), Math.max(...closeDays)] : null,
    lastCloseDay,
    issues: rows.map(({ tl: _t, entryMs: _e, exitMs: _x, doneMs: _d, startedIn: _s, moves: _m, ...r }) => r),
    attention,
    dataQuality,
  };
}

/** Chiffres du sprint en Markdown compact : seule entrée du modèle pour le compte rendu. */
export function sprintReportToMarkdown(r: SprintReport): string {
  const L: string[] = [];
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');
  const c = r.counts;
  L.push(`# ${r.sprint.name} (${r.sprint.state === 'closed' ? 'clos' : r.sprint.state === 'active' ? 'en cours' : 'à venir'})`);
  if (r.sprint.goal.trim()) L.push(`Objectif du sprint : ${r.sprint.goal.trim()}`);
  L.push(`- Lancé le ${shortDay(r.startDay)}${r.endDay ? `, fin prévue le ${shortDay(r.endDay)}` : ''} ; données arrêtées au ${shortDay(r.asOfDay)} (${r.elapsedDays} j écoulés${r.plannedDays ? ` sur ${r.plannedDays}` : ''})`);
  L.push(`- Équipe : ${r.team.join(', ') || '—'}`);
  L.push(`- Tickets : ${c.active} actifs (${c.atStart} au lancement, ${c.added} ajoutés en cours de sprint dont ${c.addedDone} clôturés), ${c.removed} retirés`);
  L.push(`- Clôturés : ${c.done} / ${c.active} (${pct(c.done, c.active)}) ; avec la recette : ${c.done + c.recette} / ${c.active} (${pct(c.done + c.recette, c.active)})`);
  L.push(`- Story points : ${r.points.done} livrés sur ${r.points.active} actifs (renseignés sur ${c.withPoints} tickets sur ${c.active}) ; ${r.points.removed} SP sortis du sprint`);
  L.push(`- Échéances dépassées : ${c.overdue}`);
  if (r.medianCloseDays !== null) L.push(`- Délai médian de clôture : ${r.medianCloseDays} j (de ${r.closeDaysRange![0]} à ${r.closeDaysRange![1]} j) ; dernière clôture le ${shortDay(r.lastCloseDay ?? '')}`);
  L.push('\n## Répartition par statut');
  for (const g of r.byGroup.filter((x) => x.count)) L.push(`- ${SPRINT_GROUP_LABELS[g.group]} (${g.statuses.join(', ')}) : ${g.count} ticket(s), ${g.points} SP`);
  L.push('\n## Temps des tickets ouverts par statut');
  for (const t of r.timeByGroup) L.push(`- ${SPRINT_GROUP_LABELS[t.group]} : ${t.share} %`);
  L.push('\n## Charge par personne');
  for (const p of r.byAssignee) L.push(`- ${p.assignee} : ${p.total} ticket(s), ${p.points} SP — ${SPRINT_GROUPS.filter((g) => p.groups[g]).map((g) => `${p.groups[g]} ${SPRINT_GROUP_LABELS[g].toLowerCase()}`).join(', ')}`);
  L.push('\n## Tickets');
  for (const i of r.issues) {
    L.push(
      `- ${i.key} « ${i.summary} » — ${i.assignee} · ${i.priority || '?'} · ${i.points ?? '–'} SP · ${i.status}${i.active ? '' : ' (retiré)'} · ${movementLabel(i.movement)}${i.dueDate ? ` · échéance ${shortDay(i.dueDate)}${i.overdue ? ' DÉPASSÉE' : ''}` : ''}${i.waitingDays >= 1 ? ` · ${i.waitingDays} j en attente` : ''}`,
    );
  }
  const alerts = (title: string, xs: SprintAlert[]) => {
    if (!xs.length) return;
    L.push(`\n## ${title}`);
    for (const a of xs) L.push(`- [${a.level}] ${a.title} : ${a.text}`);
  };
  alerts('Points d’attention détectés', r.attention);
  alerts('Qualité des données Jira', r.dataQuality);
  return L.join('\n');
}
