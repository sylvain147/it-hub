import { z } from 'zod';
import { PRIORITIES, type Priority } from './project.js';

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

/**
 * Longueur maximale d'un message : on peut coller un long texte (compte rendu, transcription de réunion, e-mail) pour
 * que Gandalf propose les actions à mener. Les échanges précédents ne repartent qu'abrégés (`ASSISTANT_HISTORY_CHARS`).
 */
export const ASSISTANT_QUESTION_MAX = 60_000;
export const ASSISTANT_HISTORY_CHARS = 2000;

export const assistantAskBody = z.object({
  question: z.string().trim().min(1, 'Posez une question.').max(ASSISTANT_QUESTION_MAX, `Texte trop long (${ASSISTANT_QUESTION_MAX.toLocaleString('fr-FR')} caractères au plus).`),
  /** Échanges précédents, du plus ancien au plus récent. */
  history: z.array(assistantMessageSchema).max(ASSISTANT_HISTORY_MAX * 2).default([]),
});
export type AssistantAskBody = z.input<typeof assistantAskBody>;

/** Ce que Gandalf peut proposer de créer (toujours validé par l'utilisateur, créé par les routes habituelles). */
export const ASSISTANT_ACTION_KINDS = ['ticket', 'todo', 'jalon'] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

/**
 * Proposition d'action tirée d'un texte (« Dois-je créer un ticket dans le projet X pour … ? »). Gandalf ne crée
 * rien : le navigateur crée l'élément au clic de l'utilisateur, par les routes habituelles et avec ses droits.
 */
export interface AssistantAction {
  kind: AssistantActionKind;
  /** Intitulé du ticket ou de la tâche, libellé du jalon. */
  title: string;
  /** Précisions tirées du texte (Markdown), vide si aucune. */
  details: string;
  /** Projet existant (vérifié par le serveur) ; vide : aucun projet (ticket hors projet, tâche personnelle). Obligatoire pour un jalon. */
  projectId: string;
  projectName: string;
  /** Échéance (AAAA-MM-JJ) ou date du jalon, vide si inconnue. */
  dueDate: string;
  /** Priorité d'un ticket. */
  priority: Priority;
  /** Responsable (utilisateur actif du hub, vérifié par le serveur) ; vide : l'utilisateur qui crée. */
  assigneeId: string;
  /** Motif court : ce qui, dans le texte, justifie la proposition. */
  reason: string;
}

export const assistantActionOutputSchema = z.object({
  kind: z.enum(ASSISTANT_ACTION_KINDS),
  title: z.string().describe('Intitulé court commençant par un verbe (libellé pour un jalon) ; pour un ticket typé, ce qui suit le préfixe « [TYPE] - »'),
  ticketType: z.string().describe('Ticket : type parmi les types de tickets du hub (ex. Dev), chaîne vide si aucun ne correspond ou pour une tâche ou un jalon'),
  details: z.string().describe('Contexte utile tiré du texte, 1 à 3 phrases ; chaîne vide si rien'),
  projectId: z.string().describe('Identifiant du projet concerné (celui des liens /projets/<id>), chaîne vide si aucun'),
  dueDate: z.string().describe('AAAA-MM-JJ si une date est donnée ou se déduit du texte, sinon chaîne vide'),
  priority: z.enum(PRIORITIES),
  assigneeId: z.string().describe('E-mail de l’utilisateur du hub désigné comme responsable, chaîne vide si personne n’est désigné'),
  reason: z.string().describe('Motif court : ce qui, dans le texte, justifie la proposition'),
});

export interface AssistantAnswer {
  /** Réponse en Markdown ; les liens internes (`/projets/…`, `/todo`…) s'ouvrent dans le hub. */
  answer: string;
  /** Questions de relance proposées. */
  followUps: string[];
  /** Projets dont le détail a été transmis à l'IA (cités dans la question ou la conversation). */
  projects: { id: string; name: string }[];
  /** Actions proposées (tickets, to-do, jalons à créer), à valider une par une. */
  actions: AssistantAction[];
}

/** Questions proposées sur une conversation vide. */
export const ASSISTANT_STARTERS = [
  'Qu’est-ce que je dois faire en priorité cette semaine ?',
  'Quelles sont les échéances des 15 prochains jours ?',
  'Quels projets sont en retard ou en difficulté ?',
  'Où en est le sprint en cours ?',
];
