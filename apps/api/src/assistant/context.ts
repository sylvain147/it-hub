/**
 * Données envoyées à l'assistant : rassemblées et mises en forme par le code (Markdown compact), jamais par l'IA.
 *
 *  - contexte global (stable pendant une conversation, mis en cache) : projets et leurs indicateurs, jalons en retard
 *    et à venir, sprint en cours, mes tickets, ma to-do (avec ses sous-tâches), mes notes (extraits), la FAQ ;
 *  - détail des projets cités dans la question ou les derniers échanges (au plus 3), comme pour un rapport.
 *
 * Seules les données que l'utilisateur voit déjà dans le hub sont envoyées : ses propres notes, sa to-do et celle des
 * projets ; jamais les notes ni la to-do personnelle des autres.
 */
import {
  CLOSED_PROJECT_STATUSES,
  HEALTH_LABELS,
  NO_PROJECT_ID,
  PRIORITY_LABELS,
  addDays,
  isJalonLate,
  isMyProject,
  isTaskOverdue,
  ticketKey,
  statusLabel,
  byFaqCategory,
  type AssistantMessage,
  type FaqEntry,
  type HubUser,
  type ListSettings,
  type PersonalNote,
  type PersonalTask,
  type ProjectItem,
  type ProjectSummary,
  type Sprint,
  type TicketView,
} from '@samm/shared';

export interface AssistantData {
  me: { email: string; name: string };
  today: string;
  lists: ListSettings;
  users: HubUser[];
  projects: ProjectSummary[];
  jalons: { projectId: string; item: ProjectItem<'jalons'> }[];
  tickets: TicketView[];
  sprints: Sprint[];
  /** To-do visible : la mienne (confiée à moi ou par moi) et celle des projets. */
  todos: PersonalTask[];
  /** Mes notes, hors archives. */
  notes: PersonalNote[];
  /** FAQ de l'équipe (vue par tous). */
  faq: FaqEntry[];
}

/** FAQ envoyée : au plus 150 entrées, réponses abrégées (sans les images). */
const FAQ_MAX = 150;
const FAQ_ANSWER_CHARS = 800;

function faqLine(f: FaqEntry): string {
  const answer = f.answer.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  return `- [${cut(f.question, 200)}](/faq?entree=${f.id})${f.category ? ` (${f.category})` : ''} : ${answer ? cut(answer, FAQ_ANSWER_CHARS) : 'SANS RÉPONSE'}`;
}

/** Fenêtre des échéances à venir (jours). */
export const UPCOMING_DAYS = 60;

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const cut = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const section = (title: string, lines: string[], empty = '(aucun)') => `## ${title}\n${lines.length ? lines.join('\n') : empty}`;
const projectLink = (p: Pick<ProjectSummary, 'id' | 'name'>) => `[${p.name}](/projets/${p.id})`;

function projectLine(p: ProjectSummary, d: AssistantData): string {
  const s = p.stats;
  return [
    `- ${projectLink(p)}${p.code ? ` (${p.code})` : ''}`,
    statusLabel(d.lists, 'project', p.status),
    p.blocked && `BLOQUÉ${p.blockedReason ? ` (${cut(p.blockedReason, 160)})` : ''}`,
    p.domains?.length && `domaines : ${p.domains.join(', ')}`,
    `priorité ${p.priority}`,
    `météo ${HEALTH_LABELS[p.health]}${p.healthComment ? ` (${cut(p.healthComment, 120)})` : ''}`,
    p.chefDeProjet && `chef(s) : ${p.chefDeProjet}`,
    p.targetDate && `fin visée ${p.targetDate}`,
    `tickets ouverts ${s.openTasks}${s.overdueTasks ? ` dont ${s.overdueTasks} EN RETARD` : ''}`,
    s.nextJalon && `prochain jalon : ${s.nextJalon.label} (${s.nextJalon.date || 'sans date'})`,
    s.lateJalons && `${s.lateJalons} jalon(s) EN RETARD`,
    s.openRisks && `${s.openRisks} risque(s) ouvert(s), criticité max ${s.maxRiskScore}/9`,
  ]
    .filter(Boolean)
    .join(' — ');
}

function ticketLine(t: TicketView, d: AssistantData, sprints: Map<number, Sprint>): string {
  const sprint = t.sprintId ? sprints.get(t.sprintId) : null;
  return [
    `- ${ticketKey(t)} ${cut(t.title, 140)}`,
    t.projectId === NO_PROJECT_ID ? 'hors projet' : `[${t.projectName}](/projets/${t.projectId})`,
    statusLabel(d.lists, 'ticket', t.status),
    `priorité ${PRIORITY_LABELS[t.priority].toLowerCase()}`,
    t.assignee && `responsable ${t.assignee}`,
    t.dueDate && `échéance ${t.dueDate}${isTaskOverdue(t, d.today) ? ' (EN RETARD)' : ''}`,
    sprint ? `sprint « ${sprint.name} »` : 'backlog',
  ]
    .filter(Boolean)
    .join(' — ');
}

function todoLine(t: PersonalTask, d: AssistantData, name: (e: string) => string): string {
  const project = t.projectId ? d.projects.find((p) => p.id === t.projectId) : null;
  const head = [
    `- ${cut(t.title, 160)}`,
    t.dueDate && `échéance ${t.dueDate}${isTaskOverdue(t, d.today) ? ' (EN RETARD)' : t.dueDate === d.today ? " (AUJOURD'HUI)" : ''}`,
    project && `projet ${projectLink(project)}`,
    t.assigneeId !== d.me.email && `responsable ${name(t.assigneeId)}`,
  ]
    .filter(Boolean)
    .join(' — ');
  const subs = (t.subtasks ?? []).map((s) => `  - [${s.done ? 'x' : ' '}] ${cut(s.title, 120)}`);
  return [head, ...subs].join('\n');
}

/** Contexte global de l'assistant (Markdown), identique pour toutes les questions d'une même journée. */
export function globalContext(d: AssistantData): string {
  const name = (e: string) => d.users.find((u) => u.email === e)?.name ?? e;
  const weekday = WEEKDAYS[new Date(`${d.today}T12:00:00Z`).getUTCDay()];
  const open = d.projects.filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const mine = open.filter((p) => isMyProject(p, d.me.email));
  const others = open.filter((p) => !isMyProject(p, d.me.email));
  const closed = d.projects.filter((p) => CLOSED_PROJECT_STATUSES.includes(p.status));
  const byId = new Map(d.projects.map((p) => [p.id, p]));
  const sprints = new Map(d.sprints.map((s) => [s.id, s]));

  const horizon = addDays(d.today, UPCOMING_DAYS);
  const jalons = d.jalons
    .filter(({ projectId, item: j }) => !j.done && j.date && j.date <= horizon && byId.has(projectId) && !CLOSED_PROJECT_STATUSES.includes(byId.get(projectId)!.status))
    .sort((a, b) => a.item.date.localeCompare(b.item.date))
    .slice(0, 80)
    .map(({ projectId, item: j }) => `- ${j.startDate ? `du ${j.startDate} au ` : ''}${j.date} — ${cut(j.label, 120)} — ${projectLink(byId.get(projectId)!)}${isJalonLate(j, d.today) ? ' — EN RETARD' : ''}`);

  const active = d.sprints.find((s) => s.state === 'active');
  const sprintTickets = active ? d.tickets.filter((t) => t.sprintId === active.id) : [];
  const sprintLines = active
    ? [
        `- « ${active.name} » du ${active.startDate} au ${active.endDate}${active.goal ? ` — objectif : ${cut(active.goal, 300)}` : ''}`,
        `- ${sprintTickets.length} ticket(s) : ${(['a_faire', 'en_cours', 'attente', 'recette', 'termine'] as const)
          .map((st) => `${statusLabel(d.lists, 'ticket', st)} ${sprintTickets.filter((t) => t.status === st).length}`)
          .join(', ')}`,
      ]
    : [];
  const nextSprint = d.sprints.filter((s) => s.state === 'future').sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9'))[0];
  if (nextSprint) sprintLines.push(`- Sprint suivant : « ${nextSprint.name} »${nextSprint.startDate ? ` à partir du ${nextSprint.startDate}` : ''}`);

  const openTickets = d.tickets.filter((t) => !t.done);
  const myTickets = openTickets.filter((t) => t.assigneeId === d.me.email).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
  const lateOthers = openTickets.filter((t) => t.assigneeId !== d.me.email && isTaskOverdue(t, d.today));

  const myTodos = d.todos.filter((t) => !t.done && (t.assigneeId === d.me.email || (t.createdBy === d.me.email && !t.projectId)));
  const projectTodos = d.todos.filter((t) => !t.done && t.projectId && !myTodos.includes(t) && byId.has(t.projectId));
  const byDue = (a: PersonalTask, b: PersonalTask) => (a.dueDate || '9').localeCompare(b.dueDate || '9');

  return [
    `# Données du hub au ${weekday} ${d.today}`,
    `Utilisateur : ${d.me.name} (${d.me.email}). « Je », « mes », « moi » désignent cet utilisateur.`,
    section('Équipe (utilisateurs du hub)', d.users.filter((u) => u.active).map((u) => `- ${u.name} (${u.email})`)),
    section('Types de tickets', [d.lists.ticketTypes.join(', ')]),
    section('Domaines de projet', [d.lists.projectDomains.join(', ')]),
    section('Mes projets (chef de projet ou suivi)', mine.map((p) => projectLine(p, d))),
    section('Autres projets en cours', others.map((p) => projectLine(p, d))),
    closed.length ? section('Projets clos', [closed.map((p) => `${projectLink(p)} (${statusLabel(d.lists, 'project', p.status)})`).join(' ; ')]) : '',
    section(`Jalons non atteints : en retard et des ${UPCOMING_DAYS} prochains jours`, jalons),
    section('Sprint en cours', sprintLines, '(aucun sprint en cours)'),
    section('Mes tickets ouverts', myTickets.slice(0, 60).map((t) => ticketLine(t, d, sprints))),
    section('Tickets en retard des autres', lateOthers.slice(0, 40).map((t) => ticketLine(t, d, sprints))),
    section('Ma to-do (à faire, avec les sous-tâches)', myTodos.sort(byDue).slice(0, 80).map((t) => todoLine(t, d, name)), '(vide)'),
    projectTodos.length ? section('To-do partagée des projets (à faire)', projectTodos.sort(byDue).slice(0, 40).map((t) => todoLine(t, d, name))) : '',
    d.notes.length
      ? section(
          'Mes notes (extraits)',
          d.notes.slice(0, 30).map((n) => {
            const project = n.projectId ? byId.get(n.projectId) : null;
            return `- ${n.title ? `**${cut(n.title, 100)}** : ` : ''}${cut(n.content, 300)}${project ? ` — projet ${projectLink(project)}` : ''} — ${n.updatedAt.slice(0, 10)}`;
          }),
        )
      : '',
    d.faq.length ? section('FAQ de l’équipe (questions et réponses)', [...d.faq].sort(byFaqCategory).slice(0, FAQ_MAX).map(faqLine)) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Minuscules sans accents ni ponctuation, pour reconnaître un nom de projet dans une question. */
export function normalizeText(s: string): string {
  return ` ${s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Projets cités (nom ou code, en mots entiers) dans la question, sinon dans les derniers échanges (question de relance :
 * « et ses risques ? »). Au plus `max`, les plus longs noms d'abord (« ERP Paie » plutôt que « ERP »).
 */
export function mentionedProjects(projects: ProjectSummary[], question: string, history: AssistantMessage[], max = 3): ProjectSummary[] {
  const keys = projects
    .flatMap((p) => [p.name, p.code].filter((k) => normalizeText(k).trim().length >= 3).map((k) => ({ p, key: normalizeText(k) })))
    .sort((a, b) => b.key.length - a.key.length);
  const find = (text: string) => {
    let t = normalizeText(text);
    const found: ProjectSummary[] = [];
    for (const { p, key } of keys) {
      if (!t.includes(key)) continue;
      t = t.split(key).join(' ');
      if (!found.includes(p)) found.push(p);
    }
    return found;
  };
  const direct = find(question);
  if (direct.length) return direct.slice(0, max);
  return find(history.slice(-4).map((m) => m.content).join('\n')).slice(0, max);
}
