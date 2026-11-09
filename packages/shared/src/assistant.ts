import { z } from 'zod';

/**
 * Assistant : un chat global où l'on interroge l'IA sur les projets, les échéances, les tickets et sa to-do.
 * La conversation reste dans le navigateur (rien n'est enregistré côté serveur) ; chaque question renvoie les
 * derniers échanges. Les données sont rassemblées par le code (`apps/api/src/assistant/context.ts`), jamais par l'IA.
 */

/** Nombre d'échanges précédents renvoyés avec une question (au-delà, les plus anciens sont oubliés). */
export const ASSISTANT_HISTORY_MAX = 10;

export const assistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(8000),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantAskBody = z.object({
  question: z.string().trim().min(1, 'Posez une question.').max(2000, 'Question trop longue (2 000 caractères au plus).'),
  /** Échanges précédents, du plus ancien au plus récent. */
  history: z.array(assistantMessageSchema).max(ASSISTANT_HISTORY_MAX * 2).default([]),
});
export type AssistantAskBody = z.input<typeof assistantAskBody>;

export interface AssistantAnswer {
  /** Réponse en Markdown ; les liens internes (`/projets/…`, `/todo`…) s'ouvrent dans le hub. */
  answer: string;
  /** Questions de relance proposées. */
  followUps: string[];
  /** Projets dont le détail a été transmis à l'IA (cités dans la question ou la conversation). */
  projects: { id: string; name: string }[];
}

/** Questions proposées sur une conversation vide. */
export const ASSISTANT_STARTERS = [
  'Qu’est-ce que je dois faire en priorité cette semaine ?',
  'Quelles sont les échéances des 15 prochains jours ?',
  'Quels projets sont en retard ou en difficulté ?',
  'Où en est le sprint en cours ?',
];
