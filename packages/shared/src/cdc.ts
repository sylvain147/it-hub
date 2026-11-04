import { z } from 'zod';

/** Contenu riche au format ProseMirror / TipTap (JSON). */
export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}
export type RichDoc = RichNode & { type: 'doc' };

export const emptyDoc = (): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(richNodeSchema).optional(),
    marks: z
      .array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() }))
      .optional(),
    text: z.string().optional(),
  }),
);
export const richDocSchema = richNodeSchema as unknown as z.ZodType<RichDoc>;

// ---------------------------------------------------------------------------
// Statuts, phases
// ---------------------------------------------------------------------------

/** Statut du document dans l'appli (workflow de rédaction). */
export const CDC_STATUSES = ['brouillon', 'en_revue', 'valide', 'envoye', 'archive'] as const;
export type CdcStatus = (typeof CDC_STATUSES)[number];
export const CDC_STATUS_LABELS: Record<CdcStatus, string> = {
  brouillon: 'Brouillon',
  en_revue: 'En revue',
  valide: 'Validé',
  envoye: 'Envoyé au prestataire',
  archive: 'Archivé',
};
/** Passer à l'un de ces statuts crée une version majeure (1.0, 2.0…). */
export const MAJOR_VERSION_STATUSES: CdcStatus[] = ['valide', 'envoye'];

/** Phase du projet, affichée dans l'en-tête du document (« Phase actuelle : … »). */
export const PROJECT_PHASES = ['cadrage', 'developpement', 'testing', 'production', 'termine'] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];
export const PROJECT_PHASE_LABELS: Record<ProjectPhase, string> = {
  cadrage: 'Cadrage',
  developpement: 'Développement',
  testing: 'Testing',
  production: 'Production',
  termine: 'Terminé',
};

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const jalonSchema = z.object({
  id: z.string(),
  label: z.string().max(200),
  /** Date ISO AAAA-MM-JJ, vide si pas encore connue. */
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
});
export type Jalon = z.infer<typeof jalonSchema>;

export const cdcMetaSchema = z.object({
  title: z.string().trim().min(1, 'Le titre est obligatoire').max(300),
  prestataire: z.string().max(200).default(''),
  projet: z.string().max(200).default(''),
  status: z.enum(CDC_STATUSES),
  phase: z.enum(PROJECT_PHASES).nullable().default(null),
  jalons: z.array(jalonSchema).max(30).default([]),
  /** Estimation en jours/homme. */
  estimationJours: z.number().min(0).max(100000).nullable().default(null),
  tags: z.array(z.string().max(50)).max(20).default([]),
});
export type CdcMeta = z.infer<typeof cdcMetaSchema>;

export const SECTION_KINDS = ['contexte', 'standard', 'annexes'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const sectionSchema = z.object({
  id: z.string(),
  kind: z.enum(SECTION_KINDS),
  title: z.string().trim().min(1).max(300),
  content: richDocSchema,
});
export type Section = z.infer<typeof sectionSchema>;

export const cdcDocumentSchema = z
  .object({
    meta: cdcMetaSchema,
    sections: z.array(sectionSchema).min(1).max(60),
  })
  .superRefine((doc, ctx) => {
    const contexte = doc.sections.filter((s) => s.kind === 'contexte');
    if (contexte.length !== 1 || doc.sections[0]?.kind !== 'contexte') {
      ctx.addIssue({ code: 'custom', message: 'La section « Contexte » est obligatoire et doit être la première.' });
    }
    const annexes = doc.sections.filter((s) => s.kind === 'annexes');
    if (annexes.length > 1 || (annexes.length === 1 && doc.sections.at(-1)?.kind !== 'annexes')) {
      ctx.addIssue({ code: 'custom', message: 'Il ne peut y avoir qu’une section « Annexes », placée en dernier.' });
    }
  });
export type CdcDocument = z.infer<typeof cdcDocumentSchema>;

/** Règles supplémentaires exigées avant de passer un CDC en « Validé » ou « Envoyé ». */
export function validationErrorsForStatus(doc: CdcDocument): string[] {
  if (!MAJOR_VERSION_STATUSES.includes(doc.meta.status)) return [];
  const errors: string[] = [];
  if (!doc.meta.jalons.some((j) => j.date)) errors.push('Au moins une échéance datée est requise.');
  if (doc.meta.estimationJours == null) errors.push('L’estimation (jours/homme) est requise.');
  const contexte = doc.sections.find((s) => s.kind === 'contexte');
  if (!contexte || !hasText(contexte.content)) errors.push('La section « Contexte » ne peut pas être vide.');
  return errors;
}

export function hasText(node: RichNode): boolean {
  if (node.type === 'text' && node.text?.trim()) return true;
  if (node.type === 'image') return true;
  return (node.content ?? []).some(hasText);
}

/** Numérotation des sections telle qu'affichée et exportée (« 1. », « 2. »… ; pas de numéro pour les annexes). */
export function sectionNumbers(sections: Pick<Section, 'kind'>[]): (number | null)[] {
  let n = 0;
  return sections.map((s) => (s.kind === 'annexes' ? null : ++n));
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export const VERSION_ORIGINS = ['creation', 'manuel', 'ia', 'restauration'] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];
export const VERSION_ORIGIN_LABELS: Record<VersionOrigin, string> = {
  creation: 'Création',
  manuel: 'Édition manuelle',
  ia: 'Assistant IA',
  restauration: 'Restauration',
};

export interface VersionInfo {
  seq: number;
  major: number;
  minor: number;
  label: string;
  origin: VersionOrigin;
  comment: string;
  author: string;
  createdAt: string;
}

export function versionLabel(major: number, minor: number): string {
  return `${major}.${minor}`;
}

/** Calcule le numéro de la version suivante. Le passage à un statut « majeur » incrémente la version majeure. */
export function nextVersionNumber(
  prev: { major: number; minor: number; status: CdcStatus } | null,
  newStatus: CdcStatus,
): { major: number; minor: number } {
  if (!prev) return MAJOR_VERSION_STATUSES.includes(newStatus) ? { major: 1, minor: 0 } : { major: 0, minor: 1 };
  const becomesMajor = MAJOR_VERSION_STATUSES.includes(newStatus) && prev.status !== newStatus;
  if (becomesMajor) return { major: prev.major + 1, minor: 0 };
  return { major: prev.major, minor: prev.minor + 1 };
}

// ---------------------------------------------------------------------------
// CDC (fiche) et liste
// ---------------------------------------------------------------------------

export interface CdcSummary {
  id: string;
  title: string;
  prestataire: string;
  projet: string;
  status: CdcStatus;
  phase: ProjectPhase | null;
  /** Prochaine échéance datée (>= aujourd'hui), sinon la dernière. */
  nextJalon: Jalon | null;
  estimationJours: number | null;
  currentVersion: { seq: number; label: string };
  openQuestions: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CdcDetail extends CdcSummary {
  document: CdcDocument;
  /** Job IA en cours sur ce CDC (l'édition est alors bloquée). */
  activeJobId: string | null;
}

// ---------------------------------------------------------------------------
// Questions de l'assistant
// ---------------------------------------------------------------------------

export const QUESTION_PRIORITIES = ['bloquante', 'importante', 'optionnelle'] as const;
export type QuestionPriority = (typeof QUESTION_PRIORITIES)[number];
export const QUESTION_STATUSES = ['ouverte', 'repondue', 'integree', 'ignoree'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface Question {
  id: string;
  text: string;
  /** Pourquoi la question est posée (ce qui manque / est ambigu). */
  why: string;
  priority: QuestionPriority;
  /** Section concernée (null : question transverse, ou section à créer). */
  sectionId: string | null;
  sectionTitle: string;
  status: QuestionStatus;
  answer: string;
  answeredBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Sources (transcriptions)
// ---------------------------------------------------------------------------

export interface SourceInfo {
  id: string;
  title: string;
  charCount: number;
  /** Notes structurées extraites par l'IA (markdown). */
  notes: string;
  createdAt: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Traductions
// ---------------------------------------------------------------------------

export const LANGUAGES = ['fr', 'en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];
export const TRANSLATION_LANGUAGES = ['en', 'de'] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
export const LANGUAGE_LABELS: Record<Language, string> = { fr: 'Français', en: 'Anglais', de: 'Allemand' };

export interface TranslationInfo {
  lang: TranslationLanguage;
  versionSeq: number;
  versionLabel: string;
  createdAt: string;
  createdBy: string;
  /** Vrai si le CDC a changé depuis la traduction. */
  outdated: boolean;
}

// ---------------------------------------------------------------------------
// Jobs IA
// ---------------------------------------------------------------------------

export const JOB_TYPES = ['create_from_transcript', 'add_transcript', 'integrate_answers', 'rework_section', 'translate', 'filetype_create', 'filetype_adjust'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  create_from_transcript: 'Génération du cahier des charges',
  add_transcript: 'Intégration d’une nouvelle transcription',
  integrate_answers: 'Intégration des réponses',
  rework_section: 'Retravail d’une section',
  translate: 'Traduction',
  filetype_create: 'Création de la fiche de lecture',
  filetype_adjust: 'Ajustement de la fiche de lecture',
};

export type JobStatus = 'en_attente' | 'en_cours' | 'termine' | 'erreur';

export interface JobInfo {
  id: string;
  type: JobType;
  status: JobStatus;
  /** Élément concerné : identifiant du CDC ou du type de fichier. */
  targetId: string;
  step: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  /** Version créée par le job, le cas échéant. */
  resultVersionSeq: number | null;
}

// ---------------------------------------------------------------------------
// Consommation IA
// ---------------------------------------------------------------------------

export interface UsageBreakdownRow {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface UsageReport {
  month: string;
  budgetUsd: number;
  totalCostUsd: number;
  calls: number;
  byOperation: UsageBreakdownRow[];
  byModel: UsageBreakdownRow[];
  byUser: UsageBreakdownRow[];
  recent: {
    at: string;
    operation: string;
    model: string;
    user: string;
    cdcId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
  }[];
}
