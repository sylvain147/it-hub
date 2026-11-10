import { z } from 'zod';
import { PRIORITIES, type Priority } from './project.js';

/**
 * Idées d'amélioration (ERP, outils, process…) : la liste de l'équipe, partagée, chaque idée avec une priorité.
 * Une idée retenue peut devenir un ticket (backlog d'un projet ou hors projet), sur action explicite.
 */

export const IDEA_STATUSES = ['nouvelle', 'retenue', 'en_cours', 'realisee', 'ecartee'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  nouvelle: 'Nouvelle',
  retenue: 'Retenue',
  en_cours: 'En cours',
  realisee: 'Réalisée',
  ecartee: 'Écartée',
};
/** Idées closes (masquées par défaut). */
export const CLOSED_IDEA_STATUSES: IdeaStatus[] = ['realisee', 'ecartee'];

/** Domaine proposé par défaut (la liste d'origine : « Idées amélioration ERP »). */
export const DEFAULT_IDEA_DOMAIN = 'ERP';

export const ideaInputSchema = z.object({
  title: z.string().trim().min(1, 'L’idée doit avoir un intitulé').max(300),
  /** Description en Markdown. */
  details: z.string().max(10_000).default(''),
  priority: z.enum(PRIORITIES).default('normale'),
  status: z.enum(IDEA_STATUSES).default('nouvelle'),
  /** Domaine concerné (ERP, intranet…), texte libre. */
  domain: z.string().trim().max(60).default(DEFAULT_IDEA_DOMAIN),
  /** Projet concerné (vide : aucun). */
  projectId: z.string().max(100).default(''),
});
export type IdeaInput = z.input<typeof ideaInputSchema>;

export interface Idea extends z.infer<typeof ideaInputSchema> {
  id: string;
  /** Utilisateurs qui soutiennent l'idée (+1). */
  votes: string[];
  /** Ticket créé à partir de l'idée. */
  ticket: { projectId: string; ticketId: string; number: number } | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export const updateIdeaBody = ideaInputSchema.partial();
export type UpdateIdeaBody = z.input<typeof updateIdeaBody>;

export const voteIdeaBody = z.object({ vote: z.boolean() });

export const ideaTicketBody = z.object({
  /** Projet du ticket ; vide : celui de l'idée, sinon hors projet. */
  projectId: z.string().max(100).default(''),
});

/** Tri : priorité la plus haute, puis le plus de soutiens, puis la plus ancienne. */
export function byIdeaPriority(a: Idea, b: Idea): number {
  return PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || b.votes.length - a.votes.length || a.createdAt.localeCompare(b.createdAt);
}
