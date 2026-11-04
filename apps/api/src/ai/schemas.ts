/** Formats de sortie structurés demandés au modèle (validés automatiquement). */
import { z } from 'zod';
import { PROJECT_PHASES, QUESTION_PRIORITIES } from '@samm/shared';

const jalon = z.object({
  label: z.string().describe('Libellé du jalon, ex. « Testing phase 1 », « Mise en production »'),
  date: z.string().describe('Date au format AAAA-MM-JJ, ou chaîne vide si inconnue'),
});

const question = z.object({
  text: z.string().describe('La question, formulée pour le chargé de projet'),
  why: z.string().describe('Ce qui manque ou est ambigu, en une phrase'),
  priority: z.enum(QUESTION_PRIORITIES),
  sectionTitle: z.string().describe('Titre de la section concernée'),
});

export const extractionSchema = z.object({
  titre: z.string().describe('Titre court du sujet traité'),
  prestataire: z.string().describe('Nom du prestataire, chaîne vide si inconnu'),
  phase: z.enum(PROJECT_PHASES).nullable(),
  jalons: z.array(jalon),
  estimationJours: z.number().nullable().describe('Charge en jours/homme si elle est mentionnée'),
  notes: z.string().describe('Notes structurées en Markdown'),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const draftSchema = z.object({
  title: z.string(),
  prestataire: z.string(),
  phase: z.enum(PROJECT_PHASES).nullable(),
  jalons: z.array(jalon),
  estimationJours: z.number().nullable(),
  sections: z.array(
    z.object({
      kind: z.enum(['contexte', 'standard', 'annexes']),
      title: z.string(),
      markdown: z.string(),
    }),
  ),
  questions: z.array(question),
});
export type Draft = z.infer<typeof draftSchema>;

export const updateSchema = z.object({
  summary: z.string().describe('Résumé des modifications en une phrase (commentaire de version)'),
  sectionChanges: z.array(
    z.object({
      sectionId: z.string().describe('Identifiant de la section modifiée, ou chaîne vide pour une nouvelle section'),
      title: z.string(),
      markdown: z.string().describe('Contenu COMPLET de la section après modification'),
      insertAfterSectionId: z.string().describe('Pour une nouvelle section : identifiant de la section qui la précède, sinon chaîne vide'),
    }),
  ),
  meta: z.object({
    prestataire: z.string().nullable().describe('null = inchangé'),
    phase: z.enum(PROJECT_PHASES).nullable().describe('null = inchangé'),
    jalons: z.array(jalon).nullable().describe('Liste complète des jalons, ou null = inchangé'),
    estimationJours: z.number().nullable().describe('null = inchangé'),
  }),
  newQuestions: z.array(question),
  resolvedQuestionIds: z.array(z.string()).describe('Questions ouvertes auxquelles les nouvelles informations répondent'),
});
export type Update = z.infer<typeof updateSchema>;

export const translationSchema = z.object({
  items: z.array(z.object({ key: z.string(), text: z.string() })),
});
export type Translation = z.infer<typeof translationSchema>;
