import { z } from 'zod';

/**
 * FAQ de l'équipe : questions fréquentes et leurs réponses (Markdown, images comprises), classées par thème.
 * Tout le monde ajoute une entrée ou complète une réponse ; une question peut être posée sans réponse, à compléter
 * par qui la connaît. Seul son auteur (ou le droit `manageFaq`) la supprime.
 */

export const faqInputSchema = z.object({
  question: z.string().trim().min(1, 'La question est obligatoire').max(300),
  /** Réponse en Markdown ; vide : question en attente de réponse. */
  answer: z.string().max(20_000).default(''),
  /** Thème (Connexion, ERP, Teams…), texte libre ; vide : aucun. */
  category: z.string().trim().max(60).default(''),
});
export type FaqInput = z.input<typeof faqInputSchema>;

export interface FaqEntry extends z.infer<typeof faqInputSchema> {
  id: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export const updateFaqBody = faqInputSchema.partial();
export type UpdateFaqBody = z.input<typeof updateFaqBody>;

/** Tri : par thème (les entrées sans thème à la fin), puis par question. */
export function byFaqCategory(a: FaqEntry, b: FaqEntry): number {
  return (!a.category ? 1 : 0) - (!b.category ? 1 : 0) || a.category.localeCompare(b.category, 'fr') || a.question.localeCompare(b.question, 'fr');
}
