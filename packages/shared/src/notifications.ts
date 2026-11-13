import { z } from 'zod';

/**
 * Notifications Teams : le hub publie des messages (cartes adaptatives) dans un canal Teams de l'équipe, par
 * l'adresse d'un flux « Workflows » (« Publier dans un canal lorsqu'une demande de webhook est reçue »).
 * Une seule connexion pour le hub, réglée par les utilisateurs qui ont le droit `manageIntegrations`.
 *
 * Le canal est lu par toute l'équipe : n'y envoyer que ce que tous les utilisateurs du hub voient déjà.
 */

/** Évènements qui peuvent être envoyés sur Teams (chacun s'active à part). */
export const NOTIFICATION_EVENTS = ['sprint_demarre', 'sprint_clos', 'idee_ajoutee', 'faq_ajoutee', 'mise_en_prod'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, { title: string; hint: string }> = {
  sprint_demarre: { title: 'Sprint démarré', hint: 'Nom, dates et objectif du sprint qui commence.' },
  sprint_clos: { title: 'Sprint clôturé', hint: 'Nom du sprint et nombre de tickets non terminés reportés.' },
  idee_ajoutee: { title: 'Nouvelle idée d’amélioration', hint: 'Intitulé, domaine et auteur de l’idée.' },
  faq_ajoutee: { title: 'Nouvelle entrée de la FAQ', hint: 'Question, thème et auteur ; signale une question encore sans réponse.' },
  mise_en_prod: { title: 'Mise en production', hint: 'Nouvelle version de Hobbit en ligne, avec son patch note (nouveautés depuis la précédente).' },
};

/**
 * Entrée du patch note annoncée à la mise en production : transmise par le déploiement (`infra/lib/hub-stack.ts`, à
 * partir du `patch-notes.json` du front) au worker, qui publie les entrées pas encore annoncées.
 */
export interface ReleaseNote {
  /** Commit sur la branche principale. */
  id: string;
  date: string;
  title: string;
  pr: number | null;
  /** Titres des commits de l'entrée. */
  changes: string[];
}


/**
 * Adresses acceptées : flux Workflows (Power Automate / Logic Apps) et anciens connecteurs « Incoming Webhook ».
 * Le serveur n'appelle jamais d'autre hôte.
 */
const TEAMS_HOSTS = ['.logic.azure.com', '.powerplatform.com', '.webhook.office.com'];

/** Message d'erreur si l'adresse n'est pas celle d'un flux Teams, null sinon. */
export function teamsWebhookError(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return 'Adresse invalide : collez l’URL complète donnée par Teams (https://…).';
  }
  if (u.protocol !== 'https:') return 'L’adresse doit commencer par https://.';
  if (!TEAMS_HOSTS.some((h) => u.hostname.endsWith(h))) return 'Ce n’est pas une adresse de flux Teams (Workflows) : elle doit se terminer par logic.azure.com, powerplatform.com ou webhook.office.com.';
  return null;
}

export const teamsSettingsBody = z.object({
  /** Absent : adresse inchangée ; vide : connexion supprimée. */
  webhookUrl: z
    .string()
    .trim()
    .max(2000)
    .superRefine((v, ctx) => {
      const error = v ? teamsWebhookError(v) : null;
      if (error) ctx.addIssue({ code: 'custom', message: error });
    })
    .optional(),
  events: z.partialRecord(z.enum(NOTIFICATION_EVENTS), z.boolean()).default({}),
});
export type TeamsSettingsBody = z.input<typeof teamsSettingsBody>;

/** Réglages renvoyés au front : l'adresse (qui vaut mot de passe) n'est jamais renvoyée en entier. */
export interface TeamsSettings {
  connected: boolean;
  /** Début de l'hôte et fin de l'adresse, pour reconnaître le flux. */
  webhookHint: string;
  events: Record<NotificationEvent, boolean>;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Dernier envoi en échec (message et instant), effacé au premier envoi réussi. */
  lastError: { message: string; at: string } | null;
}

/** Évènements actifs par défaut à la connexion. */
export function defaultNotificationEvents(): Record<NotificationEvent, boolean> {
  return Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, true])) as Record<NotificationEvent, boolean>;
}

export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.split('.')[0]}…${url.slice(-6)}`;
  } catch {
    return '…';
  }
}
