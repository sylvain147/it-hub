import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoSpec } from './fixtures/demo-spec.js';
import { parseFile, readRecord, diagnostics, specToText, scoreSpec, decodeFile, convert, parseDecimal } from '../src/files/parse.js';
import { buildExcerpt, anonymizeLine } from '../src/files/excerpt.js';
import { writeXlsx, xlsxToText } from '../src/files/xlsx.js';
import { fileSpecSchema } from '../src/files/spec.js';

const demo = readFileSync(join(__dirname, 'fixtures/demo.ww'), 'utf8');

describe('lecture d’un fichier à positions fixes', () => {
  const r = parseFile(demoSpec, demo);

  it('reconnaît chaque type d’enregistrement et rattache les lignes à leur facture', () => {
    expect(r.unknown).toEqual([]);
    expect(r.byType.get('3101')).toHaveLength(4);
    const firstInvoice = r.byType.get('3101')![0]!;
    expect(r.children.get(firstInvoice)?.length).toBe(1);
    expect(r.fieldErrorCount).toBe(0);
  });

  it('convertit dates, entiers, montants et codes', () => {
    const header = readRecord(r, r.byType.get('3000')![0]!);
    expect(header.values[1]).toMatchObject({ value: '2026-11-02', display: '02/11/2026' });
    const line = readRecord(r, r.byType.get('3102')![0]!);
    const byKey = Object.fromEntries(line.type!.fields.map((f, i) => [f.key, line.values[i]!]));
    expect(byKey.libelle!.value).toBe('CHEMISE LIN BLANC');
    expect(byKey.montant!.value).toBe(4.5);
    expect(byKey.devise!.display).toBe('Euro (EUR)');
  });

  it('vérifie les contrôles de fin de bloc', () => {
    const c = r.checks.find((x) => x.label === 'Nombre de factures annoncé')!;
    expect(c).toMatchObject({ expected: 4, actual: 4, ok: true });
    expect(r.checks.find((x) => x.label === 'Nombre d’avoirs annoncé')).toMatchObject({ expected: 0, actual: 0, ok: true });
  });

  it('signale lignes inconnues, erreurs et contrôles en échec', () => {
    const broken = demo.replace('WIWW3199000000400', 'WIWW3199000000500') + 'XXXXligne inconnue\n';
    const spec = fileSpecSchema.parse({ ...demoSpec, recordTypes: demoSpec.recordTypes.map((t) => (t.code === '3000' ? { ...t, fields: [...t.fields.slice(0, 1), { ...t.fields[1]!, dateFormat: 'DD/MM/YYYY' }, t.fields[2]] } : t)) });
    const b = parseFile(spec, broken);
    expect(b.unknown).toHaveLength(1);
    expect(b.fieldErrorCount).toBe(1);
    expect(b.checks[0]).toMatchObject({ expected: 5, actual: 4, ok: false });
    const diag = diagnostics(b);
    expect(diag).toContain('non reconnus : 1');
    expect(diag).toContain('ÉCHEC');
    expect(diag).toContain('[3102]');
    expect(specToText(spec)).toContain('115+14 montant decimal');
  });

  it('reconnaît le bon type de fichier', () => {
    expect(scoreSpec(demoSpec, demo, 'envoi.ww')).toBeGreaterThan(0.9);
    const csvSpec = fileSpecSchema.parse({ format: 'delimited', delimiter: ';', recordTypes: [{ code: 'L', name: 'Ligne', match: [{ start: 1, length: 0, value: 'L' }], fields: [] }] });
    expect(scoreSpec(csvSpec, demo)).toBe(0);
  });
});

describe('fichiers délimités et conversions', () => {
  it('lit un CSV avec en-tête et guillemets', () => {
    const spec = fileSpecSchema.parse({
      format: 'delimited',
      delimiter: ';',
      skipLines: 1,
      recordTypes: [
        {
          code: 'ligne',
          name: 'Ligne',
          fields: [
            { key: 'client', label: 'Client', start: 1, length: 0, type: 'text' },
            { key: 'montant', label: 'Montant', start: 2, length: 0, type: 'decimal' },
            { key: 'date', label: 'Date', start: 3, length: 0, type: 'date', dateFormat: 'DD/MM/YYYY' },
          ],
        },
      ],
    });
    const r = parseFile(spec, 'client;montant;date\n"Dupont; fils";1 234,50;31/12/2026\nMartin;-12,3;00/00/0000\n');
    expect(r.records).toHaveLength(2);
    const v = readRecord(r, 0).values;
    expect(v[0]!.value).toBe('Dupont; fils');
    expect(v[1]!.value).toBe(1234.5);
    expect(v[2]!.value).toBe('2026-12-31');
    expect(readRecord(r, 1).values[2]!.value).toBeNull();
  });

  it('gère signes, décimales implicites et formats de date', () => {
    expect(parseDecimal('000012345-', 2)).toBe(-123.45);
    expect(parseDecimal('12.5', 2)).toBe(12.5);
    expect(parseDecimal('abc', 0)).toBeUndefined();
    const f = { key: 'd', label: 'd', start: 1, length: 8, type: 'date' as const, impliedDecimals: 0, dateFormat: 'DDMMYYYY', values: [], description: '', hidden: false };
    expect(convert(f, '31022026').error).toBeTruthy();
    expect(convert(f, '28022026').value).toBe('2026-02-28');
    const big = { ...f, type: 'integer' as const, dateFormat: '' };
    expect(convert(big, '0024712220710718822').value).toBe('24712220710718822');
    expect(convert(big, '000042').value).toBe(42);
  });

  it('relit en Windows-1252 un fichier qui n’est pas en UTF-8', () => {
    const bytes = new Uint8Array([0x45, 0x55, 0x52, 0x20, 0xe9]); // « EUR é » en ANSI
    expect(decodeFile(bytes, 'utf-8')).toEqual({ text: 'EUR é', encoding: 'windows-1252' });
  });
});

describe('extrait anonymisé', () => {
  it('garde la structure (préfixe, longueurs, dates, codes courts) et masque le reste', () => {
    const line = 'WIWW3102000000101 CHEMISE LIN BLANC 2026-11-02 EUR 00000000045000';
    const a = anonymizeLine(line, 8);
    expect(a).toHaveLength(line.length);
    expect(a.startsWith('WIWW3102')).toBe(true);
    expect(a).toContain('2026-11-02');
    expect(a).toContain(' EUR ');
    expect(a).not.toContain('CHEMISE');
  });

  it('échantillonne chaque forme de ligne et la fin du fichier', () => {
    const big = Array.from({ length: 500 }, (_, i) => `A${String(i).padStart(5, '0')}`).concat(['Z99 fin']).join('\n');
    const e = buildExcerpt(big, { anonymize: false, keepPrefix: 1 });
    expect(e.totalLines).toBe(501);
    expect(e.text).toContain('Z99 fin');
    expect(e.lines.length).toBeLessThan(60);
  });
});

describe('classeurs Excel', () => {
  it('écrit puis relit un classeur', () => {
    const bytes = writeXlsx([
      { name: 'Enregistrement 12', rows: [['Pos.', 'Long.', 'Description'], [1, 2, 'Type d’enregistrement « 12 »'], [3, null, 'A & B < C']] },
      { name: 'Autre', rows: [['x']] },
    ]);
    const { sheets } = xlsxToText(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Enregistrement 12', 'Autre']);
    expect(sheets[0]!.text).toBe('Pos. | Long. | Description\n1 | 2 | Type d’enregistrement « 12 »\n3 |  | A & B < C');
  });
});
