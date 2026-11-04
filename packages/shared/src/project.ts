import { z } from 'zod';
import type { CdcSummary } from './cdc.js';

/**
 * Module « Projets » : un projet regroupe tout ce que le chargé de projet suit (fiche, intervenants, prestations,
 * tâches, planning, documents, liens, journal, risques). Les cahiers des charges sont rattachés à un projet.
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

/** Météo du projet. */
export const HEALTHS = ['vert', 'orange', 'rouge'] as const;
export type Health = (typeof HEALTHS)[number];
export const HEALTH_LABELS: Record<Health, string> = { vert: 'Au vert', orange: 'Vigilance', rouge: 'En difficulté' };
export const HEALTH_ICONS: Record<Health, string> = { vert: '🟢', orange: '🟠', rouge: '🔴' };

export const TASK_STATUSES = ['a_faire', 'en_cours', 'bloque', 'fait'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { a_faire: 'À faire', en_cours: 'En cours', bloque: 'Bloqué', fait: 'Fait' };

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
  ticket: 'Tickets (Jira, GLPI…)',
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

/** Rôles proposés pour les intervenants (saisie libre possible). */
export const CONTACT_ROLE_SUGGESTIONS = [
  'Chef de projet',
  'Sponsor',
  'Référent métier',
  'Utilisateur clé',
  'Chef de projet prestataire',
  'Développeur',
  'Architecte',
  'Exploitation',
  'Sécurité',
  'Achats',
];

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
  /** Chef de projet côté IT. */
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
  blockedTasks: number;
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
  activeJobId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Éléments rattachés
// ---------------------------------------------------------------------------

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'L’intitulé est obligatoire').max(300),
  details: z.string().max(5000).default(''),
  status: z.enum(TASK_STATUSES).default('a_faire'),
  priority: z.enum(PRIORITIES).default('normale'),
  assignee: z.string().max(200).default(''),
  dueDate: isoDate.default(''),
});

export const jalonInputSchema = z.object({
  label: z.string().trim().min(1, 'Le libellé est obligatoire').max(200),
  date: isoDate.default(''),
  done: z.boolean().default(false),
  notes: z.string().max(2000).default(''),
});

export const prestationInputSchema = z.object({
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
export type Task = z.infer<typeof taskInputSchema> & ItemBase & { doneAt: string };
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

/** Tâche ouverte, vue transverse (accueil). */
export interface OpenTask extends Task {
  projectId: string;
  projectName: string;
}

// ---------------------------------------------------------------------------
// Calculs
// ---------------------------------------------------------------------------

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function isTaskOverdue(t: Pick<Task, 'status' | 'dueDate'>, today = todayIso()): boolean {
  return t.status !== 'fait' && !!t.dueDate && t.dueDate < today;
}

export function isJalonLate(j: Pick<ProjectJalon, 'done' | 'date'>, today = todayIso()): boolean {
  return !j.done && !!j.date && j.date < today;
}

/** Glissement d'un jalon par rapport à sa date initiale, en jours (positif = retard). */
export function jalonDrift(j: Pick<ProjectJalon, 'date' | 'initialDate'>): number {
  if (!j.date || !j.initialDate) return 0;
  return Math.round((Date.parse(j.date) - Date.parse(j.initialDate)) / 86400000);
}

export function computeStats(items: ProjectItems, today = todayIso()): ProjectStats {
  const open = items.tasks.filter((t) => t.status !== 'fait');
  const pendingJalons = items.jalons.filter((j) => !j.done && j.date).sort((a, b) => a.date.localeCompare(b.date));
  const next = pendingJalons.find((j) => j.date >= today) ?? null;
  const prestas = items.prestations.filter((p) => p.status !== 'annule');
  const openRisks = items.risks.filter((r) => r.status !== 'clos');
  return {
    openTasks: open.length,
    overdueTasks: open.filter((t) => isTaskOverdue(t, today)).length,
    blockedTasks: open.filter((t) => t.status === 'bloque').length,
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
