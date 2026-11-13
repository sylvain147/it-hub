import { z } from 'zod';
import type { CellValue } from './files/xlsx.js';

/**
 * Patch management : les tests à réaliser après chaque patch des serveurs (ex-onglet « Tests » du classeur de l'équipe).
 * Des lignes de tests configurables (qui, quoi, description, résultat attendu, adresses), et une colonne par session de
 * patch (environnement et date) où l'on note le résultat de chaque test : OK, KO ou sans objet, avec un commentaire.
 */

export const PATCH_ENVS = ['PROD', 'TEST'] as const;
export type PatchEnv = (typeof PATCH_ENVS)[number];
export const PATCH_ENV_LABELS: Record<PatchEnv, string> = { PROD: 'Production', TEST: 'Testing' };

export const PATCH_STATUSES = ['ok', 'ko', 'na'] as const;
export type PatchStatus = (typeof PATCH_STATUSES)[number];
export const PATCH_STATUS_LABELS: Record<PatchStatus, string> = { ok: 'OK', ko: 'KO', na: 'Sans objet' };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const text = (max: number) => z.string().trim().max(max).default('');

export const patchTestInputSchema = z.object({
  /** Qui fait le test (équipe, prestataire). */
  who: text(100),
  /** Ce qui est testé (application, serveur, proxy…). */
  what: text(200),
  description: text(2000),
  /** Paramètres et résultat attendu. */
  expected: text(2000),
  /** Adresse à tester en production et en testing. */
  urlProd: text(500),
  urlTest: text(500),
});
export type PatchTestInput = z.input<typeof patchTestInputSchema>;

export interface PatchTest extends z.infer<typeof patchTestInputSchema> {
  id: string;
  /** Rang dans la liste (ordre choisi par l'équipe). */
  position: number;
  /** Retiré : n'apparaît plus pour les nouvelles sessions, mais garde ses résultats passés. */
  archived: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export const updatePatchTestBody = patchTestInputSchema.partial().extend({ archived: z.boolean().optional() });
export const reorderPatchTestsBody = z.object({ ids: z.array(z.string().max(40)).max(500) });

export const patchSessionInputSchema = z.object({
  env: z.enum(PATCH_ENVS),
  date: isoDate,
  /** Précision libre (créneau, « 20:00 à 22:00 »…). */
  note: text(200),
});
export type PatchSessionInput = z.input<typeof patchSessionInputSchema>;

export const patchResultBody = z.object({
  /** Vide : pas encore fait. */
  status: z.enum([...PATCH_STATUSES, '']),
  comment: text(1000),
});
export type PatchResultBody = z.input<typeof patchResultBody>;

export interface PatchResult {
  status: PatchStatus | '';
  comment: string;
  at: string;
  by: string;
}

export interface PatchSession extends z.infer<typeof patchSessionInputSchema> {
  id: string;
  /** Résultat de chaque test (par identifiant de test). */
  results: Record<string, PatchResult>;
  createdAt: string;
  createdBy: string;
}

export interface PatchOverview {
  tests: PatchTest[];
  /** De la plus récente à la plus ancienne. */
  sessions: PatchSession[];
}

/** Sessions de la plus récente à la plus ancienne. */
export const byRecentSession = (a: PatchSession, b: PatchSession) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/** Avancement d'une session : tests faits, KO, restants (sur les tests actifs ou déjà renseignés). */
export function sessionProgress(s: PatchSession, tests: PatchTest[]) {
  const shown = tests.filter((t) => !t.archived || s.results[t.id]?.status);
  const status = (t: PatchTest) => s.results[t.id]?.status ?? '';
  return { total: shown.length, done: shown.filter((t) => status(t)).length, ko: shown.filter((t) => status(t) === 'ko').length };
}

// ---------------------------------------------------------------------------
// Reprise de l'ancien classeur (lu dans le navigateur)
// ---------------------------------------------------------------------------

export const patchImportBody = z.object({
  tests: z.array(patchTestInputSchema).min(1, 'Aucun test à reprendre').max(300),
  sessions: z
    .array(
      patchSessionInputSchema.extend({
        /** Résultats, par rang du test dans `tests`. */
        results: z.array(z.object({ test: z.number().int().min(0), status: z.enum(PATCH_STATUSES), comment: text(1000) })).max(300),
      }),
    )
    .max(300),
});
export type PatchImportBody = z.input<typeof patchImportBody>;

const cell = (v: CellValue | undefined) => String(v ?? '').trim();

/** « OK », « KO\nPas de mire », « - », « OK Non fait » → statut et commentaire (« ? » : pas de statut). */
export function parsePatchCell(raw: string): { status: PatchStatus; comment: string } | null {
  const v = raw.trim();
  if (!v) return null;
  const m = /^(ok|ko|-)(.*)$/is.exec(v);
  if (!m) return { status: 'na', comment: v };
  const status: PatchStatus = m[1]!.toLowerCase() === 'ok' ? 'ok' : m[1]!.toLowerCase() === 'ko' ? 'ko' : 'na';
  // « OKO » (faute de frappe) : OK.
  const comment = m[2]!.replace(/^o\b/i, '').replace(/\s*\n\s*/g, ' ').trim();
  return { status, comment };
}

/** En-tête de colonne de session : « PROD\n19/12/25 », « TEST 13/11 », « PROD 17/04 ». */
function sessionHeader(raw: string): { env: PatchEnv; day: number; month: number; year: number | null } | null {
  const m = /^(prod|test)\w*\s*[\n ]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i.exec(raw.trim());
  if (!m) return null;
  const y = m[4] ? Number(m[4]) : null;
  return { env: m[1]!.toUpperCase().startsWith('PROD') ? 'PROD' : 'TEST', day: Number(m[2]), month: Number(m[3]), year: y === null ? null : y < 100 ? 2000 + y : y };
}

/**
 * Lit l'onglet des tests de l'ancien classeur : en-tête « Qui | Quoi | Description | Paramètres & résultats attendus »,
 * puis une colonne par session (« PROD 19/12/25 »). Une ligne sans « Quoi » reprend celui de la ligne précédente. Entre
 * « Paramètres » et les sessions : remarques (ajoutées au résultat attendu) et adresse de testing.
 * Une date sans année suit la précédente (année suivante si le mois recule).
 */
export function parsePatchTestsSheet(rows: CellValue[][]): PatchImportBody | null {
  const h = rows.findIndex((r) => /^qui$/i.test(cell(r[1])) && /^quoi$/i.test(cell(r[2])));
  if (h < 0) return null;
  const header = rows[h]!;
  const cols: { col: number; env: PatchEnv; date: string }[] = [];
  let year = new Date().getFullYear();
  let lastMonth = 0;
  for (let c = 4; c < header.length; c++) {
    const s = sessionHeader(cell(header[c]));
    if (!s) continue;
    if (s.year) year = s.year;
    else if (lastMonth && s.month < lastMonth) year++;
    lastMonth = s.month;
    cols.push({ col: c, env: s.env, date: `${year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}` });
  }
  const first = cols[0]?.col ?? header.length;
  const tests: PatchImportBody['tests'] = [];
  const results = cols.map(() => [] as PatchImportBody['sessions'][number]['results']);
  let who = '';
  let what = '';
  for (const r of rows.slice(h + 1)) {
    const description = cell(r[3]);
    if (!cell(r[1]) && !cell(r[2]) && !description) continue;
    if (cell(r[2])) {
      what = cell(r[2]);
      who = cell(r[1]) === '-' || cell(r[1]) === '*' ? '' : cell(r[1]);
    } else if (cell(r[1]) && cell(r[1]) !== '-' && cell(r[1]) !== '*') who = cell(r[1]);
    // « Paramètres » : une adresse (production) ou le résultat attendu ; colonnes suivantes : remarque, adresse de testing.
    const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
    const extra = Array.from({ length: Math.max(0, first - 5) }, (_, i) => cell(r[5 + i])).filter(Boolean);
    tests.push({
      who,
      what,
      description,
      expected: [isUrl(cell(r[4])) ? '' : cell(r[4]), ...extra.filter((v) => !isUrl(v))].filter(Boolean).join('\n'),
      urlProd: isUrl(cell(r[4])) ? cell(r[4]) : '',
      urlTest: extra.filter(isUrl).at(-1) ?? '',
    });
    cols.forEach((c, i) => {
      const v = parsePatchCell(cell(r[c.col]));
      if (v) results[i]!.push({ test: tests.length - 1, ...v });
    });
  }
  if (!tests.length) return null;
  return { tests, sessions: cols.map((c, i) => ({ env: c.env, date: c.date, note: '', results: results[i]! })) };
}
