import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';

beforeAll(async () => {
  env = await setupTestEnv();
  await env.call('GET', '/me', undefined, ADMIN);
  await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand', role: 'membre' }, ADMIN);
});
afterAll(async () => env.close());

describe('patch management : tests après patch', () => {
  let ihm = '';
  let proxy = '';
  let session = '';

  it('reprend l’ancien classeur une seule fois, au départ', async () => {
    const res = await env.call(
      'POST',
      '/patch/import',
      {
        tests: [
          { who: 'Équipe', what: 'Application', description: 'Se connecter', urlProd: 'https://app.exemple.fr' },
          { who: 'Prestataire', what: 'Proxy', description: 'Ouvrir la page', expected: 'Affiche une page blanche' },
        ],
        sessions: [{ env: 'PROD', date: '2026-10-16', note: '', results: [{ test: 0, status: 'ok', comment: '' }, { test: 1, status: 'ko', comment: 'Erreur 502' }] }],
      },
      MEMBRE,
    );
    expect(res.status).toBe(201);
    expect(res.json.tests.map((t: { what: string; position: number }) => [t.what, t.position])).toEqual([['Application', 1], ['Proxy', 2]]);
    [ihm, proxy] = res.json.tests.map((t: { id: string }) => t.id);
    expect(res.json.sessions[0].results[proxy]).toMatchObject({ status: 'ko', comment: 'Erreur 502', by: MEMBRE });
    expect((await env.call('POST', '/patch/import', { tests: [{ what: 'X' }], sessions: [] }, ADMIN)).status).toBe(409);
  });

  it('les lignes se configurent : ajout, modification, ordre', async () => {
    expect((await env.call('POST', '/patch/tests', { who: 'Équipe' }, MEMBRE)).status).toBe(400);
    const bo = (await env.call('POST', '/patch/tests', { who: 'Équipe', what: 'Rapports', description: 'Ouvrir le rapport de test' }, MEMBRE)).json;
    expect(bo.position).toBe(3);
    const upd = await env.call('PATCH', `/patch/tests/${bo.id}`, { expected: 'Le rapport affiche la commande du jour' }, ADMIN);
    expect(upd.json).toMatchObject({ what: 'Rapports', expected: 'Le rapport affiche la commande du jour', updatedBy: ADMIN });
    const o = (await env.call('PUT', '/patch/tests/ordre', { ids: [bo.id, ihm, proxy] }, MEMBRE)).json;
    expect(o.tests.map((t: { what: string }) => t.what)).toEqual(['Rapports', 'Application', 'Proxy']);
    // Jamais renseigné : supprimé ; déjà renseigné : à retirer, pour garder l'historique.
    expect((await env.call('DELETE', `/patch/tests/${proxy}`, undefined, MEMBRE)).status).toBe(409);
    expect((await env.call('PATCH', `/patch/tests/${proxy}`, { archived: true }, MEMBRE)).json.archived).toBe(true);
    const tmp = (await env.call('POST', '/patch/tests', { what: 'Temporaire' }, MEMBRE)).json;
    expect((await env.call('DELETE', `/patch/tests/${tmp.id}`, undefined, MEMBRE)).status).toBe(204);
  });

  it('une session reçoit le résultat de chaque test, renseigné par plusieurs personnes', async () => {
    expect((await env.call('POST', '/patch/sessions', { env: 'PRA', date: '2026-11-13' }, MEMBRE)).status).toBe(400);
    const s = await env.call('POST', '/patch/sessions', { env: 'TEST', date: '2026-11-13', note: '09:00' }, MEMBRE);
    expect(s.status).toBe(201);
    session = s.json.id;
    await env.call('PUT', `/patch/sessions/${session}/resultats/${ihm}`, { status: 'ok', comment: '' }, MEMBRE);
    const r = await env.call('PUT', `/patch/sessions/${session}/resultats/${proxy}`, { status: 'ko', comment: 'Page en erreur' }, ADMIN);
    expect(r.json.results[ihm]).toMatchObject({ status: 'ok', by: MEMBRE });
    expect(r.json.results[proxy]).toMatchObject({ status: 'ko', comment: 'Page en erreur', by: ADMIN });
    expect((await env.call('PUT', `/patch/sessions/${session}/resultats/inconnu`, { status: 'ok' }, ADMIN)).status).toBe(404);
    // Sessions de la plus récente à la plus ancienne.
    const all = (await env.call('GET', '/patch', undefined, MEMBRE)).json;
    expect(all.sessions.map((x: { env: string; date: string }) => `${x.env} ${x.date}`)).toEqual(['TEST 2026-11-13', 'PROD 2026-10-16']);
    expect((await env.call('PUT', `/patch/sessions/${session}`, { env: 'TEST', date: '2026-11-14', note: '' }, MEMBRE)).json.date).toBe('2026-11-14');
    expect((await env.call('DELETE', `/patch/sessions/${session}`, undefined, MEMBRE)).status).toBe(204);
  });
});
