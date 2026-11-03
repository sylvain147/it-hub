import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExcerpt, parseFile } from '@samm/shared';
import { setupTestEnv } from './helpers.js';
import { applyPatch, sanitizeSpec } from '../src/filetypes/pipeline.js';
import { demoSpec } from '../../../packages/shared/test/fixtures/demo-spec.js';

const demo = readFileSync(join(__dirname, '../../../packages/shared/test/fixtures/demo.ww'), 'utf8');
let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

describe('module Lecteur de fichiers', () => {
  let id = '';

  it('crée un type de fichier à partir d’un exemple anonymisé et d’une documentation', async () => {
    const excerpt = buildExcerpt(demo, { anonymize: true, keepPrefix: 8 });
    const res = await env.call('POST', '/filetypes', {
      name: 'Flux WIWW',
      notes: 'Les lignes 3102 sont les articles de la facture 3101.',
      sampleFileName: 'envoi.ww',
      excerpt: excerpt.text,
      anonymized: true,
      documents: [{ name: 'spec.xlsx', text: 'Onglet 3101 | Pos 1 | Long 8 | Type d’enregistrement' }],
    });
    expect(res.status).toBe(201);
    id = res.json.id;
    const job = await env.waitJob(res.json.job.id);
    expect(job.error).toBe('');
    expect(job.status).toBe('termine');
    const { json: d } = await env.call('GET', `/filetypes/${id}`);
    expect(d.currentVersion).toEqual({ seq: 1, label: '1' });
    expect(d.spec.recordTypes.length).toBeGreaterThan(3);
    expect(d.documents).toEqual([{ name: 'spec.xlsx', chars: 52 }]);
    expect(d.excerpt).not.toContain('CHEMISE');
    expect(d.activeJobId).toBeNull();
    // la fiche simulée lit le vrai fichier sans ligne inconnue
    expect(parseFile(d.spec, demo).unknown).toHaveLength(0);
  });

  it('ajuste la fiche avec une consigne et des lignes supplémentaires', async () => {
    const start = await env.call('POST', `/filetypes/${id}/adjust`, { baseSeq: 1, instruction: 'Le montant est en centimes', extraLines: 'WIWW9999 ligne inconnue' });
    expect(start.status).toBe(202);
    const job = await env.waitJob(start.json.id);
    expect(job.error).toBe('');
    const { json: d } = await env.call('GET', `/filetypes/${id}`);
    expect(d.currentVersion.seq).toBe(2);
    expect(d.excerpt).toContain('WIWW9999');
  });

  it('enregistre une fiche modifiée à la main, refuse une version obsolète, restaure', async () => {
    const save = await env.call('PUT', `/filetypes/${id}/spec`, { baseSeq: 2, spec: demoSpec, comment: 'Fiche corrigée' });
    expect(save.status).toBe(200);
    expect(save.json.version).toMatchObject({ seq: 3, origin: 'manuel' });
    expect(save.json.detail.recordTypeCount).toBe(7);
    expect((await env.call('PUT', `/filetypes/${id}/spec`, { baseSeq: 2, spec: demoSpec })).status).toBe(409);
    const versions = await env.call('GET', `/filetypes/${id}/versions`);
    expect(versions.json.map((v: any) => v.seq)).toEqual([3, 2, 1]);
    const restore = await env.call('POST', `/filetypes/${id}/versions/1/restore`, { baseSeq: 3 });
    expect(restore.json.version).toMatchObject({ seq: 4, origin: 'restauration' });
  });

  it('crée un type sans documentation, liste, renomme et supprime', async () => {
    const res = await env.call('POST', '/filetypes', { name: 'Export CSV', excerpt: 'a;b;c\n1;2;3\n4;5;6', anonymized: false });
    const job = await env.waitJob(res.json.job.id);
    expect(job.error).toBe('');
    const { json: d } = await env.call('GET', `/filetypes/${res.json.id}`);
    expect(d.spec.format).toBe('delimited');
    const list = await env.call('GET', '/filetypes');
    expect(list.json.map((t: any) => t.name)).toEqual(expect.arrayContaining(['Flux WIWW', 'Export CSV']));
    const ren = await env.call('PATCH', `/filetypes/${res.json.id}`, { name: 'Export CSV clients', description: 'Exports quotidiens' });
    expect(ren.json.name).toBe('Export CSV clients');
    expect((await env.call('DELETE', `/filetypes/${res.json.id}`)).status).toBe(204);
    expect((await env.call('GET', `/filetypes/${res.json.id}`)).status).toBe(404);
  });

  it('valide les entrées', async () => {
    expect((await env.call('POST', '/filetypes', { name: '', excerpt: 'x', anonymized: true })).status).toBe(400);
    expect((await env.call('POST', '/filetypes', { name: 'X', excerpt: '', anonymized: true })).status).toBe(400);
  });
});

describe('fusion des correctifs de l’IA', () => {
  const settings = { format: 'fixed' as const, encoding: 'utf-8' as const, delimiter: ';', quote: '"', skipLines: 0, fileNamePattern: '' };
  const field = (key: string, start: number, length: number) => ({ key, label: key, start, length, type: 'text' as const, impliedDecimals: 0, dateFormat: '', values: [], description: '', hidden: false });

  it('remplace les types modifiés, garde les autres, supprime et nettoie', () => {
    const patched = applyPatch(demoSpec, {
      settings: null,
      upsertRecordTypes: [
        { code: '3101', name: 'Facture corrigée', description: '', role: 'group', match: [{ start: 5, length: 4, value: '3101' }], parent: null, fields: [field('numero', 9, 19), field('numero', 28, 5)] },
        { code: 'NEW', name: 'Nouveau', description: '', role: 'other', match: [{ start: 1, length: 3, value: 'NEW' }], parent: 'INCONNU', fields: [] },
      ],
      removeRecordTypes: ['3300'],
      checks: null,
      summary: '',
      remarks: [],
    });
    expect(patched.recordTypes.find((r) => r.code === '3101')!.name).toBe('Facture corrigée');
    expect(patched.recordTypes.find((r) => r.code === '3101')!.fields.map((f) => f.key)).toEqual(['numero', 'numero_2']);
    expect(patched.recordTypes.find((r) => r.code === 'NEW')!.parent).toBeNull();
    expect(patched.recordTypes.some((r) => r.code === '3300')).toBe(false);
    expect(patched.recordTypes.find((r) => r.code === '3102')!.parent).toBe('3101');
    // le contrôle sur le bloc 3300 supprimé disparaît, l'autre reste
    expect(patched.checks.map((c) => c.label)).toEqual(['Nombre de factures annoncé']);
  });

  it('refuse une fiche sans aucun type de ligne', () => {
    expect(() => sanitizeSpec({ settings, recordTypes: [], checks: [] })).toThrow(/aucun type/);
  });
});
