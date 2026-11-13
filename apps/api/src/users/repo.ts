/**
 * Stockage des utilisateurs et des tâches personnelles.
 *
 *  pk      sk           contenu
 *  USER    U#<e-mail>   utilisateur du hub (nom, rôle, actif, dernière activité)
 *  TODO    T#<id>       tâche de la to-do, rattachée ou non à un projet (responsable : `assigneeId`)
 *
 * L'équipe compte quelques personnes : une partition par entité suffit, lue en entier.
 */
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { themeOrDefault, type HubUser, type PersonalTask } from '@samm/shared';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { notFound, nowIso } from '../lib/util.js';

const T = () => config.tableName;
const USER_PK = 'USER';
const TODO_PK = 'TODO';

export const userKeys = {
  user: (email: string) => ({ pk: USER_PK, sk: `U#${email.toLowerCase()}` }),
  todo: (id: string) => ({ pk: TODO_PK, sk: `T#${id}` }),
};

type UserItem = HubUser & { pk: string; sk: string };
/** Les utilisateurs créés avant la fiche (poste, backup, périmètres) ou le choix du thème n'ont pas ces champs. */
const stripUser = ({ pk: _pk, sk: _sk, ...u }: UserItem): HubUser => ({ ...u, jobTitle: u.jobTitle ?? '', backupId: u.backupId ?? '', perimeters: u.perimeters ?? [], theme: themeOrDefault(u.theme), tools: u.tools ?? null, defaultBoardId: u.defaultBoardId ?? '' });

/** L'annuaire sert à chaque requête (contrôle d'accès) : courte mise en cache dans le processus. */
let cache: { at: number; users: HubUser[] } | null = null;
const CACHE_MS = 10_000;

export function clearUserCache() {
  cache = null;
}

export async function listUsers(fresh = false): Promise<HubUser[]> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.users;
  const items = await queryAll<UserItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
    ExpressionAttributeValues: { ':p': USER_PK, ':s': 'U#' },
  });
  const users = items.map(stripUser).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  cache = { at: Date.now(), users };
  return users;
}

export async function getUser(email: string): Promise<HubUser> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: userKeys.user(email) }));
  if (!res.Item) throw notFound('Utilisateur');
  return stripUser(res.Item as UserItem);
}

/** Crée l'utilisateur s'il n'existe pas encore (renvoie false sinon). */
export async function createUser(u: HubUser): Promise<boolean> {
  try {
    await ddb().send(new PutCommand({ TableName: T(), Item: { ...userKeys.user(u.email), ...u }, ConditionExpression: 'attribute_not_exists(pk)' }));
    clearUserCache();
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/** Préférences personnelles (thème, outils, tableau par défaut) : mise à jour ciblée des seules préférences envoyées, sans toucher au reste de la fiche. */
export async function setUserPreferences(email: string, prefs: Partial<Pick<HubUser, 'theme' | 'tools' | 'defaultBoardId'>>): Promise<void> {
  const entries = Object.entries(prefs).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: userKeys.user(email),
      UpdateExpression: 'SET ' + entries.map(([k]) => `#${k} = :${k}`).join(', '),
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: Object.fromEntries(entries.map(([k]) => [`#${k}`, k])),
      ExpressionAttributeValues: Object.fromEntries(entries.map(([k, v]) => [`:${k}`, v])),
    }),
  );
  clearUserCache();
}

export async function putUser(u: HubUser): Promise<HubUser> {
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...userKeys.user(u.email), ...u } }));
  clearUserCache();
  return u;
}

/** Note la dernière activité, au plus une fois toutes les 10 minutes. */
export async function touchLastSeen(u: HubUser): Promise<void> {
  if (u.lastSeenAt && Date.now() - Date.parse(u.lastSeenAt) < 10 * 60_000) return;
  const now = nowIso();
  u.lastSeenAt = now;
  await ddb().send(new UpdateCommand({ TableName: T(), Key: userKeys.user(u.email), UpdateExpression: 'SET lastSeenAt = :n', ExpressionAttributeValues: { ':n': now } }));
}

// ---------------------------------------------------------------------------
// Tâches personnelles
// ---------------------------------------------------------------------------

type TodoItem = PersonalTask & { pk: string; sk: string };
/**
 * Les tâches enregistrées avant la simplification portent un statut (« fait ») au lieu de `done` ; d'autres pointaient
 * un ticket (`ticketId`), lien abandonné depuis que la to-do est séparée des tickets. Les plus anciennes n'ont pas de
 * sous-tâches.
 */
function stripTodo({ pk: _pk, sk: _sk, ...t }: TodoItem): PersonalTask {
  const { status, priority: _p, ticketId: _t, ...rest } = t as PersonalTask & { status?: string; priority?: string; ticketId?: string };
  return { ...rest, done: typeof t.done === 'boolean' ? t.done : status === 'fait', projectId: t.projectId ?? '', subtasks: t.subtasks ?? [] };
}

export async function listTodos(): Promise<PersonalTask[]> {
  const items = await queryAll<TodoItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
    ExpressionAttributeValues: { ':p': TODO_PK, ':s': 'T#' },
  });
  return items.map(stripTodo);
}

export async function getTodo(id: string): Promise<PersonalTask> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: userKeys.todo(id) }));
  if (!res.Item) throw notFound('Tâche');
  return stripTodo(res.Item as TodoItem);
}

export async function putTodo(t: PersonalTask): Promise<PersonalTask> {
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...userKeys.todo(t.id), ...t } }));
  return t;
}

export async function deleteTodo(id: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: T(), Key: userKeys.todo(id) }));
}
