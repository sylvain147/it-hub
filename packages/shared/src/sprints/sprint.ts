import { z } from 'zod';
import type { TicketView } from '../project.js';
import type { SprintReport } from './report.js';
import type { SprintPreparation } from './preparation.js';

/**
 * Module « Sprints » : les tickets des projets se planifient dans des sprints (ou restent au backlog), avancent sur le
 * tableau du sprint en cours, et l'assistant rédige à la demande le compte rendu ou la préparation d'un sprint.
 *
 * Un seul sprint est en cours à la fois (une seule équipe). Clore un sprint renvoie ses tickets non terminés vers le
 * sprint suivant ou le backlog.
 */

const isoDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date invalide (AAAA-MM-JJ)');

export const SPRINT_STATES = ['future', 'active', 'closed'] as const;
export type SprintState = (typeof SPRINT_STATES)[number];
export const SPRINT_STATE_LABELS: Record<SprintState, string> = { future: 'À venir', active: 'En cours', closed: 'Clos' };

export const sprintInputSchema = z.object({
  name: z.string().trim().min(1, 'Le nom du sprint est obligatoire').max(100),
  goal: z.string().trim().max(1000).default(''),
  /** Dates prévues (AAAA-MM-JJ). */
  startDate: isoDate.default(''),
  endDate: isoDate.default(''),
});
export type SprintInput = z.input<typeof sprintInputSchema>;

/** Création : nom (« Sprint 4 » par défaut) et dates (à la suite du dernier sprint) facultatifs. */
export const createSprintBody = sprintInputSchema.extend({ name: z.string().trim().max(100).default('') });
export type CreateSprintBody = z.input<typeof createSprintBody>;

export interface Sprint extends z.infer<typeof sprintInputSchema> {
  /** Numéro du sprint (1, 2, 3…). */
  id: number;
  state: SprintState;
  /** Instants de lancement et de clôture (ISO). */
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** Durée proposée pour un nouveau sprint (jours). */
export const DEFAULT_SPRINT_DAYS = 14;

/** Clôture : destination des tickets non terminés (sprint à venir, ou null pour le backlog). */
/** Planifie d'un coup dans un sprint tous les tickets ouverts d'un projet restés au backlog. */
export const planProjectBody = z.object({ projectId: z.string().min(1).max(40) });
export type PlanProjectBody = z.input<typeof planProjectBody>;

export const closeSprintBody = z.object({ moveTo: z.number().int().positive().nullable().default(null) });
export type CloseSprintBody = z.input<typeof closeSprintBody>;

export interface SprintListItem extends Sprint {
  ticketCount: number;
  openCount: number;
  hasCompteRendu: boolean;
  hasPreparation: boolean;
}

export interface SprintsOverview {
  /** En cours, puis à venir (dans l'ordre), puis clos du plus récent au plus ancien. */
  sprints: SprintListItem[];
  /** Tickets des sprints en cours et à venir, et tickets ouverts du backlog. */
  tickets: TicketView[];
}

// ---------------------------------------------------------------------------
// Documents de sprint (IA)
// ---------------------------------------------------------------------------

export const SPRINT_DOC_KINDS = ['compte_rendu', 'preparation'] as const;
export type SprintDocKind = (typeof SPRINT_DOC_KINDS)[number];
export const SPRINT_DOC_LABELS: Record<SprintDocKind, string> = { compte_rendu: 'Compte rendu', preparation: 'Préparation du sprint' };

export interface SprintDocument {
  markdown: string;
  createdAt: string;
  createdBy: string;
  /** Modifié à la main après la rédaction. */
  editedAt: string | null;
  editedBy: string | null;
}

export interface SprintDetail {
  sprint: Sprint;
  /** Instant des chiffres (maintenant, ou clôture du sprint). */
  asOf: string;
  /** Revue chiffrée (sprint démarré). */
  report: SprintReport | null;
  /** Préparation chiffrée (sprint à venir ou en cours). */
  preparation: SprintPreparation | null;
  documents: Record<SprintDocKind, SprintDocument | null>;
  activeJobId: string | null;
  /** Projets des tickets du sprint (le plus fréquent d'abord). */
  projects: { id: string; name: string; count: number }[];
}

/** Documents proposés selon l'état du sprint. */
export function sprintDocKinds(state: SprintState): SprintDocKind[] {
  if (state === 'future') return ['preparation'];
  if (state === 'closed') return ['compte_rendu'];
  return ['compte_rendu', 'preparation'];
}

/**
 * Export (tests) de la requête qui serait envoyée à Bedrock pour rédiger un document de sprint, sans appel au modèle.
 */
export interface SprintPromptExport {
  model: string;
  url: string;
  /** Corps JSON exact de la requête, tel que produit par le SDK. */
  body: Record<string, unknown>;
  /** Même contenu en texte, à coller dans une IA locale. */
  text: string;
}

export const saveSprintDocBody = z.object({ markdown: z.string().max(30_000) });
export const publishSprintDocBody = z.object({ projectId: z.string().min(1).max(40) });
