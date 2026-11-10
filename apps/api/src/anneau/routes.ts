/**
 * L'Anneau unique : un seul porteur pour tout le hub.
 *
 *  pk      sk     contenu
 *  ANNEAU  ETAT   porteur, depuis, nombre de passages
 */
import { Hono } from 'hono';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AnneauState, AnneauTaken } from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, isConditionFailed } from '../db/client.js';
import { nowIso } from '../lib/util.js';

const KEY = { pk: 'ANNEAU', sk: 'ETAT' };

async function state(): Promise<AnneauState> {
  const { Item } = await ddb().send(new GetCommand({ TableName: config.tableName, Key: KEY }));
  return { holder: Item?.holder ?? null, since: Item?.since ?? null, passes: Item?.passes ?? 0 };
}

/** Routes de l'Anneau (montées sous /api/anneau). */
export function anneauRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await state()));

  /** L'utilisateur connecté prend l'Anneau, à son ancien porteur s'il y en a un (sans effet s'il le porte déjà). */
  r.post('/prendre', async (c) => {
    const current = userName(c);
    let previous: string | null = current;
    try {
      const { Attributes } = await ddb().send(
        new UpdateCommand({
          TableName: config.tableName,
          Key: KEY,
          UpdateExpression: 'SET holder = :e, since = :t ADD passes :one',
          ConditionExpression: 'attribute_not_exists(holder) OR holder <> :e',
          ExpressionAttributeValues: { ':e': current, ':t': nowIso(), ':one': 1 },
          ReturnValues: 'ALL_OLD',
        }),
      );
      previous = (Attributes?.holder as string | undefined) ?? null;
    } catch (e) {
      if (!isConditionFailed(e)) throw e;
    }
    const res: AnneauTaken = { ...(await state()), previous };
    return c.json(res);
  });

  return r;
}
