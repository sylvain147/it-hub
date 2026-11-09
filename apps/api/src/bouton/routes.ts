/**
 * Bouton rouge « NE PAS CLIQUER » : compteur de clics par utilisateur.
 *
 *  pk      sk           contenu
 *  BOUTON  C#<e-mail>   nombre de clics, dernier clic
 */
import { Hono } from 'hono';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { BoutonRougeScore, BoutonRougeScores } from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { nowIso } from '../lib/util.js';

const PK = 'BOUTON';

async function scores(current: string): Promise<BoutonRougeScores> {
  const items = await queryAll<BoutonRougeScore & { pk: string; sk: string }>({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': PK } });
  const ranking = items.map(({ email, count, lastAt }) => ({ email, count, lastAt })).sort((a, b) => b.count - a.count || a.lastAt.localeCompare(b.lastAt));
  return { mine: ranking.find((s) => s.email === current)?.count ?? 0, ranking };
}

/** Routes du bouton rouge (montées sous /api/bouton-rouge). */
export function boutonRougeRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await scores(userName(c))));

  /** Un clic de plus pour l'utilisateur connecté (incrément atomique). */
  r.post('/clic', async (c) => {
    const current = userName(c);
    await ddb().send(
      new UpdateCommand({
        TableName: config.tableName,
        Key: { pk: PK, sk: `C#${current}` },
        UpdateExpression: 'ADD #n :one SET email = :e, lastAt = :t',
        ExpressionAttributeNames: { '#n': 'count' },
        ExpressionAttributeValues: { ':one': 1, ':e': current, ':t': nowIso() },
      }),
    );
    return c.json(await scores(current));
  });

  return r;
}
