/**
 * Notes en vrac : le bloc-notes personnel de chaque utilisateur, rattaché ou non à un projet.
 *
 *  pk              sk         contenu
 *  NOTE#<e-mail>   N#<id>     note (titre, texte Markdown, projet, épinglée)
 *
 * Une partition par auteur : chacun ne lit que la sienne, personne d'autre (pas même un administrateur) ne la voit.
 */
import { Hono } from 'hono';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { byPinnedThenRecent, personalNoteInputSchema, type PersonalNote } from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { body, parseBody } from '../lib/http.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';
import * as pr from '../projects/repo.js';

const key = (ownerId: string, id: string) => ({ pk: `NOTE#${ownerId}`, sk: `N#${id}` });

type Item = PersonalNote & { pk: string; sk: string };
const strip = ({ pk: _pk, sk: _sk, ...n }: Item): PersonalNote => n;

export async function listNotes(ownerId: string): Promise<PersonalNote[]> {
  const items = await queryAll<Item>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
    ExpressionAttributeValues: { ':p': `NOTE#${ownerId}`, ':s': 'N#' },
  });
  return items.map(strip).sort(byPinnedThenRecent);
}

async function getNote(ownerId: string, id: string): Promise<PersonalNote> {
  const res = await ddb().send(new GetCommand({ TableName: config.tableName, Key: key(ownerId, id) }));
  if (!res.Item) throw notFound('Note');
  return strip(res.Item as Item);
}

export async function putNote(n: PersonalNote): Promise<PersonalNote> {
  await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...key(n.ownerId, n.id), ...n } }));
  return n;
}

/** Routes des notes (montées sous /api/notes). Toujours celles de l'utilisateur connecté. */
export function noteRoutes() {
  const r = new Hono();

  /** `?projet=` : seulement les notes rattachées à ce projet. */
  r.get('/', async (c) => {
    const projectId = c.req.query('projet');
    const notes = await listNotes(userName(c));
    return c.json(projectId ? notes.filter((n) => n.projectId === projectId) : notes);
  });

  r.post('/', async (c) => {
    const current = userName(c);
    const b = await body(c, personalNoteInputSchema);
    await pr.assertProjectRef(b.projectId);
    const now = nowIso();
    return c.json(await putNote({ ...b, id: newId(), ownerId: current, createdAt: now, createdBy: current, updatedAt: now, updatedBy: current }), 201);
  });

  r.patch('/:id', async (c) => {
    const current = userName(c);
    const before = await getNote(current, c.req.param('id'));
    let raw: Record<string, unknown>;
    try {
      raw = (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Corps de requête JSON invalide');
    }
    const merged = parseBody(personalNoteInputSchema, { title: before.title, content: before.content, projectId: before.projectId, pinned: before.pinned, ...raw });
    if (merged.projectId !== before.projectId) await pr.assertProjectRef(merged.projectId);
    return c.json(await putNote({ ...before, ...merged, updatedAt: nowIso(), updatedBy: current }));
  });

  r.delete('/:id', async (c) => {
    const current = userName(c);
    const n = await getNote(current, c.req.param('id'));
    await ddb().send(new DeleteCommand({ TableName: config.tableName, Key: key(current, n.id) }));
    return c.body(null, 204);
  });

  return r;
}
