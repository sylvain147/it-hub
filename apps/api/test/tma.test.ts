import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDeskExport, parseTmaWorkbook } from '@samm/shared';
import { setupTestEnv } from './helpers.js';
import { reportToMarkdown } from '../src/tma/jobs.js';
import { DESK_CSV, tmaWorkbook, TMA_ROWS } from '../../../packages/shared/test/fixtures/tma.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let otherTicket = '';
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

describe('module Suivi TMA', () => {
  const { tickets } = parseDeskExport(DESK_CSV);
  const october = parseTmaWorkbook(tmaWorkbook()).entries;
  // Septembre : mêmes activités, un mois plus tôt.
  const september = parseTmaWorkbook(tmaWorkbook(TMA_ROWS.map(([d, ...rest]) => [d - 30, ...rest]))).entries;

  it('part d’un module vide', async () => {
    const { json } = await env.call('GET', '/tma');
    expect(json).toEqual({
      months: [],
      desk: { ticketCount: 0, classifiedCount: 0, firstCreatedAt: null, lastCreatedAt: null, lastImportAt: null, lastImportBy: null, activeJobId: null },
    });
    expect((await env.call('POST', '/tma/desk/classify', {})).status).toBe(400);
  });

  it('importe un export Desk puis le réimporte sans doublon', async () => {
    const first = await env.call('POST', '/tma/desk/import', { fileName: 'Tkt_Lst.csv', tickets: tickets.slice(0, 2) });
    expect(first.json).toEqual({ created: 2, updated: 0, total: 2 });
    const second = await env.call('POST', '/tma/desk/import', { fileName: 'Tkt_Lst.csv', tickets });
    expect(second.json).toEqual({ created: 2, updated: 2, total: 4 });
    const { json } = await env.call('GET', '/tma');
    expect(json.desk).toMatchObject({ ticketCount: 4, classifiedCount: 0, firstCreatedAt: '2026-08-25T09:38', lastImportBy: 'alice@test' });
  });

  it('classe les tickets par thème et conserve les thèmes à la réimportation', async () => {
    const start = await env.call('POST', '/tma/desk/classify', {});
    expect(start.status).toBe(202);
    const job = await env.waitJob(start.json.id);
    expect(job.error).toBe('');
    expect(job.step).toMatch(/4 ticket\(s\) classé\(s\)/);
    expect((await env.call('POST', '/tma/desk/classify', {})).status).toBe(400); // tout est classé
    await env.call('POST', '/tma/desk/import', { tickets });
    const { json } = await env.call('GET', '/tma');
    expect(json.desk.classifiedCount).toBe(4);
    // Reclassement complet sur demande.
    const again = await env.waitJob((await env.call('POST', '/tma/desk/classify', { all: true })).json.id);
    expect(again.status).toBe('termine');
  });

  it('importe les relevés mensuels et calcule le rapport', async () => {
    expect((await env.call('PUT', '/tma/months/2026-09', { fileName: 'TMA oct.xlsx', entries: october })).status).toBe(400); // mauvais mois
    await env.call('PUT', '/tma/months/2026-09', { fileName: 'TMA SEPTEMBRE.xlsx', entries: september });
    const put = await env.call('PUT', '/tma/months/2026-10', { fileName: 'TMA OCTOBRE.xlsx', entries: october });
    expect(put.status).toBe(200);
    const r = put.json.report;
    expect(r).toMatchObject({ month: '2026-10', totalHours: 8.8, pilotageHours: 1, createdTickets: 3, unknownTickets: ['8503'], unclassified: 0 });
    expect(r.previous).toMatchObject({ month: '2026-09', totalHours: 8.8 });
    expect(r.byTicket.find((t: any) => t.id === '11884').ticket.theme).toBe('Chèques – erreur de montant / impayé');
    expect(r.timeByTheme[0]).toMatchObject({ key: 'Chèques – erreur de montant / impayé' });
    expect(put.json.entries).toHaveLength(5);
    expect(put.json.synthesis).toBeNull();
    const { json } = await env.call('GET', '/tma');
    expect(json.months.map((m: any) => [m.month, m.entryCount, m.totalHours])).toEqual([
      ['2026-10', 5, 8.8],
      ['2026-09', 5, 8.8],
    ]);
  });

  it('compte le temps des relevés sur les contacts des prestataires et signale les intervenants inconnus', async () => {
    // Aucun prestataire : tous les intervenants sont inconnus.
    expect((await env.call('GET', '/tma/months/2026-10')).json.people['Romain Durand']).toBeNull();
    const coq = (await env.call('POST', '/settings/prestataires', { name: 'Coqliqo' })).json;
    let p = (await env.call('POST', `/settings/prestataires/${coq.id}/contacts`, { name: 'DURAND Romain' })).json;
    p = (await env.call('POST', `/settings/prestataires/${coq.id}/contacts`, { name: 'Jérôme Martin' })).json;
    p = (await env.call('POST', `/settings/prestataires/${coq.id}/contacts`, { name: 'Alain Didier' })).json;
    const [durand] = p.contacts;

    const put = await env.call('PUT', '/tma/months/2026-09', { fileName: 'TMA SEPTEMBRE.xlsx', entries: september });
    expect(put.json.unknownPeople).toEqual(['Alexandre Robert']);
    expect(put.json.people['Romain Durand']).toEqual({ prestataireId: coq.id, prestataireName: 'Coqliqo', contactId: durand.id, contactName: 'DURAND Romain' });
    expect(put.json.people['Alexandre Robert']).toBeNull();

    const hours = (await env.call('GET', '/tma/prestataires')).json;
    expect(hours.byContact[durand.id]).toEqual({ hours: 4, months: [{ month: '2026-09', hours: 2 }, { month: '2026-10', hours: 2 }] });
    expect(hours.byPrestataire[coq.id].hours).toBe(15.5);
    expect(hours.unknown).toEqual([{ person: 'Alexandre Robert', hours: 2 }]);

    // Une fois ajouté au carnet, l'intervenant n'est plus signalé.
    await env.call('POST', `/settings/prestataires/${coq.id}/contacts`, { name: 'Alexandre Robert' });
    expect((await env.call('PUT', '/tma/months/2026-09', { fileName: 'TMA SEPTEMBRE.xlsx', entries: september })).json.unknownPeople).toEqual([]);
    expect((await env.call('GET', '/tma/prestataires')).json).toMatchObject({ unknown: [], byPrestataire: { [coq.id]: { hours: 17.5 } } });
  });

  it('rattache un ticket du hub à un ticket Desk du prestataire', async () => {
    const projectId = (await env.call('POST', '/projects', { name: 'Encaissements' })).json.id;
    expect((await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'X', deskId: '12a' })).status).toBe(400);
    const t = await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Corriger les montants des chèques', deskId: '#11884' });
    expect(t.status).toBe(201);
    expect(t.json.deskId).toBe('11884');
    const other = await env.call('POST', '/projects/hors-projet/items/tasks', { title: 'Suivi du correctif chèques', deskId: '011884', spentHours: 2 });
    otherTicket = other.json.id;

    const info = (await env.call('GET', '/tma/desk/tickets/11884')).json;
    const oct = (await env.call('GET', '/tma/months/2026-10')).json;
    const octHours = oct.report.byTicket.find((x: any) => x.id === '11884').hours;
    expect(info.ticket).toMatchObject({ id: '11884', theme: 'Chèques – erreur de montant / impayé' });
    expect(info.months.map((m: any) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(info.months[1].hours).toBe(octHours);
    expect(info.hours).toBe(info.months[0].hours + info.months[1].hours);
    expect(info.hubTickets.map((h: any) => [h.title, h.projectName])).toEqual([
      ['Corriger les montants des chèques', 'Encaissements'],
      ['Suivi du correctif chèques', 'Hors projet'],
    ]);
    expect(info.hubTickets[0].key).toMatch(/^T-\d+$/);
    // Le relevé du mois signale les tickets du hub rattachés.
    expect(oct.hubTickets['11884']).toHaveLength(2);
    // Ticket Desk inconnu : rien, sans erreur.
    expect((await env.call('GET', '/tma/desk/tickets/999999')).json).toMatchObject({ ticket: null, hours: 0, months: [], hubTickets: [] });
    expect((await env.call('GET', '/tma/desk/tickets/abc')).status).toBe(400);
    // Le temps des relevés passe sur les tickets rattachés, en plus du temps saisi à la main.
    expect(t.json).toMatchObject({ spentHours: info.hours, tmaHours: info.hours });
    expect(other.json).toMatchObject({ spentHours: 2 + info.hours, tmaHours: info.hours });
    // Saisi à la main, le temps passé garde la part du prestataire.
    expect((await env.call('PATCH', `/projects/${projectId}/items/tasks/${t.json.id}`, { spentHours: info.hours + 1 })).json).toMatchObject({ spentHours: info.hours + 1, tmaHours: info.hours });
    expect((await env.call('PATCH', `/projects/${projectId}/items/tasks/${t.json.id}`, { spentHours: null })).json).toMatchObject({ spentHours: info.hours, tmaHours: info.hours });
    // Le numéro Desk s'efface, et la part du prestataire avec lui.
    const cleared = await env.call('PATCH', `/projects/${projectId}/items/tasks/${t.json.id}`, { deskId: '' });
    expect(cleared.json).toMatchObject({ deskId: '', spentHours: null, tmaHours: null });
    // Ticket rattaché après coup.
    const late = await env.call('POST', `/projects/${projectId}/items/tasks`, { title: 'Relance prestataire', spentHours: 1 });
    expect(late.json.tmaHours).toBeNull();
    expect((await env.call('PATCH', `/projects/${projectId}/items/tasks/${late.json.id}`, { deskId: '11884' })).json).toMatchObject({ spentHours: 1 + info.hours, tmaHours: info.hours });
    await env.call('DELETE', `/projects/${projectId}/items/tasks/${late.json.id}`);
  });

  /** Temps du ticket hors projet rattaché au ticket Desk #11884. */
  const otherTimes = async () => {
    const t = (await env.call('GET', '/sprints')).json.tickets.find((x: any) => x.id === otherTicket);
    return { spentHours: t.spentHours, tmaHours: t.tmaHours };
  };
  const deskHours = async () => (await env.call('GET', '/tma/desk/tickets/11884')).json.hours;

  it('rédige la synthèse à partir des seuls chiffres, et l’efface si le relevé est remplacé', async () => {
    const start = await env.call('POST', '/tma/months/2026-10/synthesis');
    expect(start.status).toBe(202);
    const job = await env.waitJob(start.json.id);
    expect(job.error).toBe('');
    const { json } = await env.call('GET', '/tma/months/2026-10');
    expect(json.synthesis.markdown).toContain('Synthèse simulée');
    expect(json.synthesis.createdBy).toBe('alice@test');
    expect(json.info.hasSynthesis).toBe(true);
    // L'entrée du modèle : chiffres agrégés, sans description de ticket.
    const md = reportToMarkdown(json.report);
    expect(md).toContain('Temps total : 9 h');
    expect(md).toContain('#10555 : 3 h — Chèque à 90 jours');
    expect(md).not.toContain('Bonjour');
    const replaced = await env.call('PUT', '/tma/months/2026-10', { entries: october.slice(0, 3) });
    expect(replaced.json.synthesis).toBeNull();
    expect(replaced.json.report.entryCount).toBe(3);
    // Relevé remplacé : la part du prestataire suit, le temps saisi à la main reste.
    const h = await deskHours();
    expect(await otherTimes()).toEqual({ spentHours: 2 + h, tmaHours: h });
    expect((await env.call('GET', '/usage?month=' + new Date().toISOString().slice(0, 7))).json.byOperation.map((o: any) => o.key)).toEqual(
      expect.arrayContaining(['tma_themes', 'tma_synthese']),
    );
  });

  it('calcule les récurrences par thème sur toute la période', async () => {
    const { json } = await env.call('GET', '/tma/themes');
    expect(json.months).toEqual(['2026-08', '2026-10']);
    const cheques = json.themes.find((t: any) => t.theme.startsWith('Chèques'));
    expect(cheques).toMatchObject({ tickets: 2, byMonth: { '2026-08': 1, '2026-10': 1 } });
    expect(cheques.examples[0].id).toBe('11884');
  });

  it('supprime un mois et valide les entrées', async () => {
    const before = await otherTimes();
    expect((await env.call('DELETE', '/tma/months/2026-09')).status).toBe(204);
    const h = await deskHours();
    expect(h).toBeLessThan(before.tmaHours);
    expect(await otherTimes()).toEqual({ spentHours: 2 + h, tmaHours: h });
    expect((await env.call('GET', '/tma/months/2026-09')).status).toBe(404);
    expect((await env.call('GET', '/tma/months/2026-13')).status).toBe(400);
    expect((await env.call('POST', '/tma/months/2026-09/synthesis')).status).toBe(404);
    expect((await env.call('POST', '/tma/desk/import', { tickets: [] })).status).toBe(400);
    expect((await env.call('POST', '/tma/desk/import', { tickets: [{ ...tickets[0], id: 'abc' }] })).status).toBe(400);
    expect((await env.call('PUT', '/tma/months/2026-10', { entries: [{ ...october[0], hours: 30 }] })).status).toBe(400);
  });
});
