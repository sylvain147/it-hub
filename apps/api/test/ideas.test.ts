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

describe('idées d’amélioration', () => {
  let id = '';
  let projectId = '';

  it('crée, modifie et soutient une idée', async () => {
    expect((await env.call('POST', '/idees', { title: ' ' })).status).toBe(400);
    expect((await env.call('POST', '/idees', { title: 'X', projectId: 'inconnu' })).status).toBe(400);
    const res = await env.call('POST', '/idees', { title: 'Export des commandes en Excel', priority: 'haute' }, MEMBRE);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ domain: 'ERP', status: 'nouvelle', votes: [], ticket: null, createdBy: MEMBRE });
    id = res.json.id;
    const upd = await env.call('PATCH', `/idees/${id}`, { status: 'retenue' }, ADMIN);
    expect(upd.json).toMatchObject({ status: 'retenue', priority: 'haute', title: 'Export des commandes en Excel', updatedBy: ADMIN });
    await env.call('PUT', `/idees/${id}/vote`, { vote: true }, ADMIN);
    await env.call('PUT', `/idees/${id}/vote`, { vote: true }, ADMIN);
    const v = await env.call('PUT', `/idees/${id}/vote`, { vote: true }, MEMBRE);
    expect(v.json.votes).toEqual([ADMIN, MEMBRE]);
    expect((await env.call('PUT', `/idees/${id}/vote`, { vote: false }, MEMBRE)).json.votes).toEqual([ADMIN]);
  });

  it('ajoute d’autres idées, dans d’autres domaines', async () => {
    await env.call('POST', '/idees', { title: 'Raccourci vers la fiche client', priority: 'basse' });
    await env.call('POST', '/idees', { title: 'Export des commandes en Excel', domain: 'Intranet' });
    expect((await env.call('GET', '/idees')).json).toHaveLength(3);
  });

  it('crée un ticket à partir d’une idée, une seule fois', async () => {
    projectId = (await env.call('POST', '/projects', { name: 'Évolutions ERP' })).json.id;
    await env.call('PATCH', `/idees/${id}`, { projectId });
    const res = await env.call('POST', `/idees/${id}/ticket`, {}, MEMBRE);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ status: 'en_cours', projectId, ticket: { projectId } });
    const { json: p } = await env.call('GET', `/projects/${projectId}`);
    expect(p.items.tasks[0]).toMatchObject({ title: 'Export des commandes en Excel', priority: 'haute', sprintId: null, assigneeId: MEMBRE, number: res.json.ticket.number });
    expect((await env.call('POST', `/idees/${id}/ticket`, {})).status).toBe(409);
    // Hors projet.
    const other = (await env.call('GET', '/idees')).json.find((i: any) => i.title === 'Raccourci vers la fiche client');
    const hp = await env.call('POST', `/idees/${other.id}/ticket`, { projectId: 'hors-projet' });
    expect(hp.json).toMatchObject({ projectId: '', ticket: { projectId: 'hors-projet' } });
  });

  it('détache les idées du projet supprimé, puis supprime une idée', async () => {
    expect((await env.call('DELETE', `/projects/${projectId}`)).status).toBe(204);
    const idea = (await env.call('GET', '/idees')).json.find((i: any) => i.id === id);
    expect(idea.projectId).toBe('');
    expect((await env.call('DELETE', `/idees/${id}`)).status).toBe(204);
    expect((await env.call('PATCH', `/idees/${id}`, { status: 'ecartee' })).status).toBe(404);
  });
});
