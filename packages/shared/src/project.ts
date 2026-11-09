import { z } from 'zod';
import type { CdcSummary } from './cdc.js';

/**
 * Module « Projets » : un projet regroupe tout ce que le chargé de projet suit (fiche, intervenants, prestations,
 * tickets, planning, documents, liens, journal, risques). Les cahiers des charges sont rattachés à un projet.
 */

const isoDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date invalide (AAAA-MM-JJ)');

// ---------------------------------------------------------------------------
// Listes de valeurs
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ['idee', 'cadrage', 'en_cours', 'recette', 'production', 'en_pause', 'termine', 'abandonne'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idee: 'Idée',
  cadrage: 'Cadrage',
  en_cours: 'En cours',
  recette: 'En recette',
  production: 'En production',
  en_pause: 'En pause',
  termine: 'Terminé',
  abandonne: 'Abandonné',
};
/** Statuts considérés comme « clos » (exclus des vues par défaut). */
export const CLOSED_PROJECT_STATUSES: ProjectStatus[] = ['termine', 'abandonne'];

export const PRIORITIES = ['basse', 'normale', 'haute', 'critique'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { basse: 'Basse', normale: 'Normale', haute: 'Haute', critique: 'Critique' };

/**
 * Statuts d'un ticket, dans l'ordre des colonnes du tableau du sprint. Les codes portent le comportement
 * (« termine » : ticket fait ; « attente » et « recette » : points d'attention de la revue de sprint).
 */
export const TICKET_STATUSES = ['a_faire', 'en_cours', 'attente', 'recette', 'termine'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  attente: 'En attente',
  recette: 'En recette',
  termine: 'Terminé',
};

/** Météo du projet. */
export const HEALTHS = ['vert', 'orange', 'rouge'] as const;
export type Health = (typeof HEALTHS)[number];
export const HEALTH_LABELS: Record<Health, string> = { vert: 'Au vert', orange: 'Vigilance', rouge: 'En difficulté' };
export const HEALTH_ICONS: Record<Health, string> = { vert: '🟢', orange: '🟠', rouge: '🔴' };

export const PRESTA_STATUSES = ['a_chiffrer', 'devis_recu', 'commande', 'en_cours', 'livre', 'facture', 'annule'] as const;
export type PrestaStatus = (typeof PRESTA_STATUSES)[number];
export const PRESTA_STATUS_LABELS: Record<PrestaStatus, string> = {
  a_chiffrer: 'À chiffrer',
  devis_recu: 'Devis reçu',
  commande: 'Commandé',
  en_cours: 'En cours',
  livre: 'Livré',
  facture: 'Facturé',
  annule: 'Annulé',
};
/** Prestations dont le montant est engagé (commandées ou au-delà). */
export const ENGAGED_PRESTA_STATUSES: PrestaStatus[] = ['commande', 'en_cours', 'livre', 'facture'];

export const LINK_CATEGORIES = ['ticket', 'documentation', 'code', 'environnement', 'partage', 'autre'] as const;
export type LinkCategory = (typeof LINK_CATEGORIES)[number];
export const LINK_CATEGORY_LABELS: Record<LinkCategory, string> = {
  ticket: 'Tickets externes (GLPI, Jira…)',
  documentation: 'Documentation',
  code: 'Code source',
  environnement: 'Environnement (recette, prod…)',
  partage: 'Espace de partage',
  autre: 'Autre',
};
export const LINK_CATEGORY_ICONS: Record<LinkCategory, string> = { ticket: '🎫', documentation: '📘', code: '💻', environnement: '🖥️', partage: '📁', autre: '🔗' };

export const FILE_CATEGORIES = ['devis', 'commande', 'specification', 'compte_rendu', 'recette', 'contrat', 'autre'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  devis: 'Devis',
  commande: 'Bon de commande',
  specification: 'Spécification',
  compte_rendu: 'Compte rendu',
  recette: 'Recette / PV',
  contrat: 'Contrat',
  autre: 'Autre',
};

export const NOTE_KINDS = ['compte_rendu', 'decision', 'info', 'alerte', 'rapport'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  compte_rendu: 'Compte rendu',
  decision: 'Décision',
  info: 'Information',
  alerte: 'Point d’attention',
  rapport: 'Rapport d’avancement',
};
export const NOTE_KIND_ICONS: Record<NoteKind, string> = { compte_rendu: '📝', decision: '✅', info: 'ℹ️', alerte: '⚠️', rapport: '📊' };

export const RISK_LEVELS = ['faible', 'moyen', 'fort'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = { faible: 'Faible', moyen: 'Moyen', fort: 'Fort' };
export const RISK_STATUSES = ['ouvert', 'surveille', 'clos'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const RISK_STATUS_LABELS: Record<RiskStatus, string> = { ouvert: 'Ouvert', surveille: 'Sous surveillance', clos: 'Clos' };

/** Criticité d'un risque (1 à 9) : probabilité × impact. */
export function riskScore(r: { probability: RiskLevel; impact: RiskLevel }): number {
  return (RISK_LEVELS.indexOf(r.probability) + 1) * (RISK_LEVELS.indexOf(r.impact) + 1);
}

// ---------------------------------------------------------------------------
// Fiche projet
// ---------------------------------------------------------------------------

export const projectFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Le nom du projet est obligatoire').max(200),
  code: z.string().trim().max(40).default(''),
  status: z.enum(PROJECT_STATUSES).default('cadrage'),
  priority: z.enum(PRIORITIES).default('normale'),
  health: z.enum(HEALTHS).default('vert'),
  healthComment: z.string().max(1000).default(''),
  /** Chef de projet côté IT : utilisateur du hub (e-mail). Vide : aucun (ou ancien projet saisi en texte). */
  chefDeProjetId: z.string().trim().toLowerCase().max(200).default(''),
  /** Nom du chef de projet, recopié de l'annuaire par le serveur quand `chefDeProjetId` est renseigné. */
  chefDeProjet: z.string().max(200).default(''),
  /** Direction ou service demandeur. */
  demandeur: z.string().max(200).default(''),
  startDate: isoDate.default(''),
  targetDate: isoDate.default(''),
  /** Textes riches au format Markdown. */
  description: z.string().max(30_000).default(''),
  objectifs: z.string().max(15_000).default(''),
  horsPerimetre: z.string().max(15_000).default(''),
  /** Budget prévisionnel (€ HT), indépendant des prestations saisies. */
  budgetPrevu: z.number().min(0).max(1e9).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type ProjectFields = z.infer<typeof projectFieldsSchema>;

export interface ProjectStats {
  openTasks: number;
  overdueTasks: number;
  doneTasks: number;
  /** Prochaine échéance : jalon non atteint le plus proche. */
  nextJalon: { label: string; date: string } | null;
  lateJalons: number;
  prestataires: string[];
  /** Somme des prestations non annulées. */
  chargeJours: number;
  montantPrevu: number;
  /** Somme des prestations commandées ou au-delà. */
  montantEngage: number;
  openRisks: number;
  /** Risque ouvert le plus critique (1 à 9). */
  maxRiskScore: number;
  contacts: number;
  files: number;
  links: number;
  notes: number;
}

export interface ProjectSummary extends ProjectFields {
  id: string;
  rev: number;
  stats: ProjectStats;
  cdcCount: number;
  /** Utilisateurs qui suivent le projet (e-mails), hors fiche versionnée : `PUT /api/projects/:id/suivi`. */
  followers: string[];
  activeJobId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Éléments rattachés
// ---------------------------------------------------------------------------

/**
 * Ticket : travail planifié d'un projet, qui suit les statuts du tableau et se range dans un sprint
 * (`sprintId` null : backlog). La description est en Markdown. Les tâches personnelles (to-do) sont à part (`users.ts`).
 */
/** Durée en heures (au quart d'heure), vide : non renseignée. */
const hours = z
  .number({ message: 'Durée invalide (en heures)' })
  .min(0, 'Une durée ne peut pas être négative')
  .max(10_000, 'Durée trop grande')
  .transform((h) => Math.round(h * 4) / 4)
  .nullable()
  .default(null);

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'L’intitulé est obligatoire').max(300),
  details: z.string().max(10_000).default(''),
  status: z.enum(TICKET_STATUSES).default('a_faire'),
  priority: z.enum(PRIORITIES).default('normale'),
  sprintId: z.number().int().positive().nullable().default(null),
  /** Utilisateur du hub responsable (e-mail). Vide : personne extérieure saisie en texte (ou ticket antérieur aux utilisateurs). */
  assigneeId: z.string().trim().toLowerCase().max(200).default(''),
  /** Nom du responsable, recopié de l'annuaire par le serveur quand `assigneeId` est renseigné. */
  assignee: z.string().max(200).default(''),
  dueDate: isoDate.default(''),
  /** Numéro du ticket Desk du prestataire (chiffres, sans « # ») ; vide : aucun. */
  deskId: z
    .string()
    .trim()
    .transform((v) => v.replace(/^#/, ''))
    .pipe(z.string().regex(/^\d{0,9}$/, 'Le numéro Desk ne contient que des chiffres (ex. 48213).'))
    .default(''),
  /** Temps estimé, en heures (null : non estimé). Deux champs indépendants, pour les statistiques. */
  estimatedHours: hours,
  /** Temps passé, en heures (null : non renseigné). */
  spentHours: hours,
});

/** Tri des tickets : priorité la plus haute d'abord, puis numéro. */
export const byTicketPriority = (a: Pick<Task, 'priority' | 'number'>, b: Pick<Task, 'priority' | 'number'>) =>
  PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || a.number - b.number;

/** Clé de comparaison d'un numéro Desk (sans « # » ni zéros en tête). */
export const deskKey = (id: string) => id.trim().replace(/^#/, '').replace(/^0+(?=\d)/, '');

/**
 * Tickets sans projet : rangés sous cet identifiant réservé, qui n'a pas de fiche projet (ni indicateurs, ni historique).
 * Un ticket peut ensuite être rattaché à un projet, ou en être sorti, en gardant son numéro et son historique.
 */
export const NO_PROJECT_ID = 'hors-projet';
export const NO_PROJECT_LABEL = 'Hors projet';

/** Changement de statut d'un ticket (historique : revue de sprint). */
export interface StatusChange {
  at: string;
  from: TicketStatus;
  to: TicketStatus;
}

/** Changement de sprint d'un ticket (null : backlog). */
export interface SprintChange {
  at: string;
  from: number | null;
  to: number | null;
}

/** Historique conservé par ticket (les plus récents). */
export const MAX_TICKET_HISTORY = 200;

/** Clé affichée d'un ticket (« T-12 »). */
export function ticketKey(t: { number: number }): string {
  return t.number ? `T-${t.number}` : 'T-?';
}

/**
 * Jalon : une date (`date`, l'échéance), ou une période quand `startDate` est renseignée (du début à `date`).
 * Le retard et le glissement se mesurent sur `date`.
 */
export const jalonInputSchema = z.object({
  label: z.string().trim().min(1, 'Le libellé est obligatoire').max(200),
  /** Début de la période (facultatif) ; vide : jalon ponctuel. */
  startDate: isoDate.default(''),
  date: isoDate.default(''),
  done: z.boolean().default(false),
  notes: z.string().max(2000).default(''),
});

export const prestationInputSchema = z.object({
  /** Prestataire du paramétrage (obligatoire à la saisie ; vide pour les prestations saisies avant le paramétrage). */
  prestataireId: z.string().max(40).default(''),
  /** Nom du prestataire, recopié du paramétrage par le serveur. */
  prestataire: z.string().trim().min(1, 'Le prestataire est obligatoire').max(200),
  objet: z.string().trim().min(1, 'L’objet est obligatoire').max(300),
  status: z.enum(PRESTA_STATUSES).default('a_chiffrer'),
  chargeJours: z.number().min(0).max(100000).nullable().default(null),
  montantHT: z.number().min(0).max(1e9).nullable().default(null),
  referenceDevis: z.string().max(100).default(''),
  bonCommande: z.string().max(100).default(''),
  dateLivraison: isoDate.default(''),
  /** Cahier des charges correspondant. */
  cdcId: z.string().max(40).nullable().default(null),
  notes: z.string().max(5000).default(''),
});

export const contactInputSchema = z.object({
  /**
   * Contact du carnet d'un prestataire : nom, e-mail, téléphone et organisation sont alors repris du paramétrage
   * (et mis à jour avec lui) ; le rôle et les notes restent propres au projet.
   */
  directoryContactId: z.string().max(40).default(''),
  prestataireId: z.string().max(40).default(''),
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(200),
  role: z.string().max(100).default(''),
  organisation: z.string().max(200).default(''),
  email: z.union([z.literal(''), z.string().trim().email('Adresse e-mail invalide').max(200)]).default(''),
  phone: z.string().max(50).default(''),
  notes: z.string().max(2000).default(''),
});

export const linkInputSchema = z.object({
  label: z.string().trim().min(1, 'Le libellé est obligatoire').max(200),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => /^https?:\/\/\S+$/i.test(u), 'Adresse invalide (doit commencer par http:// ou https://)'),
  category: z.enum(LINK_CATEGORIES).default('autre'),
  notes: z.string().max(1000).default(''),
});

export const fileInputSchema = z.object({
  name: z.string().trim().min(1).max(250),
  category: z.enum(FILE_CATEGORIES).default('autre'),
  notes: z.string().max(1000).default(''),
});

/** Propositions de l'assistant issues d'un compte rendu, à valider une à une. */
export const SUGGESTION_STATES = ['proposee', 'acceptee', 'refusee'] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];
export interface NoteSuggestions {
  tasks: { title: string; assignee: string; dueDate: string; priority: Priority; state: SuggestionState }[];
  jalons: { label: string; date: string; state: SuggestionState }[];
  risks: { title: string; probability: RiskLevel; impact: RiskLevel; mitigation: string; state: SuggestionState }[];
}

export const noteInputSchema = z.object({
  kind: z.enum(NOTE_KINDS).default('info'),
  title: z.string().trim().min(1, 'Le titre est obligatoire').max(300),
  /** Date de l'événement (réunion, décision…). */
  date: isoDate.default(''),
  content: z.string().max(60_000).default(''),
  pinned: z.boolean().default(false),
});

export const riskInputSchema = z.object({
  title: z.string().trim().min(1, 'L’intitulé est obligatoire').max(300),
  description: z.string().max(5000).default(''),
  probability: z.enum(RISK_LEVELS).default('moyen'),
  impact: z.enum(RISK_LEVELS).default('moyen'),
  mitigation: z.string().max(5000).default(''),
  owner: z.string().max(200).default(''),
  status: z.enum(RISK_STATUSES).default('ouvert'),
});

/** Types d'éléments rattachés à un projet, avec leur schéma de saisie. */
export const PROJECT_ITEM_SCHEMAS = {
  tasks: taskInputSchema,
  jalons: jalonInputSchema,
  prestations: prestationInputSchema,
  contacts: contactInputSchema,
  links: linkInputSchema,
  files: fileInputSchema,
  notes: noteInputSchema,
  risks: riskInputSchema,
} as const;
export type ProjectItemKind = keyof typeof PROJECT_ITEM_SCHEMAS;
export const PROJECT_ITEM_KINDS = Object.keys(PROJECT_ITEM_SCHEMAS) as ProjectItemKind[];

export interface ItemBase {
  id: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
export type Task = z.infer<typeof taskInputSchema> &
  ItemBase & {
    /** Numéro unique, attribué à la création (clé « T-12 »). */
    number: number;
    /** Ticket terminé (statut « termine »), calculé par le serveur. */
    done: boolean;
    doneAt: string;
    statusChanges: StatusChange[];
    sprintChanges: SprintChange[];
  };
export type ProjectJalon = z.infer<typeof jalonInputSchema> & ItemBase & { initialDate: string };
export type Prestation = z.infer<typeof prestationInputSchema> & ItemBase;
export type Contact = z.infer<typeof contactInputSchema> & ItemBase;
export type ProjectLink = z.infer<typeof linkInputSchema> & ItemBase;
export type ProjectFile = z.infer<typeof fileInputSchema> & ItemBase & { contentType: string; size: number; uploaded: boolean };
export type Note = z.infer<typeof noteInputSchema> &
  ItemBase & {
    /** Propositions de l'assistant (compte rendu analysé). */
    suggestions: NoteSuggestions | null;
    /** Météo proposée par l'assistant (rapport d'avancement). */
    suggestedHealth: Health | null;
    /** Une transcription brute est conservée pour ce compte rendu. */
    hasSource: boolean;
    origin: 'manuel' | 'ia';
  };
export type Risk = z.infer<typeof riskInputSchema> & ItemBase;

export interface ProjectItems {
  tasks: Task[];
  jalons: ProjectJalon[];
  prestations: Prestation[];
  contacts: Contact[];
  links: ProjectLink[];
  files: ProjectFile[];
  notes: Note[];
  risks: Risk[];
}
export type ProjectItem<K extends ProjectItemKind> = ProjectItems[K][number];

export interface ActivityEntry {
  at: string;
  user: string;
  projectId: string;
  projectName: string;
  text: string;
}

export interface ProjectDetail extends ProjectSummary {
  items: ProjectItems;
  cdcs: CdcSummary[];
  activity: ActivityEntry[];
}

/** Ticket avec son projet, vue transverse (sprints, to-do, accueil). */
export interface TicketView extends Task {
  projectId: string;
  projectName: string;
}

const LEGACY_STATUS: Record<string, TicketStatus> = { fait: 'termine', bloque: 'attente' };

/**
 * Ticket enregistré avant les sprints (tâche à cocher `done`, ou plus ancienne avec un statut « à faire / en cours /
 * bloqué / fait » et une priorité) : le statut est déduit, l'historique et le sprint sont vides.
 */
export function normalizeTaskRecord<T extends Record<string, unknown>>(raw: T): T & Pick<Task, 'status' | 'done' | 'priority' | 'sprintId' | 'number' | 'statusChanges' | 'sprintChanges' | 'deskId' | 'estimatedHours' | 'spentHours'> {
  const { priority: p, ...rest } = raw as T & { priority?: unknown };
  const s = String(raw.status ?? '');
  const status: TicketStatus = (TICKET_STATUSES as readonly string[]).includes(s) ? (s as TicketStatus) : (LEGACY_STATUS[s] ?? (raw.done === true ? 'termine' : 'a_faire'));
  return {
    ...(rest as T),
    status,
    done: status === 'termine',
    sprintId: typeof raw.sprintId === 'number' ? raw.sprintId : null,
    number: typeof raw.number === 'number' ? raw.number : 0,
    statusChanges: Array.isArray(raw.statusChanges) ? (raw.statusChanges as StatusChange[]) : [],
    sprintChanges: Array.isArray(raw.sprintChanges) ? (raw.sprintChanges as SprintChange[]) : [],
    deskId: typeof raw.deskId === 'string' ? raw.deskId : '',
    estimatedHours: typeof raw.estimatedHours === 'number' ? raw.estimatedHours : null,
    spentHours: typeof raw.spentHours === 'number' ? raw.spentHours : null,
    // Les tâches à cocher d'avant les sprints portaient déjà une priorité, de mêmes valeurs.
    priority: (PRIORITIES as readonly unknown[]).includes(p) ? (p as Priority) : 'normale',
  };
}

// ---------------------------------------------------------------------------
// Calculs
// ---------------------------------------------------------------------------

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function isTaskOverdue(t: Pick<Task, 'done' | 'dueDate'>, today = todayIso()): boolean {
  return !t.done && !!t.dueDate && t.dueDate < today;
}

/** Frise globale : chaque projet avec ses jalons (`GET /api/projects/jalons`). */
export interface PlanningProject {
  id: string;
  chefDeProjetId: string;
  followers: string[];
  name: string;
  code: string;
  status: ProjectStatus;
  health: Health;
  startDate: string;
  targetDate: string;
  jalons: ProjectJalon[];
  /** Tâches de la to-do du projet qui ont une échéance. */
  todos: PlanningTodo[];
}

/** Tâche de la to-do placée sur la frise (son échéance). */
export interface PlanningTodo {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
  assigneeId: string;
}

export function isJalonLate(j: Pick<ProjectJalon, 'done' | 'date'>, today = todayIso()): boolean {
  return !j.done && !!j.date && j.date < today;
}

/** Dates d'un jalon en clair : « 12 mars » ou « du 2 au 12 mars » (format des dates fourni). */
export function jalonPeriod(j: Pick<ProjectJalon, 'startDate' | 'date'>, fmt: (iso: string) => string): string {
  if (!j.date) return '';
  return j.startDate ? `du ${fmt(j.startDate)} au ${fmt(j.date)}` : fmt(j.date);
}

/** Glissement d'un jalon par rapport à sa date initiale, en jours (positif = retard). */
export function jalonDrift(j: Pick<ProjectJalon, 'date' | 'initialDate'>): number {
  if (!j.date || !j.initialDate) return 0;
  return Math.round((Date.parse(j.date) - Date.parse(j.initialDate)) / 86400000);
}

export function computeStats(items: ProjectItems, today = todayIso()): ProjectStats {
  const open = items.tasks.filter((t) => !t.done);
  const pendingJalons = items.jalons.filter((j) => !j.done && j.date).sort((a, b) => a.date.localeCompare(b.date));
  const next = pendingJalons.find((j) => j.date >= today) ?? null;
  const prestas = items.prestations.filter((p) => p.status !== 'annule');
  const openRisks = items.risks.filter((r) => r.status !== 'clos');
  return {
    openTasks: open.length,
    overdueTasks: open.filter((t) => isTaskOverdue(t, today)).length,
    doneTasks: items.tasks.length - open.length,
    nextJalon: next ? { label: next.label, date: next.date } : null,
    lateJalons: pendingJalons.filter((j) => j.date < today).length,
    prestataires: [...new Set(prestas.map((p) => p.prestataire.trim()).filter(Boolean))],
    chargeJours: prestas.reduce((n, p) => n + (p.chargeJours ?? 0), 0),
    montantPrevu: prestas.reduce((n, p) => n + (p.montantHT ?? 0), 0),
    montantEngage: prestas.filter((p) => ENGAGED_PRESTA_STATUSES.includes(p.status)).reduce((n, p) => n + (p.montantHT ?? 0), 0),
    openRisks: openRisks.length,
    maxRiskScore: openRisks.reduce((m, r) => Math.max(m, riskScore(r)), 0),
    contacts: items.contacts.length,
    files: items.files.filter((f) => f.uploaded).length,
    links: items.links.length,
    notes: items.notes.length,
  };
}

export const emptyItems = (): ProjectItems => ({ tasks: [], jalons: [], prestations: [], contacts: [], links: [], files: [], notes: [], risks: [] });

// ---------------------------------------------------------------------------
// Corps des requêtes
// ---------------------------------------------------------------------------

export const createProjectBody = projectFieldsSchema;
export type CreateProjectBody = z.input<typeof createProjectBody>;

export const updateProjectBody = z.object({
  /** Verrouillage optimiste sur la fiche. */
  rev: z.number().int().min(1),
  fields: projectFieldsSchema,
});
export type UpdateProjectBody = z.input<typeof updateProjectBody>;

export const followProjectBody = z.object({ follow: z.boolean() });
export type FollowProjectBody = z.infer<typeof followProjectBody>;

/** « Mes projets » : ceux dont je suis le chef de projet ou que je suis. */
export function isMyProject(p: Pick<ProjectSummary, 'chefDeProjetId' | 'followers'>, email: string): boolean {
  const me = email.toLowerCase();
  return p.chefDeProjetId === me || (p.followers ?? []).includes(me);
}

export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;
export const createProjectFileBody = fileInputSchema.extend({
  contentType: z.string().max(200).default('application/octet-stream'),
  size: z.number().int().min(1).max(MAX_PROJECT_FILE_BYTES, 'Fichier trop volumineux (50 Mo au maximum)'),
});
export type CreateProjectFileBody = z.input<typeof createProjectFileBody>;

/** Analyse d'un compte rendu ou d'une transcription de réunion par l'assistant. */
export const MAX_PROJECT_TRANSCRIPT_CHARS = 200_000;
export const digestMeetingBody = z.object({
  title: z.string().max(300).default(''),
  date: isoDate.default(''),
  text: z.string().trim().min(20, 'Le texte est trop court').max(MAX_PROJECT_TRANSCRIPT_CHARS),
});
export type DigestMeetingBody = z.input<typeof digestMeetingBody>;

/** Validation des propositions de l'assistant : indices acceptés, les autres sont refusés. */
export const applySuggestionsBody = z.object({
  tasks: z.array(z.number().int().min(0)).default([]),
  jalons: z.array(z.number().int().min(0)).default([]),
  risks: z.array(z.number().int().min(0)).default([]),
});
export type ApplySuggestionsBody = z.input<typeof applySuggestionsBody>;

/** Génération d'un cahier des charges à partir du projet. */
export const createProjectCdcBody = z.object({
  title: z.string().trim().max(300).default(''),
  /** Prestation concernée : fournit le prestataire, la charge, et reçoit le lien vers le CDC. */
  prestationId: z.string().max(40).nullable().default(null),
  /** Notes du journal à fournir à l'assistant. */
  noteIds: z.array(z.string().max(40)).max(30).default([]),
  /** Transcription de réunion facultative. */
  transcript: z.string().max(MAX_PROJECT_TRANSCRIPT_CHARS).default(''),
  /** Faux : CDC vide, simplement pré-rempli. */
  withAi: z.boolean().default(true),
});
export type CreateProjectCdcBody = z.input<typeof createProjectCdcBody>;

export const attachCdcBody = z.object({ projectId: z.string().max(40).nullable() });
