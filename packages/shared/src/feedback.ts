import { z } from 'zod';

/**
 * Retours des utilisateurs sur l'application (bug, idée, remarque), envoyés depuis n'importe quelle page.
 * Lus et traités par les rôles qui en ont le droit (`manageFeedback`).
 */

export const FEEDBACK_KINDS = ['bug', 'idee', 'remarque'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = { bug: 'Bug', idee: 'Idée', remarque: 'Remarque' };
export const FEEDBACK_KIND_ICONS: Record<FeedbackKind, string> = { bug: '🐞', idee: '💡', remarque: '💬' };

export const FEEDBACK_STATUSES = ['nouveau', 'traite'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const feedbackInputSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS).default('remarque'),
  message: z.string().trim().min(3, 'Décrivez votre retour en quelques mots').max(5000),
  /** Page d'où le retour a été envoyé (chemin et paramètres). */
  page: z.string().max(500).default(''),
  /** Navigateur et taille d'écran, utiles pour reproduire un bug. */
  client: z.string().max(500).default(''),
});
export type FeedbackInput = z.input<typeof feedbackInputSchema>;

export interface Feedback extends z.infer<typeof feedbackInputSchema> {
  id: string;
  status: FeedbackStatus;
  createdAt: string;
  createdBy: string;
  /** Nom de l'auteur au moment de l'envoi. */
  authorName: string;
  /** Réponse ou note de traitement. */
  note: string;
  treatedAt: string | null;
  treatedBy: string | null;
}

export const updateFeedbackBody = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  note: z.string().max(2000).default(''),
});
export type UpdateFeedbackBody = z.input<typeof updateFeedbackBody>;
