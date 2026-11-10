/**
 * L'Anneau unique : petit jeu caché. De temps en temps, au hasard, un anneau d'or apparaît à l'écran ; qui clique
 * dessus le prend (même s'il était au doigt d'un autre). Son porteur a un rond doré autour de ses initiales.
 */

/** Rareté : une chance sur `ANNEAU_CHANCE` à chaque changement de page… */
export const ANNEAU_CHANCE = 40;
/** … et pas plus d'une apparition par période (en minutes). */
export const ANNEAU_PAUSE_MIN = 30;

export interface AnneauState {
  /** E-mail du porteur, null tant que personne ne l'a pris. */
  holder: string | null;
  /** Depuis quand il le porte (ISO). */
  since: string | null;
  /** Nombre de fois où l'Anneau a changé de main. */
  passes: number;
}

/** Réponse à la prise de l'Anneau : son nouvel état et l'ancien porteur (null s'il était libre). */
export interface AnneauTaken extends AnneauState {
  previous: string | null;
}
