/** Format de sortie demandé au modèle pour le compte rendu de sprint. */
import { z } from 'zod';

export const sprintReviewSchema = z.object({
  markdown: z.string().describe('Compte rendu en Markdown, en français, avec les sections demandées'),
});
export type SprintReviewOutput = z.infer<typeof sprintReviewSchema>;
