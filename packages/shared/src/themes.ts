import { z } from 'zod';
import { userToolsSchema } from './tools.js';

/**
 * Thèmes de couleur de l'interface, au choix de chaque utilisateur (enregistré sur sa fiche).
 * Un thème ne fixe que les couleurs d'accent : menu latéral (`navy`), liens et boutons (`blue`), fonds clairs (`blue50`).
 * `blue` doit rester lisible sur fond blanc (texte des liens).
 */
export const THEMES = ['comte', 'marine', 'foret', 'biere', 'framboise', 'prune', 'ardoise', 'mordor'] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = 'comte';

export interface ThemeColors {
  /** Menu latéral, titres. */
  navy: string;
  /** Second ton du dégradé de la page de connexion. */
  navy2: string;
  /** Accent : liens, boutons, onglets. */
  blue: string;
  /** Fond clair de l'accent (sélection, étiquettes). */
  blue50: string;
}

export interface ThemeDef {
  label: string;
  description: string;
  colors: ThemeColors;
  /** Logo affiché à la place du hobbit (menu, connexion, icône de l'onglet), dans `apps/web/public`. */
  logo?: string;
  /** Assistant incarné à la place de Gandalf (bulle, chat, ton de l'IA). */
  assistant?: AssistantPersona;
}

/** Personnage de l'assistant : nom affiché, avatar (dans `apps/web/public`) et ton demandé à l'IA. */
export interface AssistantPersona {
  name: string;
  avatar: string;
  /** Consigne de ton ajoutée au prompt système (fixe pour chaque personnage : le cache de prompt est conservé). */
  tone?: string;
}

export const DEFAULT_ASSISTANT: AssistantPersona = { name: 'Gandalf', avatar: '/gandalf.png' };

export const THEME_DEFS: Record<ThemeId, ThemeDef> = {
  comte: { label: 'La Comté', description: 'Vert prairie, comme chez soi (thème par défaut).', colors: { navy: '#2f4a2a', navy2: '#4a6b3a', blue: '#3f7a32', blue50: '#eef5ea' } },
  marine: { label: 'Bleu marine', description: 'Le thème d’origine, sobre.', colors: { navy: '#1f3864', navy2: '#2b4f8c', blue: '#2e74b5', blue50: '#eef4fb' } },
  foret: { label: 'Forêt', description: 'Vert sapin et bleu canard.', colors: { navy: '#123f3c', navy2: '#1f6b65', blue: '#0e7c73', blue50: '#e6f4f2' } },
  biere: { label: 'Bière ambrée', description: 'Brun chaleureux et ambre.', colors: { navy: '#4a2e12', navy2: '#7a5220', blue: '#99560f', blue50: '#fbf2e4' } },
  framboise: { label: 'Framboise', description: 'Rose profond.', colors: { navy: '#561a32', navy2: '#86304f', blue: '#b12d5c', blue50: '#fbedf2' } },
  prune: { label: 'Prune', description: 'Violet doux.', colors: { navy: '#3b2251', navy2: '#5c3a80', blue: '#7046a8', blue50: '#f3eefa' } },
  ardoise: { label: 'Ardoise', description: 'Gris neutre.', colors: { navy: '#2b2f36', navy2: '#4a515c', blue: '#4b6177', blue50: '#eef1f4' } },
  mordor: {
    label: 'Mordor',
    description: 'Rouge et noir. À vos risques et périls…',
    colors: { navy: '#140707', navy2: '#5c0d0a', blue: '#b3261e', blue50: '#fbeceb' },
    logo: '/oeil-de-sauron.png',
    assistant: {
      name: 'Saroumane',
      avatar: '/saroumane.svg',
      tone: 'Tu parles avec la superbe de Saroumane le Blanc, maître d’Orthanc : une pointe hautaine et théâtrale (une courte formule au plus par réponse), sans jamais nuire à l’exactitude, à la concision ni à la courtoisie.',
    },
  },
};

/** Thème connu, ou le thème par défaut (fiches enregistrées avant le choix du thème, valeur inconnue). */
export function themeOrDefault(id: string | undefined | null): ThemeId {
  return (THEMES as readonly string[]).includes(id ?? '') ? (id as ThemeId) : DEFAULT_THEME;
}

/** Assistant du thème (Gandalf, sauf thème qui en incarne un autre). */
export function themeAssistant(id: string | undefined | null): AssistantPersona {
  return THEME_DEFS[themeOrDefault(id)].assistant ?? DEFAULT_ASSISTANT;
}

/** Préférences que chacun règle pour lui-même (`PUT /api/me/preferences`) : chacune facultative, seules celles envoyées changent. */
export const mePreferencesSchema = z.object({ theme: z.enum(THEMES).optional(), tools: userToolsSchema.optional() });
export type MePreferences = z.input<typeof mePreferencesSchema>;
