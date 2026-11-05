import { z } from 'zod';
import type { JiraSprintInfo, JiraStatusCategory, SprintReport } from './sprint.js';
import type { SprintPreparation } from './preparation.js';

/**
 * Module Jira : connexion à Jira Cloud (site, compte et jeton d'API, https://id.atlassian.com/manage-profile/security/api-tokens),
 * import des tickets et des sprints des tableaux suivis, rattachement des tickets aux projets du hub, et documents de
 * sprint rédigés par l'IA (compte rendu, préparation).
 *
 * Le jeton n'est jamais renvoyé au navigateur ; les appels à Jira partent de l'API du hub. Le hub ne modifie jamais Jira :
 * les tickets importés sont en lecture seule, seul leur rattachement à un projet du hub se modifie.
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
  /** « scrum », « kanban », ou « simple » pour un projet géré par l'équipe (sprints possibles). */
  type: string;
  projectKey: string;
}

export function jiraBoardTypeLabel(type: string): string {
  if (type === 'scrum') return 'Scrum';
  if (type === 'simple') return 'Projet géré par l’équipe';
  if (type === 'kanban') return 'Kanban — en général sans sprints';
  return type;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Tableaux suivis : leurs sprints récents et leur backlog sont importés. */
export const MAX_JIRA_BOARDS = 10;
export const jiraBoardsBody = z.object({ boardIds: z.array(z.number().int().positive()).max(MAX_JIRA_BOARDS, `${MAX_JIRA_BOARDS} tableaux au maximum`) });
export type JiraBoardsBody = z.input<typeof jiraBoardsBody>;

/** Sprints clos conservés par tableau à chaque import (les plus récents). */
export const JIRA_CLOSED_SPRINTS_KEPT = 6;

/** Ticket Jira importé : seuls les champs utiles, sans description ni commentaires. Lecture seule dans le hub. */
export interface JiraTask {
  key: string;
  summary: string;
  type: string;
  priority: string;
  assignee: string;
  /** E-mail de l'assigné quand Jira le communique (selon la confidentialité du compte). */
  assigneeEmail: string;
  status: string;
  statusCategory: JiraStatusCategory;
  storyPoints: number | null;
  /** Échéance AAAA-MM-JJ, ou chaîne vide. */
  dueDate: string;
  created: string;
  updated: string;
  resolutionDate: string | null;
  /** Projet Jira (préfixe de la clé). */
  projectKey: string;
  /** Tableau suivi par lequel le ticket a été importé. */
  boardId: number;
  /** Sprints actuels du ticket (vide : backlog). */
  sprintIds: number[];
  /** Ticket parent (épopée…) : « TC-12 Paiements », ou chaîne vide. */
  parent: string;
  /** Référence du ticket Desk (suivi TMA), sans « # ». */
  deskRef: string;
}

/** Ticket importé, avec son rattachement à un projet du hub. */
export interface JiraTaskView extends JiraTask {
  projectId: string | null;
  projectName: string;
}

export interface JiraSprintListItem extends JiraSprintInfo {
  boardName: string;
  issueCount: number;
  openCount: number;
  points: number;
  hasCompteRendu: boolean;
  hasPreparation: boolean;
}

export interface JiraOverview {
  configured: boolean;
  site: string;
  boards: JiraBoard[];
  /** Dernier import (null : jamais importé). */
  syncedAt: string | null;
  syncedBy: string | null;
  /** Remarques du dernier import (tableau sans sprints…). */
  warnings: string[];
  /** Sprints importés : à venir, en cours, puis clos du plus récent au plus ancien. */
  sprints: JiraSprintListItem[];
  tasks: JiraTaskView[];
}

export const linkJiraTasksBody = z.object({
  keys: z.array(z.string().trim().min(1).max(40)).min(1, 'Choisissez au moins un ticket').max(1000),
  /** null : détacher du projet. */
  projectId: z.string().min(1).max(40).nullable(),
});
export type LinkJiraTasksBody = z.input<typeof linkJiraTasksBody>;

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

/** Ticket Desk du suivi TMA cité par un ticket Jira. */
export interface DeskLink {
  subject: string;
  status: string;
  theme: string;
}

export interface SprintDetail {
  site: string;
  boardName: string;
  syncedAt: string;
  syncedBy: string;
  /** Revue chiffrée (sprint démarré). */
  report: SprintReport | null;
  /** Préparation chiffrée (sprint à venir ou en cours). */
  preparation: SprintPreparation | null;
  documents: Record<SprintDocKind, SprintDocument | null>;
  activeJobId: string | null;
  /** Tickets Desk connus du suivi TMA, par numéro. */
  desk: Record<string, DeskLink>;
  /** Projets du hub reliés à des tickets du sprint (le plus fréquent d'abord). */
  projects: { id: string; name: string; count: number }[];
}

/** Documents proposés selon l'état du sprint. */
export function sprintDocKinds(state: JiraSprintInfo['state']): SprintDocKind[] {
  if (state === 'future') return ['preparation'];
  if (state === 'closed') return ['compte_rendu'];
  return ['compte_rendu', 'preparation'];
}

export const saveSprintDocBody = z.object({ markdown: z.string().max(30_000) });
export const publishSprintDocBody = z.object({ projectId: z.string().min(1).max(40) });

/** Lien vers un ticket Jira. */
export function jiraIssueUrl(site: string, key: string): string | null {
  return site.startsWith('https://') ? `${site}/browse/${encodeURIComponent(key)}` : null;
}
