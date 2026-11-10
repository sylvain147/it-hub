/** Entrée du patch note (construite au build par `patch-notes.ts`, à la racine du front). */
export interface PatchNoteChange {
  title: string;
  /** Explications du commit (sans les mentions de co-auteur). */
  details: string;
}

export interface PatchNote {
  /** Commit sur la branche principale. */
  id: string;
  /** Instant (ISO). */
  date: string;
  title: string;
  /** Numéro de la pull request (null : commit direct). */
  pr: number | null;
  changes: PatchNoteChange[];
}
