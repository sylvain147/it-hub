import { z } from 'zod';
import { cdcDocumentSchema, cdcMetaSchema, QUESTION_STATUSES, TRANSLATION_LANGUAGES, LANGUAGES } from './cdc.js';

/** Taille maximale d'une transcription collée (~2 h de réunion). */
export const MAX_TRANSCRIPT_CHARS = 200_000;

export const createCdcBody = z.object({
  meta: cdcMetaSchema.partial().default({}),
  /** Si fourni, l'IA génère le CDC à partir de cette transcription. */
  transcript: z.string().max(MAX_TRANSCRIPT_CHARS).optional(),
  transcriptTitle: z.string().max(200).optional(),
});
export type CreateCdcBody = z.input<typeof createCdcBody>;

export const saveCdcBody = z.object({
  baseSeq: z.number().int().min(1),
  document: cdcDocumentSchema,
  comment: z.string().max(500).default(''),
});
export type SaveCdcBody = z.input<typeof saveCdcBody>;

export const restoreVersionBody = z.object({ baseSeq: z.number().int().min(1) });

export const updateQuestionBody = z.object({
  answer: z.string().max(10_000).optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
});
export type UpdateQuestionBody = z.input<typeof updateQuestionBody>;

export const integrateAnswersBody = z.object({ baseSeq: z.number().int().min(1) });

export const addSourceBody = z.object({
  baseSeq: z.number().int().min(1),
  title: z.string().max(200).default(''),
  text: z.string().min(20, 'La transcription est trop courte').max(MAX_TRANSCRIPT_CHARS),
});
export type AddSourceBody = z.input<typeof addSourceBody>;

export const reworkSectionBody = z.object({
  baseSeq: z.number().int().min(1),
  instruction: z.string().trim().min(3).max(2000),
});

export const translateBody = z.object({ lang: z.enum(TRANSLATION_LANGUAGES) });

export const exportBody = z.object({
  format: z.enum(['docx', 'pdf']),
  lang: z.enum(LANGUAGES).default('fr'),
  /** Version à exporter (par défaut : la version courante, ou la version traduite). */
  seq: z.number().int().min(1).optional(),
});
export type ExportBody = z.input<typeof exportBody>;

/** PNG et JPEG uniquement : ce sont les formats acceptés à la fois par Word et par le PDF. */
export const ALLOWED_ASSET_TYPES = ['image/png', 'image/jpeg'] as const;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export const createAssetBody = z.object({
  contentType: z.enum(ALLOWED_ASSET_TYPES),
  size: z.number().int().min(1).max(MAX_ASSET_BYTES),
});

export const resolveAssetsBody = z.object({ refs: z.array(z.string()).max(200) });

/**
 * Les images des documents sont référencées par `asset:<cdcId>/<assetId>` (le bucket reste privé).
 * Les images des autres textes du hub (description d'un ticket…) le sont par `asset:hub/<assetId>`.
 */
export const ASSET_PREFIX = 'asset:';
export const HUB_ASSET_SCOPE = 'hub';
export function assetRef(cdcId: string, assetId: string): string {
  return `${ASSET_PREFIX}${cdcId}/${assetId}`;
}
export function parseAssetRef(ref: string): { cdcId: string; assetId: string } | null {
  const m = /^asset:([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(ref);
  return m ? { cdcId: m[1]!, assetId: m[2]! } : null;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
