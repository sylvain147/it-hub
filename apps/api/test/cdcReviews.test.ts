import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const ADMIN = 'alice.martin@exemple.fr';
const MEMBRE = 'chloe.durand@exemple.fr';
const EXTERNE = 'jean.dupont@prestataire.fr';
const ORIGIN = { origin: 'https://hobbit.exemple.fr' };

describe('validation d’un cahier des charges', () => {
  let cdcId = '';
  let projectId = '';
  const tokens: Record<string, string> = {};

  it('envoie une demande à des utilisateurs du hub et à des personnes extérieures', async () => {
    await env.call('POST', '/users', { email: MEMBRE, name: 'Chloé Durand' }, ADMIN);
    projectId = (await env.call('POST', '/projects', { name: 'Portail fournisseurs', description: 'Le **portail** des fournisseurs.' }, ADMIN)).json.id;
    cdcId = (await env.call('POST', `/projects/${projectId}/cdcs`, { withAi: false }, ADMIN)).json.id;
    expect((await env.call('POST', `/cdcs/${cdcId}/validations`, { emails: [] }, ADMIN, ORIGIN)).status).toBe(400);
    expect((await env.call('POST', `/cdcs/${cdcId}/validations`, { emails: ['pas-une-adresse'] }, ADMIN, ORIGIN)).status).toBe(400);

    const r = await env.call('POST', `/cdcs/${cdcId}/validations`, { emails: [MEMBRE, ' Jean.Dupont@prestataire.fr ', MEMBRE], message: 'Merci de relire avant vendredi.' }, ADMIN, ORIGIN);
    expect(r.status).toBe(201);
    expect(r.json.reviews.map((x: any) => [x.email, x.name, x.versionLabel, x.decision])).toEqual([
      [MEMBRE, 'Chloé Durand', '0.1', null],
      [EXTERNE, '', '0.1', null],
    ]);
    for (const x of r.json.reviews) {
      expect(x.link).toMatch(/^https:\/\/hobbit\.exemple\.fr\/validation\/[A-Za-z0-9_-]+$/);
      tokens[x.email] = x.link.split('/').pop();
    }
    // Le lien n'est jamais conservé : la liste ne le contient pas.
    const list = (await env.call('GET', `/cdcs/${cdcId}/validations`, undefined, ADMIN)).json;
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain(tokens[EXTERNE]);
    expect((await env.call('GET', `/projects/${projectId}`, undefined, ADMIN)).json.activity[0].text).toContain('a demandé la validation');
  });

  it('montre le CDC en lecture seule à la bonne adresse, sans connexion', async () => {
    const t = tokens[EXTERNE];
    const info = await env.call('GET', `/public/validation/${t}`, undefined, '');
    expect(info.status).toBe(200);
    expect(info.json).toMatchObject({ cdcTitle: 'Portail fournisseurs', requestedByName: expect.any(String), emailHint: 'je*********@prestataire.fr' });
    expect(info.json).not.toHaveProperty('sections');
    expect((await env.call('GET', '/public/validation/inconnu-inconnu-inconnu-0000', undefined, '')).status).toBe(404);
    expect((await env.call('POST', `/public/validation/${t}/ouvrir`, { email: MEMBRE }, '')).status).toBe(403);
    const doc = await env.call('POST', `/public/validation/${t}/ouvrir`, { email: 'JEAN.DUPONT@prestataire.fr' }, '');
    expect(doc.status).toBe(200);
    expect(doc.json.message).toBe('Merci de relire avant vendredi.');
    expect(doc.json.sections[0]).toMatchObject({ title: 'Contexte', markdown: expect.stringContaining('**portail**') });
    // Personne n'a été ajouté au hub par ces pages.
    expect((await env.call('GET', '/users', undefined, ADMIN)).json.map((u: any) => u.email)).not.toContain('dev@local');
  });

  it('enregistre la réponse, sans bloquer ni modifier le CDC', async () => {
    const t = tokens[EXTERNE];
    expect((await env.call('POST', `/public/validation/${t}/reponse`, { email: MEMBRE, decision: 'valide' }, '')).status).toBe(403);
    const no = await env.call('POST', `/public/validation/${t}/reponse`, { email: EXTERNE, decision: 'refuse', comment: 'Il manque les délais de paiement.' }, '');
    expect(no.status).toBe(200);
    const list = (await env.call('GET', `/cdcs/${cdcId}/validations`, undefined, ADMIN)).json;
    expect(list.find((x: any) => x.email === EXTERNE)).toMatchObject({ decision: 'refuse', comment: 'Il manque les délais de paiement.' });
    // Le CDC n'a pas changé de version.
    expect((await env.call('GET', `/cdcs/${cdcId}`, undefined, ADMIN)).json.currentVersion.label).toBe('0.1');
    expect((await env.call('GET', `/projects/${projectId}`, undefined, ADMIN)).json.activity[0].text).toContain('n’a pas validé le cahier des charges');
    // On peut changer d'avis.
    await env.call('POST', `/public/validation/${t}/reponse`, { email: EXTERNE, decision: 'valide' }, '');
    expect((await env.call('POST', `/public/validation/${t}/ouvrir`, { email: EXTERNE }, '')).json.decision).toBe('valide');
  });

  it('retire une demande : son lien ne marche plus', async () => {
    const list = (await env.call('GET', `/cdcs/${cdcId}/validations`, undefined, ADMIN)).json;
    const member = list.find((x: any) => x.email === MEMBRE);
    expect((await env.call('DELETE', `/cdcs/${cdcId}/validations/${member.id}`, undefined, ADMIN)).status).toBe(204);
    expect((await env.call('GET', `/public/validation/${tokens[MEMBRE]}`, undefined, '')).status).toBe(404);
  });
});
