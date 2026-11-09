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

  it('laisse chacun choisir son thème de couleur, conservé quand un administrateur modifie sa fiche', async () => {
    expect((await env.call('GET', '/me', undefined, MEMBRE)).json.theme).toBe('comte');
    const r = await env.call('PUT', '/me/preferences', { theme: 'prune' }, MEMBRE);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: MEMBRE, theme: 'prune', permissions: { manageUsers: false } });
    expect((await env.call('PUT', '/me/preferences', { theme: 'fluo' }, MEMBRE)).status).toBe(400);
    // Le thème des autres ne bouge pas.
    expect((await env.call('GET', '/me', undefined, ADMIN)).json.theme).toBe('comte');
    const profile = { name: 'Chloé Durand', role: 'membre', active: true, jobTitle: '', backupId: '', perimeters: [] };
    expect((await env.call('PUT', `/users/${MEMBRE}`, profile, ADMIN)).json.theme).toBe('prune');
    expect((await env.call('GET', '/me', undefined, MEMBRE)).json.theme).toBe('prune');
  });

  it('renseigne le poste, le backup et le périmètre d’un utilisateur', async () => {
    const legacy = (await env.call('GET', '/users', undefined, ADMIN)).json.find((u: any) => u.email === RESP);
    expect(legacy).toMatchObject({ jobTitle: '', backupId: '', perimeters: [] });
    const profile = { name: 'Chloé Durand', role: 'membre', active: true, jobTitle: 'Cheffe de projet ERP', backupId: RESP, perimeters: ['web', 'erp'] };
    const r = await env.call('PUT', `/users/${MEMBRE}`, profile, ADMIN);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ jobTitle: 'Cheffe de projet ERP', backupId: RESP, perimeters: ['web', 'erp'] });
    expect((await env.call('PUT', `/users/${MEMBRE}`, { ...profile, perimeters: ['finance'] }, ADMIN)).status).toBe(400);
    expect((await env.call('PUT', `/users/${MEMBRE}`, { ...profile, backupId: MEMBRE }, ADMIN)).status).toBe(400);
    expect((await env.call('PUT', `/users/${MEMBRE}`, { ...profile, backupId: 'inconnu@exemple.fr' }, ADMIN)).status).toBe(400);
    // Seul un administrateur modifie la fiche.
    expect((await env.call('PUT', `/users/${MEMBRE}`, profile, RESP)).status).toBe(403);
    const created = await env.call('POST', '/users', { email: 'eve@exemple.fr', name: 'Ève Roux', jobTitle: 'Admin réseau', backupId: MEMBRE, perimeters: ['reseau', 'securite'] }, ADMIN);
    expect(created.json.user).toMatchObject({ jobTitle: 'Admin réseau', backupId: MEMBRE, perimeters: ['reseau', 'securite'] });
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
    expect(chloe.json.tickets).toBeUndefined(); // la to-do ne mélange pas les tickets
    // Les tâches des autres : réservées aux rôles qui le permettent.
    expect((await env.call('GET', `/todos?user=${RESP}`, undefined, MEMBRE)).status).toBe(403);
    expect((await env.call('GET', '/todos?user=all', undefined, MEMBRE)).status).toBe(403);
    const team = await env.call('GET', '/todos?user=all', undefined, RESP);
    expect(team.json.personal).toHaveLength(3);
    const ofChloe = await env.call('GET', `/todos?user=${MEMBRE}`, undefined, ADMIN);
    expect(ofChloe.json.personal).toHaveLength(2);

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

  it('découpe une tâche de la to-do en sous-tâches', async () => {
    const t = (await env.call('POST', '/todos', { title: 'Préparer le comité', subtasks: [{ id: 'a', title: 'Relire le budget' }] }, MEMBRE)).json;
    expect(t.subtasks).toEqual([{ id: 'a', title: 'Relire le budget', done: false }]);
    expect((await env.call('PATCH', `/todos/${t.id}`, { subtasks: [{ id: 'a', title: '  ' }] }, MEMBRE)).status).toBe(400);
    expect((await env.call('PATCH', `/todos/${t.id}`, { subtasks: [{ id: 'a', title: 'X' }, { id: 'a', title: 'Y' }] }, MEMBRE)).status).toBe(400);
    const steps = [
      { id: 'a', title: 'Relire le budget', done: true },
      { id: 'b', title: 'Envoyer l’ordre du jour', done: false },
    ];
    const upd = await env.call('PATCH', `/todos/${t.id}`, { subtasks: steps }, MEMBRE);
    expect(upd.json).toMatchObject({ subtasks: steps, done: false });
    // Cocher la tâche ou la modifier garde ses sous-tâches.
    expect((await env.call('PATCH', `/todos/${t.id}`, { done: true, title: 'Préparer le comité de pilotage' }, MEMBRE)).json.subtasks).toEqual(steps);
    expect((await env.call('POST', '/todos', { title: 'Trop', subtasks: Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, title: 'x' })) }, MEMBRE)).status).toBe(400);
    // Les tâches enregistrées avant les sous-tâches en ont une liste vide.
    expect((await env.call('POST', '/todos', { title: 'Sans étapes' }, MEMBRE)).json.subtasks).toEqual([]);
    for (const x of (await env.call('GET', '/todos', undefined, MEMBRE)).json.personal.filter((x: any) => ['Préparer le comité de pilotage', 'Sans étapes'].includes(x.title)))
      await env.call('DELETE', `/todos/${x.id}`, undefined, MEMBRE);
  });

  it('range la to-do dans l’ordre choisi par glisser-déposer', async () => {
    const titles = ['Premier', 'Deuxième', 'Troisième'];
    const ids: string[] = [];
    for (const title of titles) ids.push((await env.call('POST', '/todos', { title }, MEMBRE)).json.id);
    expect((await env.call('PUT', '/todos/ordre', { ids: [] }, MEMBRE)).status).toBe(400);
    expect((await env.call('PUT', '/todos/ordre', { ids: [ids[2], 'inconnue'] }, MEMBRE)).status).toBe(404);
    expect((await env.call('PUT', '/todos/ordre', { ids: [ids[2], ids[0], ids[1]] }, MEMBRE)).status).toBe(204);
    const mine = (await env.call('GET', '/todos', undefined, MEMBRE)).json.personal.filter((t: any) => ids.includes(t.id));
    const ranked = mine.sort((a: any, b: any) => a.position - b.position).map((t: any) => t.title);
    expect(ranked).toEqual(['Troisième', 'Premier', 'Deuxième']);
    // Le rang survit à une modification ; on ne range pas la to-do personnelle d'un autre.
    expect((await env.call('PATCH', `/todos/${ids[2]}`, { done: true }, MEMBRE)).json.position).toBe(0);
    const bruno = (await env.call('POST', '/todos', { title: 'Tâche de Bruno' }, RESP)).json;
    expect((await env.call('PUT', '/todos/ordre', { ids: [bruno.id, ids[0]] }, MEMBRE)).status).toBe(403);
    for (const id of [...ids, bruno.id]) await env.call('DELETE', `/todos/${id}`, undefined, ADMIN);
  });

  it('rattache une tâche de la to-do à un projet, sans en faire un ticket', async () => {
    expect((await env.call('POST', '/todos', { title: 'Relancer', projectId: 'inconnu' }, MEMBRE)).status).toBe(400);
    const todo = (await env.call('POST', '/todos', { title: 'Relancer le prestataire', projectId }, MEMBRE)).json;
    expect(todo).toMatchObject({ projectId, done: false });
    expect(todo.status).toBeUndefined();
    expect(todo.sprintId).toBeUndefined();
    // Pas de ticket créé dans le projet.
    const tickets = (await env.call('GET', `/projects/${projectId}`, undefined, ADMIN)).json.items.tasks;
    expect(tickets.some((t: any) => t.title === 'Relancer le prestataire')).toBe(false);
    // La to-do du projet est partagée : toute l'équipe la voit et la coche.
    const ofProject = (await env.call('GET', `/todos?projet=${projectId}`, undefined, RESP)).json;
    expect(ofProject).toMatchObject({ scope: 'projet' });
    expect(ofProject.personal.map((t: any) => t.title)).toEqual(['Relancer le prestataire']);
    expect((await env.call('PATCH', `/todos/${todo.id}`, { done: true }, RESP)).json.done).toBe(true);
    // Le lien vers un ticket n'existe plus.
    const legacy = await env.call('PATCH', `/todos/${todo.id}`, { ticketId: legacyTaskId }, MEMBRE);
    expect(legacy.json.ticketId).toBeUndefined();
    const detached = await env.call('PATCH', `/todos/${todo.id}`, { projectId: '' }, MEMBRE);
    expect(detached.json.projectId).toBe('');
    expect((await env.call('GET', `/todos?projet=${projectId}`, undefined, RESP)).json.personal).toHaveLength(0);
  });

  it('modifie et désactive les utilisateurs en gardant un administrateur', async () => {
    const chefs = await env.call('POST', '/projects', { name: 'Factures', chefDeProjetIds: [ADMIN, RESP] }, ADMIN);
    expect(chefs.json.chefDeProjet).toBe('Alice Martin, Bruno Petit');
    expect((await env.call('PUT', `/users/${ADMIN}`, { name: 'Alice Martin', role: 'membre', active: true }, ADMIN)).status).toBe(400);
    expect((await env.call('PUT', `/users/${ADMIN}`, { name: 'Alice Martin', role: 'admin', active: false }, ADMIN)).status).toBe(400);
    const renamed = await env.call('PUT', `/users/${RESP}`, { name: 'Bruno Petit-Durand', role: 'admin', active: true }, ADMIN);
    expect(renamed.json).toMatchObject({ name: 'Bruno Petit-Durand', role: 'admin', updatedBy: ADMIN });
    // Le nom est recopié dans les tickets.
    const tasks = (await env.call('GET', `/projects/${projectId}`, undefined, ADMIN)).json.items.tasks.filter((t: any) => t.assigneeId === RESP);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t: any) => t.assignee === 'Bruno Petit-Durand')).toBe(true);
    // … et parmi les chefs de projet.
    expect((await env.call('GET', `/projects/${chefs.json.id}`, undefined, ADMIN)).json.chefDeProjet).toBe('Alice Martin, Bruno Petit-Durand');
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
