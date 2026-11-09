import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';

describe('bouton rouge « NE PAS CLIQUER »', () => {
  it('compte les clics de chacun et classe l’équipe', async () => {
    expect((await env.call('GET', '/bouton-rouge', undefined, ADMIN)).json).toEqual({ mine: 0, ranking: [] });
    await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand' }, ADMIN);
    expect((await env.call('POST', '/bouton-rouge/clic', undefined, ADMIN)).json.mine).toBe(1);
    await env.call('POST', '/bouton-rouge/clic', undefined, MEMBRE);
    await env.call('POST', '/bouton-rouge/clic', undefined, MEMBRE);
    const last = await env.call('POST', '/bouton-rouge/clic', undefined, MEMBRE);
    expect(last.json.mine).toBe(3);
    expect(last.json.ranking.map((s: any) => [s.email, s.count])).toEqual([
      [MEMBRE, 3],
      [ADMIN, 1],
    ]);
    expect((await env.call('GET', '/bouton-rouge', undefined, ADMIN)).json.mine).toBe(1);
  });
});
