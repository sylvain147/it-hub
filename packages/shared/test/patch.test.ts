import { describe, expect, it } from 'vitest';
import { parsePatchCell, parsePatchTestsSheet, sessionProgress, type PatchSession, type PatchTest } from '../src/patch.js';

describe('patch management', () => {
  it('lit une case de résultat', () => {
    expect(parsePatchCell('OK')).toEqual({ status: 'ok', comment: '' });
    expect(parsePatchCell('Ok')).toEqual({ status: 'ok', comment: '' });
    expect(parsePatchCell('OKO')).toEqual({ status: 'ok', comment: '' });
    expect(parsePatchCell('KO\nPas de mire')).toEqual({ status: 'ko', comment: 'Pas de mire' });
    expect(parsePatchCell('OK Non fait\n- Ticket #12')).toEqual({ status: 'ok', comment: 'Non fait - Ticket #12' });
    expect(parsePatchCell('-')).toEqual({ status: 'na', comment: '' });
    expect(parsePatchCell('?')).toEqual({ status: 'na', comment: '?' });
    expect(parsePatchCell('  ')).toBeNull();
  });

  it('reprend l’onglet des tests de l’ancien classeur (données fictives)', () => {
    const rows = [
      ['Tests à réaliser lors d’un patch'],
      [null, 'Qui', 'Quoi', 'Description', 'Paramètres & résultats attendus', null, null, 'PROD\n19/12/25', 'TEST\n09/01/26', 'PROD 17/04', 'TEST\n13/11'],
      [null, 'Équipe', 'Application', 'Se connecter', 'https://app.exemple.fr', null, 'https://app-test.exemple.fr/', 'OK', 'OK', 'KO\nPage blanche', null],
      [null, null, null, 'Créer une commande', 'Client test / 75000', null, null, 'OK', '-', 'OK', null],
      [null, '-', 'Base de données', 'Validé par le test Application', null, 'Remarque utile', null, '-', 'OK', 'OK', null],
    ];
    const r = parsePatchTestsSheet(rows)!;
    expect(r.tests).toEqual([
      { who: 'Équipe', what: 'Application', description: 'Se connecter', expected: '', urlProd: 'https://app.exemple.fr', urlTest: 'https://app-test.exemple.fr/' },
      { who: 'Équipe', what: 'Application', description: 'Créer une commande', expected: 'Client test / 75000', urlProd: '', urlTest: '' },
      { who: '', what: 'Base de données', description: 'Validé par le test Application', expected: 'Remarque utile', urlProd: '', urlTest: '' },
    ]);
    // Dates sans année : celle de la précédente, l'année suivante quand le mois recule.
    expect(r.sessions.map((s) => `${s.env} ${s.date}`)).toEqual(['PROD 2025-12-19', 'TEST 2026-01-09', 'PROD 2026-04-17', 'TEST 2026-11-13']);
    expect(r.sessions[2]!.results).toEqual([
      { test: 0, status: 'ko', comment: 'Page blanche' },
      { test: 1, status: 'ok', comment: '' },
      { test: 2, status: 'ok', comment: '' },
    ]);
    expect(r.sessions[3]!.results).toEqual([]);
    expect(parsePatchTestsSheet([['a', 'b']])).toBeNull();
  });

  it('mesure l’avancement d’une session, sans les tests retirés jamais renseignés', () => {
    const t = (id: string, archived = false) => ({ id, archived }) as PatchTest;
    const s = { results: { a: { status: 'ok' }, b: { status: 'ko' }, c: { status: '' } } } as unknown as PatchSession;
    expect(sessionProgress(s, [t('a'), t('b'), t('c'), t('d', true), t('b2', true)])).toEqual({ total: 3, done: 2, ko: 1 });
  });
});
