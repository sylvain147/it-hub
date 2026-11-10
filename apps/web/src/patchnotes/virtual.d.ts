/** Patch note construit au build à partir de l'historique git (`patch-notes.ts`). */
declare module 'virtual:patch-notes' {
  const notes: import('./types').PatchNote[];
  export default notes;
}
