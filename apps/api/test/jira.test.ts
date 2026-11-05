import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';
import { setJiraFetch } from '../src/jira/client.js';
import { demoJiraFetch } from '../src/jira/demo.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => {
  setJiraFetch(null);
  await env.close();
});

describe('module Jira (revue de sprint)', () => {
  let projectId = '';

  it('n’est pas connecté au départ', async () => {
    const { json } = await env.call('GET', '/jira/config');
    expect(json).toMatchObject({ configured: false, site: '', tokenHint: '', demoAvailable: true });
    expect((await env.call('GET', '/jira/boards?project=TC')).status).toBe(400);
    expect((await env.call('PUT', '/jira/config', { site: 'http://intranet.local', email: 'a@b.fr', token: 'x' })).status).toBe(400);
    expect((await env.call('PUT', '/jira/config', { site: 'monentreprise', email: 'a@b.fr' })).status).toBe(400); // jeton manquant
  });

  it('teste la connexion avant de l’enregistrer, sans jamais renvoyer le jeton', async () => {
    const calls: { url: string; auth: string }[] = [];
    setJiraFetch(async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization ?? '' });
      if (init.headers.Authorization !== `Basic ${Buffer.from('a@b.fr:bon-jeton-1234').toString('base64')}`) return new Response('{}', { status: 401 });
      return demoJiraFetch(url, init);
    });
    const refused = await env.call('PUT', '/jira/config', { site: 'monentreprise', email: 'a@b.fr', token: 'mauvais' });
    expect(refused.status).toBe(400);
    expect(refused.json.error).toMatch(/jeton/);
    expect((await env.call('GET', '/jira/config')).json.configured).toBe(false);

    const ok = await env.call('PUT', '/jira/config', { site: 'https://monentreprise.atlassian.net/jira', email: 'a@b.fr', token: 'bon-jeton-1234' });
    expect(ok.status).toBe(200);
    expect(calls.every((c) => c.url.startsWith('https://monentreprise.atlassian.net/'))).toBe(true);
    expect(ok.json.config).toMatchObject({
      configured: true,
      site: 'https://monentreprise.atlassian.net',
      tokenHint: '…1234',
      accountName: 'Compte de démonstration',
      storyPoints: { id: 'customfield_10016', name: 'Story point estimate' },
      deskRef: { id: 'customfield_10050', name: 'Réf Ticket Desk' },
    });
    expect(JSON.stringify(ok.json)).not.toContain('bon-jeton');
    expect(ok.json.test.fields.map((f: any) => f.name)).toContain('Équipe');
    // Jeton vide : l'existant est conservé ; choix manuel d'un champ.
    const kept = await env.call('PUT', '/jira/config', { site: 'monentreprise', email: 'a@b.fr', token: '', deskRefField: 'customfield_10060' });
    expect(kept.json.config).toMatchObject({ tokenHint: '…1234', deskRef: { name: 'Équipe' } });
    await env.call('PUT', '/jira/config', { site: 'monentreprise', email: 'a@b.fr', deskRefField: 'customfield_10050' });
  });

  it('liste les tableaux et les sprints du projet', async () => {
    const boards = await env.call('GET', '/jira/boards?project=tc');
    expect(boards.json).toEqual([{ id: 7, name: 'Tableau TC', type: 'scrum', projectKey: 'TC' }]);
    const sprints = await env.call('GET', '/jira/boards/7/sprints');
    expect(sprints.json.map((s: any) => [s.name, s.state, s.syncedAt])).toEqual([
      ['TC Sprint 5', 'future', null],
      ['TC Sprint 4', 'active', null],
      ['TC Sprint 3', 'closed', null],
    ]);
    expect((await env.call('GET', '/jira/boards/99/sprints')).status).toBe(404);
  });

  it('relie un projet du hub à un tableau Jira', async () => {
    const created = await env.call('POST', '/projects', { name: 'Refonte du tunnel de commande' });
    projectId = created.json.id;
    expect(created.json).toMatchObject({ jiraProjectKey: '', jiraBoardId: null });
    const res = await env.call('PUT', `/projects/${projectId}`, {
      rev: created.json.rev,
      fields: { ...pick(created.json), jiraProjectKey: 'tc', jiraBoardId: 7 },
    });
    expect(res.json).toMatchObject({ jiraProjectKey: 'TC', jiraBoardId: 7 });
  });

  it('synchronise un sprint et calcule la revue', async () => {
    // Un ticket Desk du suivi TMA cité par un ticket Jira apparaît avec son sujet.
    await env.call('POST', '/tma/desk/import', {
      tickets: [{ id: '11375', subject: 'Commandes marketplace non importées', createdAt: '2026-10-25T10:00', status: 'Ouvert' }],
    });
    const sync = await env.call('POST', '/jira/sprints/42/sync', { boardId: 7, projectKey: 'TC' });
    expect(sync.status).toBe(200);
    const r = sync.json.report;
    expect(r.sprint).toMatchObject({ name: 'TC Sprint 4', state: 'active' });
    expect(r.counts).toMatchObject({ total: 14, active: 12, removed: 2, atStart: 9, added: 4, addedDone: 0, done: 6, recette: 3, overdue: 3, withPoints: 5 });
    expect(r.points).toEqual({ active: 8.5, done: 2, removed: 2 });
    expect(r.team).toEqual(['Alice Martin', 'Bruno Petit']);
    const tc355 = r.issues.find((i: any) => i.key === 'TC-355');
    expect(tc355).toMatchObject({ active: false, movement: { kind: 'retire', at: '2026-10-20', to: 'TC Sprint 5' } });
    expect(r.issues.find((i: any) => i.key === 'TC-361').movement).toMatchObject({ kind: 'retire', to: 'Backlog' });
    expect(r.issues.find((i: any) => i.key === 'TC-329').movement).toEqual({ kind: 'report', from: 'TC Sprint 3' });
    expect(r.attention.some((a: any) => a.title === 'Aucune clôture depuis le 28/10')).toBe(true);
    expect(r.dataQuality.map((a: any) => a.title)).toContain('Type unique « Feature »');
    expect(sync.json.desk).toEqual({ '11375': { subject: 'Commandes marketplace non importées', status: 'Ouvert', theme: '' } });
    expect(sync.json.site).toBe('https://monentreprise.atlassian.net');

    const list = await env.call('GET', '/jira/boards/7/sprints');
    expect(list.json.find((s: any) => s.id === 42)).toMatchObject({ issueCount: 14, hasCompteRendu: false });
    expect((await env.call('GET', '/jira/sprints/42')).json.report.counts.active).toBe(12);
    expect((await env.call('GET', '/jira/sprints/41')).status).toBe(404); // pas encore synchronisé

    const closed = await env.call('POST', '/jira/sprints/41/sync', { boardId: 7 });
    expect(closed.json.report.counts).toMatchObject({ active: 10, done: 2, removed: 0 });
    expect(closed.json.report.asOfDay).toBe('2026-10-14');
  });

  it('rédige, corrige et publie le compte rendu dans le journal du projet', async () => {
    expect((await env.call('POST', `/jira/sprints/42/journal`, { projectId })).status).toBe(400); // pas encore de compte rendu
    const start = await env.call('POST', '/jira/sprints/42/compte-rendu');
    expect(start.status).toBe(202);
    const job = await env.waitJob(start.json.id);
    expect(job).toMatchObject({ status: 'termine', step: 'Compte rendu rédigé' });
    const detail = (await env.call('GET', '/jira/sprints/42')).json;
    expect(detail.compteRendu.markdown).toContain('## Message clé');
    expect(detail.compteRendu.markdown).toContain('TC-367');
    expect(detail.activeJobId).toBeNull();

    const edited = await env.call('PUT', '/jira/sprints/42/compte-rendu', { markdown: '## Message clé\n\nSprint chargé, ESS en retard.' });
    expect(edited.json.compteRendu).toMatchObject({ markdown: '## Message clé\n\nSprint chargé, ESS en retard.', editedBy: 'alice@test' });

    const note = await env.call('POST', '/jira/sprints/42/journal', { projectId });
    expect(note.status).toBe(201);
    expect(note.json).toMatchObject({ kind: 'compte_rendu', title: 'Revue du TC Sprint 4', origin: 'manuel' });
    expect(note.json.content).toContain('**Story points** : 2 livrés sur 8.5');
    expect(note.json.content).toContain('ESS en retard');
    const project = (await env.call('GET', `/projects/${projectId}`)).json;
    expect(project.items.notes).toHaveLength(1);

    // Une nouvelle synchronisation conserve le compte rendu.
    await env.call('POST', '/jira/sprints/42/sync', { boardId: 7 });
    expect((await env.call('GET', '/jira/sprints/42')).json.compteRendu.editedBy).toBe('alice@test');
    expect((await env.call('GET', '/usage')).json.byOperation.map((o: any) => o.key)).toContain('jira_compte_rendu');
  });

  it('traduit les erreurs de Jira en messages clairs', async () => {
    setJiraFetch(async () => new Response(JSON.stringify({ errorMessages: ['Trop de requêtes'] }), { status: 429 }));
    const res = await env.call('GET', '/jira/boards?project=TC');
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/réessayez dans une minute/);
    setJiraFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect((await env.call('GET', '/jira/boards')).json.error).toMatch(/injoignable/);
    setJiraFetch(demoJiraFetch);
  });
});

/** Champs de la fiche projet (sans les attributs calculés). */
function pick(p: Record<string, unknown>) {
  const keys = ['name', 'code', 'status', 'priority', 'health', 'healthComment', 'chefDeProjet', 'demandeur', 'startDate', 'targetDate', 'description', 'objectifs', 'horsPerimetre', 'budgetPrevu', 'tags'];
  return Object.fromEntries(keys.map((k) => [k, p[k]]));
}
