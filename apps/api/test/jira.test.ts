import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';
import { setJiraFetch } from '../src/jira/client.js';
import { demoJiraFetch } from '../src/jira/demo.js';
import { BedrockProvider } from '../src/ai/bedrock.js';
import { config } from '../src/config.js';
import { sprintDocCall } from '../src/jira/jobs.js';
import { SPRINT_REVIEW_SYSTEM } from '../src/jira/prompts.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => {
  setJiraFetch(null);
  await env.close();
});

describe('module Jira (import, rattachement, documents de sprint)', () => {
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

  it('choisit les tableaux suivis puis importe sprints et tickets', async () => {
    const boards = await env.call('GET', '/jira/boards?project=tc');
    expect(boards.json).toEqual([{ id: 7, name: 'Tableau TC', type: 'scrum', projectKey: 'TC' }]);
    expect((await env.call('POST', '/jira/import')).status).toBe(400); // aucun tableau choisi
    expect((await env.call('PUT', '/jira/boards', { boardIds: [99] })).status).toBe(404);
    const chosen = await env.call('PUT', '/jira/boards', { boardIds: [7] });
    expect(chosen.json).toMatchObject({ configured: true, boards: [{ id: 7, name: 'Tableau TC' }], syncedAt: null, tasks: [] });

    // Un ticket Desk du suivi TMA cité par un ticket Jira apparaît avec son sujet dans la revue.
    await env.call('POST', '/tma/desk/import', {
      tickets: [{ id: '11375', subject: 'Commandes marketplace non importées', createdAt: '2026-10-25T10:00', status: 'Ouvert' }],
    });
    const imp = await env.call('POST', '/jira/import');
    expect(imp.status).toBe(200);
    expect(imp.json.syncedBy).toBe('alice@test');
    expect(imp.json.sprints.map((s: any) => [s.name, s.state, s.boardName])).toEqual([
      ['TC Sprint 4', 'active', 'Tableau TC'],
      ['TC Sprint 5', 'future', 'Tableau TC'],
      ['TC Sprint 3', 'closed', 'Tableau TC'],
    ]);
    const s5 = imp.json.sprints.find((s: any) => s.id === 43);
    expect(s5).toMatchObject({ issueCount: 5, openCount: 5, points: 10, hasPreparation: false });
    const tasks = imp.json.tasks;
    // Sprints 3 à 5 + backlog (dont TC-361, sorti du sprint 4).
    expect(tasks.map((t: any) => t.key).sort()).toEqual(expect.arrayContaining(['TC-320', 'TC-361', 'TC-380', 'TC-390', 'TC-391', 'TC-392']));
    expect(tasks).toHaveLength(23); // tous les tickets du Jira de démonstration
    expect(tasks.find((t: any) => t.key === 'TC-390')).toMatchObject({ sprintIds: [], statusCategory: 'new', parent: 'TC-301 Paiements', projectId: null, boardId: 7 });
    expect(tasks.find((t: any) => t.key === 'TC-367')).toMatchObject({ assigneeEmail: 'alice.martin@exemple.fr', sprintIds: [42], storyPoints: 5 });
    expect(JSON.stringify(imp.json)).not.toContain('changelog');
  });

  it('relie des tickets à un projet sans pouvoir les modifier', async () => {
    projectId = (await env.call('POST', '/projects', { name: 'Refonte du tunnel de commande' })).json.id;
    expect((await env.call('PUT', '/jira/links', { keys: ['TC-367'], projectId: 'inconnu' })).status).toBe(404);
    expect((await env.call('PUT', '/jira/links', { keys: ['TC-367', 'TC-380', 'TC-390'], projectId })).json).toEqual({ updated: 3 });
    const linked = await env.call('GET', `/jira/tasks?projectId=${projectId}`);
    expect(linked.json.map((t: any) => [t.key, t.projectName])).toEqual([
      ['TC-367', 'Refonte du tunnel de commande'],
      ['TC-380', 'Refonte du tunnel de commande'],
      ['TC-390', 'Refonte du tunnel de commande'],
    ]);
    await env.call('PUT', '/jira/links', { keys: ['TC-390'], projectId: null });
    expect((await env.call('GET', `/jira/tasks?projectId=${projectId}`)).json).toHaveLength(2);
    // Un nouvel import conserve les rattachements.
    await env.call('POST', '/jira/import');
    expect((await env.call('GET', '/jira/overview')).json.tasks.find((t: any) => t.key === 'TC-367').projectId).toBe(projectId);
  });

  it('calcule la revue d’un sprint en cours', async () => {
    const res = await env.call('GET', '/jira/sprints/42');
    expect(res.status).toBe(200);
    const r = res.json.report;
    expect(r.sprint).toMatchObject({ name: 'TC Sprint 4', state: 'active' });
    expect(r.counts).toMatchObject({ total: 14, active: 12, removed: 2, atStart: 9, added: 4, addedDone: 0, done: 6, recette: 3, overdue: 3, withPoints: 5 });
    expect(r.points).toEqual({ active: 8.5, done: 2, removed: 2 });
    expect(r.team).toEqual(['Alice Martin', 'Bruno Petit']);
    expect(r.issues.find((i: any) => i.key === 'TC-355')).toMatchObject({ active: false, movement: { kind: 'retire', at: '2026-10-20', to: 'TC Sprint 5' } });
    expect(r.issues.find((i: any) => i.key === 'TC-361').movement).toMatchObject({ kind: 'retire', to: 'Backlog' });
    expect(r.issues.find((i: any) => i.key === 'TC-329').movement).toEqual({ kind: 'report', from: 'TC Sprint 3' });
    expect(r.attention.some((a: any) => a.title === 'Aucune clôture depuis le 28/10')).toBe(true);
    expect(r.dataQuality.map((a: any) => a.title)).toContain('Type unique « Feature »');
    expect(res.json.desk).toEqual({ '11375': { subject: 'Commandes marketplace non importées', status: 'Ouvert', theme: '' } });
    expect(res.json.site).toBe('https://monentreprise.atlassian.net');
    expect(res.json.projects).toEqual([{ id: projectId, name: 'Refonte du tunnel de commande', count: 1 }]);
    expect(res.json.preparation.planned).toHaveLength(12);

    const closed = await env.call('GET', '/jira/sprints/41');
    expect(closed.json.report.counts).toMatchObject({ active: 10, done: 2, removed: 0 });
    expect(closed.json.report.asOfDay).toBe('2026-10-14');
    expect(closed.json.preparation).toBeNull();
    expect((await env.call('GET', '/jira/sprints/99')).status).toBe(404);
  });

  it('calcule la préparation d’un sprint à venir', async () => {
    const res = await env.call('GET', '/jira/sprints/43');
    expect(res.json.report).toBeNull();
    const p = res.json.preparation;
    expect(p.planned.map((i: any) => i.key)).toEqual(['TC-380', 'TC-355', 'TC-381', 'TC-382', 'TC-383']) // priorité, puis échéance;
    expect(p.totals).toMatchObject({ count: 5, open: 5, points: 10, unassigned: 1, unestimated: 1 });
    expect(p.history).toEqual([{ name: 'TC Sprint 3', done: 2, points: 3, active: 10 }]);
    expect(p.velocity).toEqual({ points: 3, done: 2 });
    expect(p.carryOverFrom).toBe('TC Sprint 4');
    expect(p.carryOver.map((i: any) => i.key)).toEqual(expect.arrayContaining(['TC-367', 'TC-375', 'TC-365']));
    expect(p.backlog.map((i: any) => i.key)).toEqual(['TC-390', 'TC-361', 'TC-392', 'TC-391']);
    expect(p.planned.find((i: any) => i.key === 'TC-380').project).toBe('Refonte du tunnel de commande');
    const titles = p.alerts.map((a: any) => a.title);
    expect(titles).toEqual(expect.arrayContaining(['Charge supérieure à la vélocité', 'Tickets à estimer', 'Tickets sans responsable', 'Urgences restées au backlog', 'Reports probables du TC Sprint 4']));
  });

  it('rédige, corrige, exporte et publie les documents de sprint', async () => {
    expect((await env.call('POST', '/jira/sprints/42/documents/compte_rendu/journal', { projectId })).status).toBe(400); // pas encore rédigé
    expect((await env.call('POST', '/jira/sprints/43/documents/compte_rendu')).status).toBe(400); // sprint à venir
    expect((await env.call('POST', '/jira/sprints/41/documents/preparation')).status).toBe(400); // sprint clos
    expect((await env.call('POST', '/jira/sprints/42/documents/bilan')).status).toBe(404);

    const start = await env.call('POST', '/jira/sprints/42/documents/compte_rendu');
    expect(start.status).toBe(202);
    expect(await env.waitJob(start.json.id)).toMatchObject({ status: 'termine', step: 'Compte rendu rédigé' });
    const detail = (await env.call('GET', '/jira/sprints/42')).json;
    expect(detail.documents.compte_rendu.markdown).toContain('## Message clé');
    expect(detail.documents.compte_rendu.markdown).toContain('TC-367');
    expect(detail.documents.preparation).toBeNull();
    expect(detail.activeJobId).toBeNull();

    const edited = await env.call('PUT', '/jira/sprints/42/documents/compte_rendu', { markdown: '## Message clé\n\nSprint chargé, ESS en retard.' });
    expect(edited.json.documents.compte_rendu).toMatchObject({ markdown: '## Message clé\n\nSprint chargé, ESS en retard.', editedBy: 'alice@test' });

    const note = await env.call('POST', '/jira/sprints/42/documents/compte_rendu/journal', { projectId });
    expect(note.status).toBe(201);
    expect(note.json).toMatchObject({ kind: 'compte_rendu', title: 'Revue du TC Sprint 4', origin: 'manuel' });
    expect(note.json.content).toContain('**Story points** : 2 livrés sur 8.5');
    expect(note.json.content).toContain('ESS en retard');

    const prep = await env.call('POST', '/jira/sprints/43/documents/preparation');
    expect(await env.waitJob(prep.json.id)).toMatchObject({ status: 'termine', step: 'Préparation rédigée' });
    const p = (await env.call('GET', '/jira/sprints/43')).json.documents.preparation;
    expect(p.markdown).toContain('## Points à clarifier avant le lancement');
    expect(p.markdown).toContain('TC-380');
    const word = await env.call('POST', '/jira/sprints/43/documents/preparation/word');
    expect(word.json.fileName).toBe('Préparation du sprint — TC Sprint 5.docx');
    const prepNote = await env.call('POST', '/jira/sprints/43/documents/preparation/journal', { projectId });
    expect(prepNote.json).toMatchObject({ kind: 'info', title: 'Préparation du TC Sprint 5', origin: 'ia' });
    expect((await env.call('GET', `/projects/${projectId}`)).json.items.notes).toHaveLength(2);

    // Un nouvel import conserve les documents.
    await env.call('POST', '/jira/import');
    const overview = (await env.call('GET', '/jira/overview')).json;
    expect(overview.sprints.find((s: any) => s.id === 42)).toMatchObject({ hasCompteRendu: true, hasPreparation: false });
    expect(overview.sprints.find((s: any) => s.id === 43)).toMatchObject({ hasPreparation: true });
    expect((await env.call('GET', '/jira/sprints/42')).json.documents.compte_rendu.editedBy).toBe('alice@test');
    expect((await env.call('GET', '/usage')).json.byOperation.map((o: any) => o.key)).toEqual(expect.arrayContaining(['jira_compte_rendu', 'jira_preparation']));
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

  it('rattache automatiquement les tickets de l’épopée dont la clé est le code du projet', async () => {
    const ess = (await env.call('POST', '/projects', { name: 'Offre ESS', code: 'tc-300' })).json.id;
    const pay = (await env.call('POST', '/projects', { name: 'Paiements', code: 'TC-301' })).json.id;
    await env.call('POST', '/jira/import');
    const byKey = async () => Object.fromEntries((await env.call('GET', '/jira/overview')).json.tasks.map((t: any) => [t.key, t]));
    let t = await byKey();
    // TC-382 est dans l'épopée TC-301 : rattaché sans rien faire.
    expect(t['TC-382']).toMatchObject({ projectId: pay, projectName: 'Paiements', linkSource: 'epopee', linkEpic: 'TC-301' });
    // Un choix manuel l'emporte sur l'épopée…
    expect(t['TC-367']).toMatchObject({ projectId, linkSource: 'manuel' });
    // … et un ticket détaché à la main le reste.
    expect(t['TC-390']).toMatchObject({ projectId: null, linkSource: null });
    expect(t['TC-320']).toMatchObject({ projectId: null, linkSource: null }); // sans épopée
    expect((await env.call('GET', `/jira/tasks?projectId=${pay}`)).json.map((x: any) => x.key)).toEqual(['TC-382']);

    // Retour au rattachement automatique.
    await env.call('PUT', '/jira/links', { keys: ['TC-367', 'TC-390'], projectId: 'auto' });
    t = await byKey();
    expect(t['TC-367']).toMatchObject({ projectId: ess, linkSource: 'epopee', linkEpic: 'TC-300' });
    expect(t['TC-390']).toMatchObject({ projectId: pay, linkSource: 'epopee' });
    // Détacher un ticket rattaché par l'épopée : retenu, même après un nouvel import.
    await env.call('PUT', '/jira/links', { keys: ['TC-382'], projectId: null });
    await env.call('POST', '/jira/import');
    expect((await byKey())['TC-382']).toMatchObject({ projectId: null, linkSource: null });
    // Changer le code du projet change le rattachement.
    const p = (await env.call('GET', `/projects/${pay}`)).json;
    await env.call('PUT', `/projects/${pay}`, { rev: p.rev, fields: { name: p.name, code: '' } });
    expect((await byKey())['TC-390'].projectId).toBeNull();
    await env.call('DELETE', `/projects/${ess}`);
    await env.call('DELETE', `/projects/${pay}`);
  });

  it('exporte la requête exacte qui serait envoyée à Bedrock, sans appeler le modèle', async () => {
    const usageBefore = (await env.call('GET', '/usage')).json.calls;
    const res = await env.call('GET', '/jira/sprints/42/documents/compte_rendu/prompt');
    expect(res.status).toBe(200);
    const e = res.json;
    expect(e.model).toBe(config.modelSmart);
    expect(e.url).toMatch(/\/anthropic\/v1\/messages$/);
    expect(e.body).toMatchObject({ model: config.modelSmart, max_tokens: 4000, output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(e.body.system[0]).toEqual({ type: 'text', text: SPRINT_REVIEW_SYSTEM, cache_control: { type: 'ephemeral' } });
    expect(e.body.messages[0].content).toContain('<chiffres_du_sprint>\n# TC Sprint 4 (en cours)');
    expect(e.text).toContain('=== SYSTÈME ===');
    expect(e.text).toContain('=== UTILISATEUR ===');
    expect((await env.call('GET', '/usage')).json.calls).toBe(usageBefore); // aucun appel IA

    // Identique, à l'octet près, à ce qu'envoie le fournisseur Bedrock pour le même appel.
    let sent: any = null;
    const provider = new BedrockProvider({
      skipAuth: true,
      maxRetries: 0,
      fetch: (async (_url: unknown, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: '{"markdown":"ok"}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    });
    await provider.structured(await sprintDocCall('compte_rendu', 42, { user: 'alice@test', cdcId: '42' }), config.modelSmart);
    expect(sent).toEqual(e.body);

    const prep = await env.call('GET', '/jira/sprints/43/documents/preparation/prompt');
    expect(prep.json.body.messages[0].content).toContain('<preparation_du_sprint>');
    expect((await env.call('GET', '/jira/sprints/42/documents/bilan/prompt')).status).toBe(404);
  });

  it('importe les tableaux des projets gérés par l’équipe et signale les tableaux sans sprints', async () => {
    const boards = await env.call('GET', '/jira/boards');
    expect(boards.json.map((b: any) => [b.name, b.type])).toEqual([['Tableau TC', 'scrum'], ['Tableau EQ', 'simple'], ['Support KB', 'kanban']]);
    // Le type « simple » (projet géré par l'équipe) n'empêche pas d'avoir des sprints.
    expect((await env.call('PUT', '/jira/boards', { boardIds: [7, 8, 9] })).status).toBe(200);
    const imp = await env.call('POST', '/jira/import');
    expect(imp.status).toBe(200);
    expect(imp.json.sprints.find((s: any) => s.name === 'EQ Sprint 1')).toMatchObject({ state: 'active', boardName: 'Tableau EQ', issueCount: 0 });
    expect(imp.json.sprints.filter((s: any) => s.boardId === 7)).toHaveLength(3);
    expect(imp.json.warnings).toEqual([expect.stringContaining('« Support KB » : Jira ne gère pas de sprints')]);
    await env.call('PUT', '/jira/boards', { boardIds: [7] });
  });
});
