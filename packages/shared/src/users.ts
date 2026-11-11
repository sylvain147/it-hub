import { z } from 'zod';
import { taskInputSchema, type ItemBase } from './project.js';
import type { ThemeId } from './themes.js';
import type { UserTools } from './tools.js';

/**
 * Utilisateurs du hub et rôles.
 *
 * L'identité est l'adresse e-mail (identifiant de connexion Cognito). L'annuaire du hub porte le nom affiché,
 * le rôle et l'état (actif / désactivé). Le premier utilisateur qui se connecte devient administrateur.
 */

export const ROLES = ['admin', 'responsable', 'membre'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  responsable: 'Responsable d’équipe',
  membre: 'Chargé de projet',
};
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Gère les utilisateurs et leurs rôles ; voit et attribue les to-do et les notes de toute l’équipe ; lit les retours sur l’application ; connecte le hub à Teams.',
  responsable: 'Voit les to-do de toute l’équipe et peut en attribuer à chacun.',
  membre: 'Voit sa propre to-do et y ajoute ses tâches. Les projets (et leur to-do), les tickets et les sprints restent partagés par toute l’équipe.',
};

/** Droits portés par les rôles (le code teste un droit, jamais un rôle). */
export const PERMISSIONS = {
  /** Créer, modifier et désactiver des utilisateurs. */
  manageUsers: ['admin'],
  /** Voir la to-do des autres utilisateurs. */
  seeAllTodos: ['admin', 'responsable'],
  /** Ajouter ou réattribuer une tâche de to-do à quelqu'un d'autre. */
  assignOthers: ['admin', 'responsable'],
  /** Voir les notes de tout le monde et en ajouter à n'importe qui. */
  manageAllNotes: ['admin'],
  /** Lire et traiter les retours des utilisateurs sur l'application. */
  manageFeedback: ['admin'],
  /** Connecter le hub à Teams et choisir les notifications envoyées. */
  manageIntegrations: ['admin'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, perm: Permission): boolean {
  return !!role && (PERMISSIONS[perm] as readonly Role[]).includes(role);
}

/** Périmètres d'un utilisateur (domaines qu'il couvre) ; plusieurs possibles. */
export const PERIMETERS = ['erp', 'logistique', 'securite', 'reseau', 'web'] as const;
export type Perimeter = (typeof PERIMETERS)[number];
export const PERIMETER_LABELS: Record<Perimeter, string> = { erp: 'ERP', logistique: 'Logistique', securite: 'Sécurité', reseau: 'Réseau', web: 'Web' };

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Adresse e-mail invalide')
  .max(200);

/** Fiche de l'utilisateur : poste, backup (un autre utilisateur du hub) et périmètres. */
const profile = {
  jobTitle: z.string().trim().max(120).default(''),
  /** E-mail de l'utilisateur qui le remplace en son absence ; vide : aucun. */
  backupId: z.string().trim().toLowerCase().max(200).default(''),
  perimeters: z.array(z.enum(PERIMETERS)).max(PERIMETERS.length).default([]),
};

export const userInputSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(120),
  role: z.enum(ROLES).default('membre'),
  ...profile,
});
export type UserInput = z.input<typeof userInputSchema>;

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(120),
  role: z.enum(ROLES),
  active: z.boolean(),
  ...profile,
});
export type UserUpdate = z.input<typeof userUpdateSchema>;

export interface HubUser {
  email: string;
  name: string;
  role: Role;
  active: boolean;
  jobTitle: string;
  backupId: string;
  perimeters: Perimeter[];
  /** Thème de couleur choisi par l'utilisateur (`THEMES`). */
  theme: ThemeId;
  /** Section « Outils » du menu, composée sur sa fiche ; null : jamais réglée (tous les outils du hub). */
  tools: UserTools | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Dernière requête (à la minute près), ou null si jamais connecté. */
  lastSeenAt: string | null;
  /** Invitation envoyée par e-mail (connexion Cognito). */
  invitedAt: string | null;
}

export interface Me extends HubUser {
  permissions: Record<Permission, boolean>;
  /** Fournisseur d'IA (« mock » en local). */
  llm: string;
}

/** Nom court affiché (« Alice Martin » → « Alice M. »), pour les listes étroites. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)![0] ?? '') : (parts[0]?.[1] ?? ''))).toUpperCase();
}

// ---------------------------------------------------------------------------
// To-do : tâches personnelles à cocher
// ---------------------------------------------------------------------------

/** Sous-tâche : une étape de la tâche, cochée à part (l'identifiant est choisi par le navigateur). */
export const todoSubtaskSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1, 'L’intitulé de la sous-tâche est obligatoire').max(300),
  done: z.boolean().default(false),
});
export type TodoSubtask = z.infer<typeof todoSubtaskSchema>;

/**
 * Tâche de la to-do d'une personne : une simple chose à faire que l'on coche, rattachée ou non à un projet
 * (`projectId`). La to-do est indépendante des tickets : une tâche ne se planifie pas dans un sprint.
 */
export const todoInputSchema = taskInputSchema.pick({ title: true, details: true, dueDate: true }).extend({
  done: z.boolean().default(false),
  /** Utilisateur responsable (e-mail) ; par défaut, celui qui crée la tâche. */
  assigneeId: z.string().trim().toLowerCase().max(200).default(''),
  /** Projet concerné (vide : tâche hors projet). */
  projectId: z.string().max(40).default(''),
  /** Étapes de la tâche, dans l'ordre. Les cocher toutes ne coche pas la tâche. */
  subtasks: z
    .array(todoSubtaskSchema)
    .max(50, '50 sous-tâches au plus.')
    .refine((l) => new Set(l.map((x) => x.id)).size === l.length, { message: 'Sous-tâches en double.' })
    .default([]),
});
export type TodoInput = z.input<typeof todoInputSchema>;

export type PersonalTask = z.infer<typeof todoInputSchema> &
  ItemBase & {
    doneAt: string;
    /** Rang choisi par glisser-déposer (le plus petit en tête) ; absent : après les tâches classées, par échéance. */
    position?: number;
  };

/** Avancement des sous-tâches (« 2/5 ») ; null : aucune sous-tâche. */
export function subtaskProgress(t: Pick<PersonalTask, 'subtasks'>): { done: number; total: number } | null {
  const l = t.subtasks ?? [];
  return l.length ? { done: l.filter((x) => x.done).length, total: l.length } : null;
}

/** Nouvel ordre de la to-do : les tâches, de la première à la dernière. */
export const todoOrderBody = z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(500) });
export type TodoOrderBody = z.input<typeof todoOrderBody>;

/** To-do d'une personne, de toute l'équipe ou d'un projet. */
export interface TodosResponse {
  /** E-mail de la personne, « all » pour toute l'équipe, ou « projet » pour la to-do d'un projet. */
  scope: string;
  personal: PersonalTask[];
}
