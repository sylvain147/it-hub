import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
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
    const res = await env.call('POST', '/projects', { name: 'Migration Coliéco', code: 'COL-27', description: 'La Poste arrête l’offre **Coliéco** en janvier 2027.', objectifs: '- Basculer vers l’offre Essentiel' });
    expect(res.status).toBe(201);
    id = res.json.id;
    expect(res.json).toMatchObject({ status: 'cadrage', priority: 'normale', health: 'vert', rev: 1 });
    expect(res.json.activity[0].text).toBe('a créé le projet');
  });

  it('modifie la fiche avec verrouillage optimiste', async () => {
    const { json: p } = await env.call('GET', `/projects/${id}`);
    const fields = { ...pick(p), status: 'en_cours', health: 'orange', healthComment: 'Devis en attente', targetDate: '2027-01-15' };
    const ok = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ rev: 2, status: 'en_cours', health: 'orange' });
    const stale = await env.call('PUT', `/projects/${id}`, { rev: p.rev, fields }, 'bob@test');
    expect(stale.status).toBe(409);
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
    expect(legacy).not.toHaveProperty('priority');
    const renamed = await env.call('PATCH', `/projects/${id}/items/tasks/ancienne`, { title: 'Ancienne tâche (renommée)' });
    expect(renamed.json).toMatchObject({ status: 'termine', done: true, doneAt: '2026-01-02T00:00:00.000Z', number: 4 });
    await env.call('DELETE', `/projects/${id}/items/tasks/ancienne`);
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
  const { name, code, status, priority, health, healthComment, chefDeProjet, demandeur, startDate, targetDate, description, objectifs, horsPerimetre, budgetPrevu, tags } = p;
  return { name, code, status, priority, health, healthComment, chefDeProjet, demandeur, startDate, targetDate, description, objectifs, horsPerimetre, budgetPrevu, tags };
}
