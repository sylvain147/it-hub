import { z } from 'zod';
import type { ItemBase } from './project.js';

/**
 * Notes en vrac : le bloc-notes personnel de chaque utilisateur. Une note appartient à son titulaire (`ownerId`) :
 * lui seul la voit, avec les administrateurs (droit `manageAllNotes`), qui peuvent aussi lui en ajouter (`createdBy`
 * est alors l'administrateur). Elle peut être rattachée à un projet (`projectId`) pour la retrouver depuis sa page.
 * À ne pas confondre avec le journal d'un projet (comptes rendus, décisions), partagé par l'équipe.
 */
export const personalNoteInputSchema = z
  .object({
    title: z.string().trim().max(200).default(''),
    /** Texte en Markdown. */
    content: z.string().max(50_000).default(''),
    /** Projet concerné (vide : note hors projet). */
    projectId: z.string().max(40).default(''),
    /** Épinglée en tête de liste. */
    pinned: z.boolean().default(false),
  })
  .refine((n) => n.title || n.content.trim(), { message: 'La note est vide.' });
export type PersonalNoteInput = z.input<typeof personalNoteInputSchema>;

export type PersonalNote = z.infer<typeof personalNoteInputSchema> & ItemBase & { ownerId: string };

/** Tri : épinglées d'abord, puis la plus récemment modifiée. */
export const byPinnedThenRecent = (a: PersonalNote, b: PersonalNote) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt);
