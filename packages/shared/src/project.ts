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

export const PROJECT_STATUSES = ['idee', 'cadrage', 'planifie', 'en_cours', 'recette', 'production', 'en_pause', 'termine', 'abandonne'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idee: 'Idée',
  cadrage: 'Cadrage',
  planifie: 'Planifié',
  en_cours: 'En cours',
  recette: 'En recette',
  production: 'En production',
  en_pause: 'En pause',
  termine: 'Terminé',
  abandonne: 'Abandonné',
};
/** Statuts considérés comme « clos » (exclus des vues par défaut). */
export const CLOSED_PROJECT_STATUSES: ProjectStatus[] = ['termine', 'abandonne'];

/**
 * Étapes de la frise d'avancement d'un projet, dans l'ordre (accueil, page du projet). Les autres statuts (idée, en
 * pause, abandonné) sont hors frise. Un projet bloqué (`blocked`) reste à son étape, marquée en rouge avec la raison.
 */
export const PROJECT_STEPS = ['cadrage', 'planifie', 'en_cours', 'recette', 'production', 'termine'] as const satisfies readonly ProjectStatus[];

/** Rang de l'étape d'un statut dans la frise (0 : cadrage), -1 hors frise. */
export function projectStepIndex(status: ProjectStatus): number {
  return (PROJECT_STEPS as readonly ProjectStatus[]).indexOf(status);
}

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

/** Section libre de la fiche projet (titre + texte Markdown), ajoutée par l'utilisateur sous la description. */
export const projectSectionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1, 'Chaque section doit avoir un titre').max(200),
  content: z.string().max(15_000).default(''),
});
export type ProjectSection = z.infer<typeof projectSectionSchema>;

export const projectFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Le nom du projet est obligatoire').max(200),
  status: z.enum(PROJECT_STATUSES).default('cadrage'),
  priority: z.enum(PRIORITIES).default('normale'),
  health: z.enum(HEALTHS).default('vert'),
  healthComment: z.string().max(1000).default(''),
  /**
   * Chefs de projet côté IT (ex. un pour l'ERP, un pour le Web) : utilisateurs du hub (e-mails), dans l'ordre choisi.
   * Vide : aucun (ou ancien projet saisi en texte). Remplace l'ancien champ unique `chefDeProjetId` (`normalizeChefIds`).
   */
  chefDeProjetIds: z
    .array(z.string().trim().toLowerCase().min(1).max(200))
    .max(10)
    .default([])
    .transform((ids) => [...new Set(ids)]),
  /** Noms des chefs de projet séparés par des virgules, recopiés de l'annuaire par le serveur quand `chefDeProjetIds` est renseigné. */
  chefDeProjet: z.string().max(1000).default(''),
  /** Direction ou service demandeur. */
  demandeur: z.string().max(200).default(''),
  startDate: isoDate.default(''),
  targetDate: isoDate.default(''),
  /** Textes riches au format Markdown. */
  description: z.string().max(30_000).default(''),
  /** Sections ajoutées par l'utilisateur, dans l'ordre d'affichage. */
  sections: z.array(projectSectionSchema).max(30).default([]),
  /** Budget prévisionnel (€ HT), indépendant des prestations saisies. */
  budgetPrevu: z.number().min(0).max(1e9).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** Domaines concernés (IT, Logistique…), choisis parmi ceux du paramétrage (`projectDomains`). */
  domains: z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .default([])
    .transform((ds) => [...new Set(ds)]),
  /** Projet bloqué : il reste à son étape, marquée en rouge sur la frise, avec la raison. */
  blocked: z.boolean().default(false),
  blockedReason: z.string().trim().max(500).default(''),
});
export type ProjectFields = z.infer<typeof projectFieldsSchema>;

/**
 * Sections d'un enregistrement de projet. Les projets antérieurs aux sections libres avaient deux champs
 * fixes (`objectifs`, `horsPerimetre`) : ils deviennent des sections du même nom.
 */
export function normalizeProjectSections(it: { sections?: ProjectSection[]; objectifs?: string; horsPerimetre?: string }): ProjectSection[] {
  if (it.sections) return it.sections;
  const legacy: ProjectSection[] = [];
  if (it.objectifs?.trim()) legacy.push({ id: 'objectifs', title: 'Objectifs', content: it.objectifs });
  if (it.horsPerimetre?.trim()) legacy.push({ id: 'hors-perimetre', title: 'Hors périmètre', content: it.horsPerimetre });
  return legacy;
}

/** Sections non vides, en Markdown (`## Titre`), pour les rapports et l'assistant. */
export function projectSectionsMarkdown(sections: ProjectSection[], level = 2): string {
  return sections
    .filter((s) => s.content.trim())
    .map((s) => `${'#'.repeat(level)} ${s.title}\n${s.content.trim()}`)
    .join('\n\n');
}

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

/** Tableau principal (`sprints/boards.ts`) : celui des tickets et sprints d'avant les tableaux. */
export const DEFAULT_BOARD_ID = 'principal';

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'L’intitulé est obligatoire').max(300),
  /** Type du ticket (Cadrage, Dev…, parmi les `ticketTypes` du paramétrage), facultatif ; vide : aucun. */
  type: z.string().trim().max(60).default(''),
  details: z.string().max(10_000).default(''),
  status: z.enum(TICKET_STATUSES).default('a_faire'),
  priority: z.enum(PRIORITIES).default('normale'),
  sprintId: z.number().int().positive().nullable().default(null),
  /**
   * Tableau du ticket (`Board`). Vide à la création : celui du sprint choisi, sinon le tableau par défaut de qui le crée ;
   * le serveur le garde cohérent avec le sprint (`placeTicket`).
   */
  boardId: z.string().trim().max(40).default(''),
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

/**
 * Process complet d'un projet : une série de tickets créés d'un coup, dans cet ordre, chacun titré par son type
 * (« [CADRAGE] - Nom du projet »).
 */
export const TICKET_PROCESS_STEPS = ['Cadrage', 'Dev', 'Recette', 'Correctif', 'MEP'] as const;
export type TicketProcessStep = (typeof TICKET_PROCESS_STEPS)[number];

/** Clé de comparaison d'un type de ticket (« DEV », « Dev » et « dev » sont le même type). */
export const ticketTypeKey = (t: string) => t.trim().toLowerCase();

/** Étape du process d'un type de ticket (null : type hors process, ou aucun). */
export function processStepOf(type: string): TicketProcessStep | null {
  return TICKET_PROCESS_STEPS.find((s) => ticketTypeKey(s) === ticketTypeKey(type)) ?? null;
}

/**
 * Ce qu'on propose quand un ticket du process est terminé : le statut du projet (le premier est proposé, les autres
 * sont des raccourcis) et l'étape dont le ticket passe « À faire ». Cadrage terminé : « Planifié » (ou directement
 * « En cours »), le ticket Dev passe à faire ; Dev terminé : « En recette », ticket Recette ; Recette : ticket Correctif ;
 * Correctif : ticket MEP ; MEP terminée : « En production ».
 */
export const PROCESS_NEXT: Record<TicketProcessStep, { statuses: ProjectStatus[]; nextStep: TicketProcessStep | null }> = {
  Cadrage: { statuses: ['planifie', 'en_cours'], nextStep: 'Dev' },
  Dev: { statuses: ['recette'], nextStep: 'Recette' },
  Recette: { statuses: ['recette'], nextStep: 'Correctif' },
  Correctif: { statuses: ['recette'], nextStep: 'MEP' },
  MEP: { statuses: ['production'], nextStep: null },
};

/** Passage à l'étape suivante, après validation de l'utilisateur (`POST /api/projects/:id/tickets/:itemId/suite`). */
export const processNextBody = z.object({
  /** Nouveau statut du projet ; null : inchangé. */
  projectStatus: z.enum(PROJECT_STATUSES).nullable().default(null),
});
export type ProcessNextBody = z.input<typeof processNextBody>;

export const ticketProcessBody = z.object({
  /** Étapes retenues (au moins une), créées dans l'ordre de `TICKET_PROCESS_STEPS`. */
  steps: z.array(z.enum(TICKET_PROCESS_STEPS)).min(1, 'Choisissez au moins une étape.').max(TICKET_PROCESS_STEPS.length),
  /** Précision ajoutée après le nom du projet (« [DEV] - Nom du projet - Export des commandes »), facultative. */
  complement: z.string().trim().max(200).default(''),
  priority: z.enum(PRIORITIES).default('normale'),
  assigneeId: z.string().trim().toLowerCase().max(200).default(''),
  /** Sprint des tickets (null : backlog). */
  sprintId: z.number().int().positive().nullable().default(null),
});
export type TicketProcessBody = z.input<typeof ticketProcessBody>;

/**
 * Tickets d'un process, dans l'ordre : type, titre (nom du projet, et la précision) et statut. Le premier est « À faire »,
 * les suivants « En attente » : ils passent à faire un à un, quand le précédent est terminé.
 */
export function ticketProcessTickets(projectName: string, steps: readonly string[], complement = ''): { type: TicketProcessStep; title: string; status: TicketStatus }[] {
  const title = `${projectName.trim()}${complement.trim() ? ` - ${complement.trim()}` : ''}`;
  return TICKET_PROCESS_STEPS.filter((s) => steps.includes(s)).map((type, i) => ({ type, title, status: i === 0 ? 'a_faire' : 'attente' }));
}

/** Tri des tickets : priorité la plus haute d'abord, puis numéro. */
export const byTicketPriority = (a: Pick<Task, 'priority' | 'number'>, b: Pick<Task, 'priority' | 'number'>) =>
  PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || a.number - b.number;

/** Clé de comparaison d'un numéro Desk (sans « # » ni zéros en tête). */
export const deskKey = (id: string) => id.trim().replace(/^#/, '').replace(/^0+(?=\d)/, '');

/**
 * Temps passé d'un ticket une fois reporté le temps du prestataire (relevés TMA de son ticket Desk) : l'ancienne
 * part TMA est remplacée par la nouvelle, le temps saisi à la main est conservé. Arrondi au quart d'heure, comme la saisie.
 */
export function withTmaHours(t: Pick<Task, 'spentHours' | 'tmaHours'>, tma: number): Pick<Task, 'spentHours' | 'tmaHours'> {
  const tmaHours = Math.round(tma * 4) / 4 || null;
  const manual = t.spentHours == null ? null : Math.max(0, t.spentHours - (t.tmaHours ?? 0));
  // Temps venu uniquement des relevés, qui disparaît : le ticket redevient « non renseigné ».
  if (!tmaHours) return { spentHours: manual === 0 && t.tmaHours ? null : manual, tmaHours: null };
  return { spentHours: (manual ?? 0) + tmaHours, tmaHours };
}

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

/**
 * Note de suivi d'un ticket (« Notes » de la fiche) : un fil de remarques datées, visible de toute l'équipe, hors
 * champs du ticket (ajouter une note ne modifie pas le ticket). Tenue par le serveur (`POST …/tickets/:id/notes`) ;
 * chacun ne modifie ou ne supprime que les siennes.
 */
export interface TicketComment {
  id: string;
  /** Texte en Markdown. */
  text: string;
  at: string;
  /** Auteur (e-mail) et son nom, recopié à l'écriture. */
  by: string;
  author: string;
  /** Dernière modification (vide : jamais modifiée). */
  editedAt: string;
}

export const ticketCommentBody = z.object({
  text: z.string().trim().min(1, 'La note est vide.').max(10_000, 'Note trop longue (10 000 caractères au plus).'),
});
export type TicketCommentBody = z.input<typeof ticketCommentBody>;

/** Notes conservées par ticket (les plus récentes). */
export const MAX_TICKET_COMMENTS = 200;

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
/**
 * Mise à jour proposée d'un ticket existant du projet (statut, échéance, priorité) : seuls les champs à changer sont
 * renseignés (null : inchangé) ; `before` garde les valeurs au moment de l'analyse, pour l'affichage.
 */
export interface TicketUpdateSuggestion {
  ticketId: string;
  number: number;
  title: string;
  status: TicketStatus | null;
  dueDate: string | null;
  priority: Priority | null;
  before: { status: TicketStatus; dueDate: string; priority: Priority };
  /** Ce qui, dans le texte, justifie la mise à jour. */
  reason: string;
  state: SuggestionState;
}

export interface NoteSuggestions {
  /** Ce que l'assistant propose de faire, en clair (« Après analyse, je vais créer… »), vide pour les anciennes notes. */
  plan?: string;
  tasks: { title: string; assignee: string; dueDate: string; priority: Priority; state: SuggestionState }[];
  /** Mises à jour de tickets existants (absent des anciennes notes). */
  ticketUpdates?: TicketUpdateSuggestion[];
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

/** Temps passé sur un projet hors ticket (réunions, cadrage, suivi…). */
export const timeInputSchema = z.object({
  /** Jour du travail (AAAA-MM-JJ). */
  date: isoDate.default(''),
  /** Durée en heures (au quart d'heure). */
  hours: z
    .number({ message: 'Durée invalide (en heures)' })
    .positive('La durée est obligatoire')
    .max(10_000, 'Durée trop grande')
    .transform((h) => Math.round(h * 4) / 4),
  label: z.string().trim().max(300).default(''),
  /** Qui a passé ce temps (e-mail d'un utilisateur du hub). */
  userId: z.string().trim().max(200).default(''),
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
  times: timeInputSchema,
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
    /**
     * Part de `spentHours` reportée des relevés TMA du prestataire (ticket Desk `deskId`), tenue par le serveur
     * (`withTmaHours`) ; null : aucune.
     */
    tmaHours: number | null;
    /** Notes de suivi, de la plus ancienne à la plus récente. */
    comments: TicketComment[];
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
export type TimeEntry = z.infer<typeof timeInputSchema> & ItemBase;

export interface ProjectItems {
  tasks: Task[];
  jalons: ProjectJalon[];
  prestations: Prestation[];
  contacts: Contact[];
  links: ProjectLink[];
  files: ProjectFile[];
  notes: Note[];
  risks: Risk[];
  times: TimeEntry[];
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
export function normalizeTaskRecord<T extends Record<string, unknown>>(raw: T): T & Pick<Task, 'title' | 'type' | 'status' | 'done' | 'priority' | 'sprintId' | 'boardId' | 'number' | 'statusChanges' | 'sprintChanges' | 'deskId' | 'estimatedHours' | 'spentHours' | 'tmaHours' | 'comments'> {
  const { priority: p, ...rest } = raw as T & { priority?: unknown };
  // Tickets d'avant le champ « type » : le type était le préfixe du titre (« [DEV] - Nom du projet »).
  const legacy = typeof raw.type === 'string' ? null : /^\[([^\]]+)\]\s*-\s*/.exec(String(raw.title ?? ''));
  const s = String(raw.status ?? '');
  const status: TicketStatus = (TICKET_STATUSES as readonly string[]).includes(s) ? (s as TicketStatus) : (LEGACY_STATUS[s] ?? (raw.done === true ? 'termine' : 'a_faire'));
  return {
    ...(rest as T),
    title: legacy ? String(raw.title).slice(legacy[0].length).trim() || String(raw.title) : String(raw.title ?? ''),
    type: typeof raw.type === 'string' ? raw.type : (legacy?.[1]?.trim() ?? ''),
    status,
    done: status === 'termine',
    sprintId: typeof raw.sprintId === 'number' ? raw.sprintId : null,
    // Tickets d'avant les tableaux : tableau principal.
    boardId: typeof raw.boardId === 'string' && raw.boardId ? raw.boardId : DEFAULT_BOARD_ID,
    number: typeof raw.number === 'number' ? raw.number : 0,
    statusChanges: Array.isArray(raw.statusChanges) ? (raw.statusChanges as StatusChange[]) : [],
    sprintChanges: Array.isArray(raw.sprintChanges) ? (raw.sprintChanges as SprintChange[]) : [],
    deskId: typeof raw.deskId === 'string' ? raw.deskId : '',
    estimatedHours: typeof raw.estimatedHours === 'number' ? raw.estimatedHours : null,
    spentHours: typeof raw.spentHours === 'number' ? raw.spentHours : null,
    tmaHours: typeof raw.tmaHours === 'number' ? raw.tmaHours : null,
    comments: Array.isArray(raw.comments) ? (raw.comments as TicketComment[]) : [],
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

/** Jalon tenu par le hub à la date de fin visée du projet (créé avec le projet, suivi quand la date change). */
export const TARGET_JALON_LABEL = 'Fin du projet';

/** Frise globale : chaque projet avec ses jalons (`GET /api/projects/jalons`). */
export interface PlanningProject {
  id: string;
  chefDeProjetIds: string[];
  followers: string[];
  name: string;
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

/** Temps passé sur un projet : somme des tickets (temps passé, relevés TMA compris) et du temps saisi hors ticket. */
export function projectSpentHours(items: Pick<ProjectItems, 'tasks' | 'times'>): { tickets: number; other: number; total: number } {
  const tickets = items.tasks.reduce((n, t) => n + (t.spentHours ?? 0), 0);
  const other = (items.times ?? []).reduce((n, t) => n + t.hours, 0);
  return { tickets, other, total: tickets + other };
}

export const emptyItems = (): ProjectItems => ({ tasks: [], jalons: [], prestations: [], contacts: [], links: [], files: [], notes: [], risks: [], times: [] });

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

/** « Mes projets » : ceux dont je suis l'un des chefs de projet ou que je suis. */
export function isMyProject(p: Pick<ProjectSummary, 'chefDeProjetIds' | 'followers'>, email: string): boolean {
  const me = email.toLowerCase();
  return (p.chefDeProjetIds ?? []).includes(me) || (p.followers ?? []).includes(me);
}

/** Chefs de projet d'un enregistrement, y compris ceux d'avant les chefs multiples (champ unique `chefDeProjetId`). */
export function normalizeChefIds(p: { chefDeProjetIds?: string[]; chefDeProjetId?: string }): string[] {
  return p.chefDeProjetIds ?? (p.chefDeProjetId ? [p.chefDeProjetId] : []);
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
  ticketUpdates: z.array(z.number().int().min(0)).default([]),
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

/**
 * Report de la fiche projet dans ses cahiers des charges, après confirmation : la description remplace le Contexte,
 * chaque section modifiée du projet remplace la section du CDC de même titre (ou de son ancien titre), ou s'ajoute.
 */
export const syncProjectCdcsBody = z.object({
  cdcIds: z.array(z.string().max(40)).min(1).max(50),
  /** La description a changé : le Contexte des CDC est remplacé. */
  description: z.boolean().default(false),
  /** Sections du projet modifiées ou ajoutées (identifiants), avec leur titre d'avant pour celles renommées. */
  sectionIds: z.array(z.string().max(40)).max(30).default([]),
  previousTitles: z.record(z.string().max(40), z.string().max(200)).default({}),
});
export type SyncProjectCdcsBody = z.input<typeof syncProjectCdcsBody>;

export interface SyncProjectCdcsResult {
  updated: { id: string; title: string; version: string }[];
  skipped: { id: string; title: string; reason: string }[];
}

export const attachCdcBody = z.object({ projectId: z.string().max(40).nullable() });
