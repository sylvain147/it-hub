/**
 * Stockage du module « Projets ».
 *
 *  pk              sk                       contenu
 *  PROJ#<id>       META                     fiche + indicateurs calculés (+ GSI1 « PROJ » pour la liste)
 *  PROJ#<id>       TASK#<id>                ticket (+ GSI1 « TICKET » : tous les tickets, pour les sprints)
 *  PROJ#hors-projet TASK#<id>               ticket sans projet (`NO_PROJECT_ID` : pas de fiche META)
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
 *
 * Les tickets enregistrés avant les sprints (tâches à cocher, GSI1 « TASK_OPEN » pour les tâches ouvertes) reçoivent
 * un numéro et l'index « TICKET » à leur première lecture (`listTickets`, `getProjectDetail`).
 */
import { randomBytes } from 'node:crypto';
import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  computeStats,
  emptyItems,
  normalizeTaskRecord,
  NO_PROJECT_ID,
  NO_PROJECT_LABEL,
  PROJECT_ITEM_SCHEMAS,
  statusLabel,
  type ActivityEntry,
  type ItemBase,
  type ProjectDetail,
  normalizeChefIds,
  normalizeProjectSections,
  type ProjectFields,
  type ProjectItem,
  type ProjectItemKind,
  type ProjectItems,
  type ProjectStats,
  type ProjectSummary,
  type ListSettings,
  type Task,
  type TicketView,
  MAX_TICKET_HISTORY,
  ticketKey,
} from '@samm/shared';
import { config } from '../config.js';
import { ddb, isConditionFailed, nextCounter, queryAll } from '../db/client.js';
import { GSI1, ttlInDays } from '../db/schema.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';
import { getLists } from '../settings/repo.js';
import { getSprintItem } from '../sprints/repo.js';

const T = () => config.tableName;
const LIST_PK = 'PROJ';
const TICKET_PK = 'TICKET';
/** Index des tâches ouvertes d'avant les sprints. */
const LEGACY_OPEN_TASKS_PK = 'TASK_OPEN';
const TICKET_COUNTER = 'TICKET';
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
  tasks: { one: 'le ticket' },
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
      return typeof it.number === 'number' && it.number ? `${ticketKey({ number: it.number })} ${String(it.title)}` : String(it.title);
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

interface MetaItem extends Omit<ProjectFields, 'sections' | 'chefDeProjetIds'> {
  /** Absent des projets antérieurs aux sections libres. */
  sections?: ProjectFields['sections'];
  /** Absent des projets antérieurs aux chefs multiples, qui ont `chefDeProjetId` (retiré au premier enregistrement). */
  chefDeProjetIds?: string[];
  chefDeProjetId?: string;
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  id: string;
  rev: number;
  stats: ProjectStats;
  /** Absent des projets créés avant le suivi. */
  followers?: string[];
  /** Anciens champs fixes, remplacés par les sections libres (`normalizeProjectSections`) et retirés au premier enregistrement. */
  objectifs?: string;
  horsPerimetre?: string;
  activeJobId: string | null;
  activeJobAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

function toSummary(it: MetaItem, cdcCount = 0): ProjectSummary {
  const { pk: _pk, sk: _sk, gsi1pk: _g, gsi1sk: _s, activeJobAt, objectifs: _o, horsPerimetre: _h, ...rest } = it;
  const stale = it.activeJobAt && (Date.now() - Date.parse(it.activeJobAt)) / 60000 > config.staleJobMinutes;
  const { chefDeProjetId: _c, ...fiche } = rest;
  return { ...fiche, chefDeProjetIds: normalizeChefIds(it), sections: normalizeProjectSections(it), followers: it.followers ?? [], activeJobId: stale || !activeJobAt ? null : it.activeJobId, cdcCount };
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

/** Projet désigné par une tâche de la to-do ou une note (vide : aucun). */
export async function assertProjectRef(projectId: string): Promise<void> {
  if (projectId && !(await getMeta(projectId))) throw new HttpError(400, 'Projet introuvable : il a peut-être été supprimé.');
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
    followers: [],
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
        UpdateExpression: 'SET ' + sets.join(', ') + ' REMOVE objectifs, horsPerimetre, chefDeProjetId',
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
  if (normalizeChefIds(before).join() !== fields.chefDeProjetIds.join() || before.chefDeProjet !== fields.chefDeProjet) {
    changes.push(fields.chefDeProjetIds.length > 1 ? 'les chefs de projet' : 'le chef de projet');
  }
  await logActivity(id, fields.name, user, changes.length ? `a modifié ${changes.join(', ')} du projet` : 'a modifié la fiche du projet');
}

/** Suit (ou ne suit plus) un projet : hors fiche, sans révision ni historique. */
export async function setFollower(id: string, email: string, follow: boolean): Promise<string[]> {
  const before = await getMeta(id);
  if (!before) throw notFound('Projet');
  const rest = (before.followers ?? []).filter((e) => e !== email);
  const followers = follow ? [...rest, email] : rest;
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: projectKeys.meta(id),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET followers = :f',
      ExpressionAttributeValues: { ':f': followers },
    }),
  );
  return followers;
}

/** Recopie les chefs de projet (rattachement d'un ancien projet, renommage d'un utilisateur), sans révision ni historique. */
export async function setChefs(id: string, chefDeProjetIds: string[], chefDeProjet: string): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: projectKeys.meta(id),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET chefDeProjetIds = :ids, chefDeProjet = :name REMOVE chefDeProjetId',
      ExpressionAttributeValues: { ':ids': chefDeProjetIds, ':name': chefDeProjet },
    }),
  );
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
  await numberLegacyTickets(all.filter((it) => it.sk.startsWith(SK_PREFIX.tasks) && typeof it.number !== 'number'));
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
  items.tasks.sort((a, b) => a.number - b.number || a.createdAt.localeCompare(b.createdAt));
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
      const done = data.status === 'termine';
      const doneAt = done ? (before?.done === true && before.doneAt ? (before.doneAt as string) : nowIso()) : '';
      // Historique des statuts et des sprints : revue de sprint.
      const at = String(data.updatedAt);
      const statusChanges = [...((before?.statusChanges as unknown[]) ?? [])];
      if (before && before.status !== data.status) statusChanges.push({ at, from: before.status, to: data.status });
      const sprintChanges = [...((before?.sprintChanges as unknown[]) ?? [])];
      if (before && (before.sprintId ?? null) !== data.sprintId) sprintChanges.push({ at, from: before.sprintId ?? null, to: data.sprintId });
      return {
        number: (data.number as number) || (before?.number as number) || 0,
        done,
        doneAt,
        statusChanges: statusChanges.slice(-MAX_TICKET_HISTORY),
        sprintChanges: sprintChanges.slice(-MAX_TICKET_HISTORY),
        gsi1pk: TICKET_PK,
        gsi1sk: data.id as string,
      };
    }
    case 'jalons':
      if (data.startDate && !data.date) throw new HttpError(400, 'Renseignez la date de fin du jalon.');
      if (data.startDate && data.date && String(data.startDate) > String(data.date)) throw new HttpError(400, 'La date de début du jalon doit précéder sa date de fin.');
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
  const project = await ownerProject(id, kind);
  const data = PROJECT_ITEM_SCHEMAS[kind].parse(input) as Record<string, unknown>;
  const now = nowIso();
  const itemId = opts.itemId ?? newId();
  const extra = kind === 'tasks' ? { ...opts.extra, number: await nextCounter(TICKET_COUNTER) } : opts.extra;
  const base = { ...data, ...extra, id: itemId, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
  const item = { ...projectKeys.item(id, kind, itemId), projectId: id, ...base, ...derived(kind, base, null) };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  if (!opts.silent && project) {
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
  const project = await ownerProject(id, kind);
  const before = await getStored(id, kind, itemId);
  if (!before) throw notFound('Élément');
  if (kind === 'tasks' && !before.number) extra = { ...extra, number: await nextCounter(TICKET_COUNTER) };
  const data = PROJECT_ITEM_SCHEMAS[kind].parse({ ...stripItem<Record<string, unknown>>(before), ...patch }) as Record<string, unknown>;
  const base = { ...data, ...extra, id: itemId, createdAt: before.createdAt, createdBy: before.createdBy, updatedAt: nowIso(), updatedBy: user };
  const merged = { ...base, ...derived(kind, base, { ...before, ...extra }) };
  const item = { ...projectKeys.item(id, kind, itemId), projectId: id, ...merged };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  if (project) {
    await logActivity(id, project.name, user, await activityForUpdate(kind, before, merged, await getLists()));
    await refreshStats(id, user);
  }
  return stripItem(item);
}

async function activityForUpdate(kind: ProjectItemKind, before: Record<string, unknown>, after: Record<string, unknown>, lists: ListSettings): Promise<string> {
  const title = `« ${itemTitle(kind, after)} »`;
  if (kind === 'tasks' && before.status !== after.status) return `a passé le ticket ${title} au statut « ${statusLabel(lists, 'ticket', String(after.status))} »`;
  if (kind === 'tasks' && (before.sprintId ?? null) !== after.sprintId) {
    if (after.sprintId === null) return `a remis le ticket ${title} au backlog`;
    const sprint = await getSprintItem(after.sprintId as number);
    return `a planifié le ticket ${title} dans le sprint « ${sprint?.name ?? after.sprintId} »`;
  }
  if (kind === 'jalons' && !before.done && after.done) return `a marqué le jalon ${title} comme atteint`;
  if (kind === 'jalons' && before.date !== after.date) return `a déplacé le jalon ${title} au ${String(after.date) || '(date à définir)'}`;
  if (kind === 'risks' && before.status !== after.status && after.status === 'clos') return `a clos le risque ${title}`;
  if (kind === 'prestations' && before.status !== after.status) return `a passé la prestation ${title} au statut « ${statusLabel(lists, 'prestation', String(after.status))} »`;
  return `a modifié ${KIND_LABELS[kind].one} ${title}`;
}

export async function deleteItem(id: string, kind: ProjectItemKind, itemId: string, user: string): Promise<void> {
  const project = await ownerProject(id, kind);
  const before = await getStored(id, kind, itemId);
  if (!before) throw notFound('Élément');
  await ddb().send(new DeleteCommand({ TableName: T(), Key: projectKeys.item(id, kind, itemId) }));
  if (project) {
    await logActivity(id, project.name, user, `a supprimé ${KIND_LABELS[kind].one} « ${itemTitle(kind, before)} »`);
    await refreshStats(id, user);
  }
}

/**
 * Projet d'un élément ; null pour un ticket hors projet (`NO_PROJECT_ID`), qui n'a ni fiche, ni historique,
 * ni indicateurs. Seuls les tickets peuvent être hors projet.
 */
async function ownerProject(id: string, kind: ProjectItemKind): Promise<ProjectSummary | null> {
  if (id === NO_PROJECT_ID) {
    if (kind !== 'tasks') throw new HttpError(400, 'Seul un ticket peut être hors projet.');
    return null;
  }
  return requireProject(id);
}

/**
 * Rattache un ticket à un autre projet, ou le sort de tout projet (`NO_PROJECT_ID`) : il garde son identifiant,
 * son numéro, son sprint et son historique.
 */
export async function moveTicket(fromId: string, itemId: string, toId: string, user: string): Promise<void> {
  if (fromId === toId) return;
  const [from, to] = [await ownerProject(fromId, 'tasks'), await ownerProject(toId, 'tasks')];
  const before = await getStored(fromId, 'tasks', itemId);
  if (!before) throw notFound('Ticket');
  const item = { ...before, ...projectKeys.item(toId, 'tasks', itemId), projectId: toId, updatedAt: nowIso(), updatedBy: user };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  await ddb().send(new DeleteCommand({ TableName: T(), Key: projectKeys.item(fromId, 'tasks', itemId) }));
  const title = itemTitle('tasks', before);
  if (from) {
    await logActivity(fromId, from.name, user, `a déplacé le ticket « ${title} » ${to ? `vers le projet « ${to.name} »` : 'hors projet'}`);
    await refreshStats(fromId, user);
  }
  if (to) {
    await logActivity(toId, to.name, user, `a rattaché le ticket « ${title} » au projet`);
    await refreshStats(toId, user);
  }
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

/** Tickets de tous les projets (projet supprimé : ignorés). */
export async function listTickets(): Promise<TicketView[]> {
  const [tickets, legacy, projects] = await Promise.all([
    queryAll<Record<string, unknown>>({ IndexName: GSI1, KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': TICKET_PK } }),
    queryAll<Record<string, unknown>>({ IndexName: GSI1, KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': LEGACY_OPEN_TASKS_PK } }),
    listProjects(),
  ]);
  const all = [...tickets, ...(await numberLegacyTickets(legacy))];
  const names = new Map([...projects.map((p) => [p.id, p.name] as const), [NO_PROJECT_ID, NO_PROJECT_LABEL] as const]);
  return all
    .filter((t) => names.has(String(t.projectId)))
    .map((t) => ({ ...stripItem<Task>(normalizeTaskRecord(t)), projectId: String(t.projectId), projectName: names.get(String(t.projectId))! }));
}

/** Tickets d'avant les sprints : numéro (dans l'ordre de création) et index « TICKET ». Renvoie les enregistrements à jour. */
async function numberLegacyTickets(items: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const last = await nextCounter(TICKET_COUNTER, sorted.length);
  const out: Record<string, unknown>[] = [];
  for (const [i, raw] of sorted.entries()) {
    const it = normalizeTaskRecord(raw);
    const item = { ...it, number: last - sorted.length + 1 + i, gsi1pk: TICKET_PK, gsi1sk: String(it.id) };
    await ddb().send(new PutCommand({ TableName: T(), Item: item }));
    Object.assign(raw, item);
    out.push(item);
  }
  return out;
}

/** Tickets actuellement dans un sprint. */
export async function ticketsOfSprint(sprintId: number): Promise<TicketView[]> {
  return (await listTickets()).filter((t) => t.sprintId === sprintId);
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
