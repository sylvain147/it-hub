import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDeskExport } from '@samm/shared';
import { setupTestEnv } from './helpers.js';
import { DESK_CSV } from '../../../packages/shared/test/fixtures/tma.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const USER = 'alice@test';
const APERCU = { 'x-ia-apercu': '1' };

describe('récapitulatif avant un traitement IA', () => {
  it('décrit le classement des tickets Desk sans rien lancer', async () => {
    await env.call('POST', '/tma/desk/import', { fileName: 'Tkt_Lst.csv', tickets: parseDeskExport(DESK_CSV).tickets });
    const r = await env.call('POST', '/tma/desk/classify', { all: false }, USER, APERCU);
    expect(r.status).toBe(200);
    expect(r.json.apercu).toMatchObject({ job: 'tma_classify', simulated: true, budget: { limitUsd: 30 } });
    expect(r.json.apercu.steps[0]).toContain('4 tickets Desk');
    expect(r.json.apercu.calls[0]).toMatchObject({ tier: 'fast', count: 1 });
    expect(r.json.apercu.estimatedUsd).toBeGreaterThan(0);
    // Rien n'a été lancé : aucun ticket classé, le classement reste possible.
    expect((await env.call('GET', '/tma')).json.desk.classifiedCount).toBe(0);
    const started = await env.call('POST', '/tma/desk/classify', { all: false });
    expect(started.status).toBe(202);
    await env.waitJob(started.json.id);
  });

  it('décrit l’analyse d’un compte rendu et la création d’un CDC, sans rien créer', async () => {
    const p = (await env.call('POST', '/projects', { name: 'Portail', description: 'Un portail.' })).json;
    const digest = await env.call('POST', `/projects/${p.id}/digest`, { text: 'Compte rendu : il faut corriger la recherche des fournisseurs.' }, USER, APERCU);
    expect(digest.json.apercu).toMatchObject({ job: 'project_digest', calls: [expect.objectContaining({ tier: 'fast' })] });
    const cdc = await env.call('POST', `/projects/${p.id}/cdcs`, { withAi: true }, USER, APERCU);
    expect(cdc.json.apercu.calls.map((c: any) => c.tier)).toEqual(['smart']);
    const report = await env.call('POST', `/projects/${p.id}/report`, undefined, USER, APERCU);
    expect(report.json.apercu.job).toBe('project_report');
    const after = (await env.call('GET', `/projects/${p.id}`)).json;
    expect(after.cdcs).toEqual([]);
    expect(after.items.notes).toEqual([]);
    expect(after.activeJobId).toBeNull();
  });

  it('décrit les traitements d’un CDC sans le verrouiller ni le modifier', async () => {
    const p = (await env.call('POST', '/projects', { name: 'Intranet' })).json;
    const cdc = (await env.call('POST', `/projects/${p.id}/cdcs`, { withAi: false })).json.id;
    const { json: detail } = await env.call('GET', `/cdcs/${cdc}`);
    const tr = await env.call('POST', `/cdcs/${cdc}/translations`, { lang: 'en' }, USER, APERCU);
    expect(tr.json.apercu.job).toBe('translate');
    const rework = await env.call('POST', `/cdcs/${cdc}/sections/${detail.document.sections[0].id}/rework`, { baseSeq: detail.currentVersion.seq, instruction: 'Plus court' }, USER, APERCU);
    expect(rework.json.apercu.job).toBe('rework_section');
    expect((await env.call('GET', `/cdcs/${cdc}`)).json.activeJobId).toBeNull();
  });
});
