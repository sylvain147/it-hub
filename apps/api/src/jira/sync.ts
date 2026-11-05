/**
 * Lecture des données Jira : comptes, champs, tableaux, sprints et tickets d'un sprint avec leur historique
 * (changements de sprint et de statut). Le résultat est un instantané compact, indépendant du format Jira.
 */
import type { JiraBoard, JiraFieldRef, JiraSprintInfo, JiraStatusCategory, JiraTestResult, SprintIssue, SprintSnapshot } from '@samm/shared';
import { HttpError, nowIso } from '../lib/util.js';
import { JiraClient } from './client.js';

/** Garde-fou : un sprint de plus de 500 tickets n'est pas un cas d'usage du hub. */
const MAX_ISSUES = 500;
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

export async function listSprints(jira: JiraClient, boardId: number): Promise<JiraSprintInfo[]> {
  try {
    const raw = await paged<RawSprint>(jira, `/rest/agile/1.0/board/${boardId}/sprint`);
    return raw.map((s) => sprintInfo(s, boardId));
  } catch (e) {
    // Les tableaux Kanban n'ont pas de sprints.
    if (e instanceof HttpError && e.status === 400) throw new HttpError(400, 'Ce tableau Jira ne gère pas de sprints (tableau Kanban ?). Choisissez un tableau Scrum.');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Instantané d'un sprint
// ---------------------------------------------------------------------------

const ids = (s: string | null) => (s ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);

/** Tickets retirés du sprint (rapport de sprint du tableau) : ils n'apparaissent plus dans la recherche « sprint = ». */
async function removedKeys(jira: JiraClient, boardId: number, sprintId: number): Promise<string[] | null> {
  try {
    const r = await jira.get<{ contents?: { puntedIssues?: { key: string }[] } }>('/rest/greenhopper/1.0/rapid/charts/sprintreport', { rapidViewId: boardId, sprintId });
    return (r.contents?.puntedIssues ?? []).map((i) => i.key);
  } catch {
    return null; // API interne indisponible : repli sur la recherche par projet
  }
}

async function search(jira: JiraClient, jql: string, fields: string[]): Promise<RawIssue[]> {
  const out: RawIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await jira.post<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>('/rest/api/3/search/jql', {
      jql,
      fields,
      expand: 'changelog',
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...page.issues);
    nextPageToken = page.isLast === false ? page.nextPageToken : undefined;
    if (out.length > MAX_ISSUES) throw new HttpError(422, `Plus de ${MAX_ISSUES} tickets concernés : le sprint est trop volumineux pour la revue de sprint.`);
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

export interface SyncOptions {
  site: string;
  boardId: number;
  sprintId: number;
  projectKey: string;
  storyPointsField: string | null;
  deskRefField: string | null;
  sprintField: string | null;
}

export async function fetchSprintSnapshot(jira: JiraClient, o: SyncOptions): Promise<SprintSnapshot> {
  const sprint = sprintInfo(await jira.get<RawSprint>(`/rest/agile/1.0/sprint/${o.sprintId}`), o.boardId);
  const statuses = await jira.get<{ name: string; statusCategory?: { key?: string } }[]>('/rest/api/3/status');
  const statusCategories: Record<string, JiraStatusCategory> = {};
  for (const s of statuses) {
    const k = s.statusCategory?.key;
    statusCategories[s.name] = k === 'done' ? 'done' : k === 'new' ? 'new' : 'indeterminate';
  }
  const sprintField = o.sprintField ?? 'customfield_10020';

  const removed = sprint.startDate ? await removedKeys(jira, o.boardId, o.sprintId) : [];
  const clauses = [`sprint = ${o.sprintId}`];
  if (removed?.length) clauses.push(`key in (${removed.map((k) => `"${k}"`).join(', ')})`);
  if (removed === null && o.projectKey && sprint.startDate) clauses.push(`(project = "${o.projectKey}" AND updated >= "${sprint.startDate.slice(0, 10)}")`);
  const fields = ['summary', 'issuetype', 'priority', 'assignee', 'status', 'duedate', 'created', 'resolutiondate', 'timespent', 'timeestimate', sprintField];
  if (o.storyPointsField) fields.push(o.storyPointsField);
  if (o.deskRefField) fields.push(o.deskRefField);
  const raw = await search(jira, `${clauses.join(' OR ')} ORDER BY key`, fields);

  const sprintNames: Record<string, string> = { [sprint.id]: sprint.name };
  const issues: SprintIssue[] = [];
  for (const it of raw) {
    let histories = it.changelog?.histories ?? [];
    if (it.changelog && (it.changelog.total ?? 0) > histories.length) histories = await fullChangelog(jira, it.key);
    const f = it.fields;
    const current = Array.isArray(f[sprintField]) ? (f[sprintField] as { id: number; name: string }[]) : [];
    for (const s of current) sprintNames[s.id] = s.name;
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
    const inSprint = current.some((s) => s.id === o.sprintId) || sprintChanges.some((c) => c.from.includes(o.sprintId) || c.to.includes(o.sprintId));
    if (!inSprint) continue; // remonté par la recherche de repli, sans rapport avec ce sprint
    const sp = o.storyPointsField ? f[o.storyPointsField] : null;
    issues.push({
      key: it.key,
      summary: text(f.summary),
      type: text(f.issuetype),
      priority: text(f.priority),
      assignee: text(f.assignee),
      status: text(f.status),
      storyPoints: typeof sp === 'number' ? sp : null,
      dueDate: typeof f.duedate === 'string' ? f.duedate.slice(0, 10) : '',
      created: jiraDate(f.created) ?? nowIso(),
      resolutionDate: jiraDate(f.resolutiondate),
      timeSpentSeconds: typeof f.timespent === 'number' ? f.timespent : null,
      remainingSeconds: typeof f.timeestimate === 'number' ? f.timeestimate : null,
      deskRef: o.deskRefField ? (/\d{1,9}/.exec(text(f[o.deskRefField]))?.[0] ?? '') : '',
      sprints: current.map((s) => s.id),
      sprintChanges,
      statusChanges,
    });
  }

  return {
    site: o.site,
    sprint,
    syncedAt: nowIso(),
    statusCategories,
    sprintNames,
    hasStoryPoints: !!o.storyPointsField,
    issues,
  };
}
