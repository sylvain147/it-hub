import { z } from 'zod';
import { fileSpecSchema } from './spec.js';

export const MAX_DOCUMENTS_CHARS = 600_000;
export const MAX_EXCERPT_CHARS = 40_000;

export const createFileTypeBody = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(200),
  description: z.string().max(2000).default(''),
  /** Explications libres de l'utilisateur sur le format. */
  notes: z.string().max(20_000).default(''),
  sampleFileName: z.string().max(300).default(''),
  /** Extrait de l'exemple, préparé (et anonymisé si demandé) dans le navigateur. */
  excerpt: z.string().min(1, 'Le fichier exemple est vide').max(MAX_EXCERPT_CHARS),
  anonymized: z.boolean(),
  /** Documentation et code source, déjà convertis en texte. */
  documents: z
    .array(z.object({ name: z.string().max(300), text: z.string() }))
    .max(20)
    .default([])
    .refine((docs) => docs.reduce((n, d) => n + d.text.length, 0) <= MAX_DOCUMENTS_CHARS, 'Documentation trop volumineuse (600 000 caractères au maximum)'),
});
export type CreateFileTypeBody = z.input<typeof createFileTypeBody>;

export const adjustFileTypeBody = z.object({
  baseSeq: z.number().int().min(1),
  instruction: z.string().trim().min(3).max(4000),
  /** Lignes supplémentaires (anonymisées si demandé) d'un fichier qui pose problème. */
  extraLines: z.string().max(20_000).default(''),
});
export type AdjustFileTypeBody = z.input<typeof adjustFileTypeBody>;

export const saveFileTypeSpecBody = z.object({
  baseSeq: z.number().int().min(1),
  spec: fileSpecSchema,
  comment: z.string().max(500).default(''),
});

export const updateFileTypeBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
});
