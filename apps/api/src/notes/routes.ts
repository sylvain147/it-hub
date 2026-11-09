/**
 * Notes en vrac : le bloc-notes personnel de chaque utilisateur, rattaché ou non à un projet.
 *
 *  pk              sk         contenu
 *  NOTE#<e-mail>   N#<id>     note (titre, texte Markdown, projet, épinglée)
 *
 * Une partition par titulaire : chacun ne lit que la sienne ; les administrateurs (`manageAllNotes`) lisent et
 * complètent celles de tout le monde.
 */
import { Hono, type Context } from 'hono';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { byPinnedThenRecent, personalNoteInputSchema, type PersonalNote } from '@samm/shared';
import { requirePermission, userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { parseBody } from '../lib/http.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';
import * as pr from '../projects/repo.js';
import * as users from '../users/repo.js';

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

/**
 * Titulaire visé par la requête : soi-même par défaut ; quelqu'un d'autre (ou « all » en lecture) seulement avec
 * le droit `manageAllNotes`.
 */
function ownerParam(c: Context, value: string | undefined, what: string): string {
  const current = userName(c);
  const owner = (value || current).trim().toLowerCase();
  if (owner !== current) requirePermission(c, 'manageAllNotes', what);
  return owner;
}

/** Notes d'un titulaire, ou de tout le monde (« all »). */
async function notesOf(owner: string): Promise<PersonalNote[]> {
  if (owner !== 'all') return listNotes(owner);
  const all = (await Promise.all((await users.listUsers()).map((u) => listNotes(u.email)))).flat();
  return all.sort(byPinnedThenRecent);
}

async function rawJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  } catch {
    /* corps invalide */
  }
  throw new HttpError(400, 'Corps de requête JSON invalide');
}

/**
 * Routes des notes (montées sous /api/notes). Par défaut celles de l'utilisateur connecté ; `?user=` (ou `ownerId`
 * à la création) désigne un autre titulaire, réservé aux administrateurs.
 */
export function noteRoutes() {
  const r = new Hono();

  /** `?user=` : e-mail ou « all » (administrateurs) ; `?projet=` : seulement les notes rattachées à ce projet. */
  r.get('/', async (c) => {
    const projectId = c.req.query('projet');
    const notes = await notesOf(ownerParam(c, c.req.query('user'), 'voir les notes des autres'));
    return c.json(projectId ? notes.filter((n) => n.projectId === projectId) : notes);
  });

  r.post('/', async (c) => {
    const current = userName(c);
    const raw = await rawJson(c);
    const owner = ownerParam(c, typeof raw.ownerId === 'string' ? raw.ownerId : '', 'ajouter une note à quelqu’un d’autre');
    if (owner === 'all') throw new HttpError(400, 'Choisissez à qui ajouter la note.');
    if (owner !== current) {
      const u = (await users.listUsers()).find((x) => x.email === owner);
      if (!u) throw new HttpError(400, 'Utilisateur inconnu : choisissez un utilisateur du hub.');
      if (!u.active) throw new HttpError(400, `${u.name} est désactivé : choisissez quelqu’un d’autre.`);
    }
    const b = parseBody(personalNoteInputSchema, raw);
    await pr.assertProjectRef(b.projectId);
    const now = nowIso();
    return c.json(await putNote({ ...b, id: newId(), ownerId: owner, createdAt: now, createdBy: current, updatedAt: now, updatedBy: current }), 201);
  });

  /** `?owner=` : titulaire de la note, si ce n'est pas soi (administrateurs). */
  r.patch('/:id', async (c) => {
    const current = userName(c);
    const owner = ownerParam(c, c.req.query('owner'), 'modifier les notes des autres');
    const before = await getNote(owner, c.req.param('id'));
    const raw = await rawJson(c);
    const merged = parseBody(personalNoteInputSchema, { title: before.title, content: before.content, projectId: before.projectId, pinned: before.pinned, ...raw });
    if (merged.projectId !== before.projectId) await pr.assertProjectRef(merged.projectId);
    return c.json(await putNote({ ...before, ...merged, updatedAt: nowIso(), updatedBy: current }));
  });

  r.delete('/:id', async (c) => {
    const owner = ownerParam(c, c.req.query('owner'), 'supprimer les notes des autres');
    const n = await getNote(owner, c.req.param('id'));
    await ddb().send(new DeleteCommand({ TableName: config.tableName, Key: key(owner, n.id) }));
    return c.body(null, 204);
  });

  return r;
}
