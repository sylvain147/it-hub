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

  it('propose ce qu’on lui demande de créer, avec le type, la priorité et le projet', async () => {
    const calls = spy();
    const r = await env.call('POST', '/assistant', { question: 'Crée-moi un ticket sur la migration ERP pour le développement, c’est urgent' }, MEMBRE);
    expect(calls.at(-1)!.context).toContain('## Types de tickets\nCadrage, Dev, Recette, MEP, Correctif');
    expect(calls.at(-1)!.context).toContain('- Chloé Durand (chloe.durand@exemple.fr)');
    expect(r.json.actions).toEqual([expect.objectContaining({ kind: 'ticket', title: 'Migration ERP', ticketType: 'Dev', projectId: erp, priority: 'haute', assigneeId: '' })]);
    expect(r.json.answer).toMatch(/^Après analyse/);
    // Mise à jour d'un ticket existant : avant → après, rien n'est modifié tant que l'utilisateur ne clique pas.
    const t = (await env.call('POST', `/projects/${erp}/items/tasks`, { title: 'Brancher la paie', status: 'en_cours' }, MEMBRE)).json;
    const up = await env.call('POST', '/assistant', { question: `Passe T-${t.number} en recette` }, MEMBRE);
    expect(up.json.actions).toEqual([
      expect.objectContaining({ kind: 'ticket_update', title: 'Brancher la paie', projectId: erp, update: expect.objectContaining({ ticketId: t.id, status: 'recette', before: expect.objectContaining({ status: 'en_cours' }) }) }),
    ]);
    expect((await env.call('GET', `/projects/${erp}`, undefined, MEMBRE)).json.items.tasks.find((x: any) => x.id === t.id).status).toBe('en_cours');
    // Ticket inconnu, ou sans changement réel : pas de proposition.
    expect((await env.call('POST', '/assistant', { question: 'Passe T-9999 en recette' }, MEMBRE)).json.actions).toEqual([]);
    expect((await env.call('POST', '/assistant', { question: `Passe T-${t.number} en cours` }, MEMBRE)).json.actions).toEqual([]);
    const todo = await env.call('POST', '/assistant', { question: 'Ajoute à ma to-do de relancer le prestataire' }, MEMBRE);
    expect(todo.json.actions).toEqual([expect.objectContaining({ kind: 'todo', projectId: '' })]);
    setProvider(new MockProvider(0));
  });

  it('répond d’après la FAQ de l’équipe, sans les images des réponses', async () => {
    const f = (await env.call('POST', '/faq', { question: 'Comment obtenir un accès VPN ?', answer: 'Demander au support.\n\n![capture](asset:hub/abc)', category: 'Réseau' }, ADMIN)).json;
    await env.call('POST', '/faq', { question: 'Qui valide les congés ?' }, ADMIN);
    const calls = spy();
    const r = await env.call('POST', '/assistant', { question: 'Comment avoir le VPN ?' }, MEMBRE);
    const ctx = calls.at(-1)!.context!;
    expect(ctx).toContain(`## FAQ de l’équipe (questions et réponses)\n- [Comment obtenir un accès VPN ?](/faq?entree=${f.id}) (Réseau) : Demander au support.\n- [Qui valide les congés ?]`);
    expect(ctx).toContain('Qui valide les congés ?](/faq?entree=');
    expect(ctx).toContain(': SANS RÉPONSE');
    expect(ctx).not.toContain('asset:hub');
    expect(r.json.answer).toContain('D’après la FAQ');
    expect(calls.at(-1)!.system).toContain('/faq?entree=<id>');
    setProvider(new MockProvider(0));
  });

  it('propose de créer un projet qu’on lui demande, sans le créer', async () => {
    const before = (await env.call('GET', '/projects', undefined, MEMBRE)).json.length;
    const calls = spy();
    const r = await env.call('POST', '/assistant', { question: 'Crée le projet Refonte du site, domaine Web' }, MEMBRE);
    expect(calls.at(-1)!.context).toContain('## Domaines de projet\nIT, Logistique, Marketing, Finance');
    expect(r.json.actions).toEqual([expect.objectContaining({ kind: 'projet', title: 'Refonte du site', domain: 'Web', projectId: '' })]);
    expect((await env.call('GET', '/projects', undefined, MEMBRE)).json.length).toBe(before);
    // Projet déjà existant : pas de doublon proposé.
    expect((await env.call('POST', '/assistant', { question: 'Crée le projet Migration ERP' }, MEMBRE)).json.actions).toEqual([]);
    setProvider(new MockProvider(0));
  });

  it('devient Saroumane sous le thème Mordor, avec un prompt système fixe par personnage', async () => {
    const calls = spy();
    await env.call('POST', '/assistant', { question: 'Bonjour' }, MEMBRE);
    const gandalf = calls.at(-1)!.system;
    expect(gandalf).toMatch(/^Tu es Gandalf, l'assistant du hub/);
    expect(gandalf).not.toContain('Saroumane');

    expect((await env.call('PUT', '/me/preferences', { theme: 'mordor' }, MEMBRE)).status).toBe(200);
    await env.call('POST', '/assistant', { question: 'Bonjour' }, MEMBRE);
    const saroumane = calls.at(-1)!.system;
    expect(saroumane).toMatch(/^Tu es Saroumane, l'assistant du hub/);
    expect(saroumane).toContain('maître d’Orthanc');
    expect(saroumane).not.toContain('Chloé');
    // Les autres gardent leur Gandalf.
    await env.call('POST', '/assistant', { question: 'Bonjour' }, ADMIN);
    expect(calls.at(-1)!.system).toBe(gandalf);
    await env.call('PUT', '/me/preferences', { theme: 'comte' }, MEMBRE);
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
    // Type de ticket du paramétrage en préfixe (sans le doubler), responsable seulement s'il est actif.
    const users = [{ email: 'paul@exemple.fr', active: true }, { email: 'ancien@exemple.fr', active: false }] as any;
    expect(
      sanitizeActions(
        [
          a({ ticketType: 'dev', title: '', projectId: 'p1', assigneeId: 'Paul@exemple.fr' }),
          a({ ticketType: 'Dev', title: '[DEV] - Paie - Export', assigneeId: 'ancien@exemple.fr' }),
          a({ ticketType: 'Inconnu', title: 'Corriger' }),
        ],
        projects,
        { ticketTypes: ['Dev', 'MEP'], users },
      ).map((x) => [x.ticketType, x.title, x.assigneeId]),
    ).toEqual([
      ['Dev', 'Paie', 'paul@exemple.fr'],
      ['Dev', 'Paie - Export', ''],
      ['', 'Corriger', ''],
    ]);
    // Projet : domaine du paramétrage seulement, chef de projet actif, jamais rattaché à un projet existant.
    expect(
      sanitizeActions(
        [a({ kind: 'projet', title: 'Portail SAV', domain: 'relation client', assigneeId: 'paul@exemple.fr', projectId: 'p1', dueDate: '2027-03-31' }), a({ kind: 'projet', title: 'paie' }), a({ kind: 'projet', title: 'Juridique', domain: 'Inventé' })],
        projects,
        { projectDomains: ['Web', 'Relation client'], users },
      ),
    ).toEqual([
      expect.objectContaining({ kind: 'projet', title: 'Portail SAV', domain: 'Relation client', assigneeId: 'paul@exemple.fr', projectId: '', dueDate: '2027-03-31' }),
      expect.objectContaining({ kind: 'projet', title: 'Juridique', domain: '' }),
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

describe('pièces jointes de l’assistant', () => {
  // PNG 1×1 et PDF minimal, en base64.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4\n%%EOF').toString('base64');

  it('envoie les images et PDF joints au modèle, avec cette question seulement', async () => {
    const calls = spy();
    const r = await env.call('POST', '/assistant', { question: 'Que montre cette capture ?', attachments: [{ name: 'erreur.png', mediaType: 'image/png', data: PNG }, { name: 'devis.pdf', mediaType: 'application/pdf', data: PDF }] }, ADMIN);
    expect(r.status).toBe(200);
    expect(r.json.answer).toContain('erreur.png (image)');
    const call = calls.at(-1)!;
    expect(call.attachments).toEqual([{ mediaType: 'image/png', data: PNG }, { mediaType: 'application/pdf', data: PDF }]);
    expect(call.input).toContain('<pieces_jointes>\n1. erreur.png (image)\n2. devis.pdf (PDF)\n</pieces_jointes>');
    // Sans pièce jointe : rien de plus dans l'appel.
    await env.call('POST', '/assistant', { question: 'Et sinon ?' }, ADMIN);
    expect(calls.at(-1)!.attachments).toEqual([]);
    expect(calls.at(-1)!.input).not.toContain('pieces_jointes');
  });

  it('refuse un format inconnu, trop de pièces jointes ou des pièces trop lourdes', async () => {
    const ask = (attachments: unknown[]) => env.call('POST', '/assistant', { question: 'Voici', attachments }, ADMIN);
    expect((await ask([{ name: 'a.exe', mediaType: 'application/x-msdownload', data: PNG }])).json.error).toMatch(/Format de pièce jointe non pris en charge/);
    expect((await ask(Array.from({ length: 6 }, () => ({ name: 'a.png', mediaType: 'image/png', data: PNG })))).json.error).toMatch(/5 pièces jointes au plus/);
    expect((await ask([{ name: 'a.png', mediaType: 'image/png', data: 'A'.repeat(4_600_000) }])).json.error).toMatch(/trop lourdes/);
    expect((await ask([{ name: 'a.png', mediaType: 'image/png', data: 'pas du base64 !' }])).status).toBe(400);
  });

  it('place les pièces jointes avant le texte dans la requête Bedrock', async () => {
    const { captureBedrockRequest } = await import('../src/ai/bedrock.js');
    const { z } = await import('zod');
    const req = await captureBedrockRequest(
      { tier: 'fast', operation: 'assistant', system: 's', input: 'q', attachments: [{ mediaType: 'image/png', data: PNG }, { mediaType: 'application/pdf', data: PDF }], schema: z.object({ a: z.string() }), maxTokens: 100, effort: 'low', ctx: { user: 'u', cdcId: '' } },
      'eu.anthropic.claude-haiku-5-5',
    );
    expect((req.body.messages as any[])[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF } },
      { type: 'text', text: 'q' },
    ]);
  });
});

describe('erreurs de Bedrock', () => {
  it('rend lisible un refus de Bedrock au lieu d’une « erreur interne »', async () => {
    const { BedrockProvider } = await import('../src/ai/bedrock.js');
    const { z } = await import('zod');
    const refuse = async () => new Response(JSON.stringify({ message: 'You don’t have access to the model with the specified model ID.' }), { status: 403, headers: { 'content-type': 'application/json' } });
    const p = new BedrockProvider({ skipAuth: true, fetch: refuse as typeof fetch, maxRetries: 0 });
    const call = { tier: 'fast' as const, operation: 'assistant', system: 's', input: 'q', schema: z.object({ a: z.string() }), maxTokens: 100, effort: 'low' as const, ctx: { user: 'u', cdcId: '' } };
    await expect(p.structured(call, 'anthropic.claude-haiku-5-5')).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/HTTP 403 .*access to the model.*Vérifiez l’accès au modèle/) });
    const panne = async () => {
      throw new TypeError('fetch failed');
    };
    const q = new BedrockProvider({ skipAuth: true, fetch: panne as typeof fetch, maxRetries: 0 });
    await expect(q.structured(call, 'anthropic.claude-haiku-5-5')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('impossible') });
  });
});

describe('tarifs des profils d’inférence Bedrock', () => {
  it('prend le tarif du modèle, majoré de 10 % pour un profil régional', async () => {
    const { pricingOf } = await import('../src/ai/llm.js');
    const base = pricingOf('anthropic.claude-haiku-5-5')!;
    expect(pricingOf('global.anthropic.claude-haiku-5-5')).toEqual(base);
    expect(pricingOf('eu.anthropic.claude-haiku-5-5')!.input).toBeCloseTo(base.input * 1.1);
    expect(pricingOf('eu.anthropic.inconnu')).toBeUndefined();
  });
});
