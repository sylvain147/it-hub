import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { setupTestEnv } from './helpers.js';
import { ddb } from '../src/db/client.js';
import { config } from '../src/config.js';
import { projectKeys } from '../src/projects/repo.js';

const MEETING = `Julien: point hebdo sur la migration Coliéco avec Coqliqo
Marie: le prestataire doit envoyer le devis révisé avant vendredi
Julien: il faut faire valider les règles d'éligibilité par le métier
Marie: la recette est prévue fin octobre, risque de retard si les tables de référence ne sont pas prêtes
Julien: on part sur la bascule automatique en Colissimo`;

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let id: string;

beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

describe('module Projets', () => {
  it('crée un projet et refuse une fiche invalide', async () => {
    const bad = await env.call('POST', '/projects', { name: '  ' });
    expect(bad.status).toBe(400);
    const res = await env.call('POST', '/projects', { name: 'Migration Coliéco', code: 'COL-27', description: 'La Poste arrête l’offre **Coliéco** en janvier 2027.', sections: [{ id: 'obj', title: 'Objectifs', content: '- Basculer vers l’offre Essentiel' }] });
    expect(res.status).toBe(201);
    id = res.json.id;
    expect(res.json).toMatchObject({ status: 'cadrage', priority: 'normale', health: 'vert', rev: 1 });
    expect(res.json.activity[0].text).toBe('a créé le projet');
    expect(res.json.sections).toEqual([{ id: 'obj', title: 'Objectifs', content: '- Basculer vers l’offre Essentiel' }]);
    expect(res.json).not.toHaveProperty('objectifs');
  });

  it('ajoute, renomme et retire des sections libres', async () => {
    const { json: p } = await env.call('GET', `/projects/${id}`);
    const untitled = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields: { ...pick(p), sections: [...p.sections, { id: 'x', title: ' ', content: '' }] } });
    expect(untitled.status).toBe(400);
    const sections = [{ id: 'enjeux', title: 'Enjeux', content: 'Coût du transport' }, { ...p.sections[0], title: 'Objectifs du projet' }];
    const ok = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields: { ...pick(p), sections } });
    expect(ok.status).toBe(200);
    expect(ok.json.sections).toEqual(sections);
    const back = await env.call('PUT', `/projects/${id}`, { rev: ok.json.rev, fields: { ...pick(ok.json), sections: [p.sections[0]] } });
    expect(back.json.sections).toEqual(p.sections);
  });

  it('modifie la fiche avec verrouillage optimiste', async () => {
    const { json: p } = await env.call('GET', `/projects/${id}`);
    const fields = { ...pick(p), status: 'en_cours', health: 'orange', healthComment: 'Devis en attente', targetDate: '2027-01-15' };
    const ok = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ rev: p.rev + 1, status: 'en_cours', health: 'orange' });
    const stale = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields }, 'bob@test');
    expect(stale.status).toBe(409);
  });

  it('rattache le chef de projet à un utilisateur et gère le suivi', async () => {
    await env.call('GET', '/me', undefined, 'bob@test');
    const { json: p } = await env.call('GET', `/projects/${id}`);
    expect(p.followers).toEqual([]);
    // Texte qui ne désigne aucun utilisateur : refusé.
    const unknown = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields: { ...pick(p), chefDeProjetIds: [], chefDeProjet: 'Quelqu’un' } });
    expect(unknown.status).toBe(400);
    const notUser = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields: { ...pick(p), chefDeProjetIds: ['bob@test', 'inconnu@test'] } });
    expect(notUser.status).toBe(400);
    const solo = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields: { ...pick(p), chefDeProjetIds: ['bob@test'], chefDeProjet: '' } });
    expect(solo.status).toBe(200);
    expect(solo.json.chefDeProjetIds).toEqual(['bob@test']);
    expect(solo.json.chefDeProjet).toBeTruthy();
    expect(solo.json.activity[0].text).toContain('le chef de projet');
    // Plusieurs chefs de projet (ex. ERP et Web), dans l'ordre choisi, sans doublon ; noms recopiés.
    const ok = await env.call('PUT', `/projects/${id}`, { rev: solo.json.rev, fields: { ...pick(solo.json), chefDeProjetIds: ['bob@test', 'alice@test', 'bob@test'] } });
    expect(ok.status).toBe(200);
    expect(ok.json.chefDeProjetIds).toEqual(['bob@test', 'alice@test']);
    expect(ok.json.chefDeProjet.split(', ')).toHaveLength(2);
    expect(ok.json.activity[0].text).toContain('les chefs de projet');
    // Chacun le compte parmi « mes projets » : le bouton Suivre n'est pas nécessaire.

    // Suivre / ne plus suivre, sans toucher à la révision de la fiche.
    const follow = await env.call('PUT', `/projects/${id}/suivi`, { follow: true });
    expect(follow.json.followers).toEqual(['alice@test']);
    await env.call('PUT', `/projects/${id}/suivi`, { follow: true });
    await env.call('PUT', `/projects/${id}/suivi`, { follow: true }, 'bob@test');
    const { json: list } = await env.call('GET', '/projects');
    expect(list.find((x: any) => x.id === id)).toMatchObject({ followers: ['alice@test', 'bob@test'], rev: ok.json.rev });
    await env.call('PUT', `/projects/${id}/suivi`, { follow: false }, 'bob@test');
    const { json: planning } = await env.call('GET', '/projects/jalons');
    expect(planning.find((x: any) => x.id === id)).toMatchObject({ chefDeProjetIds: ['bob@test', 'alice@test'], followers: ['alice@test'] });
    expect((await env.call('PUT', '/projects/inconnu/suivi', { follow: true })).status).toBe(404);
  });

  it('rattache les anciens chefs de projet saisis en texte', async () => {
    const now = new Date().toISOString();
    const base = { gsi1pk: 'PROJ', gsi1sk: now, status: 'cadrage', priority: 'normale', health: 'vert', healthComment: '', demandeur: '', startDate: '', targetDate: '', description: '', objectifs: '', horsPerimetre: '', budgetPrevu: null, tags: [], code: '', rev: 1, stats: {}, activeJobId: null, activeJobAt: null, createdAt: now, createdBy: 'x', updatedAt: now, updatedBy: 'x' };
    await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...projectKeys.meta('ancien-1'), ...base, id: 'ancien-1', name: 'Ancien 1', chefDeProjet: 'bob' } }));
    await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...projectKeys.meta('ancien-2'), ...base, id: 'ancien-2', name: 'Ancien 2', chefDeProjet: 'Prestataire externe' } }));
    const { json: list } = await env.call('GET', '/projects');
    expect(list.find((x: any) => x.id === 'ancien-1')).toMatchObject({ chefDeProjetIds: ['bob@test'], followers: [] });
    const old = list.find((x: any) => x.id === 'ancien-2');
    expect(old).toMatchObject({ chefDeProjetIds: [], chefDeProjet: 'Prestataire externe' });
    // Le texte d'origine reste accepté tant qu'on n'y touche pas.
    const keep = await env.call('PUT', '/projects/ancien-2', { rev: 1, fields: { ...pick(old), status: 'en_cours' } });
    expect(keep.status).toBe(200);
    expect(keep.json.chefDeProjet).toBe('Prestataire externe');
    await env.call('DELETE', '/projects/ancien-1');
    await env.call('DELETE', '/projects/ancien-2');
  });

  it('reprend l’ancien chef de projet unique dans la liste des chefs', async () => {
    const now = new Date().toISOString();
    const item = { ...projectKeys.meta('ancien-4'), gsi1pk: 'PROJ', gsi1sk: now, id: 'ancien-4', name: 'Ancien 4', code: '', status: 'cadrage', priority: 'normale', health: 'vert', healthComment: '', chefDeProjetId: 'bob@test', chefDeProjet: 'Bob', demandeur: '', startDate: '', targetDate: '', description: '', budgetPrevu: null, tags: [], rev: 1, stats: {}, activeJobId: null, activeJobAt: null, createdAt: now, createdBy: 'x', updatedAt: now, updatedBy: 'x' };
    await ddb().send(new PutCommand({ TableName: config.tableName, Item: item }));
    const { json: p } = await env.call('GET', '/projects/ancien-4');
    expect(p.chefDeProjetIds).toEqual(['bob@test']);
    expect(p).not.toHaveProperty('chefDeProjetId');
    const mine = (await env.call('GET', '/projects', undefined, 'bob@test')).json.find((x: any) => x.id === 'ancien-4');
    expect(mine.chefDeProjetIds).toEqual(['bob@test']);
    // Au premier enregistrement, l'ancien champ disparaît.
    const saved = await env.call('PUT', '/projects/ancien-4', { rev: 1, fields: { ...pick(p), chefDeProjetIds: ['bob@test', 'alice@test'] } });
    expect(saved.json.chefDeProjetIds).toEqual(['bob@test', 'alice@test']);
    const { Item } = await ddb().send(new GetCommand({ TableName: config.tableName, Key: projectKeys.meta('ancien-4') }));
    expect(Item).not.toHaveProperty('chefDeProjetId');
    await env.call('DELETE', '/projects/ancien-4');
  });

  it('reprend les anciens champs objectifs et hors périmètre en sections', async () => {
    const now = new Date().toISOString();
    const item = { ...projectKeys.meta('ancien-3'), gsi1pk: 'PROJ', gsi1sk: now, id: 'ancien-3', name: 'Ancien 3', code: '', status: 'cadrage', priority: 'normale', health: 'vert', healthComment: '', chefDeProjet: '', demandeur: '', startDate: '', targetDate: '', description: 'Contexte', objectifs: 'Livrer', horsPerimetre: 'La facturation', budgetPrevu: null, tags: [], rev: 1, stats: {}, activeJobId: null, activeJobAt: null, createdAt: now, createdBy: 'x', updatedAt: now, updatedBy: 'x' };
    await ddb().send(new PutCommand({ TableName: config.tableName, Item: item }));
    const { json: p } = await env.call('GET', '/projects/ancien-3');
    expect(p.sections).toEqual([{ id: 'objectifs', title: 'Objectifs', content: 'Livrer' }, { id: 'hors-perimetre', title: 'Hors périmètre', content: 'La facturation' }]);
    expect(p).not.toHaveProperty('objectifs');
    // Au premier enregistrement, les anciens champs disparaissent : retirer une section est définitif.
    const saved = await env.call('PUT', '/projects/ancien-3', { rev: 1, fields: { ...pick(p), sections: [p.sections[1]] } });
    expect(saved.json.sections).toEqual([p.sections[1]]);
    const { Item } = await ddb().send(new GetCommand({ TableName: config.tableName, Key: projectKeys.meta('ancien-3') }));
    expect(Item).not.toHaveProperty('objectifs');
    expect((await env.call('GET', '/projects/ancien-3')).json.sections).toEqual([p.sections[1]]);
    await env.call('DELETE', '/projects/ancien-3');
  });

  it('relit le projet de façon cohérente : une note ajoutée au journal apparaît sans recharger la page', async () => {
    const send = vi.spyOn(ddb(), 'send');
    try {
      await env.call('POST', `/projects/${id}/items/notes`, { kind: 'info', title: 'Info du jour' });
      const { json: p } = await env.call('GET', `/projects/${id}`);
      expect(p.items.notes.map((n: any) => n.title)).toContain('Info du jour');
      // Sur DynamoDB, une lecture « éventuellement cohérente » juste après l'ajout peut encore l'ignorer.
      const reads = send.mock.calls.map(([cmd]) => cmd as unknown).filter((cmd): cmd is QueryCommand => cmd instanceof QueryCommand && !cmd.input.IndexName);
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every((cmd) => cmd.input.ConsistentRead)).toBe(true);
    } finally {
      send.mockRestore();
    }
    await env.call('DELETE', `/projects/${id}/items/notes/${(await env.call('GET', `/projects/${id}`)).json.items.notes.find((n: any) => n.title === 'Info du jour').id}`);
  });

  it('gère tickets, jalons, prestations, intervenants, liens et risques', async () => {
    const task = await env.call('POST', `/projects/${id}/items/tasks`, { title: 'Relancer le prestataire', assignee: 'alice', dueDate: yesterday() });
    expect(task.status).toBe(201);
    await env.call('POST', `/projects/${id}/items/tasks`, { title: 'Préparer la recette', details: '- vérifier les **tables** de référence' });
    const jalon = await env.call('POST', `/projects/${id}/items/jalons`, { label: 'Mise en production', date: '2027-01-10' });
    expect(jalon.json.initialDate).toBe('2027-01-10');
    // Le prestataire doit exister dans le paramétrage.
    const noRef = await env.call('POST', `/projects/${id}/items/prestations`, { prestataire: 'Coqliqo', objet: 'Offre Essentiel' });
    expect(noRef.status).toBe(400);
    const coqliqo = (await env.call('POST', '/settings/prestataires', { name: 'Coqliqo' })).json;
    const presta = await env.call('POST', `/projects/${id}/items/prestations`, { prestataireId: coqliqo.id, objet: 'Offre Essentiel', status: 'commande', chargeJours: 8, montantHT: 6400 });
    expect(presta.status).toBe(201);
    expect(presta.json).toMatchObject({ prestataireId: coqliqo.id, prestataire: 'Coqliqo' });
    await env.call('POST', `/projects/${id}/items/prestations`, { prestataireId: coqliqo.id, objet: 'Option abandonnée', status: 'annule', montantHT: 1000 });
    await env.call('POST', `/projects/${id}/items/contacts`, { name: 'Paul Martin', role: 'Chef de projet prestataire', organisation: 'Coqliqo', email: 'paul@coqliqo.fr' });
    const badContact = await env.call('POST', `/projects/${id}/items/contacts`, { name: 'X', email: 'pas-un-mail' });
    expect(badContact.status).toBe(400);
    const badLink = await env.call('POST', `/projects/${id}/items/links`, { label: 'Jira', url: 'javascript:alert(1)' });
    expect(badLink.status).toBe(400);
    await env.call('POST', `/projects/${id}/items/links`, { label: 'Jira', url: 'https://jira.example.com/COL', category: 'ticket' });
    await env.call('POST', `/projects/${id}/items/risks`, { title: 'Tables de référence en retard', probability: 'fort', impact: 'moyen' });
    const unknown = await env.call('POST', `/projects/${id}/items/bidules`, { title: 'x' });
    expect(unknown.status).toBe(404);

    const { json: p } = await env.call('GET', `/projects/${id}`);
    expect(p.stats).toMatchObject({
      openTasks: 2,
      overdueTasks: 1,
      nextJalon: { label: 'Mise en production', date: '2027-01-10' },
      prestataires: ['Coqliqo'],
      chargeJours: 8,
      montantPrevu: 6400,
      montantEngage: 6400,
      openRisks: 1,
      maxRiskScore: 6,
      contacts: 1,
      links: 1,
    });

    // Modification partielle : seuls les champs fournis changent.
    const done = await env.call('PATCH', `/projects/${id}/items/tasks/${task.json.id}`, { status: 'termine' });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ title: 'Relancer le prestataire', assignee: 'Alice', assigneeId: 'alice@test', status: 'termine', done: true, number: 1 });
    expect(done.json.doneAt).not.toBe('');
    const moved = await env.call('PATCH', `/projects/${id}/items/jalons/${jalon.json.id}`, { date: '2027-01-24' });
    expect(moved.json).toMatchObject({ date: '2027-01-24', initialDate: '2027-01-10' });

    const { json: p2 } = await env.call('GET', `/projects/${id}`);
    expect(p2.stats).toMatchObject({ openTasks: 1, overdueTasks: 0, doneTasks: 1 });
    expect(p2.activity.map((a: any) => a.text)).toEqual(expect.arrayContaining(['a passé le ticket « T-1 Relancer le prestataire » au statut « Terminé »', 'a déplacé le jalon « Mise en production » au 2027-01-24']));
  });

  it('rouvre un ticket et lit les tâches enregistrées avant les sprints', async () => {
    const t = await env.call('POST', `/projects/${id}/items/tasks`, { title: 'Ticket fermé par erreur', status: 'termine' });
    expect(t.json).toMatchObject({ done: true, number: 3 });
    const reopened = await env.call('PATCH', `/projects/${id}/items/tasks/${t.json.id}`, { status: 'a_faire' });
    expect(reopened.json).toMatchObject({ done: false, doneAt: '' });
    expect((await env.call('GET', `/projects/${id}`)).json.activity[0].text).toBe('a passé le ticket « T-3 Ticket fermé par erreur » au statut « À faire »');
    await env.call('DELETE', `/projects/${id}/items/tasks/${t.json.id}`);

    // Ancien format : statut « fait » et priorité.
    await ddb().send(
      new PutCommand({
        TableName: config.tableName,
        Item: { ...projectKeys.item(id, 'tasks', 'ancienne'), projectId: id, id: 'ancienne', title: 'Ancienne tâche', details: '', status: 'fait', priority: 'haute', assigneeId: '', assignee: 'Paul', dueDate: '', doneAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'x', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'x' },
      }),
    );
    const legacy = (await env.call('GET', `/projects/${id}`)).json.items.tasks.find((x: any) => x.id === 'ancienne');
    expect(legacy).toMatchObject({ status: 'termine', done: true, doneAt: '2026-01-02T00:00:00.000Z', number: 4, sprintId: null });
    expect(legacy.priority).toBe('haute'); // la priorité des anciennes tâches est reprise
    expect(legacy).toMatchObject({ estimatedHours: null, spentHours: null });
    const renamed = await env.call('PATCH', `/projects/${id}/items/tasks/ancienne`, { title: 'Ancienne tâche (renommée)' });
    expect(renamed.json).toMatchObject({ status: 'termine', done: true, doneAt: '2026-01-02T00:00:00.000Z', number: 4 });
    await env.call('DELETE', `/projects/${id}/items/tasks/ancienne`);
  });

  it('enregistre le temps estimé et le temps passé d’un ticket, indépendamment', async () => {
    const t = await env.call('POST', `/projects/${id}/items/tasks`, { title: 'Paramétrer les tarifs', estimatedHours: 6 });
    expect(t.status).toBe(201);
    expect(t.json).toMatchObject({ estimatedHours: 6, spentHours: null });
    const spent = await env.call('PATCH', `/projects/${id}/items/tasks/${t.json.id}`, { spentHours: 7.3 });
    expect(spent.json).toMatchObject({ estimatedHours: 6, spentHours: 7.25 }); // arrondi au quart d'heure
    expect((await env.call('PATCH', `/projects/${id}/items/tasks/${t.json.id}`, { spentHours: -1 })).status).toBe(400);
    const cleared = await env.call('PATCH', `/projects/${id}/items/tasks/${t.json.id}`, { estimatedHours: null });
    expect(cleared.json).toMatchObject({ estimatedHours: null, spentHours: 7.25 });
    const { json: o } = await env.call('GET', '/sprints');
    expect(o.tickets.find((x: any) => x.id === t.json.id)).toMatchObject({ estimatedHours: null, spentHours: 7.25 });
    await env.call('DELETE', `/projects/${id}/items/tasks/${t.json.id}`);
  });

  it('liste les tickets ouverts de tous les projets et l’activité récente', async () => {
    const { json: open } = await env.call('GET', '/sprints');
    expect(open.tickets).toHaveLength(1);
    expect(open.tickets[0]).toMatchObject({ title: 'Préparer la recette', projectId: id, projectName: 'Migration Coliéco', number: 2 });
    const { json: activity } = await env.call('GET', '/activity');
    expect(activity.length).toBeGreaterThan(5);
    expect(activity[0].at >= activity[1].at).toBe(true);
  });

  it('dépose, confirme et télécharge une pièce jointe', async () => {
    const res = await env.call('POST', `/projects/${id}/files`, { name: 'Devis Coqliqo.pdf', contentType: 'application/pdf', size: 9, category: 'devis' });
    expect(res.status).toBe(201);
    const fileId = res.json.file.id;
    const early = await env.call('POST', `/projects/${id}/files/${fileId}/confirm`);
    expect(early.status).toBe(400);
    const key = decodeURIComponent(res.json.upload.url.slice('/local-blob/'.length));
    await env.store.put(key, Buffer.from('%PDF-1.4\n'), 'application/pdf');
    const ok = await env.call('POST', `/projects/${id}/files/${fileId}/confirm`);
    expect(ok.json.uploaded).toBe(true);
    const dl = await env.call('GET', `/projects/${id}/files/${fileId}/download`);
    expect(dl.json.fileName).toBe('Devis Coqliqo.pdf');
    const { json: p } = await env.call('GET', `/projects/${id}`);
    expect(p.stats.files).toBe(1);
    const generic = await env.call('POST', `/projects/${id}/items/files`, { name: 'x' });
    expect(generic.status).toBe(400);
  });

  it('analyse un compte rendu et applique les propositions retenues', async () => {
    const start = await env.call('POST', `/projects/${id}/digest`, { title: 'Point hebdo', text: MEETING });
    expect(start.status).toBe(202);
    const job = await env.waitJob(start.json.id);
    expect(job.error).toBe('');
    expect(job.status).toBe('termine');

    const { json: p } = await env.call('GET', `/projects/${id}`);
    const note = p.items.notes.find((n: any) => n.kind === 'compte_rendu');
    expect(note).toMatchObject({ title: 'Point hebdo', origin: 'ia', hasSource: true });
    expect(note.content).toContain('## Décisions');
    expect(note.suggestions.tasks.length).toBeGreaterThan(0);
    const source = await env.call('GET', `/projects/${id}/notes/${note.id}/source`);
    expect(source.json.text).toContain('Coqliqo');

    const before = p.items.tasks.length;
    const applied = await env.call('POST', `/projects/${id}/notes/${note.id}/suggestions`, { tasks: [0], risks: [0] });
    expect(applied.status).toBe(200);
    expect(applied.json.items.tasks.length).toBe(before + 1);
    expect(applied.json.items.risks.length).toBe(2);
    const after = applied.json.items.notes.find((n: any) => n.id === note.id);
    expect(after.suggestions.tasks[0].state).toBe('acceptee');
    expect(after.suggestions.tasks.slice(1).every((t: any) => t.state === 'refusee')).toBe(true);
    // Une seconde validation ne recrée rien.
    const again = await env.call('POST', `/projects/${id}/notes/${note.id}/suggestions`, { tasks: [0] });
    expect(again.json.items.tasks.length).toBe(before + 1);
  });

  it('rédige un rapport d’avancement', async () => {
    const start = await env.call('POST', `/projects/${id}/report`);
    const job = await env.waitJob(start.json.id);
    expect(job.error).toBe('');
    const { json: p } = await env.call('GET', `/projects/${id}`);
    const report = p.items.notes.find((n: any) => n.kind === 'rapport');
    expect(report.content).toContain('## Synthèse');
    expect(['vert', 'orange', 'rouge']).toContain(report.suggestedHealth);
    const { json: usage } = await env.call('GET', '/usage');
    expect(usage.byOperation.map((r: any) => r.key)).toEqual(expect.arrayContaining(['projet_compte_rendu', 'projet_rapport']));
  });

  it('génère un cahier des charges à partir du projet', async () => {
    const { json: p } = await env.call('GET', `/projects/${id}`);
    const presta = p.items.prestations.find((x: any) => x.objet === 'Offre Essentiel');
    const note = p.items.notes.find((n: any) => n.kind === 'compte_rendu');
    const res = await env.call('POST', `/projects/${id}/cdcs`, { prestationId: presta.id, noteIds: [note.id] });
    expect(res.status).toBe(201);
    const job = await env.waitJob(res.json.job.id);
    expect(job.error).toBe('');

    const { json: cdc } = await env.call('GET', `/cdcs/${res.json.id}`);
    expect(cdc.projectId).toBe(id);
    expect(cdc.document.meta).toMatchObject({ title: 'Migration Coliéco — Offre Essentiel', projet: 'Migration Coliéco', prestataire: 'Coqliqo', estimationJours: 8, phase: 'developpement' });
    expect(cdc.document.meta.jalons.map((j: any) => j.label)).toContain('Mise en production');
    expect(cdc.currentVersion.label).toBe('0.2');
    // Aucune transcription : pas de source enregistrée.
    const { json: sources } = await env.call('GET', `/cdcs/${res.json.id}/sources`);
    expect(sources).toHaveLength(0);

    const { json: p2 } = await env.call('GET', `/projects/${id}`);
    expect(p2.cdcs.map((c: any) => c.id)).toEqual([res.json.id]);
    expect(p2.items.prestations.find((x: any) => x.id === presta.id).cdcId).toBe(res.json.id);
    const { json: list } = await env.call('GET', '/projects');
    expect(list.find((x: any) => x.id === id).cdcCount).toBe(1);
  });

  it('crée un CDC vide pré-rempli, ou avec une transcription', async () => {
    const empty = await env.call('POST', `/projects/${id}/cdcs`, { title: 'Lot 2', withAi: false });
    expect(empty.json.job).toBeNull();
    const withTranscript = await env.call('POST', `/projects/${id}/cdcs`, { title: 'Lot 3', transcript: MEETING });
    const job = await env.waitJob(withTranscript.json.job.id);
    expect(job.error).toBe('');
    const { json: sources } = await env.call('GET', `/cdcs/${withTranscript.json.id}/sources`);
    expect(sources).toHaveLength(1);
  });

  it('rattache et détache un CDC existant, et le conserve à la suppression du projet', async () => {
    const legacy = await env.call('POST', '/cdcs', { meta: { title: 'Ancien CDC' } });
    const att = await env.call('PATCH', `/cdcs/${legacy.json.id}/project`, { projectId: id });
    expect(att.json.projectId).toBe(id);
    const { json: p } = await env.call('GET', `/projects/${id}`);
    expect(p.cdcs).toHaveLength(4);

    const del = await env.call('DELETE', `/projects/${id}`);
    expect(del.status).toBe(204);
    expect((await env.call('GET', `/projects/${id}`)).status).toBe(404);
    const { json: cdc } = await env.call('GET', `/cdcs/${legacy.json.id}`);
    expect(cdc.projectId).toBeNull();
    const { json: open } = await env.call('GET', '/sprints');
    expect(open.tickets).toHaveLength(0);
  });
});

function pick(p: any) {
  const { name, code, status, priority, health, healthComment, chefDeProjetIds, chefDeProjet, demandeur, startDate, targetDate, description, sections, budgetPrevu, tags } = p;
  return { name, code, status, priority, health, healthComment, chefDeProjetIds, chefDeProjet, demandeur, startDate, targetDate, description, sections, budgetPrevu, tags };
}
