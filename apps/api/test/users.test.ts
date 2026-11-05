import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const ADMIN = 'alice.martin@exemple.fr';
const RESP = 'bruno.petit@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';

describe('utilisateurs, rôles et tâches', () => {
  let projectId = '';
  let legacyTaskId = '';

  it('fait du premier utilisateur un administrateur', async () => {
    const me = await env.call('GET', '/me', undefined, ADMIN);
    expect(me.json).toMatchObject({
      email: ADMIN,
      name: 'Alice Martin',
      role: 'admin',
      active: true,
      permissions: { manageUsers: true, seeAllTodos: true, assignOthers: true },
    });
    // Une tâche saisie avant l'annuaire, avec un nom en texte libre.
    projectId = (await env.call('POST', '/projects', { name: 'Refonte du site' }, ADMIN)).json.id;
    const legacy = await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Recette des paiements', assignee: 'chloé durand' }, ADMIN);
    expect(legacy.json).toMatchObject({ assigneeId: '', assignee: 'chloé durand' });
    legacyTaskId = legacy.json.id;
  });

  it('crée les utilisateurs (administrateur seulement) et rattache leurs tâches existantes', async () => {
    const r = await env.call('POST', '/users', { email: 'Bruno.Petit@exemple.fr', name: 'Bruno Petit', role: 'responsable' }, ADMIN);
    expect(r.status).toBe(201);
    expect(r.json.user).toMatchObject({ email: RESP, role: 'responsable', invitedAt: null });
    const c = await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand' }, ADMIN);
    expect(c.json).toMatchObject({ user: { role: 'membre' }, linkedTasks: 1 });
    expect((await env.call('POST', '/users', { email: MEMBRE, name: 'Doublon' }, ADMIN)).status).toBe(409);
    expect((await env.call('POST', '/users', { email: 'x@exemple.fr', name: 'X' }, RESP)).status).toBe(403);
    const task = (await env.call('GET', `/projects/${projectId}`, undefined, ADMIN)).json.items.tasks.find((t: any) => t.id === legacyTaskId);
    expect(task).toMatchObject({ assigneeId: MEMBRE, assignee: 'Chloé Durand' });
    const list = await env.call('GET', '/users', undefined, MEMBRE);
    expect(list.json.map((u: any) => u.name)).toEqual(['Alice Martin', 'Bruno Petit', 'Chloé Durand']);
    expect((await env.call('POST', `/users/${MEMBRE}/invitation`, {}, ADMIN)).status).toBe(400); // pas de Cognito en local
  });

  it('rattache les tâches de projet à un utilisateur', async () => {
    const mine = await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Préparer le comité' }, MEMBRE);
    expect(mine.json).toMatchObject({ assigneeId: MEMBRE, assignee: 'Chloé Durand' }); // par défaut : soi-même
    const forBruno = await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Valider le devis', assigneeId: RESP, dueDate: '2026-11-20' }, ADMIN);
    expect(forBruno.json).toMatchObject({ assigneeId: RESP, assignee: 'Bruno Petit' });
    const ext = await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Livrer le correctif', assignee: 'Prestataire ACME' }, ADMIN);
    expect(ext.json).toMatchObject({ assigneeId: '', assignee: 'Prestataire ACME' });
    expect((await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'X', assigneeId: 'inconnu@exemple.fr' }, ADMIN)).status).toBe(400);
    expect((await env.call('PATCH', `/projects/${projectId}/items/tasks/${mine.json.id}`, { assigneeId: '', assignee: '' }, ADMIN)).status).toBe(400);
    const moved = await env.call('PATCH', `/projects/${projectId}/items/tasks/${mine.json.id}`, { assigneeId: RESP }, ADMIN);
    expect(moved.json).toMatchObject({ assigneeId: RESP, assignee: 'Bruno Petit' });
    // Cocher la tâche ne touche pas au responsable.
    const done = await env.call('PATCH', `/projects/${projectId}/items/tasks/${moved.json.id}`, { done: true }, RESP);
    expect(done.json).toMatchObject({ assigneeId: RESP, done: true });
  });

  it('gère les tâches personnelles selon le rôle', async () => {
    const own = await env.call('POST', '/todos', { title: 'Mettre à jour mon planning', dueDate: '2026-11-10' }, MEMBRE);
    expect(own.status).toBe(201);
    expect(own.json).toMatchObject({ assigneeId: MEMBRE, createdBy: MEMBRE, done: false });
    // Un chargé de projet ne peut pas attribuer de tâche à quelqu'un d'autre…
    expect((await env.call('POST', '/todos', { title: 'Pour Bruno', assigneeId: RESP }, MEMBRE)).status).toBe(403);
    // … un responsable si.
    const given = await env.call('POST', '/todos', { title: 'Préparer l’entretien annuel', assigneeId: MEMBRE, details: 'Relire **les objectifs** de l’an dernier' }, RESP);
    expect(given.json).toMatchObject({ assigneeId: MEMBRE, createdBy: RESP });
    await env.call('POST', '/todos', { title: 'Note de cadrage budget' }, RESP);

    const chloe = await env.call('GET', '/todos', undefined, MEMBRE);
    expect(chloe.json.scope).toBe(MEMBRE);
    expect(chloe.json.personal.map((t: any) => t.title).sort()).toEqual(['Mettre à jour mon planning', 'Préparer l’entretien annuel']);
    expect(chloe.json.project.map((t: any) => t.title)).toEqual(['Recette des paiements']);
    // Les tâches des autres : réservées aux rôles qui le permettent.
    expect((await env.call('GET', `/todos?user=${RESP}`, undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('GET', '/todos?user=all', undefined, MEMBRE)).status).toBe(403);
    const team = await env.call('GET', '/todos?user=all', undefined, RESP);
    expect(team.json.personal).toHaveLength(3);
    expect(team.json.project.length).toBeGreaterThanOrEqual(3);
    const ofChloe = await env.call('GET', `/todos?user=${MEMBRE}`, undefined, ADMIN);
    expect(ofChloe.json.personal).toHaveLength(2);
    // L'accueil (« mes tâches ») suit la même règle.
    const open = await env.call('GET', '/tasks/open', undefined, MEMBRE);
    expect(open.json.every((t: any) => t.assigneeId === MEMBRE)).toBe(true);
    expect((await env.call('GET', '/tasks/open', undefined, RESP)).json.length).toBeGreaterThan(open.json.length);

    // Modification : la personne concernée, l'auteur ou un rôle qui voit tout.
    const doneTodo = await env.call('PATCH', `/todos/${own.json.id}`, { done: true }, MEMBRE);
    expect(doneTodo.json.doneAt).not.toBe('');
    const bruno = (await env.call('GET', '/todos', undefined, RESP)).json.personal.find((t: any) => t.title === 'Note de cadrage budget');
    expect((await env.call('PATCH', `/todos/${bruno.id}`, { title: 'X' }, MEMBRE)).status).toBe(403);
    expect((await env.call('DELETE', `/todos/${bruno.id}`, undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('PATCH', `/todos/${own.json.id}`, { assigneeId: RESP }, MEMBRE)).status).toBe(403);
    expect((await env.call('PATCH', `/todos/${bruno.id}`, { assigneeId: MEMBRE }, ADMIN)).json.assigneeId).toBe(MEMBRE);
    expect((await env.call('DELETE', `/todos/${own.json.id}`, undefined, MEMBRE)).status).toBe(204);
  });

  it('rattache une tâche personnelle à un projet, puis la rend personnelle', async () => {
    const todo = (await env.call('POST', '/todos', { title: 'Appeler le métier', details: 'Avant **jeudi**', dueDate: '2026-11-12' }, MEMBRE)).json;
    expect((await env.call('POST', '/todos/move', { id: todo.id }, MEMBRE)).status).toBe(400); // déjà personnelle
    const toProject = await env.call('POST', '/todos/move', { id: todo.id, toProjectId: projectId }, MEMBRE);
    expect(toProject.status).toBe(200);
    expect(toProject.json.task).toMatchObject({ id: todo.id, title: 'Appeler le métier', details: 'Avant **jeudi**', assigneeId: MEMBRE, assignee: 'Chloé Durand', done: false });
    expect((await env.call('GET', '/todos', undefined, MEMBRE)).json.personal.some((t: any) => t.id === todo.id)).toBe(false);
    expect((await env.call('GET', `/projects/${projectId}`, undefined, MEMBRE)).json.items.tasks.some((t: any) => t.id === todo.id)).toBe(true);

    // Une tâche de projet confiée à une personne extérieure revient à celui qui la rend personnelle.
    const ext = (await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Livrer la V2', assignee: 'Prestataire ACME' }, ADMIN)).json;
    const back = await env.call('POST', '/todos/move', { id: ext.id, fromProjectId: projectId }, MEMBRE);
    expect(back.json.task).toMatchObject({ id: ext.id, title: 'Livrer la V2', assigneeId: MEMBRE });
    expect((await env.call('POST', '/todos/move', { id: todo.id, fromProjectId: projectId }, MEMBRE)).json.task.assigneeId).toBe(MEMBRE);
    expect((await env.call('GET', `/projects/${projectId}`, undefined, MEMBRE)).json.items.tasks.some((t: any) => t.id === todo.id || t.id === ext.id)).toBe(false);
  });

  it('modifie et désactive les utilisateurs en gardant un administrateur', async () => {
    expect((await env.call('PUT', `/users/${ADMIN}`, { name: 'Alice Martin', role: 'membre', active: true }, ADMIN)).status).toBe(400);
    expect((await env.call('PUT', `/users/${ADMIN}`, { name: 'Alice Martin', role: 'admin', active: false }, ADMIN)).status).toBe(400);
    const renamed = await env.call('PUT', `/users/${RESP}`, { name: 'Bruno Petit-Durand', role: 'admin', active: true }, ADMIN);
    expect(renamed.json).toMatchObject({ name: 'Bruno Petit-Durand', role: 'admin', updatedBy: ADMIN });
    // Le nom est recopié dans les tâches de projet.
    const tasks = (await env.call('GET', `/projects/${projectId}`, undefined, ADMIN)).json.items.tasks.filter((t: any) => t.assigneeId === RESP);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t: any) => t.assignee === 'Bruno Petit-Durand')).toBe(true);
    // Deux administrateurs : Alice peut redevenir chargée de projet.
    expect((await env.call('PUT', `/users/${ADMIN}`, { name: 'Alice Martin', role: 'membre', active: true }, RESP)).status).toBe(200);

    const off = await env.call('PUT', `/users/${MEMBRE}`, { name: 'Chloé Durand', role: 'membre', active: false }, RESP);
    expect(off.json.active).toBe(false);
    const refused = await env.call('GET', '/me', undefined, MEMBRE);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/désactivé/);
    expect((await env.call('POST', '/todos', { title: 'Pour Chloé', assigneeId: MEMBRE }, RESP)).status).toBe(400);
  });

  it('ajoute à l’annuaire, comme chargé de projet, une personne authentifiée inconnue', async () => {
    const me = await env.call('GET', '/me', undefined, 'david.leroy@exemple.fr');
    expect(me.json).toMatchObject({ name: 'David Leroy', role: 'membre', permissions: { manageUsers: false, seeAllTodos: false } });
  });
});
