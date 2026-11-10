import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';

describe('l’Anneau unique', () => {
  it('passe de main en main, un seul porteur à la fois', async () => {
    await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand' }, ADMIN);
    expect((await env.call('GET', '/anneau', undefined, MEMBRE)).json).toEqual({ holder: null, since: null, passes: 0 });

    // Le premier qui clique prend l'Anneau, libre.
    const first = await env.call('POST', '/anneau/prendre', undefined, ADMIN);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ holder: ADMIN, previous: null, passes: 1 });
    expect(first.json.since).toBeTruthy();

    // Un autre le lui prend.
    const second = await env.call('POST', '/anneau/prendre', undefined, MEMBRE);
    expect(second.json).toMatchObject({ holder: MEMBRE, previous: ADMIN, passes: 2 });

    // Le reprendre quand on le porte déjà ne change rien.
    const again = await env.call('POST', '/anneau/prendre', undefined, MEMBRE);
    expect(again.json).toEqual({ ...second.json, previous: MEMBRE });

    // Tout le monde voit le porteur.
    expect((await env.call('GET', '/anneau', undefined, ADMIN)).json).toMatchObject({ holder: MEMBRE, passes: 2 });
  });
});
