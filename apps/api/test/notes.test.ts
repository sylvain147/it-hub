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
    projectId = (await env.call('POST', '/projects', { name: 'Migration ERP' }, ADMIN)).json.id;
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

  it('archive une note et la ressort des archives', async () => {
    const n = (await env.call('POST', '/notes', { content: 'Compte rendu du comité de septembre' }, MEMBRE)).json;
    expect(n.archived).toBe(false);
    const archived = await env.call('PATCH', `/notes/${n.id}`, { archived: true }, MEMBRE);
    expect(archived.json).toMatchObject({ archived: true, content: 'Compte rendu du comité de septembre' });
    // Une autre modification garde l'archivage.
    expect((await env.call('PATCH', `/notes/${n.id}`, { title: 'Comité' }, MEMBRE)).json.archived).toBe(true);
    expect((await env.call('GET', '/notes', undefined, MEMBRE)).json.find((x: any) => x.id === n.id).archived).toBe(true);
    expect((await env.call('PATCH', `/notes/${n.id}`, { archived: false }, MEMBRE)).json.archived).toBe(false);
    expect((await env.call('DELETE', `/notes/${n.id}`, undefined, MEMBRE)).status).toBe(204);
  });

  it('change la taille d’un post-it sans compter comme une modification', async () => {
    const n = (await env.call('POST', '/notes', { content: 'Une longue note à lire sans l’ouvrir' }, MEMBRE)).json;
    expect(n).toMatchObject({ width: 1, height: 180 });
    expect((await env.call('PATCH', `/notes/${n.id}`, { width: 4 }, MEMBRE)).status).toBe(400);
    expect((await env.call('PATCH', `/notes/${n.id}`, { height: 20 }, MEMBRE)).status).toBe(400);
    const big = await env.call('PATCH', `/notes/${n.id}`, { width: 2, height: 0 }, MEMBRE);
    expect(big.json).toMatchObject({ width: 2, height: 0, content: 'Une longue note à lire sans l’ouvrir', updatedAt: n.updatedAt });
    // Une vraie modification garde la taille choisie et compte comme une modification.
    const edited = await env.call('PATCH', `/notes/${n.id}`, { title: 'À lire', height: 320 }, MEMBRE);
    expect(edited.json).toMatchObject({ width: 2, height: 320, title: 'À lire' });
    expect(edited.json.updatedAt > n.updatedAt).toBe(true);
    expect((await env.call('DELETE', `/notes/${n.id}`, undefined, MEMBRE)).status).toBe(204);
  });

  it('garde les notes privées, sauf pour les administrateurs qui voient et ajoutent celles de tous', async () => {
    const RESP = 'bruno.petit@exemple.fr';
    await env.call('POST', '/users', { email: RESP, name: 'Bruno Petit', role: 'responsable' }, ADMIN);
    // Un autre utilisateur, même responsable d'équipe, ne voit rien.
    expect((await env.call('GET', '/notes', undefined, RESP)).json).toHaveLength(0);
    expect((await env.call('GET', `/notes?user=${MEMBRE}`, undefined, RESP)).status).toBe(403);
    expect((await env.call('POST', '/notes', { content: 'x', ownerId: MEMBRE }, RESP)).status).toBe(403);
    expect((await env.call('PATCH', `/notes/${otherId}?owner=${MEMBRE}`, { title: 'X' }, RESP)).status).toBe(403);
    expect((await env.call('PATCH', `/notes/${otherId}`, { title: 'X' }, RESP)).status).toBe(404);

    // L'administrateur : ses propres notes par défaut, celles de Chloé ou de tout le monde sur demande.
    expect((await env.call('GET', '/notes', undefined, ADMIN)).json).toHaveLength(0);
    expect((await env.call('GET', `/notes?user=${MEMBRE}`, undefined, ADMIN)).json).toHaveLength(2);
    expect((await env.call('GET', `/notes?user=${MEMBRE}&projet=${projectId}`, undefined, ADMIN)).json.map((n: any) => n.id)).toEqual([otherId]);
    const given = await env.call('POST', '/notes', { title: 'À voir avec moi', content: 'Point budget lundi', ownerId: MEMBRE }, ADMIN);
    expect(given.status).toBe(201);
    expect(given.json).toMatchObject({ ownerId: MEMBRE, createdBy: ADMIN });
    await env.call('POST', '/notes', { content: 'Ma note d’admin' }, ADMIN);
    expect((await env.call('GET', '/notes?user=all', undefined, ADMIN)).json).toHaveLength(4);
    expect((await env.call('GET', '/notes', undefined, MEMBRE)).json.some((n: any) => n.title === 'À voir avec moi')).toBe(true);
    expect((await env.call('POST', '/notes', { content: 'x', ownerId: 'inconnu@exemple.fr' }, ADMIN)).status).toBe(400);
    expect((await env.call('POST', '/notes', { content: 'x', ownerId: 'all' }, ADMIN)).status).toBe(400);
    // Modification et suppression chez quelqu'un d'autre : en désignant le titulaire.
    expect((await env.call('PATCH', `/notes/${given.json.id}?owner=${MEMBRE}`, { pinned: true }, ADMIN)).json).toMatchObject({ pinned: true, updatedBy: ADMIN });
    expect((await env.call('DELETE', `/notes/${given.json.id}?owner=${MEMBRE}`, undefined, ADMIN)).status).toBe(204);
  });

  it('rassemble les jalons de tous les projets pour la frise', async () => {
    const second = (await env.call('POST', '/projects', { name: 'Portail fournisseurs', startDate: '2026-09-01', targetDate: '2027-03-31' }, ADMIN)).json.id;
    await env.call('POST', `/projects/${projectId}/items/jalons`, { label: 'Recette', date: '2026-12-01' }, ADMIN);
    await env.call('POST', `/projects/${second}/items/jalons`, { label: 'Mise en production', date: '2027-03-15' }, ADMIN);
    await env.call('POST', `/projects/${second}/items/jalons`, { label: 'Devis reçu', date: '2026-10-01', done: true }, ADMIN);
    // Jalon sur une période : début avant la fin, fin obligatoire.
    expect((await env.call('POST', `/projects/${second}/items/jalons`, { label: 'Recette', startDate: '2027-02-10', date: '2027-02-01' }, ADMIN)).status).toBe(400);
    expect((await env.call('POST', `/projects/${second}/items/jalons`, { label: 'Recette', startDate: '2027-02-10' }, ADMIN)).status).toBe(400);
    const recette = await env.call('POST', `/projects/${second}/items/jalons`, { label: 'Recette', startDate: '2027-02-01', date: '2027-02-28' }, ADMIN);
    expect(recette.json).toMatchObject({ startDate: '2027-02-01', date: '2027-02-28', initialDate: '2027-02-28' });
    // La to-do datée du projet apparaît sur la frise ; une tâche sans échéance, non.
    await env.call('POST', '/todos', { title: 'Relancer le prestataire', projectId: second, dueDate: '2026-12-15' }, MEMBRE);
    await env.call('POST', '/todos', { title: 'Sans échéance', projectId: second }, MEMBRE);
    const { json } = await env.call('GET', '/projects/jalons', undefined, MEMBRE);
    expect(json).toHaveLength(2);
    const erp = json.find((p: any) => p.id === projectId);
    expect(erp).toMatchObject({ name: 'Migration ERP', status: 'cadrage' });
    expect(erp.jalons.map((j: any) => j.label)).toEqual(['Recette']);
    const portail = json.find((p: any) => p.id === second);
    expect(portail).toMatchObject({ startDate: '2026-09-01', targetDate: '2027-03-31' });
    expect(portail.jalons.map((j: any) => [j.label, j.done]).sort()).toEqual([['Devis reçu', true], ['Fin du projet', false], ['Mise en production', false], ['Recette', false]]);
    expect(portail.todos).toEqual([expect.objectContaining({ title: 'Relancer le prestataire', dueDate: '2026-12-15', done: false, assigneeId: MEMBRE })]);
    expect(erp.todos).toEqual([]);
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
