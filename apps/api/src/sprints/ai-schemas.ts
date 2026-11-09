/** Format de sortie demandé au modèle pour les documents de sprint (compte rendu, préparation). */
import { z } from 'zod';

export const sprintDocSchema = z.object({
  markdown: z.string().describe('Document en Markdown, en français, avec les sections demandées'),
});
export type SprintDocOutput = z.infer<typeof sprintDocSchema>;
