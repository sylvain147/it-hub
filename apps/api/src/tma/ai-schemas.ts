/** Formats de sortie demandés au modèle pour le suivi TMA (tous les champs sont obligatoires : sorties structurées). */
import { z } from 'zod';

export const themesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().describe('Numéro du ticket, tel que fourni'),
        theme: z.string().describe('Thème du ticket : un thème existant recopié à l’identique, ou un nouveau thème court'),
      }),
    )
    .describe('Un élément par ticket fourni'),
});
export type ThemesOutput = z.infer<typeof themesSchema>;

export const synthesisSchema = z.object({
  markdown: z.string().describe('Synthèse en Markdown, en français'),
});
export type SynthesisOutput = z.infer<typeof synthesisSchema>;
