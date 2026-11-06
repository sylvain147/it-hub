/**
 * Retours sur l'application.
 *
 *  pk        sk                       contenu
 *  FEEDBACK  F#<date ISO>#<id>        retour (type, message, page, auteur, statut de traitement)
 *
 * Quelques retours par mois : une partition lue en entière, du plus récent au plus ancien.
 */
import { Hono } from 'hono';
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { feedbackInputSchema, updateFeedbackBody, type Feedback } from '@samm/shared';
import { requirePermission, userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { body } from '../lib/http.js';
import { newId, notFound, nowIso } from '../lib/util.js';

const PK = 'FEEDBACK';
const key = (f: Pick<Feedback, 'createdAt' | 'id'>) => ({ pk: PK, sk: `F#${f.createdAt}#${f.id}` });

type Item = Feedback & { pk: string; sk: string };
const strip = ({ pk: _pk, sk: _sk, ...f }: Item): Feedback => f;

async function listAll(): Promise<Feedback[]> {
  const items = await queryAll<Item>({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': PK }, ScanIndexForward: false });
  return items.map(strip);
}

async function find(id: string): Promise<Feedback> {
  const f = (await listAll()).find((x) => x.id === id);
  if (!f) throw notFound('Retour');
  return f;
}

async function put(f: Feedback) {
  await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...key(f), ...f } }));
}

/** Routes des retours (montées sous /api/feedback). */
export function feedbackRoutes() {
  const r = new Hono();

  /** Tout utilisateur peut envoyer un retour. */
  r.post('/', async (c) => {
    const b = await body(c, feedbackInputSchema);
    const u = c.get('user');
    const f: Feedback = { ...b, id: newId(), status: 'nouveau', createdAt: nowIso(), createdBy: userName(c), authorName: u.name, note: '', treatedAt: null, treatedBy: null };
    await put(f);
    return c.json(f, 201);
  });

  r.get('/', async (c) => {
    requirePermission(c, 'manageFeedback', 'lire les retours');
    return c.json(await listAll());
  });

  r.patch('/:id', async (c) => {
    requirePermission(c, 'manageFeedback', 'traiter les retours');
    const b = await body(c, updateFeedbackBody);
    const before = await find(c.req.param('id'));
    const treated = b.status === 'traite';
    const f: Feedback = { ...before, status: b.status, note: b.note, treatedAt: treated ? (before.treatedAt ?? nowIso()) : null, treatedBy: treated ? (before.treatedBy ?? userName(c)) : null };
    await put(f);
    return c.json(f);
  });

  r.delete('/:id', async (c) => {
    requirePermission(c, 'manageFeedback', 'supprimer les retours');
    const f = await find(c.req.param('id'));
    await ddb().send(new DeleteCommand({ TableName: config.tableName, Key: key(f) }));
    return c.body(null, 204);
  });

  return r;
}
