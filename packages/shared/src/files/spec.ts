/**
 * « Fiche de lecture » d'un type de fichier : description déclarative du format,
 * produite par l'IA (ou modifiée à la main) et interprétée par `parseFile`.
 * Aucune ligne de code n'est générée ni exécutée.
 */
import { z } from 'zod';

export const FILE_FORMATS = ['fixed', 'delimited'] as const;
export const FILE_FORMAT_LABELS: Record<(typeof FILE_FORMATS)[number], string> = {
  fixed: 'Positions fixes',
  delimited: 'Délimité (CSV…)',
};

export const ENCODINGS = ['utf-8', 'windows-1252'] as const;

export const FIELD_TYPES = ['text', 'integer', 'decimal', 'date', 'time', 'datetime', 'code'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texte',
  integer: 'Entier',
  decimal: 'Nombre décimal / montant',
  date: 'Date',
  time: 'Heure',
  datetime: 'Date et heure',
  code: 'Code (avec libellés)',
};

export const RECORD_ROLES = ['header', 'group', 'detail', 'trailer', 'other'] as const;
export type RecordRole = (typeof RECORD_ROLES)[number];
export const RECORD_ROLE_LABELS: Record<RecordRole, string> = {
  header: 'En-tête',
  group: 'Regroupement (ex. facture)',
  detail: 'Détail (ex. ligne)',
  trailer: 'Fin / totaux',
  other: 'Autre',
};

export const codeValueSchema = z.object({ code: z.string(), label: z.string() });

export const fieldSpecSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  /** Positions fixes : position du 1er caractère (à partir de 1). Délimité : numéro de colonne (à partir de 1). */
  start: z.number().int().min(1),
  /** Positions fixes : nombre de caractères. Délimité : ignoré (0). */
  length: z.number().int().min(0),
  type: z.enum(FIELD_TYPES),
  /** Décimales implicites quand la valeur n'a pas de séparateur (ex. 2 = montant en centimes). */
  impliedDecimals: z.number().int().min(0).max(10).default(0),
  /** Format de date/heure : YYYY, YY, MM, DD, HH, mm, ss et séparateurs (ex. « YYYYMMDD », « DD/MM/YYYY »). */
  dateFormat: z.string().max(40).default(''),
  /** Libellés des codes (type « code », ou valeurs connues d'un champ texte). */
  values: z.array(codeValueSchema).max(500).default([]),
  description: z.string().max(1000).default(''),
  /** Champ masqué dans les tableaux (zones vides, réservées…). */
  hidden: z.boolean().default(false),
});
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const matchRuleSchema = z.object({
  start: z.number().int().min(1),
  /** Longueur de la zone comparée (positions fixes) ; ignorée en délimité. */
  length: z.number().int().min(0),
  value: z.string(),
});
export type MatchRule = z.infer<typeof matchRuleSchema>;

export const recordTypeSpecSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  role: z.enum(RECORD_ROLES).default('other'),
  /** Toutes les règles doivent être vérifiées. Aucune règle : la ligne est de ce type par défaut. */
  match: z.array(matchRuleSchema).max(5).default([]),
  /** Code du type parent : la ligne est rattachée au dernier enregistrement lu de ce type. */
  parent: z.string().nullable().default(null),
  fields: z.array(fieldSpecSchema).max(300),
});
export type RecordTypeSpec = z.infer<typeof recordTypeSpecSchema>;

export const CHECK_KINDS = ['count', 'sum'] as const;
export const checkSpecSchema = z.object({
  label: z.string().min(1).max(300),
  kind: z.enum(CHECK_KINDS),
  /** Enregistrement qui porte la valeur attendue (souvent la fin de fichier). */
  expectedRecord: z.string(),
  expectedField: z.string(),
  /** Types d'enregistrement comptés (count) ou dont on additionne `targetField` (sum). */
  targetRecords: z.array(z.string()).min(1),
  targetField: z.string().default(''),
  /** Si renseigné : on ne considère que les lignes depuis le dernier enregistrement de ce type (bloc). */
  blockStart: z.string().nullable().default(null),
});
export type CheckSpec = z.infer<typeof checkSpecSchema>;

export const fileSpecSchema = z
  .object({
    format: z.enum(FILE_FORMATS),
    encoding: z.enum(ENCODINGS).default('utf-8'),
    delimiter: z.string().max(5).default(';'),
    quote: z.string().max(1).default('"'),
    /** Lignes ignorées en début de fichier (ex. ligne de titres d'un CSV). */
    skipLines: z.number().int().min(0).max(1000).default(0),
    /** Motif de nom de fichier (ex. « *_facture_a_plat*.txt »), aide à la reconnaissance automatique. */
    fileNamePattern: z.string().max(200).default(''),
    recordTypes: z.array(recordTypeSpecSchema).min(1).max(200),
    checks: z.array(checkSpecSchema).max(100).default([]),
  })
  .superRefine((spec, ctx) => {
    const codes = new Set<string>();
    for (const r of spec.recordTypes) {
      if (codes.has(r.code)) ctx.addIssue({ code: 'custom', message: `Type d’enregistrement « ${r.code} » en double` });
      codes.add(r.code);
      const keys = new Set<string>();
      for (const f of r.fields) {
        if (keys.has(f.key)) ctx.addIssue({ code: 'custom', message: `Champ « ${f.key} » en double dans « ${r.code} »` });
        keys.add(f.key);
      }
    }
    for (const r of spec.recordTypes) {
      if (r.parent && !codes.has(r.parent)) ctx.addIssue({ code: 'custom', message: `Parent « ${r.parent} » inconnu pour « ${r.code} »` });
    }
  });
export type FileSpec = z.infer<typeof fileSpecSchema>;
export type FileSpecInput = z.input<typeof fileSpecSchema>;

// ---------------------------------------------------------------------------
// Types de fichiers (fiches enregistrées)
// ---------------------------------------------------------------------------

export interface FileTypeSummary {
  id: string;
  name: string;
  description: string;
  format: FileSpec['format'] | null;
  fileNamePattern: string;
  recordTypeCount: number;
  currentVersion: { seq: number; label: string } | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FileTypeDetail extends FileTypeSummary {
  spec: FileSpec | null;
  /** Remarques et incertitudes de l'IA sur la dernière version. */
  remarks: string[];
  /** Extrait (anonymisé) de l'exemple envoyé à l'IA. */
  excerpt: string;
  /** L'extrait a été anonymisé : les lignes ajoutées lors des ajustements le sont aussi. */
  anonymized: boolean;
  sampleFileName: string;
  notes: string;
  documents: { name: string; chars: number }[];
  activeJobId: string | null;
}

export interface FileTypeVersionInfo {
  seq: number;
  label: string;
  origin: 'ia' | 'manuel' | 'restauration';
  comment: string;
  author: string;
  createdAt: string;
}
