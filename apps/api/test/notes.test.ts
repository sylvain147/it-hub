import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';

describe('notes en vrac et frise des jalons', () => {
  let projectId = '';
  let otherId = '';

  it('crée des notes personnelles, rattachées ou non à un projet', async () => {
    projectId = (await env.call('POST', '/projects', { name: 'Migration ERP', code: 'ERP' }, ADMIN)).json.id;
    await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand' }, ADMIN);

    expect((await env.call('POST', '/notes', { title: '', content: '  ' }, MEMBRE)).status).toBe(400);
    expect((await env.call('POST', '/notes', { content: 'x', projectId: 'inconnu' }, MEMBRE)).status).toBe(400);
    const free = await env.call('POST', '/notes', { content: 'Idée : **automatiser** le relevé TMA' }, MEMBRE);
    expect(free.status).toBe(201);
    expect(free.json).toMatchObject({ ownerId: MEMBRE, projectId: '', pinned: false, title: '' });
    const onProject = await env.call('POST', '/notes', { title: 'Questions pour le comité', content: '- Budget lot 2 ?', projectId }, MEMBRE);
    expect(onProject.json.projectId).toBe(projectId);
    otherId = onProject.json.id;

    // Épinglée : en tête de liste.
    const pinned = await env.call('PATCH', `/notes/${free.json.id}`, { pinned: true }, MEMBRE);
    expect(pinned.json).toMatchObject({ pinned: true, content: 'Idée : **automatiser** le relevé TMA' });
    const mine = (await env.call('GET', '/notes', undefined, MEMBRE)).json;
    expect(mine.map((n: any) => n.id)).toEqual([free.json.id, onProject.json.id]);
    const ofProject = (await env.call('GET', `/notes?projet=${projectId}`, undefined, MEMBRE)).json;
    expect(ofProject.map((n: any) => n.title)).toEqual(['Questions pour le comité']);
  });

  it('garde les notes privées, même pour un administrateur', async () => {
    expect((await env.call('GET', '/notes', undefined, ADMIN)).json).toHaveLength(0);
    expect((await env.call('GET', `/notes?projet=${projectId}`, undefined, ADMIN)).json).toHaveLength(0);
    expect((await env.call('PATCH', `/notes/${otherId}`, { title: 'X' }, ADMIN)).status).toBe(404);
    expect((await env.call('DELETE', `/notes/${otherId}`, undefined, ADMIN)).status).toBe(404);
  });

  it('rassemble les jalons de tous les projets pour la frise', async () => {
    const second = (await env.call('POST', '/projects', { name: 'Portail fournisseurs', startDate: '2026-09-01', targetDate: '2027-03-31' }, ADMIN)).json.id;
    await env.call('POST', `/projects/${projectId}/items/jalons`, { label: 'Recette', date: '2026-12-01' }, ADMIN);
    await env.call('POST', `/projects/${second}/items/jalons`, { label: 'Mise en production', date: '2027-03-15' }, ADMIN);
    await env.call('POST', `/projects/${second}/items/jalons`, { label: 'Devis reçu', date: '2026-10-01', done: true }, ADMIN);
    const { json } = await env.call('GET', '/projects/jalons', undefined, MEMBRE);
    expect(json).toHaveLength(2);
    const erp = json.find((p: any) => p.id === projectId);
    expect(erp).toMatchObject({ name: 'Migration ERP', code: 'ERP', status: 'cadrage' });
    expect(erp.jalons.map((j: any) => j.label)).toEqual(['Recette']);
    const portail = json.find((p: any) => p.id === second);
    expect(portail).toMatchObject({ startDate: '2026-09-01', targetDate: '2027-03-31' });
    expect(portail.jalons.map((j: any) => [j.label, j.done]).sort()).toEqual([['Devis reçu', true], ['Mise en production', false]]);
  });

  it('détache la to-do et les notes d’un projet supprimé', async () => {
    const todo = (await env.call('POST', '/todos', { title: 'Relire le compte rendu', projectId }, MEMBRE)).json;
    expect((await env.call('DELETE', `/projects/${projectId}`, undefined, ADMIN)).status).toBe(204);
    const notes = (await env.call('GET', '/notes', undefined, MEMBRE)).json;
    expect(notes.find((n: any) => n.id === otherId)).toMatchObject({ projectId: '', title: 'Questions pour le comité' });
    const todos = (await env.call('GET', '/todos', undefined, MEMBRE)).json.personal;
    expect(todos.find((t: any) => t.id === todo.id)).toMatchObject({ projectId: '' });
  });
});
