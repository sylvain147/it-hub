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

describe('utilisateurs, rôles, to-do et tickets', () => {
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
    // Un ticket saisi avant l'annuaire, avec un nom en texte libre.
    projectId = (await env.call('POST', '/projects', { name: 'Refonte du site' }, ADMIN)).json.id;
    const legacy = await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Recette des paiements', assignee: 'chloé durand' }, ADMIN);
    expect(legacy.json).toMatchObject({ assigneeId: '', assignee: 'chloé durand' });
    legacyTaskId = legacy.json.id;
  });

  it('crée les utilisateurs (administrateur seulement) et rattache leurs tickets existants', async () => {
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

  it('rattache les tickets à un utilisateur', async () => {
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
    // Terminer le ticket ne touche pas au responsable.
    const done = await env.call('PATCH', `/projects/${projectId}/items/tasks/${moved.json.id}`, { status: 'termine' }, RESP);
    expect(done.json).toMatchObject({ assigneeId: RESP, done: true });
  });

  it('gère la to-do selon le rôle', async () => {
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
    expect(chloe.json.tickets.map((t: any) => t.title)).toEqual(['Recette des paiements']);
    // Les tâches des autres : réservées aux rôles qui le permettent.
    expect((await env.call('GET', `/todos?user=${RESP}`, undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('GET', '/todos?user=all', undefined, MEMBRE)).status).toBe(403);
    const team = await env.call('GET', '/todos?user=all', undefined, RESP);
    expect(team.json.personal).toHaveLength(3);
    expect(team.json.tickets.length).toBeGreaterThanOrEqual(3);
    const ofChloe = await env.call('GET', `/todos?user=${MEMBRE}`, undefined, ADMIN);
    expect(ofChloe.json.personal).toHaveLength(2);
    expect(ofChloe.json.tickets.every((t: any) => t.assigneeId === MEMBRE && !t.done)).toBe(true);

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

  it('lie une tâche de la to-do à un ticket', async () => {
    expect((await env.call('POST', '/todos', { title: 'Relancer', ticketId: 'inconnu' }, MEMBRE)).status).toBe(400);
    const todo = (await env.call('POST', '/todos', { title: 'Relancer la recette', ticketId: legacyTaskId }, MEMBRE)).json;
    expect(todo).toMatchObject({ ticketId: legacyTaskId, done: false });
    // Le ticket lié reste visible même terminé.
    await env.call('PATCH', `/projects/${projectId}/items/tasks/${legacyTaskId}`, { status: 'termine' }, ADMIN);
    const res = (await env.call('GET', '/todos', undefined, MEMBRE)).json;
    expect(res.tickets.find((t: any) => t.id === legacyTaskId)).toMatchObject({ title: 'Recette des paiements', done: true, projectName: 'Refonte du site', number: 1 });
    const unlinked = await env.call('PATCH', `/todos/${todo.id}`, { ticketId: '' }, MEMBRE);
    expect(unlinked.json.ticketId).toBe('');
    expect((await env.call('GET', '/todos', undefined, MEMBRE)).json.tickets.some((t: any) => t.id === legacyTaskId)).toBe(false);
  });

  it('modifie et désactive les utilisateurs en gardant un administrateur', async () => {
    expect((await env.call('PUT', `/users/${ADMIN}`, { name: 'Alice Martin', role: 'membre', active: true }, ADMIN)).status).toBe(400);
    expect((await env.call('PUT', `/users/${ADMIN}`, { name: 'Alice Martin', role: 'admin', active: false }, ADMIN)).status).toBe(400);
    const renamed = await env.call('PUT', `/users/${RESP}`, { name: 'Bruno Petit-Durand', role: 'admin', active: true }, ADMIN);
    expect(renamed.json).toMatchObject({ name: 'Bruno Petit-Durand', role: 'admin', updatedBy: ADMIN });
    // Le nom est recopié dans les tickets.
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
