/**
 * Bouton rouge « NE PAS CLIQUER » : petit jeu caché. Le bouton apparaît de temps en temps, au hasard ;
 * chaque clic est compté pour l'utilisateur, et le classement de l'équipe s'affiche après le clic.
 */

/** Rareté : une chance sur `BOUTON_ROUGE_CHANCE` à chaque changement de page… */
export const BOUTON_ROUGE_CHANCE = 40;
/** … et pas plus d'une apparition par période (en minutes). */
export const BOUTON_ROUGE_PAUSE_MIN = 30;

export interface BoutonRougeScore {
  email: string;
  count: number;
  /** Dernier clic (ISO). */
  lastAt: string;
}

export interface BoutonRougeScores {
  /** Nombre de clics de l'utilisateur connecté. */
  mine: number;
  /** Classement : le plus de clics d'abord. */
  ranking: BoutonRougeScore[];
}
