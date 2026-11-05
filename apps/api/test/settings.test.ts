import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CDC_STATUSES, normalizeListSettings, statusOptions } from '@samm/shared';
import { setupTestEnv } from './helpers.js';
import * as pr from '../src/projects/repo.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let projectId = '';

beforeAll(async () => {
  env = await setupTestEnv();
  projectId = (await env.call('POST', '/projects', { name: 'Refonte paiements' })).json.id;
});
afterAll(async () => env.close());

const project = async () => (await env.call('GET', `/projects/${projectId}`)).json;

describe('paramétrage : statuts, jalons et rôles', () => {
  it('fournit les valeurs par défaut', async () => {
    const { json } = await env.call('GET', '/settings');
    expect(json.prestataires).toEqual([]);
    expect(json.lists.statuses.risk.map((s: any) => s.key)).toEqual(['ouvert', 'surveille', 'clos']);
    expect(json.lists.statuses.task).toBeUndefined(); // les tâches se cochent : pas de statut
    expect(json.lists.statuses.project[0]).toEqual({ key: 'idee', label: 'Idée', hidden: false });
    expect(json.lists.jalonLabels).toContain('Mise en production');
    expect(json.lists.contactRoles).toContain('Chef de projet prestataire');
  });

  it('renomme, réordonne et masque les statuts ; les statuts verrouillés restent visibles', async () => {
    const { json: s } = await env.call('GET', '/settings');
    const risk = [
      { key: 'clos', label: 'Fermé', hidden: true },
      { key: 'surveille', label: '', hidden: true },
      { key: 'inconnu', label: 'X', hidden: false },
    ];
    const prestation = s.lists.statuses.prestation.map((x: any) => (x.key === 'commande' ? { ...x, label: 'Commandé (BC)' } : x));
    const res = await env.call('PUT', '/settings/lists', { ...s.lists, statuses: { ...s.lists.statuses, risk, prestation }, jalonLabels: ['Kick-off', ' MEP ', 'Kick-off'] });
    expect(res.status).toBe(200);
    expect(res.json.statuses.risk).toEqual([
      { key: 'clos', label: 'Fermé', hidden: false }, // verrouillé : toujours visible
      { key: 'surveille', label: 'Sous surveillance', hidden: true }, // libellé vide : libellé d'origine
      { key: 'ouvert', label: 'Ouvert', hidden: false }, // manquant : ajouté à la fin
    ]);
    expect(res.json.jalonLabels).toEqual(['Kick-off', 'MEP']);
    expect(statusOptions(res.json, 'risk').map((o) => o.key)).toEqual(['clos', 'ouvert']);
    expect(statusOptions(res.json, 'risk', 'surveille').map((o) => o.key)).toContain('surveille');
  });

  it('utilise les libellés paramétrés dans l’historique du projet', async () => {
    const acme = (await env.call('POST', '/settings/prestataires', { name: 'ACME' })).json;
    const p = await env.call('POST', `/projects/${projectId}/items/prestations`, { prestataireId: acme.id, objet: 'Brancher PayPal' });
    await env.call('PATCH', `/projects/${projectId}/items/prestations/${p.json.id}`, { status: 'commande' });
    expect((await project()).activity[0].text).toBe('a passé la prestation « ACME — Brancher PayPal » au statut « Commandé (BC) »');
    await env.call('DELETE', `/projects/${projectId}/items/prestations/${p.json.id}`);
    expect((await env.call('DELETE', `/settings/prestataires/${acme.id}`)).status).toBe(204);
  });

  it('assainit un paramétrage incomplet', () => {
    const n = normalizeListSettings({ statuses: { project: [{ key: 'termine', label: 'Clos', hidden: false }] } as any });
    expect(n.statuses.project[0]).toEqual({ key: 'termine', label: 'Clos', hidden: false });
    expect(n.statuses.project).toHaveLength(8);
    expect(n.statuses.cdc.map((s) => s.key)).toEqual([...CDC_STATUSES]);
  });
});

describe('paramétrage : prestataires et contacts', () => {
  let coqliqo: any;

  it('crée un prestataire, refuse un doublon (casse et accents ignorés)', async () => {
    const res = await env.call('POST', '/settings/prestataires', { name: 'Coqliqo', activite: 'TMA de l’ERP', website: 'https://coqliqo.fr' });
    expect(res.status).toBe(201);
    coqliqo = res.json;
    expect((await env.call('POST', '/settings/prestataires', { name: ' COQLIQO ' })).status).toBe(409);
    expect((await env.call('POST', '/settings/prestataires', { name: 'X', website: 'coqliqo.fr' })).status).toBe(400);
  });

  it('gère le carnet de contacts et le relie aux intervenants des projets', async () => {
    const withContact = await env.call('POST', `/settings/prestataires/${coqliqo.id}/contacts`, { name: 'Romain Durand', role: 'Chef de projet', email: 'romain@coqliqo.fr' });
    expect(withContact.status).toBe(201);
    const contactId = withContact.json.contacts[0].id;
    // Intervenant lié : nom, e-mail et organisation viennent du carnet ; le rôle peut être propre au projet.
    const c = await env.call('POST', `/projects/${projectId}/items/contacts`, { directoryContactId: contactId, name: 'ignoré', role: 'Pilote TMA' });
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ name: 'Romain Durand', email: 'romain@coqliqo.fr', organisation: 'Coqliqo', prestataireId: coqliqo.id, role: 'Pilote TMA' });
    // Le nom d'un intervenant lié ne se modifie pas depuis le projet.
    const patched = await env.call('PATCH', `/projects/${projectId}/items/contacts/${c.json.id}`, { name: 'Autre nom', notes: 'Disponible le matin' });
    expect(patched.json).toMatchObject({ name: 'Romain Durand', notes: 'Disponible le matin' });
    // Une modification du carnet se répercute dans les projets.
    await env.call('PUT', `/settings/prestataires/${coqliqo.id}/contacts/${contactId}`, { name: 'Romain Durand', role: 'Directeur de projet', email: 'r.durand@coqliqo.fr', phone: '01 02 03 04 05' });
    const linked = (await project()).items.contacts[0];
    expect(linked).toMatchObject({ email: 'r.durand@coqliqo.fr', phone: '01 02 03 04 05', role: 'Pilote TMA' });
    // Un contact utilisé ne se supprime pas (il s'archive).
    expect((await env.call('DELETE', `/settings/prestataires/${coqliqo.id}/contacts/${contactId}`)).status).toBe(409);
  });

  it('impose le prestataire du paramétrage pour les prestations et répercute son renommage', async () => {
    expect((await env.call('POST', `/projects/${projectId}/items/prestations`, { prestataire: 'Coqliqo', objet: 'Paiements' })).status).toBe(400);
    expect((await env.call('POST', `/projects/${projectId}/items/prestations`, { prestataireId: 'inconnu', objet: 'Paiements' })).status).toBe(400);
    const p = await env.call('POST', `/projects/${projectId}/items/prestations`, { prestataireId: coqliqo.id, objet: 'Paiements', montantHT: 5000 });
    expect(p.json.prestataire).toBe('Coqliqo');
    // Un changement de statut ne redemande pas le prestataire.
    expect((await env.call('PATCH', `/projects/${projectId}/items/prestations/${p.json.id}`, { status: 'commande' })).status).toBe(200);
    const renamed = await env.call('PUT', `/settings/prestataires/${coqliqo.id}`, { ...coqliqo, name: 'Coqliqo SAS' });
    expect(renamed.json.name).toBe('Coqliqo SAS');
    const after = await project();
    expect(after.items.prestations[0].prestataire).toBe('Coqliqo SAS');
    expect(after.items.contacts[0].organisation).toBe('Coqliqo SAS');
    expect(after.stats.prestataires).toEqual(['Coqliqo SAS']);
    expect((await env.call('DELETE', `/settings/prestataires/${coqliqo.id}`)).status).toBe(409);
  });

  it('reprend les noms saisis avant le paramétrage, puis fusionne un doublon', async () => {
    // Prestations historiques : nom libre, sans prestataire du paramétrage.
    await pr.createItem(projectId, 'prestations', { prestataire: 'Weiden', objet: 'Flux factures' }, 'alice@test');
    await pr.createItem(projectId, 'prestations', { prestataire: 'coqliqo sas', objet: 'Ancienne commande' }, 'alice@test');
    const usage = await env.call('GET', '/settings/usage');
    expect(usage.json.unlinked).toEqual([
      { name: 'coqliqo sas', prestations: 1 },
      { name: 'Weiden', prestations: 1 },
    ]);
    expect(usage.json.prestations[coqliqo.id]).toBe(1);
    const imp = await env.call('POST', '/settings/prestataires/import');
    expect(imp.json).toEqual({ created: 1, linked: 2 });
    const { json: s } = await env.call('GET', '/settings');
    expect(s.prestataires.map((p: any) => p.name)).toEqual(['Coqliqo SAS', 'Weiden']);
    expect((await project()).items.prestations.map((x: any) => x.prestataire).sort()).toEqual(['Coqliqo SAS', 'Coqliqo SAS', 'Weiden']);
    expect((await env.call('GET', '/settings/usage')).json.unlinked).toEqual([]);

    const weiden = s.prestataires.find((p: any) => p.name === 'Weiden');
    await env.call('POST', `/settings/prestataires/${weiden.id}/contacts`, { name: 'Hans Weber' });
    const merged = await env.call('POST', `/settings/prestataires/${weiden.id}/merge`, { intoId: coqliqo.id });
    expect(merged.json.contacts.map((c: any) => c.name)).toEqual(['Romain Durand', 'Hans Weber']);
    expect((await env.call('GET', '/settings')).json.prestataires.map((p: any) => p.name)).toEqual(['Coqliqo SAS']);
    expect(new Set((await project()).items.prestations.map((x: any) => x.prestataire))).toEqual(new Set(['Coqliqo SAS']));
  });

  it('archive et supprime un prestataire inutilisé', async () => {
    const p = (await env.call('POST', '/settings/prestataires', { name: 'Essai' })).json;
    const archived = await env.call('PUT', `/settings/prestataires/${p.id}`, { name: 'Essai', active: false });
    expect(archived.json.active).toBe(false);
    expect((await env.call('DELETE', `/settings/prestataires/${p.id}`)).status).toBe(204);
  });
});
