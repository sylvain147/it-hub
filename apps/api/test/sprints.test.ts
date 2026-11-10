import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { setupTestEnv, TINY_PNG } from './helpers.js';
import { BedrockProvider } from '../src/ai/bedrock.js';
import { config } from '../src/config.js';
import { ddb } from '../src/db/client.js';
import { sprintDocCall } from '../src/sprints/jobs.js';
import { SPRINT_REVIEW_SYSTEM } from '../src/sprints/prompts.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => {
  await env.close();
});

/** Laisse passer quelques millisecondes : l'historique des tickets est horodaté. */
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('module Sprints (tickets, planification, tableau, documents)', () => {
  let p1 = '';
  let p2 = '';
  const ids: Record<string, string> = {};

  async function ticket(projectId: string, title: string, extra: Record<string, unknown> = {}) {
    const res = await env.call('POST', `/projects/${projectId}/items/tasks`, { title, ...extra });
    expect(res.status).toBe(201);
    ids[title] = res.json.id;
    return res.json;
  }
  const patch = (projectId: string, title: string, body: Record<string, unknown>) => env.call('PATCH', `/projects/${projectId}/items/tasks/${ids[title]}`, body);

  it('crée des tickets numérotés dans les projets, au backlog', async () => {
    await env.call('POST', '/users', { email: 'bruno@exemple.fr', name: 'Bruno Petit', role: 'membre' });
    p1 = (await env.call('POST', '/projects', { name: 'Portail fournisseurs' })).json.id;
    p2 = (await env.call('POST', '/projects', { name: 'Paie' })).json.id;
    const a = await ticket(p1, 'Maquettes');
    expect(a).toMatchObject({ number: 1, status: 'a_faire', sprintId: null, done: false, assigneeId: 'alice@test', statusChanges: [], sprintChanges: [] });
    await ticket(p1, 'API commandes', { assigneeId: 'bruno@exemple.fr', dueDate: '2020-01-10' });
    const c = await ticket(p2, 'Bulletin de décembre');
    expect(c.number).toBe(3);
    expect((await env.call('POST', `/projects/${p1}/items/tasks`, { title: 'X', status: 'fini' })).status).toBe(400);
    expect((await env.call('POST', `/projects/${p1}/items/tasks`, { title: 'X', sprintId: 99 })).status).toBe(400); // sprint inconnu

    const project = (await env.call('GET', `/projects/${p1}`)).json;
    expect(project.stats).toMatchObject({ openTasks: 2, doneTasks: 0 });
    expect(project.activity[0].text).toContain('a ajouté le ticket « T-2 API commandes »');
  });

  it('crée les sprints à la suite les uns des autres', async () => {
    const s1 = await env.call('POST', '/sprints', { goal: 'Ouvrir le portail en recette' });
    expect(s1.status).toBe(201);
    expect(s1.json).toMatchObject({ id: 1, name: 'Sprint 1', state: 'future', startedAt: null });
    expect(s1.json.endDate > s1.json.startDate).toBe(true);
    const s2 = await env.call('POST', '/sprints', { name: 'Sprint 2 — paie' });
    expect(s2.json).toMatchObject({ id: 2, name: 'Sprint 2 — paie' });
    expect(s2.json.startDate > s1.json.endDate).toBe(true);
    expect((await env.call('POST', '/sprints', { startDate: '2026-05-10', endDate: '2026-05-01' })).status).toBe(400);
    const s3 = await env.call('POST', '/sprints', {});
    expect((await env.call('DELETE', `/sprints/${s3.json.id}`)).status).toBe(204);
    expect((await env.call('GET', `/sprints/${s3.json.id}`)).status).toBe(404);
  });

  it('planifie les tickets dans un sprint et lance le sprint', async () => {
    await patch(p1, 'Maquettes', { sprintId: 1 });
    await patch(p1, 'API commandes', { sprintId: 1 });
    const moved = await patch(p2, 'Bulletin de décembre', { sprintId: 2 });
    expect(moved.json.sprintChanges).toEqual([{ at: expect.any(String), from: null, to: 2 }]);

    const o = (await env.call('GET', '/sprints')).json;
    expect(o.sprints.map((s: any) => [s.id, s.state, s.ticketCount])).toEqual([[1, 'future', 2], [2, 'future', 1]]);
    expect(o.tickets).toHaveLength(3);

    await tick();
    const started = await env.call('POST', '/sprints/1/start');
    expect(started.status).toBe(200);
    expect(started.json.sprint).toMatchObject({ state: 'active', startedAt: expect.any(String) });
    expect((await env.call('POST', '/sprints/1/start')).status).toBe(400);
    expect((await env.call('POST', '/sprints/2/start')).status).toBe(409); // un seul sprint en cours
    expect((await env.call('DELETE', '/sprints/1')).status).toBe(400);
  });

  it('fait avancer les tickets sur le tableau et calcule la revue du sprint', async () => {
    await tick();
    await patch(p1, 'Maquettes', { status: 'en_cours' });
    await tick();
    const done = await patch(p1, 'Maquettes', { status: 'termine' });
    expect(done.json).toMatchObject({ status: 'termine', done: true, doneAt: expect.any(String) });
    expect(done.json.statusChanges.map((c: any) => `${c.from}>${c.to}`)).toEqual(['a_faire>en_cours', 'en_cours>termine']);
    await patch(p1, 'API commandes', { status: 'attente' });
    // Ajouté en cours de sprint.
    await ticket(p2, 'Contrôle des cotisations', { sprintId: 1, status: 'recette' });

    const project = (await env.call('GET', `/projects/${p1}`)).json;
    expect(project.stats).toMatchObject({ openTasks: 1, doneTasks: 1 });
    expect(project.activity.map((a: any) => a.text)).toContain('a passé le ticket « T-1 Maquettes » au statut « Terminé »');
    expect(project.activity.map((a: any) => a.text)).toContain('a planifié le ticket « T-1 Maquettes » dans le sprint « Sprint 1 »');

    const d = (await env.call('GET', '/sprints/1')).json;
    expect(d.report.counts).toMatchObject({ total: 3, active: 3, atStart: 2, added: 1, done: 1, recette: 1, overdue: 1, removed: 0 });
    expect(d.report.issues.find((i: any) => i.key === 'T-4')).toMatchObject({ movement: { kind: 'cree' }, project: 'Paie', status: 'recette' });
    expect(d.report.issues.find((i: any) => i.key === 'T-1')).toMatchObject({ movement: { kind: 'lancement' }, doneDay: expect.any(String) });
    expect(d.report.attention.map((a: any) => a.title)).toEqual(expect.arrayContaining(['T-2 API commandes', 'Ajouts en cours de sprint']));
    expect(d.preparation.planned.map((i: any) => i.key)).toEqual(['T-2', 'T-1', 'T-4']);
    expect(d.projects.map((p: any) => p.name)).toEqual(['Portail fournisseurs', 'Paie']);
  });

  it('prépare le sprint suivant : reports probables et backlog', async () => {
    await ticket(p1, 'Recette utilisateurs', { dueDate: '2030-01-01' });
    const d = (await env.call('GET', '/sprints/2')).json;
    expect(d.report).toBeNull();
    const p = d.preparation;
    expect(p.planned.map((i: any) => i.key)).toEqual(['T-3']);
    expect(p.carryOverFrom).toBe('Sprint 1');
    expect(p.carryOver.map((i: any) => i.key)).toEqual(['T-2', 'T-4']);
    expect(p.backlog.map((i: any) => i.key)).toEqual(['T-5']);
    expect(p.alerts.map((a: any) => a.title)).toEqual(expect.arrayContaining(['Objectif non défini', 'Reports probables du Sprint 1']));
  });

  it('rédige, corrige, exporte et publie les documents de sprint', async () => {
    expect((await env.call('POST', '/sprints/1/documents/compte_rendu/journal', { projectId: p1 })).status).toBe(400); // pas encore rédigé
    expect((await env.call('POST', '/sprints/2/documents/compte_rendu')).status).toBe(400); // sprint à venir
    expect((await env.call('POST', '/sprints/1/documents/bilan')).status).toBe(404);

    const start = await env.call('POST', '/sprints/1/documents/compte_rendu');
    expect(start.status).toBe(202);
    expect((await env.waitJob(start.json.id)).status).toBe('termine');
    let detail = (await env.call('GET', '/sprints/1')).json;
    expect(detail.documents.compte_rendu.markdown).toContain('## Message clé');
    expect(detail.documents.compte_rendu.markdown).toContain('Tickets : 3 actifs');

    const edited = await env.call('PUT', '/sprints/1/documents/compte_rendu', { markdown: '## Message clé\n\nSprint tenu, API en attente.' });
    expect(edited.json.documents.compte_rendu).toMatchObject({ markdown: '## Message clé\n\nSprint tenu, API en attente.', editedBy: 'alice@test' });
    const note = await env.call('POST', '/sprints/1/documents/compte_rendu/journal', { projectId: p1 });
    expect(note.status).toBe(201);
    expect(note.json).toMatchObject({ kind: 'compte_rendu', title: 'Revue du Sprint 1', origin: 'manuel' });
    expect(note.json.content).toContain('1 clôturés sur 3');

    const prep = await env.call('POST', '/sprints/2/documents/preparation');
    expect((await env.waitJob(prep.json.id)).status).toBe('termine');
    detail = (await env.call('GET', '/sprints/2')).json;
    expect(detail.documents.preparation.markdown).toContain('## Objectif proposé');
    const word = await env.call('POST', '/sprints/2/documents/preparation/word');
    expect(word.json.fileName).toBe('Préparation du sprint — Sprint 2 — paie.docx');
  });

  it('clôt le sprint : les tickets non terminés passent au sprint suivant', async () => {
    expect((await env.call('POST', '/sprints/1/close', { moveTo: 1 })).status).toBe(400); // pas un sprint à venir
    await tick();
    const closed = await env.call('POST', '/sprints/1/close', { moveTo: 2 });
    expect(closed.status).toBe(200);
    expect(closed.json.moved).toBe(2);
    const r = closed.json.detail.report;
    expect(closed.json.detail.sprint.state).toBe('closed');
    // Les chiffres du sprint clos s'arrêtent avant le report des tickets.
    expect(r.counts).toMatchObject({ active: 3, removed: 0, done: 1 });
    expect(closed.json.detail.preparation).toBeNull();
    expect((await env.call('POST', '/sprints/1/documents/preparation')).status).toBe(400);
    expect((await patch(p1, 'Recette utilisateurs', { sprintId: 1 })).status).toBe(400); // sprint clos

    const o = (await env.call('GET', '/sprints')).json;
    expect(o.sprints.map((s: any) => [s.id, s.state, s.ticketCount])).toEqual([[2, 'future', 3], [1, 'closed', 1]]);
    expect(o.tickets.map((t: any) => t.number).sort()).toEqual([2, 3, 4, 5]); // les tickets terminés des sprints clos sortent de la vue

    await tick();
    await env.call('POST', '/sprints/2/start');
    const d2 = (await env.call('GET', '/sprints/2')).json;
    expect(d2.report.issues.find((i: any) => i.key === 'T-2').movement).toEqual({ kind: 'report', from: 'Sprint 1' });
    expect(d2.report.issues.find((i: any) => i.key === 'T-3').movement).toEqual({ kind: 'lancement' });
    expect(d2.preparation.history).toEqual([{ name: 'Sprint 1', done: 1, active: 3 }]);
  });

  it('exporte la requête exacte qui serait envoyée à Bedrock, sans appeler le modèle', async () => {
    // Sprint clos : chiffres figés, la requête est identique d'un appel à l'autre.
    const usageBefore = (await env.call('GET', '/usage')).json.calls;
    const res = await env.call('GET', '/sprints/1/documents/compte_rendu/prompt');
    expect(res.status).toBe(200);
    const e = res.json;
    expect(e.body).toMatchObject({ model: config.modelSmart, max_tokens: 4000, output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(e.body.system[0]).toEqual({ type: 'text', text: SPRINT_REVIEW_SYSTEM, cache_control: { type: 'ephemeral' } });
    expect(e.body.messages[0].content).toContain('<chiffres_du_sprint>\n# Sprint 1 (clos)');
    expect(e.body.messages[0].content).toContain('T-2 « API commandes » [Portail fournisseurs] — Bruno Petit · En attente');
    expect(e.body.messages[0].content).not.toContain('SP');
    expect((await env.call('GET', '/usage')).json.calls).toBe(usageBefore); // aucun appel IA

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
    await provider.structured(await sprintDocCall('compte_rendu', 1, { user: 'alice@test', cdcId: '1' }), config.modelSmart);
    expect(sent).toEqual(e.body);
    expect((await env.call('GET', '/sprints/2/documents/preparation/prompt')).json.body.messages[0].content).toContain('<preparation_du_sprint>');
  });

  it('remet au backlog les tickets d’un sprint à venir supprimé', async () => {
    const s = (await env.call('POST', '/sprints', {})).json;
    await patch(p1, 'Recette utilisateurs', { sprintId: s.id });
    expect((await env.call('DELETE', `/sprints/${s.id}`)).status).toBe(204);
    const t = (await env.call('GET', `/projects/${p1}`)).json.items.tasks.find((x: any) => x.id === ids['Recette utilisateurs']);
    expect(t.sprintId).toBeNull();
    expect((await env.call('DELETE', '/sprints/1')).status).toBe(400); // sprint clos
  });

  it('numérote les tâches enregistrées avant les sprints', async () => {
    const now = new Date().toISOString();
    const base = { createdAt: now, createdBy: 'alice@test', updatedAt: now, updatedBy: 'alice@test', title: 'Ancienne tâche', details: '', assigneeId: 'alice@test', assignee: 'Alice', dueDate: '', projectId: p2 };
    await ddb().send(new PutCommand({ TableName: config.tableName, Item: { pk: `PROJ#${p2}`, sk: 'TASK#old1', id: 'old1', ...base, done: false, doneAt: '', gsi1pk: 'TASK_OPEN', gsi1sk: '9999-12-31#old1' } }));
    await ddb().send(new PutCommand({ TableName: config.tableName, Item: { pk: `PROJ#${p2}`, sk: 'TASK#old2', id: 'old2', ...base, title: 'Très ancienne', status: 'fait', priority: 'haute', doneAt: now } }));
    const o = (await env.call('GET', '/sprints')).json;
    const old = o.tickets.find((t: any) => t.id === 'old1');
    expect(old).toMatchObject({ number: 6, status: 'a_faire', sprintId: null, projectName: 'Paie' });
    const items = (await env.call('GET', `/projects/${p2}`)).json.items.tasks;
    expect(items.find((t: any) => t.id === 'old2')).toMatchObject({ number: 7, status: 'termine', done: true });
    expect(items.find((t: any) => t.id === 'old2').priority).toBe('haute'); // priorité reprise des anciennes tâches
    // Toujours modifiables, et désormais indexées comme tickets.
    expect((await env.call('PATCH', `/projects/${p2}/items/tasks/old1`, { status: 'en_cours' })).json.statusChanges).toHaveLength(1);
    expect((await env.call('GET', '/sprints')).json.tickets.filter((t: any) => t.id === 'old1')).toHaveLength(1);
  });

  it('crée des tickets hors projet, puis les rattache à un projet en gardant leur historique', async () => {
    const free = await ticket('hors-projet', 'Mettre à jour la doc d’exploitation', { sprintId: null });
    expect(free).toMatchObject({ number: 8, status: 'a_faire' });
    const listed = (await env.call('GET', '/sprints')).json.tickets.find((t: any) => t.id === free.id);
    expect(listed).toMatchObject({ projectId: 'hors-projet', projectName: 'Hors projet' });
    await tick();
    expect((await patch('hors-projet', 'Mettre à jour la doc d’exploitation', { status: 'en_cours' })).json.statusChanges).toHaveLength(1);
    // Pas de fiche projet, ni d'autre élément hors projet.
    expect((await env.call('GET', '/projects/hors-projet')).status).toBe(404);
    expect((await env.call('POST', '/projects/hors-projet/items/risks', { title: 'X' })).status).toBe(400);
    expect((await env.call('GET', '/projects')).json.some((p: any) => p.id === 'hors-projet')).toBe(false);

    // Une modification invalide ne déplace rien.
    expect((await patch('hors-projet', 'Mettre à jour la doc d’exploitation', { projectId: p2, status: 'inconnu' })).status).toBe(400);
    expect((await env.call('GET', `/projects/${p2}`)).json.items.tasks.some((t: any) => t.id === free.id)).toBe(false);
    // Rattaché au projet Paie : même numéro, même historique, et modifié dans la foulée.
    await tick();
    const moved = await patch('hors-projet', 'Mettre à jour la doc d’exploitation', { projectId: p2, status: 'recette' });
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ number: 8, status: 'recette' });
    expect(moved.json.statusChanges).toHaveLength(2);
    const inP2 = (await env.call('GET', `/projects/${p2}`)).json;
    expect(inP2.items.tasks.some((t: any) => t.id === free.id)).toBe(true);
    expect(inP2.activity.some((a: any) => /rattaché le ticket/.test(a.text))).toBe(true);
    expect((await env.call('GET', '/sprints')).json.tickets.filter((t: any) => t.id === free.id).map((t: any) => t.projectId)).toEqual([p2]);
    // … puis de nouveau sorti de tout projet.
    const back = await patch(p2, 'Mettre à jour la doc d’exploitation', { projectId: 'hors-projet' });
    expect(back.json.number).toBe(8);
    expect((await env.call('GET', `/projects/${p2}`)).json.items.tasks.some((t: any) => t.id === free.id)).toBe(false);
    expect((await patch('hors-projet', 'Mettre à jour la doc d’exploitation', { projectId: 'inconnu' })).status).toBe(404);
    expect((await env.call('DELETE', `/projects/hors-projet/items/tasks/${free.id}`)).status).toBe(204);
  });

  it('donne une priorité aux tickets et planifie tout un projet d’un coup', async () => {
    const t = await ticket(p1, 'Corriger la TVA', { priority: 'critique' });
    expect(t.priority).toBe('critique');
    expect((await env.call('POST', `/projects/${p1}/items/tasks`, { title: 'X', priority: 'urgente' })).status).toBe(400);
    expect((await patch(p1, 'Corriger la TVA', { priority: 'haute' })).json.priority).toBe('haute');
    expect((await ticket(p1, 'Sans priorité')).priority).toBe('normale');

    const s = (await env.call('POST', '/sprints', {})).json;
    const before = (await env.call('GET', '/sprints')).json.tickets.filter((x: any) => x.projectId === p1 && x.sprintId === null && !x.done);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const r = await env.call('POST', `/sprints/${s.id}/plan-project`, { projectId: p1 });
    expect(r.json.planned).toBe(before.length);
    const after = (await env.call('GET', '/sprints')).json.tickets.filter((x: any) => x.projectId === p1 && !x.done);
    expect(after.filter((x: any) => x.sprintId === null)).toHaveLength(0);
    expect(after.find((x: any) => x.id === t.id).sprintChanges.at(-1)).toMatchObject({ from: null, to: s.id });
    // Plus rien à planifier ; un sprint clos refuse.
    expect((await env.call('POST', `/sprints/${s.id}/plan-project`, { projectId: p1 })).status).toBe(400);
    expect((await env.call('POST', '/sprints/1/plan-project', { projectId: p2 })).status).toBe(400);
  });

  it('enregistre un sprint passé comme clos, pour l’historique', async () => {
    // Créé après coup, avec des dates passées : directement clos, rangé à sa date parmi les sprints clos.
    const old = await env.call('POST', '/sprints', { name: 'Sprint 0', startDate: '2026-01-05', endDate: '2026-01-16' });
    expect(old.status).toBe(201);
    expect(old.json).toMatchObject({ state: 'closed', startedAt: '2026-01-05T07:00:00.000Z', completedAt: '2026-01-16T19:00:00.000Z' });
    expect((await env.call('POST', `/sprints/${old.json.id}/start`)).status).toBe(400);
    const closed = (await env.call('GET', '/sprints')).json.sprints.filter((x: any) => x.state === 'closed');
    expect(closed.at(-1).id).toBe(old.json.id);
    const detail = (await env.call('GET', `/sprints/${old.json.id}`)).json;
    expect(detail.preparation).toBeNull();
    expect(detail.report).toMatchObject({ startDay: '2026-01-05', asOfDay: '2026-01-16' });

    // Un sprint à venir dont la fin est dépassée se classe comme sprint passé (pas avant).
    const s = (await env.call('POST', '/sprints', { name: 'Futur' })).json;
    expect(s.state).toBe('future');
    expect((await env.call('POST', `/sprints/${s.id}/past`, {})).status).toBe(400);
    await ticket(p1, 'Ticket du sprint passé', { sprintId: s.id });
    await ticket(p1, 'Ticket terminé du sprint passé', { sprintId: s.id });
    expect((await patch(p1, 'Ticket terminé du sprint passé', { status: 'termine' })).status).toBe(200);
    await env.call('PUT', `/sprints/${s.id}`, { name: 'Sprint 4', startDate: '2026-02-02', endDate: '2026-02-13' });
    expect((await env.call('POST', `/sprints/${s.id}/past`, { moveTo: s.id })).status).toBe(400);
    const past = await env.call('POST', `/sprints/${s.id}/past`, { moveTo: null });
    expect(past.status).toBe(200);
    expect(past.json.moved).toBe(1);
    expect(past.json.detail.sprint).toMatchObject({ state: 'closed', completedAt: '2026-02-13T19:00:00.000Z' });
    // Ses tickets, planifiés et terminés après coup, figurent dans sa revue, comme présents dès le lancement.
    const review = past.json.detail.report;
    expect(review.counts).toMatchObject({ total: 2, active: 2, atStart: 2, done: 1, removed: 0 });
    expect(review.issues.map((i: any) => [i.summary, i.status, i.movement.kind, i.doneDay])).toEqual([
      ['Ticket terminé du sprint passé', 'termine', 'lancement', '2026-02-13'],
      ['Ticket du sprint passé', 'a_faire', 'lancement', null],
    ]);
    expect(review.timeline.at(-1)).toMatchObject({ day: '2026-02-13', active: 2, done: 1 });
    // Changer ses dates déplace son lancement et sa clôture ; sa revue reste la même.
    const moved = (await env.call('PUT', `/sprints/${s.id}`, { name: 'Sprint 4', startDate: '2026-02-02', endDate: '2026-02-20' })).json;
    expect(moved.sprint.completedAt).toBe('2026-02-20T19:00:00.000Z');
    expect(moved.report.counts).toMatchObject({ total: 2, done: 1 });
    expect((await env.call('PUT', `/sprints/${s.id}`, { name: 'Sprint 4', startDate: '2026-02-02', endDate: '' })).status).toBe(400);
    // La revue donne le ticket Desk de chaque ticket.
    expect((await patch(p1, 'Ticket terminé du sprint passé', { deskId: '4512' })).status).toBe(200);
    const withDesk = (await env.call('GET', `/sprints/${s.id}`)).json.report.issues;
    expect(withDesk.map((i: any) => i.deskId)).toEqual(['4512', '']);

    // Page Tickets : tous les tickets, terminés et hors sprint compris, du plus récent au plus ancien.
    const all = (await env.call('GET', '/sprints/tickets')).json;
    expect(all.find((t: any) => t.title === 'Ticket terminé du sprint passé')).toMatchObject({ status: 'termine', sprintId: s.id, deskId: '4512', projectName: 'Portail fournisseurs' });
    expect(all.map((t: any) => t.number)).toEqual([...all.map((t: any) => t.number)].sort((a: number, b: number) => b - a));
    expect(all.length).toBeGreaterThan((await env.call('GET', '/sprints')).json.tickets.length);
    expect((await patch(p1, 'Ticket du sprint passé', {})).json.sprintId).toBeNull();
    expect((await env.call('POST', `/sprints/${s.id}/past`, {})).status).toBe(400);
    // Le sprint en cours ne se classe pas ainsi : il se clôture.
    const active = (await env.call('GET', '/sprints')).json.sprints.find((x: any) => x.state === 'active');
    expect((await env.call('POST', `/sprints/${active.id}/past`, {})).status).toBe(400);
  });

  it('ajoute des notes de suivi à un ticket, sans modifier le ticket', async () => {
    const t = await ticket(p1, 'Ticket annoté');
    await env.call('POST', '/users', { email: 'claire@exemple.fr', name: 'Claire Roy', role: 'membre' });
    expect((await env.call('POST', `/projects/${p1}/tickets/${t.id}/notes`, { text: '  ' })).status).toBe(400);
    const added = await env.call('POST', `/projects/${p1}/tickets/${t.id}/notes`, { text: 'Le prestataire a **relancé** le métier.' });
    expect(added.status).toBe(201);
    expect(added.json).toEqual([expect.objectContaining({ text: 'Le prestataire a **relancé** le métier.', by: 'alice@test', editedAt: '' })]);
    const second = await env.call('POST', `/projects/${p1}/tickets/${t.id}/notes`, { text: 'Réponse attendue vendredi.' }, 'claire@exemple.fr');
    expect(second.json.map((n: any) => n.author)).toEqual([expect.any(String), 'Claire Roy']);
    const [mine, hers] = second.json;

    // Les notes suivent le ticket : modification, liste transverse, changement de projet.
    const after = (await patch(p1, 'Ticket annoté', { status: 'en_cours' })).json;
    expect(after.comments).toHaveLength(2);
    expect(after.updatedAt).not.toBe(t.updatedAt);
    const listed = (await env.call('GET', '/sprints/tickets')).json.find((x: any) => x.id === t.id);
    expect(listed.comments.map((n: any) => n.text)).toEqual(['Le prestataire a **relancé** le métier.', 'Réponse attendue vendredi.']);
    await patch(p1, 'Ticket annoté', { projectId: p2 });
    expect((await env.call('GET', `/projects/${p2}`)).json.items.tasks.find((x: any) => x.id === t.id).comments).toHaveLength(2);

    // Chacun ne modifie ou ne supprime que ses notes.
    expect((await env.call('PUT', `/projects/${p2}/tickets/${t.id}/notes/${hers.id}`, { text: 'Pas à moi' })).status).toBe(403);
    expect((await env.call('DELETE', `/projects/${p2}/tickets/${t.id}/notes/${hers.id}`)).status).toBe(403);
    const edited = await env.call('PUT', `/projects/${p2}/tickets/${t.id}/notes/${mine.id}`, { text: 'Relance faite.' });
    expect(edited.json[0]).toMatchObject({ text: 'Relance faite.', editedAt: expect.any(String) });
    const removed = await env.call('DELETE', `/projects/${p2}/tickets/${t.id}/notes/${hers.id}`, undefined, 'claire@exemple.fr');
    expect(removed.json.map((n: any) => n.id)).toEqual([mine.id]);
    expect((await env.call('DELETE', `/projects/${p2}/tickets/${t.id}/notes/inconnue`)).status).toBe(404);

    // Ticket hors projet : notes aussi, sans journal d'activité.
    const hp = (await env.call('POST', `/projects/hors-projet/items/tasks`, { title: 'Hors projet annoté' })).json;
    expect((await env.call('POST', `/projects/hors-projet/tickets/${hp.id}/notes`, { text: 'Note' })).status).toBe(201);
    // Note ajoutée quand le ticket était encore dans le premier projet.
    const activity = (await env.call('GET', `/projects/${p1}`)).json.activity.map((a: any) => a.text);
    expect(activity).toContain(`a ajouté une note au ticket « T-${t.number} Ticket annoté »`);
  });

  it('colle une image dans la description d’un ticket', async () => {
    expect((await env.call('POST', '/images', { contentType: 'image/gif', size: 10 })).status).toBe(400);
    const img = await env.call('POST', '/images', { contentType: 'image/png', size: TINY_PNG.length });
    expect(img.status).toBe(200);
    expect(img.json.ref).toMatch(/^asset:hub\//);
    const key = decodeURIComponent(img.json.upload.url.slice('/local-blob/'.length));
    expect(key).toMatch(/^images\//);
    await env.store.put(key, TINY_PNG, 'image/png');
    const details = `Capture de l’erreur :\n\n![écran](${img.json.ref})`;
    const t = await ticket(p1, 'Erreur à l’écran', { details });
    expect(t.details).toBe(details);
    const urls = await env.call('POST', '/assets/resolve', { refs: [img.json.ref] });
    expect(urls.json[img.json.ref]).toBeTruthy();
  });
});
