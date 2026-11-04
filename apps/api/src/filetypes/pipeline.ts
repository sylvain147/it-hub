/**
 * Création et mise au point des fiches de lecture par l'IA.
 *
 * Économie :
 *  - la documentation volumineuse (spec, code source) est lue par le modèle rapide, qui produit un brouillon complet ;
 *  - le modèle de rédaction ne renvoie qu'un correctif (types d'enregistrement à corriger), guidé par
 *    la lecture réelle de l'extrait par notre moteur (diagnostic) ;
 *  - seule une passe d'auto-correction automatique au plus ;
 *  - la lecture des fichiers ensuite n'utilise plus du tout l'IA.
 */
import { diagnostics, fileSpecSchema, parseFile, specToText, type FileSpec } from '@samm/shared';
import { callStructured } from '../ai/llm.js';
import { DRAFT_FROM_DOCS_SYSTEM, REFINE_SYSTEM } from './prompts.js';
import { draftSpecSchema, specPatchSchema, type DraftSpec, type SpecPatch } from './ai-schemas.js';

type Ctx = { user: string; cdcId: string };
type Step = (s: string) => Promise<void>;

/** Au-delà, la documentation n'est plus renvoyée à chaque ajustement (le brouillon en a déjà tiré l'essentiel). */
const DOCS_IN_REFINE_MAX_CHARS = 80_000;

export interface PipelineInput {
  excerpt: string;
  anonymized: boolean;
  notes: string;
  sampleFileName: string;
  documents: { name: string; text: string }[];
}

export interface PipelineResult {
  spec: FileSpec;
  summary: string;
  remarks: string[];
}

function numbered(excerpt: string): string {
  return excerpt
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(5)}│${l}`)
    .join('\n');
}

function docsBlock(docs: PipelineInput['documents']): string {
  return docs.map((d) => `===== Document : ${d.name} =====\n${d.text}`).join('\n\n');
}

// ---------------------------------------------------------------------------
// Normalisation des sorties du modèle
// ---------------------------------------------------------------------------

type RawRecordType = DraftSpec['recordTypes'][number];

/** Rend valide une fiche issue du modèle (doublons, références inconnues, positions incohérentes). */
export function sanitizeSpec(input: { settings: DraftSpec['settings']; recordTypes: RawRecordType[]; checks: DraftSpec['checks'] }): FileSpec {
  const byCode = new Map<string, RawRecordType>();
  for (const rt of input.recordTypes) if (rt.code.trim()) byCode.set(rt.code.trim(), { ...rt, code: rt.code.trim() });
  const codes = new Set(byCode.keys());
  const recordTypes = [...byCode.values()].map((rt) => {
    const keys = new Set<string>();
    const fields = rt.fields
      .filter((f) => f.start >= 1)
      .map((f) => {
        let key = (f.key || f.label).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'champ';
        for (let i = 2; keys.has(key); i++) key = `${key.replace(/_\d+$/, '')}_${i}`;
        keys.add(key);
        return {
          ...f,
          key,
          label: f.label.trim() || key,
          length: Math.max(0, f.length),
          impliedDecimals: Math.min(10, Math.max(0, f.impliedDecimals)),
          values: f.values.filter((v) => v.code.trim()).slice(0, 500),
        };
      })
      .slice(0, 300);
    return {
      ...rt,
      name: rt.name.trim() || rt.code,
      match: rt.match.filter((m) => m.start >= 1).slice(0, 5),
      parent: rt.parent && codes.has(rt.parent) && rt.parent !== rt.code ? rt.parent : null,
      fields,
    };
  });
  if (!recordTypes.length) throw new Error('L’assistant n’a décrit aucun type de ligne. Ajoutez des explications et réessayez.');
  const checks = input.checks.filter(
    (c) =>
      codes.has(c.expectedRecord) &&
      byCode.get(c.expectedRecord)!.fields.some((f) => f.key === c.expectedField) &&
      c.targetRecords.length > 0 &&
      c.targetRecords.every((t) => codes.has(t)) &&
      (!c.blockStart || codes.has(c.blockStart)),
  );
  const s = input.settings;
  return fileSpecSchema.parse({
    format: s.format,
    encoding: s.encoding,
    delimiter: s.delimiter || ';',
    quote: s.quote.slice(0, 1),
    skipLines: Math.max(0, s.skipLines),
    fileNamePattern: s.fileNamePattern,
    recordTypes,
    checks,
  });
}

export function applyPatch(spec: FileSpec | null, patch: SpecPatch): FileSpec {
  const settings = patch.settings ??
    (spec
      ? { format: spec.format, encoding: spec.encoding, delimiter: spec.delimiter, quote: spec.quote, skipLines: spec.skipLines, fileNamePattern: spec.fileNamePattern }
      : null);
  if (!settings) throw new Error('L’assistant n’a pas décrit le format général du fichier. Réessayez en ajoutant des explications.');
  const removed = new Set(patch.removeRecordTypes);
  const upserts = new Map(patch.upsertRecordTypes.map((r) => [r.code.trim(), r]));
  const existing: RawRecordType[] = (spec?.recordTypes ?? [])
    .filter((r) => !removed.has(r.code))
    .map((r) => upserts.get(r.code) ?? { ...r, parent: r.parent ?? null });
  const added = patch.upsertRecordTypes.filter((r) => !spec?.recordTypes.some((x) => x.code === r.code.trim()));
  return sanitizeSpec({ settings, recordTypes: [...existing, ...added], checks: patch.checks ?? spec?.checks.map((c) => ({ ...c, blockStart: c.blockStart ?? null })) ?? [] });
}

function hasIssues(spec: FileSpec, excerpt: string): boolean {
  const r = parseFile(spec, excerpt);
  return r.unknown.length > 0 || r.fieldErrorCount > 0 || r.checks.some((c) => !c.ok);
}

// ---------------------------------------------------------------------------
// Appels au modèle
// ---------------------------------------------------------------------------

async function draftFromDocs(input: PipelineInput, ctx: Ctx): Promise<DraftSpec> {
  return callStructured({
    tier: 'fast',
    operation: 'fichier_brouillon',
    system: DRAFT_FROM_DOCS_SYSTEM,
    input: [
      `Nom du fichier exemple : ${input.sampleFileName || '(inconnu)'}`,
      input.notes ? `<explications_utilisateur>\n${input.notes}\n</explications_utilisateur>` : '',
      `<documentation>\n${docsBlock(input.documents)}\n</documentation>`,
      `<extrait${input.anonymized ? ' anonymisé' : ''}>\n${numbered(input.excerpt)}\n</extrait>`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: draftSpecSchema,
    maxTokens: 64000,
    effort: 'low',
    ctx,
  });
}

async function refine(spec: FileSpec | null, input: PipelineInput, instruction: string, operation: string, ctx: Ctx): Promise<SpecPatch> {
  const docs = input.documents.reduce((n, d) => n + d.text.length, 0) <= DOCS_IN_REFINE_MAX_CHARS ? input.documents : [];
  const parts = [
    `Nom du fichier exemple : ${input.sampleFileName || '(inconnu)'}`,
    `<fiche_actuelle>\n${spec ? specToText(spec) : '(vide : à créer)'}\n</fiche_actuelle>`,
    spec ? `<lecture_de_l_extrait>\n${diagnostics(parseFile(spec, input.excerpt))}\n</lecture_de_l_extrait>` : '',
    `<extrait${input.anonymized ? ' anonymisé' : ''}>\n${numbered(input.excerpt)}\n</extrait>`,
    input.notes ? `<explications_utilisateur>\n${input.notes}\n</explications_utilisateur>` : '',
    instruction ? `<demande>\n${instruction}\n</demande>` : '',
  ];
  return callStructured({
    tier: 'smart',
    operation,
    system: REFINE_SYSTEM,
    // La documentation est stable d'un ajustement à l'autre : mise en cache.
    context: docs.length ? `<documentation>\n${docsBlock(docs)}\n</documentation>` : undefined,
    input: parts.filter(Boolean).join('\n\n'),
    schema: specPatchSchema,
    maxTokens: 32000,
    effort: 'medium',
    ctx,
  });
}

// ---------------------------------------------------------------------------
// Parcours
// ---------------------------------------------------------------------------

/** Au-delà, la passe d'auto-correction est sautée pour rester sous la durée maximale d'une Lambda (15 min). */
const AUTO_FIX_DEADLINE_MS = 7 * 60 * 1000;

export async function createSpec(input: PipelineInput, ctx: Ctx, step: Step): Promise<PipelineResult> {
  const started = Date.now();
  let spec: FileSpec | null = null;
  const remarks: string[] = [];
  if (input.documents.length) {
    await step('Lecture de la documentation');
    const draft = await draftFromDocs(input, ctx);
    spec = sanitizeSpec(draft);
    remarks.push(...draft.remarks);
  }

  await step(spec ? 'Vérification sur le fichier exemple' : 'Analyse du fichier exemple');
  let patch = await refine(spec, input, '', 'fichier_mise_au_point', ctx);
  spec = applyPatch(spec, patch);
  const summary = patch.summary;

  if (hasIssues(spec, input.excerpt) && Date.now() - started < AUTO_FIX_DEADLINE_MS) {
    await step('Correction des anomalies restantes');
    patch = await refine(spec, input, 'Corrige les anomalies restantes signalées par la lecture de l’extrait.', 'fichier_correction', ctx);
    spec = applyPatch(spec, patch);
  }
  remarks.push(...patch.remarks);
  return { spec, summary, remarks: [...new Set(remarks)].slice(0, 30) };
}

export async function adjustSpec(spec: FileSpec, input: PipelineInput, instruction: string, ctx: Ctx, step: Step): Promise<PipelineResult> {
  await step('Ajustement de la fiche');
  const patch = await refine(spec, input, instruction, 'fichier_ajustement', ctx);
  return { spec: applyPatch(spec, patch), summary: patch.summary, remarks: patch.remarks };
}
