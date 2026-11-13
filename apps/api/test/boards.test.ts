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

describe('tableaux de tickets', () => {
  let projectId = '';
  let support = '';

  it('le tableau principal existe toujours ; seul un administrateur crée un tableau', async () => {
    await env.call('PUT', '/settings/lists', { ...(await env.call('GET', '/settings', undefined, ADMIN)).json.lists, cardRules: [{ kind: 'retard', color: 'rouge' }] }, ADMIN);
    const list = (await env.call('GET', '/boards', undefined, MEMBRE)).json;
    // Avant toute modification, il garde les règles de l'ancien paramétrage.
    expect(list).toEqual([expect.objectContaining({ id: 'principal', name: 'Tableau principal', cardRules: [expect.objectContaining({ kind: 'retard', color: 'rouge' })] })]);
    expect((await env.call('POST', '/boards', { name: 'Support' }, MEMBRE)).status).toBe(403);
    const res = await env.call('POST', '/boards', { name: 'Support' }, ADMIN);
    expect(res.status).toBe(201);
    support = res.json.id;
    expect((await env.call('POST', '/boards', { name: 'support' }, ADMIN)).status).toBe(409);
    expect((await env.call('GET', '/boards', undefined, MEMBRE)).json.map((b: { name: string }) => b.name)).toEqual(['Tableau principal', 'Support']);
  });

  it('un ticket va dans le tableau par défaut de qui le crée, sauf tableau précisé', async () => {
    projectId = (await env.call('POST', '/projects', { name: 'Portail' }, ADMIN)).json.id;
    expect((await env.call('PUT', '/me/preferences', { defaultBoardId: 'inconnu' }, MEMBRE)).status).toBe(400);
    const me = await env.call('PUT', '/me/preferences', { defaultBoardId: support }, MEMBRE);
    expect(me.json.defaultBoardId).toBe(support);
    const a = (await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Ticket de Chloé' }, MEMBRE)).json;
    const b = (await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Ticket d’Alice' }, ADMIN)).json;
    const c = (await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Créé depuis le tableau principal', boardId: 'principal' }, MEMBRE)).json;
    expect([a.boardId, b.boardId, c.boardId]).toEqual([support, 'principal', 'principal']);
    expect((await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'X', boardId: 'inconnu' }, MEMBRE)).status).toBe(400);
    // Hors projet aussi.
    expect((await env.call('POST', '/projects/hors-projet/items/tasks', { title: 'Hors projet' }, MEMBRE)).json.boardId).toBe(support);
  });

  it('chaque tableau a ses sprints, son backlog et son sprint en cours', async () => {
    const s1 = (await env.call('POST', '/sprints', { boardId: support }, ADMIN)).json;
    expect(s1).toMatchObject({ name: 'Sprint 1', boardId: support, state: 'future' });
    const p1 = (await env.call('POST', '/sprints', {}, ADMIN)).json;
    expect(p1).toMatchObject({ name: 'Sprint 1', boardId: 'principal' });
    const ofSupport = (await env.call('GET', `/sprints?tableau=${support}`, undefined, MEMBRE)).json;
    expect(ofSupport.boardId).toBe(support);
    expect(ofSupport.sprints.map((s: { id: number }) => s.id)).toEqual([s1.id]);
    expect(ofSupport.tickets.map((t: { title: string }) => t.title).sort()).toEqual(['Hors projet', 'Ticket de Chloé']);
    const principal = (await env.call('GET', '/sprints', undefined, MEMBRE)).json;
    expect(principal.sprints.map((s: { id: number }) => s.id)).toEqual([p1.id]);
    expect(principal.tickets.map((t: { title: string }) => t.title).sort()).toEqual(['Créé depuis le tableau principal', 'Ticket d’Alice']);
    expect((await env.call('GET', '/sprints?tableau=inconnu', undefined, MEMBRE)).status).toBe(400);

    // Un sprint en cours par tableau.
    expect((await env.call('POST', `/sprints/${p1.id}/start`, undefined, ADMIN)).status).toBe(200);
    expect((await env.call('POST', `/sprints/${s1.id}/start`, undefined, ADMIN)).status).toBe(200);
    const s2 = (await env.call('POST', '/sprints', { boardId: support }, ADMIN)).json;
    expect(s2.name).toBe('Sprint 2');
    expect((await env.call('POST', `/sprints/${s2.id}/start`, undefined, ADMIN)).status).toBe(409);
    // À la clôture, les tickets non terminés ne partent que dans un sprint du même tableau.
    expect((await env.call('POST', `/sprints/${p1.id}/close`, { moveTo: s2.id }, ADMIN)).status).toBe(400);
  });

  it('planifié dans un sprint, un ticket prend son tableau ; changé de tableau, il quitte le sprint', async () => {
    const ofSupport = (await env.call('GET', `/sprints?tableau=${support}`, undefined, MEMBRE)).json;
    const s1 = ofSupport.sprints.find((s: { state: string }) => s.state === 'active');
    const alice = (await env.call('GET', '/sprints', undefined, MEMBRE)).json.tickets.find((t: { title: string }) => t.title === 'Ticket d’Alice');
    const planned = (await env.call('PATCH', `/projects/${projectId}/items/tasks/${alice.id}`, { sprintId: s1.id }, MEMBRE)).json;
    expect(planned).toMatchObject({ sprintId: s1.id, boardId: support });
    const moved = (await env.call('PATCH', `/projects/${projectId}/items/tasks/${alice.id}`, { boardId: 'principal' }, MEMBRE)).json;
    expect(moved).toMatchObject({ sprintId: null, boardId: 'principal' });
    // Un ticket créé directement dans un sprint prend son tableau, quel que soit le tableau par défaut.
    const direct = (await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Dans le sprint', sprintId: s1.id }, ADMIN)).json;
    expect(direct.boardId).toBe(support);
  });

  it('chaque tableau a ses règles d’affichage, réglées par toute l’équipe', async () => {
    const r = await env.call('PUT', `/boards/${support}/regles`, { cardRules: [{ kind: 'type', value: 'Dev', color: 'violet' }] }, MEMBRE);
    expect(r.status).toBe(200);
    expect(r.json.cardRules).toEqual([{ kind: 'type', value: 'Dev', days: 0, color: 'violet' }]);
    const boards = (await env.call('GET', '/boards', undefined, MEMBRE)).json;
    expect(boards.find((b: { id: string }) => b.id === 'principal').cardRules).toEqual([expect.objectContaining({ kind: 'retard' })]);
    expect((await env.call('PUT', `/boards/${support}`, { name: 'Support N2' }, MEMBRE)).status).toBe(403);
    expect((await env.call('PUT', `/boards/${support}`, { name: 'Support N2' }, ADMIN)).json.name).toBe('Support N2');
  });

  it('seul un tableau vide se supprime, jamais le principal', async () => {
    expect((await env.call('DELETE', '/boards/principal', undefined, ADMIN)).status).toBe(400);
    const full = await env.call('DELETE', `/boards/${support}`, undefined, ADMIN);
    expect(full.status).toBe(409);
    expect(full.json.error).toMatch(/contient encore .*ticket/);
    const vide = (await env.call('POST', '/boards', { name: 'Projets web' }, ADMIN)).json;
    expect((await env.call('DELETE', `/boards/${vide.id}`, undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('DELETE', `/boards/${vide.id}`, undefined, ADMIN)).status).toBe(204);
  });
});
