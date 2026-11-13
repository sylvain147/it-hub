/**
 * Tableaux de tickets (`packages/shared/src/sprints/boards.ts`).
 *
 *  pk      sk        contenu
 *  BOARD   B#<id>    nom, règles d'affichage des cartes
 *
 * Le tableau principal n'est enregistré qu'à sa première modification : avant, ses règles sont celles de l'ancien
 * paramétrage (`cardRules` de `REF#LISTS`). Quelques tableaux au plus : la partition se lit en entier.
 */
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { boardOf, byBoardOrder, DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME, type Board } from '@samm/shared';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { HttpError, nowIso } from '../lib/util.js';
import { getLists } from '../settings/repo.js';
import * as users from '../users/repo.js';
import { getSprintItem } from './repo.js';

const PK = 'BOARD';
const key = (id: string) => ({ pk: PK, sk: `B#${id}` });

type Item = Board & { pk: string; sk: string };
const strip = ({ pk: _pk, sk: _sk, ...b }: Item): Board => b;

/** Tableau principal tant qu'il n'a jamais été modifié. */
async function defaultBoard(): Promise<Board> {
  const at = '2000-01-01T00:00:00.000Z';
  return { id: DEFAULT_BOARD_ID, name: DEFAULT_BOARD_NAME, cardRules: (await getLists()).cardRules, createdAt: at, createdBy: '', updatedAt: at, updatedBy: '' };
}

/** Tous les tableaux, le principal d'abord. */
export async function listBoards(): Promise<Board[]> {
  const items = (await queryAll<Item>({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': PK } })).map(strip);
  if (!items.some((b) => b.id === DEFAULT_BOARD_ID)) items.push(await defaultBoard());
  return items.sort(byBoardOrder);
}

export async function getBoard(id: string): Promise<Board | null> {
  const res = await ddb().send(new GetCommand({ TableName: config.tableName, Key: key(id) }));
  if (res.Item) return strip(res.Item as Item);
  return id === DEFAULT_BOARD_ID ? defaultBoard() : null;
}

export async function requireBoard(id: string): Promise<Board> {
  const b = await getBoard(id);
  if (!b) throw new HttpError(400, 'Ce tableau n’existe pas (ou plus).');
  return b;
}

export async function putBoard(b: Board): Promise<Board> {
  await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...key(b.id), ...b } }));
  return b;
}

export async function deleteBoard(id: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: config.tableName, Key: key(id) }));
}

export function newBoard(name: string, user: string, id: string): Board {
  const now = nowIso();
  return { id, name, cardRules: [], createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
}

/** Tableau par défaut d'un utilisateur (s'il existe encore), sinon le tableau principal. */
export async function defaultBoardOf(email: string): Promise<string> {
  const id = (await users.listUsers(true)).find((u) => u.email === email)?.defaultBoardId;
  return id && (await getBoard(id)) ? id : DEFAULT_BOARD_ID;
}

/**
 * Tableau et sprint d'un ticket gardés cohérents : planifié dans un sprint, il prend le tableau de ce sprint ; changé
 * de tableau, il quitte un sprint de l'ancien tableau (retour au backlog du nouveau) ; créé sans tableau, il va dans le
 * tableau par défaut de qui le crée.
 */
export async function placeTicket(data: Record<string, unknown>, before: Record<string, unknown> | null, user: string): Promise<Record<string, unknown>> {
  const sprintId = typeof data.sprintId === 'number' ? data.sprintId : null;
  const sprintChanged = !before || sprintId !== ((before.sprintId as number | null | undefined) ?? null);
  const sprint = sprintId !== null ? await getSprintItem(sprintId) : null;
  if (sprint && sprintChanged) return { ...data, boardId: boardOf(sprint) };
  let boardId = typeof data.boardId === 'string' ? data.boardId : '';
  if (!boardId) boardId = before ? boardOf(before) : await defaultBoardOf(user);
  else if (!before || boardId !== boardOf(before)) await requireBoard(boardId);
  if (sprint && boardOf(sprint) !== boardId) return { ...data, boardId, sprintId: null };
  return { ...data, boardId };
}
