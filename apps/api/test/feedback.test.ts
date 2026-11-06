import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';

beforeAll(async () => {
  env = await setupTestEnv();
  await env.call('GET', '/me', undefined, ADMIN); // premier utilisateur : administrateur
  await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand', role: 'membre' }, ADMIN);
});
afterAll(async () => env.close());

describe('retours sur l’application', () => {
  let id = '';

  it('tout utilisateur envoie un retour, avec la page d’origine', async () => {
    expect((await env.call('POST', '/feedback', { message: ' ' }, MEMBRE)).status).toBe(400);
    const res = await env.call('POST', '/feedback', { kind: 'bug', message: 'Le bouton Importer ne répond pas', page: '/jira?projet=x', client: 'Firefox · 1280×800' }, MEMBRE);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ kind: 'bug', status: 'nouveau', createdBy: MEMBRE, authorName: 'Chloé Durand', page: '/jira?projet=x', note: '', treatedAt: null });
    id = res.json.id;
    await env.call('POST', '/feedback', { kind: 'idee', message: 'Une date sur les tâches de la todo' }, ADMIN);
  });

  it('seuls les rôles habilités lisent et traitent les retours', async () => {
    expect((await env.call('GET', '/feedback', undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('PATCH', `/feedback/${id}`, { status: 'traite' }, MEMBRE)).status).toBe(403);
    expect((await env.call('DELETE', `/feedback/${id}`, undefined, MEMBRE)).status).toBe(403);
    const list = await env.call('GET', '/feedback', undefined, ADMIN);
    expect(list.json.map((f: any) => f.kind)).toEqual(['idee', 'bug']); // le plus récent d'abord
    expect((await env.call('GET', '/me', undefined, ADMIN)).json.permissions.manageFeedback).toBe(true);
    expect((await env.call('GET', '/me', undefined, MEMBRE)).json.permissions.manageFeedback).toBe(false);
  });

  it('marque un retour comme traité, le rouvre et le supprime', async () => {
    const done = await env.call('PATCH', `/feedback/${id}`, { status: 'traite', note: 'Corrigé' }, ADMIN);
    expect(done.json).toMatchObject({ status: 'traite', note: 'Corrigé', treatedBy: ADMIN });
    expect(done.json.treatedAt).toBeTruthy();
    const reopened = await env.call('PATCH', `/feedback/${id}`, { status: 'nouveau' }, ADMIN);
    expect(reopened.json).toMatchObject({ status: 'nouveau', treatedAt: null, treatedBy: null });
    expect((await env.call('PATCH', '/feedback/inconnu', { status: 'traite' }, ADMIN)).status).toBe(404);
    expect((await env.call('DELETE', `/feedback/${id}`, undefined, ADMIN)).status).toBe(204);
    expect((await env.call('GET', '/feedback', undefined, ADMIN)).json).toHaveLength(1);
  });
});
