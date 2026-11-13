import { z } from 'zod';
import { DEFAULT_BOARD_ID } from '../project.js';
import { cardRuleSchema, MAX_CARD_RULES, type CardRule } from './cards.js';

/**
 * Tableaux de tickets : chacun a ses sprints (un seul en cours à la fois par tableau), son backlog et ses règles
 * d'affichage des cartes. Un ticket appartient à un tableau (`boardId`) ; un sprint aussi. Seuls les administrateurs
 * (droit `manageBoards`) créent, renomment ou suppriment un tableau.
 *
 * Le tableau principal existe toujours (les tickets et sprints d'avant les tableaux lui appartiennent). Chacun choisit
 * son tableau par défaut sur sa fiche (`defaultBoardId`) : un ticket créé sans tableau précis y va ; créé depuis la page
 * d'un tableau, il va dans ce tableau.
 */

export const DEFAULT_BOARD_NAME = 'Tableau principal';

export const boardInputSchema = z.object({
  name: z.string().trim().min(1, 'Le tableau doit avoir un nom').max(60),
});
export type BoardInput = z.input<typeof boardInputSchema>;

/** Règles d'affichage des cartes d'un tableau (toute l'équipe les règle). */
export const boardRulesBody = z.object({
  cardRules: z.array(cardRuleSchema).max(MAX_CARD_RULES, `${MAX_CARD_RULES} règles au maximum`),
});
export type BoardRulesBody = z.input<typeof boardRulesBody>;

export interface Board {
  id: string;
  name: string;
  /** Fonds conditionnels des cartes du tableau du sprint en cours, dans l'ordre d'évaluation. */
  cardRules: CardRule[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** Tableau d'un ticket ou d'un sprint (ceux d'avant les tableaux : le tableau principal). */
export function boardOf(x: { boardId?: string | null }): string {
  return x.boardId || DEFAULT_BOARD_ID;
}

/** Le tableau principal d'abord, puis par nom. */
export function byBoardOrder(a: Board, b: Board): number {
  return (b.id === DEFAULT_BOARD_ID ? 1 : 0) - (a.id === DEFAULT_BOARD_ID ? 1 : 0) || a.name.localeCompare(b.name, 'fr');
}
