/** Formats de sortie demandés au modèle pour les fiches de lecture (tous les champs sont obligatoires : sorties structurées). */
import { z } from 'zod';
import { CHECK_KINDS, ENCODINGS, FIELD_TYPES, FILE_FORMATS, RECORD_ROLES } from '@samm/shared';

const field = z.object({
  key: z.string().describe('Identifiant court en snake_case, unique dans l’enregistrement'),
  label: z.string().describe('Libellé lisible en français'),
  start: z.number().int().describe('Positions fixes : position du 1er caractère (à partir de 1). Délimité : numéro de colonne (à partir de 1)'),
  length: z.number().int().describe('Positions fixes : nombre de caractères. Délimité : 0'),
  type: z.enum(FIELD_TYPES),
  impliedDecimals: z.number().int().describe('Décimales implicites si la valeur n’a pas de séparateur (ex. 2 pour des centimes), sinon 0'),
  dateFormat: z.string().describe('Pour date/time/datetime : jetons YYYY YY MM DD HH mm ss et séparateurs (ex. YYYYMMDD). Sinon chaîne vide'),
  values: z.array(z.object({ code: z.string(), label: z.string() })).describe('Libellés des codes connus, sinon liste vide'),
  description: z.string(),
  hidden: z.boolean().describe('true pour une zone vide, réservée ou « non utilisée »'),
});

const recordType = z.object({
  code: z.string().describe('Code court et unique du type d’enregistrement (ex. « 12 »)'),
  name: z.string().describe('Nom lisible en français'),
  description: z.string(),
  role: z.enum(RECORD_ROLES),
  match: z
    .array(z.object({ start: z.number().int(), length: z.number().int(), value: z.string() }))
    .describe('Règles de reconnaissance (toutes vérifiées) : zone de la ligne et valeur attendue. Liste vide = type par défaut'),
  parent: z.string().nullable().describe('Code du type parent auquel rattacher la ligne (ex. ligne d’article → facture), sinon null'),
  fields: z.array(field),
});

const check = z.object({
  label: z.string(),
  kind: z.enum(CHECK_KINDS),
  expectedRecord: z.string(),
  expectedField: z.string(),
  targetRecords: z.array(z.string()),
  targetField: z.string().describe('Pour une somme : champ additionné ; sinon chaîne vide'),
  blockStart: z.string().nullable().describe('Type qui ouvre le bloc contrôlé, ou null pour tout le fichier'),
});

const settings = z.object({
  format: z.enum(FILE_FORMATS),
  encoding: z.enum(ENCODINGS),
  delimiter: z.string(),
  quote: z.string(),
  skipLines: z.number().int(),
  fileNamePattern: z.string().describe('Motif du nom de fichier avec *, ex. « *_facture_a_plat*.txt », ou chaîne vide'),
});

/** Brouillon complet produit à partir de la documentation (modèle rapide). */
export const draftSpecSchema = z.object({
  settings,
  recordTypes: z.array(recordType),
  checks: z.array(check),
  remarks: z.array(z.string()).describe('Incertitudes ou contradictions relevées dans la documentation'),
});
export type DraftSpec = z.infer<typeof draftSpecSchema>;

/** Correctif appliqué à une fiche existante (ou création complète si la fiche est vide). */
export const specPatchSchema = z.object({
  settings: settings.nullable().describe('Réglages généraux complets, ou null si inchangés'),
  upsertRecordTypes: z.array(recordType).describe('Types d’enregistrement créés ou modifiés, chacun avec la liste COMPLÈTE de ses champs'),
  removeRecordTypes: z.array(z.string()).describe('Codes des types d’enregistrement à supprimer'),
  checks: z.array(check).nullable().describe('Liste complète des contrôles, ou null si inchangée'),
  summary: z.string().describe('Résumé des modifications en une phrase'),
  remarks: z.array(z.string()).describe('Points incertains que l’utilisateur devrait vérifier (liste vide si aucun)'),
});
export type SpecPatch = z.infer<typeof specPatchSchema>;
