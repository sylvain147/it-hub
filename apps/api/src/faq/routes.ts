/**
 * FAQ de l'équipe : questions et réponses partagées.
 *
 *  pk    sk        contenu
 *  FAQ   F#<id>    question, réponse (Markdown), thème
 *
 * Quelques centaines d'entrées au plus : une partition lue en entier.
 */
import { Hono } from 'hono';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { can, faqInputSchema, updateFaqBody, type FaqEntry } from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { body, parseBody } from '../lib/http.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';
import { notify } from '../notifications/teams.js';

const PK = 'FAQ';
const key = (id: string) => ({ pk: PK, sk: `F#${id}` });

type Item = FaqEntry & { pk: string; sk: string };
const strip = ({ pk: _pk, sk: _sk, ...f }: Item): FaqEntry => f;

export async function listFaq(): Promise<FaqEntry[]> {
  const items = await queryAll<Item>({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': PK } });
  return items.map(strip);
}

async function getEntry(id: string): Promise<FaqEntry> {
  const res = await ddb().send(new GetCommand({ TableName: config.tableName, Key: key(id) }));
  if (!res.Item) throw notFound('Entrée de la FAQ');
  return strip(res.Item as Item);
}

async function putEntry(f: FaqEntry) {
  await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...key(f.id), ...f } }));
}

/** Routes de la FAQ (montées sous /api/faq) : chacun ajoute et modifie ; l'auteur ou le droit `manageFaq` supprime. */
export function faqRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await listFaq()));

  r.post('/', async (c) => {
    const b = await body(c, faqInputSchema);
    const user = userName(c);
    const now = nowIso();
    const f: FaqEntry = { ...b, id: newId(), createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
    await putEntry(f);
    await notify('faq_ajoutee', {
      title: `❓ ${f.answer.trim() ? 'Nouvelle entrée dans la FAQ' : 'Nouvelle question dans la FAQ, sans réponse'} : ${f.question}`,
      facts: [
        ...(f.category ? [{ title: 'Thème', value: f.category }] : []),
        { title: 'Ajoutée par', value: c.get('user').name || f.createdBy },
      ],
      path: `/faq?entree=${f.id}`,
    });
    return c.json(f, 201);
  });

  r.patch('/:id', async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Corps de requête JSON invalide');
    const b = parseBody(updateFaqBody, raw);
    // Les valeurs par défaut du schéma ne doivent pas écraser les champs absents de la requête.
    const patch = Object.fromEntries(Object.entries(b).filter(([k]) => k in raw));
    const f: FaqEntry = { ...(await getEntry(c.req.param('id'))), ...patch, updatedAt: nowIso(), updatedBy: userName(c) };
    await putEntry(f);
    return c.json(f);
  });

  r.delete('/:id', async (c) => {
    const f = await getEntry(c.req.param('id'));
    if (f.createdBy !== userName(c) && !can(c.get('user').role, 'manageFaq')) {
      throw new HttpError(403, 'Seul l’auteur de l’entrée (ou un responsable) peut la supprimer ; vous pouvez la modifier.');
    }
    await ddb().send(new DeleteCommand({ TableName: config.tableName, Key: key(f.id) }));
    return c.body(null, 204);
  });

  return r;
}
