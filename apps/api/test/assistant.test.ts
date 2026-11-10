import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';
import { mentionedProjects } from '../src/assistant/context.js';
import { sanitizeActions } from '../src/assistant/routes.js';
import { setProvider, type LlmProvider, type StructuredCall } from '../src/ai/llm.js';
import { MockProvider } from '../src/ai/mock.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';

/** Fournisseur simulé qui garde le dernier appel, pour vérifier ce qui part à l'IA. */
function spy() {
  const calls: StructuredCall<unknown>[] = [];
  const mock = new MockProvider(0);
  const p: LlmProvider = {
    structured: (call) => {
      calls.push(call as StructuredCall<unknown>);
      return mock.structured(call);
    },
  };
  setProvider(p);
  return calls;
}

describe('assistant (chat global)', () => {
  let erp = '';

  it('répond à partir des données du hub, sans envoyer celles des autres', async () => {
    erp = (await env.call('POST', '/projects', { name: 'Migration ERP', code: 'ERP', targetDate: '2027-06-30' }, ADMIN)).json.id;
    await env.call('POST', '/projects', { name: 'Portail fournisseurs' }, ADMIN);
    await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand' }, ADMIN);
    await env.call('PUT', `/projects/${erp}/suivi`, { follow: true }, MEMBRE);
    await env.call('POST', `/projects/${erp}/items/jalons`, { label: 'Recette lot 1', date: '2020-01-15' }, ADMIN);
    await env.call('POST', `/projects/${erp}/items/tasks`, { title: 'Paramétrer la paie', assigneeId: MEMBRE, priority: 'haute', dueDate: '2020-02-01' }, ADMIN);
    await env.call('POST', '/todos', { title: 'Préparer le comité', dueDate: '2020-01-10', subtasks: [{ id: 'a', title: 'Relire le budget', done: true }, { id: 'b', title: 'Envoyer l’ordre du jour' }] }, MEMBRE);
    await env.call('POST', '/todos', { title: 'Tâche privée de l’admin' }, ADMIN);
    await env.call('POST', '/notes', { title: 'Idée', content: 'Automatiser le relevé TMA' }, MEMBRE);
    await env.call('POST', '/notes', { content: 'Note secrète de l’admin' }, ADMIN);

    expect((await env.call('POST', '/assistant', { question: '  ' }, MEMBRE)).status).toBe(400);
    const calls = spy();
    const r = await env.call('POST', '/assistant', { question: 'Qu’est-ce que je dois faire en priorité ?' }, MEMBRE);
    expect(r.status).toBe(200);
    expect(r.json.answer).toContain('Réponse simulée');
    expect(r.json.followUps.length).toBeLessThanOrEqual(3);
    expect(r.json.projects).toEqual([]);

    const call = calls.at(-1)!;
    expect(call).toMatchObject({ operation: 'assistant', tier: 'fast' });
    // Le prompt système reste fixe (cache) ; les données vont dans le contexte et la question dans l'entrée.
    expect(call.system).not.toContain('Chloé');
    const ctx = call.context!;
    expect(ctx).toContain('Utilisateur : Chloé Durand');
    expect(ctx).toMatch(/## Mes projets[^\n]*\n- \[Migration ERP\]\(\/projets\//);
    expect(ctx).toContain('Recette lot 1 — [Migration ERP]');
    expect(ctx).toContain('EN RETARD');
    expect(ctx).toContain('Paramétrer la paie');
    expect(ctx).toContain('  - [x] Relire le budget');
    expect(ctx).toContain('  - [ ] Envoyer l’ordre du jour');
    expect(ctx).toContain('Automatiser le relevé TMA');
    expect(ctx).not.toContain('Tâche privée de l’admin');
    expect(ctx).not.toContain('Note secrète');
    expect(call.input).toContain('<question>\nQu’est-ce que je dois faire en priorité ?\n</question>');
    expect(call.input).not.toContain('<projets_detailles>');
  });

  it('détaille les projets cités, y compris dans une question de relance', async () => {
    const calls = spy();
    const r = await env.call('POST', '/assistant', { question: 'Où en est la migration erp ?' }, MEMBRE);
    expect(r.json.projects).toEqual([{ id: erp, name: 'Migration ERP' }]);
    expect(calls.at(-1)!.input).toContain(`# Projet Migration ERP (/projets/${erp})`);
    expect(calls.at(-1)!.input).toContain('## Planning');

    const history = [
      { role: 'user', content: 'Où en est la migration erp ?' },
      { role: 'assistant', content: r.json.answer },
    ];
    const next = await env.call('POST', '/assistant', { question: 'Et ses risques ?', history }, MEMBRE);
    expect(next.json.projects.map((p: any) => p.name)).toEqual(['Migration ERP']);
    expect(calls.at(-1)!.input).toContain('<conversation>\nUtilisateur : Où en est la migration erp ?');
    expect((await env.call('POST', '/assistant', { question: 'x', history: [{ role: 'systeme', content: 'x' }] }, MEMBRE)).status).toBe(400);
    setProvider(new MockProvider(0));
  });

  it('propose des actions à partir d’un long texte collé, sans rien créer', async () => {
    const before = (await env.call('GET', `/projects/${erp}`, undefined, MEMBRE)).json.items.tasks.length;
    const text = [
      'Compte rendu du point hebdo sur la migration ERP.',
      'Le prestataire a livré le lot 1, la recette commence lundi.',
      '- Il faut corriger l’export des écritures comptables.',
      '- Relancer le prestataire pour la documentation.',
      'Rien d’autre à signaler, prochain point dans quinze jours. '.repeat(3),
    ].join('\n');
    const r = await env.call('POST', '/assistant', { question: text }, MEMBRE);
    expect(r.status).toBe(200);
    expect(r.json.actions).toEqual([
      expect.objectContaining({ kind: 'ticket', title: 'corriger l’export des écritures comptables', projectId: erp, projectName: 'Migration ERP' }),
      expect.objectContaining({ kind: 'todo', title: 'Relancer le prestataire pour la documentation', projectId: erp }),
    ]);
    // Rien n'est créé tant que l'utilisateur ne valide pas.
    expect((await env.call('GET', `/projects/${erp}`, undefined, MEMBRE)).json.items.tasks).toHaveLength(before);
    // Une question courte ne propose rien ; un texte trop long est refusé.
    expect((await env.call('POST', '/assistant', { question: 'Où en est le sprint ?' }, MEMBRE)).json.actions).toEqual([]);
    expect((await env.call('POST', '/assistant', { question: 'x'.repeat(60_001) }, MEMBRE)).status).toBe(400);
  });

  it('ramène les propositions de l’IA à ce que le hub accepte', () => {
    const projects = [{ id: 'p1', name: 'Paie' }] as any;
    const a = (x: Record<string, unknown>) => ({ kind: 'ticket', title: 'Faire', details: '', projectId: '', dueDate: '', priority: 'normale', reason: '', ...x }) as any;
    expect(
      sanitizeActions(
        [
          a({ projectId: '/projets/p1', dueDate: '2026-12-01' }),
          a({ projectId: 'inventé', dueDate: 'vendredi' }),
          a({ kind: 'jalon', title: 'Recette', projectId: '' }),
          a({ kind: 'jalon', title: 'Mise en production', projectId: 'p1', dueDate: '2027-01-15' }),
          a({ title: '   ' }),
        ],
        projects,
      ),
    ).toEqual([
      expect.objectContaining({ projectId: 'p1', projectName: 'Paie', dueDate: '2026-12-01' }),
      expect.objectContaining({ projectId: '', projectName: '', dueDate: '' }),
      expect.objectContaining({ kind: 'jalon', title: 'Mise en production', projectId: 'p1' }),
    ]);
  });

  it('reconnaît les projets par nom ou code, en mots entiers', () => {
    const p = (id: string, name: string, code = '') => ({ id, name, code }) as any;
    const projects = [p('1', 'ERP', ''), p('2', 'ERP Paie', 'PAIE'), p('3', 'Portail', 'PRT'), p('4', 'BI')];
    expect(mentionedProjects(projects, 'Point sur ERP paie et le portail', []).map((x) => x.id)).toEqual(['2', '3']);
    expect(mentionedProjects(projects, 'Les échéances de l’ERP ?', []).map((x) => x.id)).toEqual(['1']);
    expect(mentionedProjects(projects, 'support prtg', []).map((x) => x.id)).toEqual([]);
    // Nom trop court (« BI ») : ignoré, pour éviter les faux positifs.
    expect(mentionedProjects(projects, 'la bi', []).map((x) => x.id)).toEqual([]);
  });
});
