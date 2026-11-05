import { z } from 'zod';
import type { JiraSprintInfo, SprintReport } from './sprint.js';

/**
 * Connexion à Jira Cloud : site, compte et jeton d'API (https://id.atlassian.com/manage-profile/security/api-tokens).
 * Le jeton n'est jamais renvoyé au navigateur ; les appels à Jira partent de l'API du hub.
 */

/** Site de démonstration (données fictives), disponible uniquement en local. */
export const JIRA_DEMO_SITE = 'demo';

/**
 * Normalise l'adresse saisie (« monsite », « monsite.atlassian.net », URL copiée depuis Jira…) en
 * « https://monsite.atlassian.net ». Seuls les sites Jira Cloud sont acceptés.
 */
export function normalizeJiraSite(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s === JIRA_DEMO_SITE) return JIRA_DEMO_SITE;
  const m = /^(?:https?:\/\/)?([a-z0-9][a-z0-9-]{0,62})(?:\.atlassian\.net)?(?:[/?#].*)?$/.exec(s);
  return m ? `https://${m[1]}.atlassian.net` : null;
}

export const jiraConfigBody = z.object({
  site: z
    .string()
    .trim()
    .min(1, 'L’adresse du site Jira est obligatoire')
    .max(300)
    .refine((s) => normalizeJiraSite(s) !== null, 'Adresse Jira Cloud invalide (ex. https://monentreprise.atlassian.net)'),
  email: z.union([z.literal(''), z.string().trim().email('Adresse e-mail invalide').max(200)]).default(''),
  /** Vide : conserver le jeton déjà enregistré. */
  token: z.string().trim().max(1000).default(''),
  /** Champs personnalisés : identifiant (customfield_…) ou vide pour la détection automatique. */
  storyPointsField: z.string().trim().max(60).default(''),
  deskRefField: z.string().trim().max(60).default(''),
});
export type JiraConfigBody = z.input<typeof jiraConfigBody>;

export interface JiraFieldRef {
  id: string;
  name: string;
}

export interface JiraConfigInfo {
  configured: boolean;
  site: string;
  email: string;
  /** 4 derniers caractères du jeton enregistré. */
  tokenHint: string;
  storyPoints: JiraFieldRef | null;
  deskRef: JiraFieldRef | null;
  /** Compte Jira utilisé (rempli au test de connexion). */
  accountName: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Le site de démonstration est disponible (serveur local). */
  demoAvailable: boolean;
}

export interface JiraTestResult {
  accountName: string;
  storyPoints: JiraFieldRef | null;
  deskRef: JiraFieldRef | null;
  /** Champs personnalisés numériques et texte, pour choisir à la main si la détection se trompe. */
  fields: (JiraFieldRef & { type: string })[];
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  projectKey: string;
}

export interface JiraSprintListItem extends JiraSprintInfo {
  /** Instantané enregistré dans le hub. */
  syncedAt: string | null;
  issueCount: number | null;
  hasCompteRendu: boolean;
}

export interface SprintCompteRendu {
  markdown: string;
  createdAt: string;
  createdBy: string;
  /** Modifié à la main après la rédaction. */
  editedAt: string | null;
  editedBy: string | null;
}

/** Ticket Desk du suivi TMA cité par un ticket Jira. */
export interface DeskLink {
  subject: string;
  status: string;
  theme: string;
}

export interface SprintDetail {
  site: string;
  syncedAt: string;
  syncedBy: string;
  report: SprintReport;
  compteRendu: SprintCompteRendu | null;
  activeJobId: string | null;
  /** Tickets Desk connus du suivi TMA, par numéro. */
  desk: Record<string, DeskLink>;
}

export const syncSprintBody = z.object({
  boardId: z.number().int().positive(),
  /** Projet Jira, pour retrouver les tickets retirés du sprint si le rapport de sprint de Jira est indisponible. */
  projectKey: z.string().trim().max(20).regex(/^[A-Z0-9_]*$/i).default(''),
});

export const saveCompteRenduBody = z.object({ markdown: z.string().max(30_000) });

export const publishCompteRenduBody = z.object({ projectId: z.string().min(1).max(40) });

/** Lien vers un ticket Jira. */
export function jiraIssueUrl(site: string, key: string): string | null {
  return site.startsWith('https://') ? `${site}/browse/${encodeURIComponent(key)}` : null;
}
