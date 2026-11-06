/**
 * Lecture des données Jira : comptes, champs, tableaux, puis import des tableaux suivis — sprints récents et leurs
 * tickets avec leur historique (changements de sprint et de statut), backlog ouvert. Le résultat est compact et
 * indépendant du format Jira : liste des tickets (lecture seule dans le hub) et un instantané par sprint.
 */
import {
  buildSprintReport,
  JIRA_CLOSED_SPRINTS_KEPT,
  type JiraBoard,
  type JiraFieldRef,
  type JiraSprintInfo,
  type JiraStatusCategory,
  type JiraTask,
  type JiraTestResult,
  type SprintHistoryEntry,
  type SprintIssue,
  type SprintSnapshot,
} from '@samm/shared';
import { HttpError, nowIso } from '../lib/util.js';
import { JiraClient } from './client.js';

/** Garde-fous : au-delà, ce n'est plus un cas d'usage du hub (équipe de quelques personnes). */
const MAX_SPRINT_ISSUES = 2000;
const MAX_BACKLOG_ISSUES = 300;
const SPRINT_FIELD_TYPE = 'com.pyxis.greenhopper.jira:gh-sprint';

interface RawField {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type?: string; custom?: string };
}

interface RawSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
  originBoardId?: number;
}

interface RawHistory {
  created: string;
  items: { field: string; fieldId?: string; from: string | null; fromString: string | null; to: string | null; toString: string | null }[];
}

interface RawIssue {
  key: string;
  fields: Record<string, unknown>;
  changelog?: { histories: RawHistory[]; total?: number; maxResults?: number };
}

/** Dates Jira (« 2026-10-14T09:12:33.000+0200 ») en ISO UTC. */
export function jiraDate(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function sprintInfo(s: RawSprint, boardId: number): JiraSprintInfo {
  return {
    id: s.id,
    name: s.name,
    state: s.state === 'closed' ? 'closed' : s.state === 'active' ? 'active' : 'future',
    startDate: jiraDate(s.startDate),
    endDate: jiraDate(s.endDate),
    completeDate: jiraDate(s.completeDate),
    goal: s.goal ?? '',
    boardId: s.originBoardId ?? boardId,
  };
}

// ---------------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------------

export interface DetectedFields {
  storyPoints: JiraFieldRef | null;
  deskRef: JiraFieldRef | null;
  sprint: string | null;
}

export async function listFields(jira: JiraClient): Promise<RawField[]> {
  return jira.get<RawField[]>('/rest/api/3/field');
}

/** Champs « story points », « Réf ticket Desk » et Sprint : choix manuel s'il existe, sinon détection par le nom. */
export function detectFields(fields: RawField[], wanted: { storyPointsField: string; deskRefField: string }): DetectedFields {
  const ref = (f: RawField | undefined) => (f ? { id: f.id, name: f.name } : null);
  const byId = (id: string) => fields.find((f) => f.id === id);
  const numeric = fields.filter((f) => f.custom && f.schema?.type === 'number');
  const sp =
    (wanted.storyPointsField && byId(wanted.storyPointsField)) ||
    numeric.find((f) => /^story points?$/i.test(f.name.trim())) ||
    numeric.find((f) => /story point/i.test(f.name)) ||
    numeric.find((f) => /points? d.?histoire|estimation.*points?/i.test(f.name));
  const desk = (wanted.deskRefField && byId(wanted.deskRefField)) || fields.find((f) => f.custom && /desk/i.test(f.name));
  return { storyPoints: ref(sp), deskRef: ref(desk), sprint: fields.find((f) => f.schema?.custom === SPRINT_FIELD_TYPE)?.id ?? null };
}

export async function testConnection(jira: JiraClient, wanted: { storyPointsField: string; deskRefField: string }): Promise<JiraTestResult & { sprintField: string | null }> {
  const me = await jira.get<{ displayName?: string; emailAddress?: string }>('/rest/api/3/myself');
  const fields = await listFields(jira);
  const d = detectFields(fields, wanted);
  return {
    accountName: me.displayName || me.emailAddress || '',
    storyPoints: d.storyPoints,
    deskRef: d.deskRef,
    sprintField: d.sprint,
    fields: fields
      .filter((f) => f.custom && ['number', 'string', 'option'].includes(f.schema?.type ?? ''))
      .map((f) => ({ id: f.id, name: f.name, type: f.schema?.type ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  };
}

// ---------------------------------------------------------------------------
// Tableaux et sprints
// ---------------------------------------------------------------------------

async function paged<T>(jira: JiraClient, path: string, query: Record<string, string | number | undefined> = {}, max = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let startAt = 0; out.length < max; ) {
    const page = await jira.get<{ values: T[]; isLast?: boolean; total?: number }>(path, { ...query, startAt, maxResults: 50 });
    out.push(...page.values);
    startAt += page.values.length;
    if (page.isLast !== false || !page.values.length) break;
  }
  return out;
}

export async function listBoards(jira: JiraClient, projectKey: string): Promise<JiraBoard[]> {
  const raw = await paged<{ id: number; name: string; type: string; location?: { projectKey?: string } }>(jira, '/rest/agile/1.0/board', {
    projectKeyOrId: projectKey || undefined,
  });
  return raw.map((b) => ({ id: b.id, name: b.name, type: b.type, projectKey: b.location?.projectKey ?? '' }));
}

/**
 * Sprints d'un tableau, ou null si Jira refuse de les lister (tableau Kanban sans sprints). Le type du tableau ne suffit
 * pas à le savoir : les projets « gérés par l'équipe » ont des tableaux de type `simple`, avec ou sans sprints.
 */
export async function listSprints(jira: JiraClient, boardId: number): Promise<JiraSprintInfo[] | null> {
  try {
    const raw = await paged<RawSprint>(jira, `/rest/agile/1.0/board/${boardId}/sprint`);
    return raw.map((s) => sprintInfo(s, boardId));
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Import des tableaux suivis
// ---------------------------------------------------------------------------

const ids = (s: string | null) => (s ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);

/** Tickets retirés du sprint (rapport de sprint du tableau) : ils n'apparaissent plus dans la recherche « sprint in ». */
async function removedKeys(jira: JiraClient, boardId: number, sprintId: number): Promise<string[] | null> {
  try {
    const r = await jira.get<{ contents?: { puntedIssues?: { key: string }[] } }>('/rest/greenhopper/1.0/rapid/charts/sprintreport', { rapidViewId: boardId, sprintId });
    return (r.contents?.puntedIssues ?? []).map((i) => i.key);
  } catch {
    return null; // API interne indisponible : repli sur la recherche par projet
  }
}

async function search(jira: JiraClient, jql: string, fields: string[], o: { changelog: boolean; max: number; what: string }): Promise<RawIssue[]> {
  const out: RawIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await jira.post<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>('/rest/api/3/search/jql', {
      jql,
      fields,
      ...(o.changelog ? { expand: 'changelog' } : {}),
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...page.issues);
    nextPageToken = page.isLast === false ? page.nextPageToken : undefined;
    if (out.length > o.max) throw new HttpError(422, `Plus de ${o.max} tickets ${o.what} : réduisez le nombre de tableaux suivis.`);
  } while (nextPageToken);
  return out;
}

/** Historique complet, quand la recherche l'a tronqué. */
async function fullChangelog(jira: JiraClient, key: string): Promise<RawHistory[]> {
  return paged<RawHistory>(jira, `/rest/api/3/issue/${encodeURIComponent(key)}/changelog`, {}, 2000);
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as { value?: unknown; name?: unknown; displayName?: unknown };
    return text(o.value ?? o.name ?? o.displayName ?? '');
  }
  return '';
}

export interface ImportOptions {
  site: string;
  boards: JiraBoard[];
  storyPointsField: string | null;
  deskRefField: string | null;
  sprintField: string | null;
}

export interface ImportedSprint extends JiraSprintInfo {
  boardName: string;
  issueCount: number;
  openCount: number;
  points: number;
}

/** Résultat d'un import : liste des tickets et des sprints, plus un instantané (avec historique) par sprint. */
export interface ImportResult {
  site: string;
  syncedAt: string;
  boards: JiraBoard[];
  sprints: ImportedSprint[];
  statusCategories: Record<string, JiraStatusCategory>;
  tasks: JiraTask[];
  /** Remarques sur les tableaux (sans sprints…), affichées après l'import. */
  warnings: string[];
  /** Bilan des derniers sprints clos, par tableau (du plus récent au plus ancien). */
  history: Record<string, SprintHistoryEntry[]>;
  snapshots: SprintSnapshot[];
}

const closedRank = (s: JiraSprintInfo) => s.completeDate ?? s.endDate ?? s.startDate ?? '';

export async function importBoards(jira: JiraClient, o: ImportOptions): Promise<ImportResult> {
  const syncedAt = nowIso();
  const statuses = await jira.get<{ name: string; statusCategory?: { key?: string } }[]>('/rest/api/3/status');
  const statusCategories: Record<string, JiraStatusCategory> = {};
  const category = (k: string | undefined): JiraStatusCategory => (k === 'done' ? 'done' : k === 'new' ? 'new' : 'indeterminate');
  for (const s of statuses) statusCategories[s.name] = category(s.statusCategory?.key);
  const sprintField = o.sprintField ?? 'customfield_10020';

  // ---- Sprints : en cours, à venir et derniers clos de chaque tableau ----
  const sprints = new Map<number, JiraSprintInfo & { boardName: string }>();
  const warnings: string[] = [];
  for (const b of o.boards) {
    const all = await listSprints(jira, b.id);
    if (!all) {
      warnings.push(`« ${b.name} » : Jira ne gère pas de sprints sur ce tableau (tableau Kanban ?) ; seuls ses tickets hors sprint sont importés.`);
      continue;
    }
    if (!all.length) warnings.push(`« ${b.name} » : aucun sprint créé sur ce tableau ; seuls ses tickets hors sprint sont importés.`);
    const closed = all.filter((s) => s.state === 'closed').sort((a, z) => closedRank(z).localeCompare(closedRank(a))).slice(0, JIRA_CLOSED_SPRINTS_KEPT);
    for (const s of [...all.filter((x) => x.state !== 'closed'), ...closed]) if (!sprints.has(s.id)) sprints.set(s.id, { ...s, boardId: b.id, boardName: b.name });
  }
  const sprintIds = [...sprints.keys()];

  // ---- Tickets des sprints, avec leur historique ----
  const removed: string[] = [];
  const fallbackProjects = new Set<string>();
  let fallbackSince = '';
  for (const s of sprints.values()) {
    if (!s.startDate) continue;
    const keys = await removedKeys(jira, s.boardId, s.id);
    if (keys) removed.push(...keys);
    else {
      const b = o.boards.find((x) => x.id === s.boardId);
      if (b?.projectKey) fallbackProjects.add(b.projectKey);
      if (!fallbackSince || s.startDate < fallbackSince) fallbackSince = s.startDate;
    }
  }
  const fields = ['summary', 'issuetype', 'priority', 'assignee', 'status', 'duedate', 'created', 'updated', 'resolutiondate', 'timespent', 'timeestimate', 'parent', 'project', sprintField];
  if (o.storyPointsField) fields.push(o.storyPointsField);
  if (o.deskRefField) fields.push(o.deskRefField);
  const clauses: string[] = [];
  if (sprintIds.length) clauses.push(`sprint in (${sprintIds.join(', ')})`);
  const uniqueRemoved = [...new Set(removed)];
  if (uniqueRemoved.length) clauses.push(`key in (${uniqueRemoved.map((k) => `"${k}"`).join(', ')})`);
  if (fallbackProjects.size) clauses.push(`(project in (${[...fallbackProjects].map((k) => `"${k}"`).join(', ')}) AND updated >= "${fallbackSince.slice(0, 10)}")`);
  const sprintRaw = clauses.length ? await search(jira, `${clauses.join(' OR ')} ORDER BY key`, fields, { changelog: true, max: MAX_SPRINT_ISSUES, what: 'dans les sprints suivis' }) : [];

  // ---- Backlog ouvert de chaque tableau (sans historique) ----
  const backlogRaw: { raw: RawIssue; boardId: number }[] = [];
  for (const b of o.boards) {
    if (!b.projectKey) continue;
    const jql = `project = "${b.projectKey}" AND sprint is EMPTY AND statusCategory != Done ORDER BY Rank ASC`;
    for (const raw of await search(jira, jql, fields, { changelog: false, max: MAX_BACKLOG_ISSUES, what: `au backlog de ${b.name}` })) backlogRaw.push({ raw, boardId: b.id });
  }

  const sprintNames: Record<string, string> = Object.fromEntries([...sprints.values()].map((s) => [s.id, s.name]));
  const boardOfProject = new Map(o.boards.filter((b) => b.projectKey).map((b) => [b.projectKey, b.id]));

  const convert = async (it: RawIssue, withHistory: boolean): Promise<{ issue: SprintIssue; task: JiraTask }> => {
    let histories = withHistory ? (it.changelog?.histories ?? []) : [];
    if (withHistory && it.changelog && (it.changelog.total ?? 0) > histories.length) histories = await fullChangelog(jira, it.key);
    const f = it.fields;
    const current = Array.isArray(f[sprintField]) ? (f[sprintField] as { id: number; name: string; boardId?: number }[]) : [];
    for (const s of current) sprintNames[s.id] ??= s.name;
    const sprintChanges: SprintIssue['sprintChanges'] = [];
    const statusChanges: SprintIssue['statusChanges'] = [];
    for (const h of histories) {
      const at = jiraDate(h.created);
      if (!at) continue;
      for (const item of h.items) {
        if (item.fieldId === sprintField || item.field === 'Sprint') {
          const from = ids(item.from);
          const to = ids(item.to);
          // Les noms sont listés dans le même ordre que les identifiants (sauf virgule dans un nom : on ignore).
          for (const [list, names] of [[from, item.fromString], [to, item.toString]] as const) {
            const parts = (names ?? '').split(',').map((x) => x.trim());
            if (parts.length === list.length) list.forEach((sid, i) => (sprintNames[sid] ??= parts[i]!));
          }
          sprintChanges.push({ at, from, to });
        } else if (item.field === 'status') {
          statusChanges.push({ at, from: item.fromString ?? '', to: item.toString ?? '' });
        }
      }
    }
    const sp = o.storyPointsField ? f[o.storyPointsField] : null;
    const status = f.status as { name?: string; statusCategory?: { key?: string } } | undefined;
    const assignee = f.assignee as { displayName?: string; emailAddress?: string } | null | undefined;
    const parent = f.parent as { key?: string; fields?: { summary?: string } } | null | undefined;
    const projectKey = text((f.project as { key?: string } | undefined)?.key) || it.key.replace(/-\d+$/, '');
    const issue: SprintIssue = {
      key: it.key,
      summary: text(f.summary),
      type: text(f.issuetype),
      priority: text(f.priority),
      assignee: text(f.assignee),
      status: text(f.status),
      storyPoints: typeof sp === 'number' ? sp : null,
      dueDate: typeof f.duedate === 'string' ? f.duedate.slice(0, 10) : '',
      created: jiraDate(f.created) ?? syncedAt,
      resolutionDate: jiraDate(f.resolutiondate),
      timeSpentSeconds: typeof f.timespent === 'number' ? f.timespent : null,
      remainingSeconds: typeof f.timeestimate === 'number' ? f.timeestimate : null,
      deskRef: o.deskRefField ? (/\d{1,9}/.exec(text(f[o.deskRefField]))?.[0] ?? '') : '',
      sprints: current.map((s) => s.id),
      sprintChanges,
      statusChanges,
    };
    const task: JiraTask = {
      key: issue.key,
      summary: issue.summary,
      type: issue.type,
      priority: issue.priority,
      assignee: issue.assignee,
      assigneeEmail: (assignee?.emailAddress ?? '').toLowerCase(),
      status: issue.status,
      statusCategory: status?.statusCategory?.key ? category(status.statusCategory.key) : (statusCategories[issue.status] ?? 'indeterminate'),
      storyPoints: issue.storyPoints,
      dueDate: issue.dueDate,
      created: issue.created,
      updated: jiraDate(f.updated) ?? issue.created,
      resolutionDate: issue.resolutionDate,
      projectKey,
      boardId: 0,
      sprintIds: issue.sprints,
      parent: parent?.key ? `${parent.key}${parent.fields?.summary ? ` ${parent.fields.summary}` : ''}` : '',
      parentKey: parent?.key ?? '',
      parentSummary: parent?.fields?.summary ?? '',
      deskRef: issue.deskRef,
    };
    return { issue, task };
  };

  const issues: SprintIssue[] = [];
  const tasks = new Map<string, JiraTask>();
  for (const raw of sprintRaw) {
    const { issue, task } = await convert(raw, true);
    const mine = issue.sprints.find((sid) => sprints.has(sid)) ?? issue.sprintChanges.flatMap((c) => [...c.from, ...c.to]).find((sid) => sprints.has(sid));
    if (mine === undefined) continue; // remonté par la recherche de repli, sans rapport avec les sprints suivis
    issues.push(issue);
    tasks.set(task.key, { ...task, boardId: sprints.get(mine)!.boardId });
  }
  for (const { raw, boardId } of backlogRaw) {
    if (tasks.has(raw.key)) continue;
    const { task } = await convert(raw, false);
    tasks.set(task.key, { ...task, boardId: boardOfProject.get(task.projectKey) ?? boardId });
  }

  // ---- Instantané et chiffres de chaque sprint ----
  const snapshots: SprintSnapshot[] = [];
  const imported: ImportedSprint[] = [];
  const history: Record<string, SprintHistoryEntry[]> = {};
  const taskList = [...tasks.values()];
  for (const s of sprints.values()) {
    const { boardName, ...sprint } = s;
    const snap: SprintSnapshot = {
      site: o.site,
      sprint,
      syncedAt,
      statusCategories,
      sprintNames,
      hasStoryPoints: !!o.storyPointsField,
      issues: issues.filter((i) => i.sprints.includes(s.id) || i.sprintChanges.some((c) => c.from.includes(s.id) || c.to.includes(s.id))),
    };
    snapshots.push(snap);
    const members = taskList.filter((t) => t.sprintIds.includes(s.id));
    imported.push({
      ...s,
      issueCount: members.length,
      openCount: members.filter((t) => t.statusCategory !== 'done').length,
      points: Math.round(members.reduce((n, t) => n + (t.storyPoints ?? 0), 0) * 10) / 10,
    });
    // Les sprints clos de chaque tableau sont parcourus du plus récent au plus ancien.
    if (s.state === 'closed') {
      const r = buildSprintReport(snap);
      (history[s.boardId] ??= []).push({ name: s.name, done: r.counts.done, points: r.points.done, active: r.counts.active });
    }
  }
  const rank = { active: 0, future: 1, closed: 2 } as const;
  imported.sort((a, z) => rank[a.state] - rank[z.state] || (z.startDate ?? '9999').localeCompare(a.startDate ?? '9999') || z.id - a.id);

  return { site: o.site, syncedAt, boards: o.boards, sprints: imported, statusCategories, tasks: taskList, warnings, history, snapshots };
}
