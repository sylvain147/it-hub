import { z } from 'zod';
import type { Task } from '../project.js';

/**
 * Fonds conditionnels des cartes du tableau de sprint : des règles d'équipe (paramétrage), évaluées dans l'ordre ;
 * la première qui correspond au ticket donne la couleur de fond de sa carte.
 */

export const CARD_RULE_KINDS = ['retard', 'echeance', 'immobile', 'projet', 'responsable', 'sans_responsable', 'sans_desk'] as const;
export type CardRuleKind = (typeof CARD_RULE_KINDS)[number];
export const CARD_RULE_LABELS: Record<CardRuleKind, string> = {
  retard: 'Échéance dépassée',
  echeance: 'Échéance dans les N jours',
  immobile: 'Même statut depuis plus de N jours',
  projet: 'Projet',
  responsable: 'Responsable',
  sans_responsable: 'Sans responsable du hub (personne extérieure)',
  sans_desk: 'Sans ticket Desk',
};
/** Conditions qui prennent un nombre de jours, ou une valeur (projet, utilisateur). */
export const CARD_RULE_DAYS: CardRuleKind[] = ['echeance', 'immobile'];
export const CARD_RULE_VALUE: CardRuleKind[] = ['projet', 'responsable'];

export const CARD_COLORS = ['rouge', 'orange', 'jaune', 'vert', 'bleu', 'violet', 'gris'] as const;
export type CardColor = (typeof CARD_COLORS)[number];
export const CARD_COLOR_LABELS: Record<CardColor, string> = { rouge: 'Rouge', orange: 'Orange', jaune: 'Jaune', vert: 'Vert', bleu: 'Bleu', violet: 'Violet', gris: 'Gris' };

export const cardRuleSchema = z.object({
  kind: z.enum(CARD_RULE_KINDS),
  /** Identifiant du projet, ou e-mail du responsable. */
  value: z.string().trim().max(200).default(''),
  days: z.number().int().min(0).max(365).default(0),
  color: z.enum(CARD_COLORS),
});
export type CardRule = z.infer<typeof cardRuleSchema>;
export const MAX_CARD_RULES = 20;

/** Une règle incomplète (projet ou responsable non choisi) est ignorée. */
export function isCardRuleComplete(r: CardRule): boolean {
  return !CARD_RULE_VALUE.includes(r.kind) || !!r.value;
}

const DAY_MS = 86_400_000;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);

type CardTicket = Pick<Task, 'done' | 'dueDate' | 'assigneeId' | 'createdAt' | 'statusChanges' | 'deskId'> & { projectId: string };

export function cardRuleMatches(r: CardRule, t: CardTicket, today: string): boolean {
  switch (r.kind) {
    case 'retard':
      return !t.done && !!t.dueDate && t.dueDate < today;
    case 'echeance':
      return !t.done && !!t.dueDate && t.dueDate >= today && dayDiff(today, t.dueDate) <= r.days;
    case 'immobile': {
      if (t.done) return false;
      const since = t.statusChanges.at(-1)?.at ?? t.createdAt;
      return dayDiff(since.slice(0, 10), today) > r.days;
    }
    case 'projet':
      return t.projectId === r.value;
    case 'responsable':
      return t.assigneeId === r.value;
    case 'sans_responsable':
      return !t.assigneeId;
    case 'sans_desk':
      return !t.deskId;
  }
}

/** Couleur de fond d'une carte : première règle qui correspond, sinon aucune. */
export function cardColor(rules: CardRule[], t: CardTicket, today: string): CardColor | null {
  return rules.find((r) => isCardRuleComplete(r) && cardRuleMatches(r, t, today))?.color ?? null;
}

/** Libellé d'une règle (« Échéance dans les 3 jours », « Projet : Paie »…). */
export function describeCardRule(r: CardRule, names: { project: (id: string) => string; user: (email: string) => string }): string {
  switch (r.kind) {
    case 'echeance':
      return `Échéance dans les ${r.days} jour${r.days > 1 ? 's' : ''}`;
    case 'immobile':
      return `Même statut depuis plus de ${r.days} jour${r.days > 1 ? 's' : ''}`;
    case 'projet':
      return `Projet : ${r.value ? names.project(r.value) : '?'}`;
    case 'responsable':
      return `Responsable : ${r.value ? names.user(r.value) : '?'}`;
    default:
      return CARD_RULE_LABELS[r.kind];
  }
}
