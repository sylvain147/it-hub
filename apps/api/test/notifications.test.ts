import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';
const WEBHOOK = 'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=SECRET123456';

/** Faux Teams : garde les messages reçus ; `teamsStatus` simule une panne. */
const sent: any[] = [];
let teamsStatus = 202;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://prod-12.westeurope.logic.azure.com')) return realFetch(input, init);
    sent.push(JSON.parse(String(init?.body)));
    return new Response(teamsStatus < 300 ? '' : 'Flow is disabled', { status: teamsStatus });
  });
  env = await setupTestEnv();
  await env.call('GET', '/me', undefined, ADMIN); // premier utilisateur : administrateur
  await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand', role: 'membre' }, ADMIN);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await env.close();
});

const card = (m: any) => m.attachments[0].content;

describe('notifications Teams', () => {
  it('rien n’est envoyé tant que Teams n’est pas connecté', async () => {
    expect((await env.call('POST', '/idees', { title: 'Avant la connexion' }, MEMBRE)).status).toBe(201);
    expect(sent).toHaveLength(0);
    const s = await env.call('GET', '/notifications/teams', undefined, ADMIN);
    expect(s.json).toMatchObject({ connected: false, webhookHint: '', events: { sprint_demarre: true, sprint_clos: true, idee_ajoutee: true } });
  });

  it('seul le droit manageIntegrations règle la connexion', async () => {
    expect((await env.call('GET', '/notifications/teams', undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('PUT', '/notifications/teams', { webhookUrl: WEBHOOK }, MEMBRE)).status).toBe(403);
    expect((await env.call('POST', '/notifications/teams/test', undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('GET', '/me', undefined, ADMIN)).json.permissions.manageIntegrations).toBe(true);
    expect((await env.call('GET', '/me', undefined, MEMBRE)).json.permissions.manageIntegrations).toBe(false);
  });

  it('n’accepte que des adresses de flux Teams', async () => {
    expect((await env.call('POST', '/notifications/teams/test', undefined, ADMIN)).status).toBe(400);
    for (const bad of ['http://prod-1.westeurope.logic.azure.com/x', 'https://exemple.fr/hook', 'https://logic.azure.com.evil.fr/x', 'pas une adresse']) {
      expect((await env.call('PUT', '/notifications/teams', { webhookUrl: bad }, ADMIN)).status).toBe(400);
    }
  });

  it('connecte un canal sans jamais renvoyer l’adresse, et envoie un message d’essai', async () => {
    const res = await env.call('PUT', '/notifications/teams', { webhookUrl: WEBHOOK }, ADMIN);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ connected: true, updatedBy: ADMIN, lastError: null });
    expect(JSON.stringify(res.json)).not.toContain('SECRET');
    expect(res.json.webhookHint).toBe('prod-12…123456');
    expect((await env.call('POST', '/notifications/teams/test', undefined, ADMIN)).json).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive' }] });
    expect(card(sent[0]).body[0].text).toContain('Hobbit est connecté');
  });

  it('envoie une carte à l’ajout d’une idée, au démarrage et à la clôture d’un sprint', async () => {
    sent.length = 0;
    await env.call('POST', '/idees', { title: 'Export Excel des tickets', domain: 'Intranet' }, MEMBRE);
    expect(sent).toHaveLength(1);
    expect(card(sent[0]).body[0].text).toBe('💡 Nouvelle idée : Export Excel des tickets');
    expect(card(sent[0]).body[1].facts).toEqual([{ title: 'Domaine', value: 'Intranet' }, { title: 'Proposée par', value: 'Chloé Durand' }]);

    const sprint = (await env.call('POST', '/sprints', { name: 'Sprint Teams', goal: 'Livrer la connexion Teams' }, ADMIN)).json;
    expect((await env.call('POST', `/sprints/${sprint.id}/start`, undefined, ADMIN)).status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(card(sent[1]).body.map((b: any) => b.text).filter(Boolean)).toEqual(['🚀 Sprint Teams a démarré', 'Livrer la connexion Teams']);
    expect((await env.call('POST', `/sprints/${sprint.id}/close`, { moveTo: null }, ADMIN)).status).toBe(200);
    expect(card(sent[2]).body[0].text).toBe('🏁 Sprint Teams est clôturé');
  });

  it('respecte les notifications désactivées', async () => {
    sent.length = 0;
    const res = await env.call('PUT', '/notifications/teams', { events: { idee_ajoutee: false } }, ADMIN);
    expect(res.json.events).toEqual({ sprint_demarre: true, sprint_clos: true, idee_ajoutee: false });
    expect(res.json.connected).toBe(true); // l'adresse est gardée
    await env.call('POST', '/idees', { title: 'Sans notification' }, MEMBRE);
    expect(sent).toHaveLength(0);
    await env.call('PUT', '/notifications/teams', { events: { idee_ajoutee: true } }, ADMIN);
  });

  it('une panne de Teams ne bloque pas l’action et reste visible dans le paramétrage', async () => {
    teamsStatus = 404;
    expect((await env.call('POST', '/idees', { title: 'Pendant la panne' }, MEMBRE)).status).toBe(201);
    const s = (await env.call('GET', '/notifications/teams', undefined, ADMIN)).json;
    expect(s.lastError.message).toContain('erreur 404');
    const test = await env.call('POST', '/notifications/teams/test', undefined, ADMIN);
    expect(test.status).toBe(502);
    expect(test.json.error).toContain('Flow is disabled');
    teamsStatus = 401; // flux réservé aux comptes Microsoft
    expect((await env.call('POST', '/notifications/teams/test', undefined, ADMIN)).json.error).toContain('Envoyer des alertes webhook à un canal');
    teamsStatus = 202;
    await env.call('POST', '/idees', { title: 'Après la panne' }, MEMBRE);
    expect((await env.call('GET', '/notifications/teams', undefined, ADMIN)).json.lastError).toBeNull();
  });

  it('se déconnecte', async () => {
    const res = await env.call('PUT', '/notifications/teams', { webhookUrl: '' }, ADMIN);
    expect(res.json.connected).toBe(false);
    sent.length = 0;
    await env.call('POST', '/idees', { title: 'Après la déconnexion' }, MEMBRE);
    expect(sent).toHaveLength(0);
  });
});
