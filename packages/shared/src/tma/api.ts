import { z } from 'zod';
import { MAX_DESCRIPTION_CHARS } from './desk.js';
import type { TmaEntry } from './activity.js';
import type { StoredTicket, ThemeStats, TmaMonthReport } from './report.js';
import type { TmaPersonLink } from './people.js';

const text = (max: number) => z.string().max(max).default('');

export const deskTicketSchema = z.object({
  id: z.string().regex(/^\d{1,9}$/, 'Numéro de ticket invalide'),
  subject: z.string().max(1000),
  description: text(MAX_DESCRIPTION_CHARS),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Date de création invalide'),
  requester: text(200),
  assignee: text(200),
  category: text(200),
  priority: text(100),
  status: text(100),
  product: text(200),
  cause: text(200),
  entity: text(200),
});

/** Import d'un export Desk (envoyé par lots par le navigateur). */
export const importDeskBody = z.object({
  fileName: z.string().max(300).default(''),
  tickets: z.array(deskTicketSchema).min(1, 'Aucun ticket dans le fichier').max(1000),
});
export type ImportDeskBody = z.input<typeof importDeskBody>;

export const tmaEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  person: z.string().min(1).max(200),
  hours: z.number().positive().max(24),
  comment: z.string().max(4000),
  tickets: z.array(z.object({ id: z.string().regex(/^\d{1,9}$/), hours: z.number().min(0).max(24) })).max(50),
  otherHours: z.number().min(0).max(24),
  activity: z.enum(['pilotage', 'autre']),
});

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Import (ou remplacement) du relevé TMA d'un mois. */
export const importTmaBody = z.object({
  fileName: z.string().max(300).default(''),
  entries: z.array(tmaEntrySchema).min(1, 'Le relevé est vide').max(5000),
});
export type ImportTmaBody = z.input<typeof importTmaBody>;

export const classifyBody = z.object({
  /** Reclasser aussi les tickets déjà classés (sinon seulement les nouveaux). */
  all: z.boolean().default(false),
});

export interface TmaMonthInfo {
  month: string;
  fileName: string;
  entryCount: number;
  totalHours: number;
  importedAt: string;
  importedBy: string;
  hasSynthesis: boolean;
}

export interface TmaSynthesis {
  markdown: string;
  createdAt: string;
  createdBy: string;
}

export interface TmaOverview {
  months: TmaMonthInfo[];
  desk: {
    ticketCount: number;
    classifiedCount: number;
    firstCreatedAt: string | null;
    lastCreatedAt: string | null;
    lastImportAt: string | null;
    lastImportBy: string | null;
    activeJobId: string | null;
  };
}

export interface TmaMonthDetail {
  info: TmaMonthInfo;
  report: TmaMonthReport;
  entries: TmaEntry[];
  synthesis: TmaSynthesis | null;
  activeJobId: string | null;
  /** Tickets du hub qui citent un ticket Desk du mois (clé : `deskKey`). */
  hubTickets: Record<string, HubTicketRef[]>;
  /** Contact du paramétrage de chaque intervenant du relevé (null : absent des carnets de contacts). */
  people: Record<string, TmaPersonLink | null>;
}

/**
 * Réponse à l'import d'un relevé : le mois, le nombre de tickets du hub dont le temps passé a été mis à jour
 * et les intervenants absents des carnets de contacts des prestataires (leur temps n'est compté sur aucun prestataire).
 */
export interface TmaMonthImportResult extends TmaMonthDetail {
  syncedTickets: number;
  unknownPeople: string[];
}

/** Ticket du hub rattaché à un ticket Desk. */
export interface HubTicketRef {
  id: string;
  /** « T-12 » */
  key: string;
  title: string;
  projectId: string;
  projectName: string;
}

/** Ce que le suivi TMA sait d'un ticket Desk (`GET /api/tma/desk/tickets/:id`). */
export interface DeskTicketInfo {
  id: string;
  /** Ticket retrouvé dans les exports Desk importés, sinon null. */
  ticket: StoredTicket | null;
  /** Temps passé par le prestataire d'après les relevés, au total et par mois. */
  hours: number;
  months: { month: string; hours: number }[];
  hubTickets: HubTicketRef[];
}

export interface TmaThemesResponse {
  months: string[];
  themes: ThemeStats[];
}

export interface DeskImportResult {
  created: number;
  updated: number;
  total: number;
}
