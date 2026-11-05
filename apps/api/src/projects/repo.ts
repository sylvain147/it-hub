/**
 * Stockage du module « Projets ».
 *
 *  pk              sk                       contenu
 *  PROJ#<id>       META                     fiche + indicateurs calculés (+ GSI1 « PROJ » pour la liste)
 *  PROJ#<id>       TASK#<id>                tâche à cocher (+ GSI1 « TASK_OPEN » tant qu'elle n'est pas faite : vue transverse)
 *  PROJ#<id>       JALON#<id>               jalon du planning
 *  PROJ#<id>       PRESTA#<id>              prestation (devis, commande…)
 *  PROJ#<id>       CONTACT#<id>             intervenant
 *  PROJ#<id>       LINK#<id>                lien
 *  PROJ#<id>       FILE#<id>                pièce jointe (contenu dans le bucket)
 *  PROJ#<id>       NOTE#<id>                note du journal (compte rendu, décision, rapport…)
 *  PROJ#<id>       RISK#<id>                risque
 *  PROJ#<id>       ACT#<date>#<aléa>        historique (+ GSI1 « ACT » : activité récente tous projets ; TTL 1 an)
 *  bucket : projects/<id>/files/<fileId>    pièces jointes
 *  bucket : projects/<id>/notes/<noteId>.txt transcription brute d'un compte rendu analysé
 */
import { randomBytes } from 'node:crypto';
import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  computeStats,
  emptyItems,
  normalizeTaskRecord,
  PROJECT_ITEM_SCHEMAS,
  statusLabel,
  type ActivityEntry,
  type ItemBase,
  type OpenTask,
  type ProjectDetail,
  type ProjectFields,
  type ProjectItem,
  type ProjectItemKind,
  type ProjectItems,
  type ProjectStats,
  type ProjectSummary,
  type ListSettings,
  type Task,
} from '@samm/shared';
import { config } from '../config.js';
import { ddb, isConditionFailed, queryAll } from '../db/client.js';
import { GSI1, ttlInDays } from '../db/schema.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';
import { getLists } from '../settings/repo.js';

const T = () => config.tableName;
const LIST_PK = 'PROJ';
const OPEN_TASKS_PK = 'TASK_OPEN';
const ACTIVITY_PK = 'ACT';

const SK_PREFIX: Record<ProjectItemKind, string> = {
  tasks: 'TASK#',
  jalons: 'JALON#',
  prestations: 'PRESTA#',
  contacts: 'CONTACT#',
  links: 'LINK#',
  files: 'FILE#',
  notes: 'NOTE#',
  risks: 'RISK#',
};

export const projectKeys = {
  meta: (id: string) => ({ pk: `PROJ#${id}`, sk: 'META' }),
  item: (id: string, kind: ProjectItemKind, itemId: string) => ({ pk: `PROJ#${id}`, sk: `${SK_PREFIX[kind]}${itemId}` }),
};

export const projectBlobKeys = {
  file: (id: string, fileId: string) => `projects/${id}/files/${fileId}`,
  noteSource: (id: string, noteId: string) => `projects/${id}/notes/${noteId}.txt`,
};

/** Libellés utilisés dans l'historique. */
const KIND_LABELS: Record<ProjectItemKind, { one: string }> = {
  tasks: { one: 'la tâche' },
  jalons: { one: 'le jalon' },
  prestations: { one: 'la prestation' },
  contacts: { one: 'l’intervenant' },
  links: { one: 'le lien' },
  files: { one: 'le document' },
  notes: { one: 'la note' },
  risks: { one: 'le risque' },
};

export function itemTitle(kind: ProjectItemKind, it: Record<string, unknown>): string {
  switch (kind) {
    case 'tasks':
    case 'notes':
    case 'risks':
      return String(it.title);
    case 'jalons':
    case 'links':
      return String(it.label);
    case 'prestations':
      return `${String(it.prestataire)} — ${String(it.objet)}`;
    case 'contacts':
    case 'files':
      return String(it.name);
  }
}

// ---------------------------------------------------------------------------
// Fiche projet
// ---------------------------------------------------------------------------

interface MetaItem extends ProjectFields {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  id: string;
  rev: number;
  stats: ProjectStats;
  activeJobId: string | null;
  activeJobAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

function toSummary(it: MetaItem, cdcCount = 0): ProjectSummary {
  const { pk: _pk, sk: _sk, gsi1pk: _g, gsi1sk: _s, activeJobAt, ...rest } = it;
  const stale = it.activeJobAt && (Date.now() - Date.parse(it.activeJobAt)) / 60000 > config.staleJobMinutes;
  return { ...rest, activeJobId: stale || !activeJobAt ? null : it.activeJobId, cdcCount };
}

async function getMeta(id: string): Promise<MetaItem | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: projectKeys.meta(id) }));
  return (res.Item as MetaItem | undefined) ?? null;
}

export async function requireProject(id: string): Promise<ProjectSummary> {
  const it = await getMeta(id);
  if (!it) throw notFound('Projet');
  return toSummary(it);
}

export async function listProjects(cdcCounts: Map<string, number> = new Map()): Promise<ProjectSummary[]> {
  const items = await queryAll<MetaItem>({
    IndexName: GSI1,
    KeyConditionExpression: 'gsi1pk = :p',
    ExpressionAttributeValues: { ':p': LIST_PK },
    ScanIndexForward: false,
  });
  return items.map((it) => toSummary(it, cdcCounts.get(it.id) ?? 0));
}

export async function createProject(fields: ProjectFields, user: string): Promise<string> {
  const id = newId();
  const now = nowIso();
  const item: MetaItem = {
    ...projectKeys.meta(id),
    gsi1pk: LIST_PK,
    gsi1sk: now,
    id,
    ...fields,
    rev: 1,
    stats: computeStats(emptyItems()),
    activeJobId: null,
    activeJobAt: null,
    createdAt: now,
    createdBy: user,
    updatedAt: now,
    updatedBy: user,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  await logActivity(id, fields.name, user, 'a créé le projet');
  return id;
}

/** Met à jour la fiche. `rev` doit être la révision lue (verrouillage optimiste). */
export async function updateProject(id: string, rev: number, fields: ProjectFields, user: string): Promise<void> {
  const before = await getMeta(id);
  if (!before) throw notFound('Projet');
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':rev': rev, ':next': rev + 1, ':now': nowIso(), ':user': user };
  const sets = ['rev = :next', 'updatedAt = :now', 'updatedBy = :user', 'gsi1sk = :now'];
  for (const [k, v] of Object.entries(fields)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: T(),
        Key: projectKeys.meta(id),
        ConditionExpression: 'rev = :rev',
        UpdateExpression: 'SET ' + sets.join(', '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  } catch (e) {
    if (isConditionFailed(e)) {
      throw new HttpError(409, `La fiche du projet a été modifiée entre-temps par ${before.updatedBy}. Rechargez pour récupérer la dernière version.`);
    }
    throw e;
  }
  const changes: string[] = [];
  if (before.status !== fields.status) changes.push('le statut');
  if (before.health !== fields.health) changes.push('la météo');
  if (before.targetDate !== fields.targetDate) changes.push('la date cible');
  await logActivity(id, fields.name, user, changes.length ? `a modifié ${changes.join(', ')} du projet` : 'a modifié la fiche du projet');
}

export async function deleteProject(id: string): Promise<void> {
  const items = await queryAll<{ pk: string; sk: string }>({
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': `PROJ#${id}` },
    ProjectionExpression: 'pk, sk',
  });
  for (let i = 0; i < items.length; i += 25) {
    await ddb().send(
      new BatchWriteCommand({ RequestItems: { [T()]: items.slice(i, i + 25).map((k) => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } })) } }),
    );
  }
}

export async function getProjectDetail(id: string, cdcs: ProjectDetail['cdcs']): Promise<ProjectDetail> {
  const all = await queryAll<Record<string, unknown> & { sk: string }>({
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': `PROJ#${id}` },
  });
  const meta = all.find((it) => it.sk === 'META') as MetaItem | undefined;
  if (!meta) throw notFound('Projet');
  const items = partition(all);
  const activity = all
    .filter((it) => it.sk.startsWith('ACT#'))
    .map(toActivity)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50);
  return { ...toSummary(meta, cdcs.length), items, cdcs, activity };
}

function partition(all: (Record<string, unknown> & { sk: string })[]): ProjectItems {
  const items = emptyItems();
  for (const [kind, prefix] of Object.entries(SK_PREFIX) as [ProjectItemKind, string][]) {
    (items[kind] as unknown[]) = all.filter((it) => it.sk.startsWith(prefix)).map((it) => stripItem(kind === 'tasks' ? normalizeTaskRecord(it) : it));
  }
  items.tasks.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt));
  items.jalons.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  items.notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.date || b.createdAt).localeCompare(a.date || a.createdAt) || b.createdAt.localeCompare(a.createdAt));
  for (const k of ['prestations', 'contacts', 'links', 'files', 'risks'] as const) (items[k] as ItemBase[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return items;
}

function stripItem<T>(it: Record<string, unknown>): T {
  const { pk: _pk, sk: _sk, gsi1pk: _g, gsi1sk: _s, projectId: _p, ...rest } = it;
  return rest as T;
}

/** Recalcule les indicateurs de la fiche après une modification d'un élément. */
export async function refreshStats(id: string, user: string): Promise<void> {
  const all = await queryAll<Record<string, unknown> & { sk: string }>({
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': `PROJ#${id}` },
  });
  const now = nowIso();
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: projectKeys.meta(id),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET stats = :s, updatedAt = :now, updatedBy = :user, gsi1sk = :now',
      ExpressionAttributeValues: { ':s': computeStats(partition(all)), ':now': now, ':user': user },
    }),
  );
}

// ---------------------------------------------------------------------------
// Éléments rattachés (tâches, jalons, prestations…)
// ---------------------------------------------------------------------------

type Stored = Record<string, unknown> & ItemBase;

async function getStored(id: string, kind: ProjectItemKind, itemId: string): Promise<Stored | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: projectKeys.item(id, kind, itemId) }));
  if (!res.Item) return null;
  return (kind === 'tasks' ? normalizeTaskRecord(res.Item) : res.Item) as Stored;
}

export async function getItem<K extends ProjectItemKind>(id: string, kind: K, itemId: string): Promise<ProjectItem<K>> {
  const it = await getStored(id, kind, itemId);
  if (!it) throw notFound('Élément');
  return stripItem(it);
}

/** Champs calculés par le serveur selon le type d'élément. */
function derived(kind: ProjectItemKind, data: Record<string, unknown>, before: Stored | null): Record<string, unknown> {
  switch (kind) {
    case 'tasks': {
      const done = data.done === true;
      const doneAt = done ? (before?.done === true && before.doneAt ? (before.doneAt as string) : nowIso()) : '';
      // Index transverse des tâches ouvertes (accueil, « mes tâches »).
      return done ? { doneAt } : { doneAt, gsi1pk: OPEN_TASKS_PK, gsi1sk: `${(data.dueDate as string) || '9999-12-31'}#${data.id as string}` };
    }
    case 'jalons':
      // La date initiale permet de mesurer le glissement du planning.
      return { initialDate: (before?.initialDate as string) || (data.date as string) || '' };
    case 'notes':
      return {
        suggestions: before?.suggestions ?? data.suggestions ?? null,
        suggestedHealth: before?.suggestedHealth ?? data.suggestedHealth ?? null,
        hasSource: before?.hasSource ?? data.hasSource ?? false,
        origin: before?.origin ?? data.origin ?? 'manuel',
      };
    case 'files':
      return { contentType: before?.contentType ?? data.contentType, size: before?.size ?? data.size, uploaded: before?.uploaded ?? data.uploaded ?? false };
    default:
      return {};
  }
}

export async function createItem<K extends ProjectItemKind>(
  id: string,
  kind: K,
  input: Record<string, unknown>,
  user: string,
  opts: { extra?: Record<string, unknown>; silent?: boolean; itemId?: string } = {},
): Promise<ProjectItem<K>> {
  const project = await requireProject(id);
  const data = PROJECT_ITEM_SCHEMAS[kind].parse(input) as Record<string, unknown>;
  const now = nowIso();
  const itemId = opts.itemId ?? newId();
  const base = { ...data, ...opts.extra, id: itemId, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
  const item = { ...projectKeys.item(id, kind, itemId), projectId: id, ...base, ...derived(kind, base, null) };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  if (!opts.silent) {
    await logActivity(id, project.name, user, `a ajouté ${KIND_LABELS[kind].one} « ${itemTitle(kind, base)} »`);
    await refreshStats(id, user);
  }
  return stripItem(item);
}

/** Modification partielle : les champs fournis remplacent les anciens, l'ensemble est revalidé. */
export async function updateItem<K extends ProjectItemKind>(
  id: string,
  kind: K,
  itemId: string,
  patch: Record<string, unknown>,
  user: string,
  extra: Record<string, unknown> = {},
): Promise<ProjectItem<K>> {
  const project = await requireProject(id);
  const before = await getStored(id, kind, itemId);
  if (!before) throw notFound('Élément');
  const data = PROJECT_ITEM_SCHEMAS[kind].parse({ ...stripItem<Record<string, unknown>>(before), ...patch }) as Record<string, unknown>;
  const base = { ...data, ...extra, id: itemId, createdAt: before.createdAt, createdBy: before.createdBy, updatedAt: nowIso(), updatedBy: user };
  const merged = { ...base, ...derived(kind, base, { ...before, ...extra }) };
  const item = { ...projectKeys.item(id, kind, itemId), projectId: id, ...merged };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  await logActivity(id, project.name, user, activityForUpdate(kind, before, merged, await getLists()));
  await refreshStats(id, user);
  return stripItem(item);
}

function activityForUpdate(kind: ProjectItemKind, before: Record<string, unknown>, after: Record<string, unknown>, lists: ListSettings): string {
  const title = `« ${itemTitle(kind, after)} »`;
  if (kind === 'tasks' && before.done !== after.done) return after.done ? `a terminé la tâche ${title}` : `a rouvert la tâche ${title}`;
  if (kind === 'jalons' && !before.done && after.done) return `a marqué le jalon ${title} comme atteint`;
  if (kind === 'jalons' && before.date !== after.date) return `a déplacé le jalon ${title} au ${String(after.date) || '(date à définir)'}`;
  if (kind === 'risks' && before.status !== after.status && after.status === 'clos') return `a clos le risque ${title}`;
  if (kind === 'prestations' && before.status !== after.status) return `a passé la prestation ${title} au statut « ${statusLabel(lists, 'prestation', String(after.status))} »`;
  return `a modifié ${KIND_LABELS[kind].one} ${title}`;
}

export async function deleteItem(id: string, kind: ProjectItemKind, itemId: string, user: string): Promise<void> {
  const project = await requireProject(id);
  const before = await getStored(id, kind, itemId);
  if (!before) throw notFound('Élément');
  await ddb().send(new DeleteCommand({ TableName: T(), Key: projectKeys.item(id, kind, itemId) }));
  await logActivity(id, project.name, user, `a supprimé ${KIND_LABELS[kind].one} « ${itemTitle(kind, before)} »`);
  await refreshStats(id, user);
}

/** Met à jour des champs techniques d'un élément sans revalidation (téléversement confirmé, propositions traitées…). */
export async function setItemFields(id: string, kind: ProjectItemKind, itemId: string, fields: Record<string, unknown>): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: projectKeys.item(id, kind, itemId),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function listItems<K extends ProjectItemKind>(id: string, kind: K): Promise<ProjectItems[K]> {
  const all = await queryAll<Record<string, unknown> & { sk: string }>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :k)',
    ExpressionAttributeValues: { ':p': `PROJ#${id}`, ':k': SK_PREFIX[kind] },
  });
  return partition(all)[kind];
}

/** Tâches non terminées de tous les projets, par échéance. */
export async function listOpenTasks(): Promise<OpenTask[]> {
  const [tasks, projects] = await Promise.all([
    queryAll<Record<string, unknown>>({ IndexName: GSI1, KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': OPEN_TASKS_PK } }),
    listProjects(),
  ]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return tasks
    .filter((t) => names.has(String(t.projectId)))
    .map((t) => ({ ...stripItem<Task>(normalizeTaskRecord(t)), projectId: String(t.projectId), projectName: names.get(String(t.projectId))! }))
    .filter((t) => !t.done);
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function toActivity(it: Record<string, unknown>): ActivityEntry {
  return { at: String(it.at), user: String(it.user), projectId: String(it.projectId), projectName: String(it.projectName), text: String(it.text) };
}

export async function logActivity(projectId: string, projectName: string, user: string, text: string): Promise<void> {
  const at = nowIso();
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        pk: `PROJ#${projectId}`,
        sk: `ACT#${at}#${randomBytes(3).toString('hex')}`,
        gsi1pk: ACTIVITY_PK,
        gsi1sk: at,
        at,
        user,
        projectId,
        projectName,
        text,
        ttl: ttlInDays(365),
      },
    }),
  );
}

export async function recentActivity(limit = 30): Promise<ActivityEntry[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      IndexName: GSI1,
      KeyConditionExpression: 'gsi1pk = :p',
      ExpressionAttributeValues: { ':p': ACTIVITY_PK },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []).map(toActivity);
}

// ---------------------------------------------------------------------------
// Paramétrage : éléments recopiés du référentiel (prestataires, contacts)
// ---------------------------------------------------------------------------

/** Éléments d'un type, tous projets confondus. */
export async function listItemsAllProjects<K extends ProjectItemKind>(kind: K): Promise<{ projectId: string; item: ProjectItem<K> }[]> {
  const projects = await listProjects();
  const out: { projectId: string; item: ProjectItem<K> }[] = [];
  for (const p of projects) for (const item of await listItems(p.id, kind)) out.push({ projectId: p.id, item: item as ProjectItem<K> });
  return out;
}

/**
 * Recopie des champs du paramétrage dans des éléments de projets (renommage d'un prestataire, contact modifié…),
 * sans historique, puis recalcule les indicateurs des projets concernés.
 */
export async function syncItems(kind: ProjectItemKind, updates: { projectId: string; itemId: string; fields: Record<string, unknown> }[], user: string): Promise<void> {
  for (const u of updates) await setItemFields(u.projectId, kind, u.itemId, u.fields);
  for (const projectId of new Set(updates.map((u) => u.projectId))) await refreshStats(projectId, user);
}
