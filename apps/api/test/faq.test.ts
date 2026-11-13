import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';
const AUTRE = 'paul.bernard@exemple.fr';

beforeAll(async () => {
  env = await setupTestEnv();
  await env.call('GET', '/me', undefined, ADMIN);
  await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand', role: 'membre' }, ADMIN);
  await env.call('POST', '/users', { email: AUTRE, name: 'Paul Bernard', role: 'membre' }, ADMIN);
});
afterAll(async () => env.close());

describe('FAQ', () => {
  let id = '';

  it('chacun ajoute une entrée, même une question sans réponse', async () => {
    expect((await env.call('POST', '/faq', { question: '  ' }, MEMBRE)).status).toBe(400);
    const res = await env.call('POST', '/faq', { question: 'Comment réinitialiser son mot de passe ERP ?', category: ' ERP ' }, MEMBRE);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ question: 'Comment réinitialiser son mot de passe ERP ?', answer: '', category: 'ERP', createdBy: MEMBRE });
    id = res.json.id;
    await env.call('POST', '/faq', { question: 'Où trouver les accès VPN ?', answer: 'Dans le **portail** IT.' }, AUTRE);
    const list = (await env.call('GET', '/faq', undefined, ADMIN)).json;
    expect(list.map((f: { question: string }) => f.question).sort()).toEqual(['Comment réinitialiser son mot de passe ERP ?', 'Où trouver les accès VPN ?']);
  });

  it('chacun complète une réponse, sans effacer les autres champs', async () => {
    const upd = await env.call('PATCH', `/faq/${id}`, { answer: 'Depuis l’écran de connexion : « Mot de passe oublié ».' }, AUTRE);
    expect(upd.status).toBe(200);
    expect(upd.json).toMatchObject({ question: 'Comment réinitialiser son mot de passe ERP ?', category: 'ERP', createdBy: MEMBRE, updatedBy: AUTRE });
    expect(upd.json.answer).toContain('Mot de passe oublié');
    expect((await env.call('PATCH', '/faq/inconnue', { answer: 'x' }, AUTRE)).status).toBe(404);
  });

  it('seul l’auteur, ou un responsable, supprime une entrée', async () => {
    expect((await env.call('DELETE', `/faq/${id}`, undefined, AUTRE)).status).toBe(403);
    expect((await env.call('DELETE', `/faq/${id}`, undefined, MEMBRE)).status).toBe(204);
    const vpn = (await env.call('GET', '/faq', undefined, ADMIN)).json[0];
    expect((await env.call('GET', '/me', undefined, ADMIN)).json.permissions.manageFaq).toBe(true);
    expect((await env.call('DELETE', `/faq/${vpn.id}`, undefined, ADMIN)).status).toBe(204);
    expect((await env.call('GET', '/faq', undefined, MEMBRE)).json).toEqual([]);
  });
});
