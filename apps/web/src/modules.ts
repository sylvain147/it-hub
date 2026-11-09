/**
 * Modules du hub. Pour ajouter une fonctionnalité : créer ses pages, puis la déclarer ici
 * (elle apparaît dans le menu, dans sa section, et sur l'accueil) et dans les routes de `main.tsx`.
 *
 * Le menu doit rester court : une entrée par module (les sous-pages s'ouvrent depuis la page du module),
 * quatre entrées au plus par section, et ce qui est déjà accessible ailleurs (bouton To-do de l'en-tête)
 * reste hors du menu (`menu: false`). L'administration est dans le menu de l'utilisateur, en bas.
 */
import type { Permission } from '@samm/shared';

export const MENU_SECTIONS = [
  { id: 'projets', title: 'Projets' },
  { id: 'quotidien', title: 'Au quotidien' },
  { id: 'prestataires', title: 'Prestataires et flux' },
] as const;
export type MenuSection = (typeof MENU_SECTIONS)[number]['id'];

export interface HubModule {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: string;
  section: MenuSection;
  /** false : hors du menu (accessible autrement), mais présent sur l'accueil si `home` n'est pas false. */
  menu?: boolean;
  home?: boolean;
}

export const MODULES: HubModule[] = [
  {
    id: 'todo',
    title: 'To-do',
    description: 'Ma liste de choses à faire, à cocher, rattachées ou non à un projet (sans lien avec les tickets). Selon le rôle, celles de toute l’équipe.',
    path: '/todo',
    icon: '✅',
    section: 'quotidien',
    menu: false,
    home: false,
  },
  {
    id: 'notes',
    title: 'Notes',
    description: 'Mon bloc-notes personnel : des notes en vrac, rattachées ou non à un projet, que je suis seul à voir.',
    path: '/notes',
    icon: '📝',
    section: 'quotidien',
  },
  {
    id: 'assistant',
    title: 'Assistant',
    description: 'Un chat avec l’IA sur tout le hub : où en est un projet, quelles échéances arrivent, que faire en priorité aujourd’hui.',
    path: '/assistant',
    icon: '✨',
    section: 'quotidien',
  },
  {
    id: 'reunion',
    title: 'Transcrire une réunion',
    description: 'Un clic au début de la réunion (Teams, Zoom…) : ce qui est dit s’écrit au fil de l’eau, sans enregistrer le son. L’assistant en fait ensuite le compte rendu dans le projet.',
    path: '/reunion',
    icon: '🎙️',
    section: 'quotidien',
  },
  {
    id: 'projets',
    title: 'Projets',
    description:
      'Suivre chaque projet : intervenants, prestations et budget, tickets, planning, documents et liens, journal, risques. Les cahiers des charges se rédigent depuis le projet.',
    path: '/projets',
    icon: '📁',
    section: 'projets',
  },
  {
    id: 'idees',
    title: 'Idées d’amélioration',
    description: 'La liste des idées d’amélioration de l’équipe (ERP, outils…), classées par priorité. Une idée retenue devient un ticket en un clic ; une liste Notion s’importe en un copier-coller.',
    path: '/idees',
    icon: '💡',
    section: 'quotidien',
  },
  {
    id: 'planning',
    title: 'Planning',
    description: 'Les jalons de tous les projets sur une même frise : ce qui arrive, ce qui glisse, ce qui est en retard.',
    path: '/planning',
    icon: '🗓️',
    section: 'projets',
  },
  {
    id: 'sprints',
    title: 'Sprints',
    description: 'Planifier les tickets des projets dans des sprints, les faire avancer sur le tableau, et faire rédiger par l’IA la préparation ou le compte rendu d’un sprint.',
    path: '/sprints',
    icon: '🧭',
    section: 'projets',
  },
  {
    id: 'fichiers',
    title: 'Lecteur de fichiers',
    description: 'Décortiquer les fichiers à plat, CSV et exports des flux : l’assistant apprend chaque format une fois, la lecture est ensuite instantanée et reste sur votre poste.',
    path: '/fichiers',
    icon: '🗂️',
    section: 'prestataires',
  },
  {
    id: 'tma',
    title: 'Suivi TMA',
    description: 'Importer les exports de tickets Desk et le relevé mensuel du prestataire : temps passé par ticket et par intervenant, récurrences par thème, synthèse rédigée par l’IA.',
    path: '/tma',
    icon: '⏱️',
    section: 'prestataires',
  },
];

export const ADMIN_LINKS: { title: string; path: string; icon: string; permission?: Permission }[] = [
  { title: 'Utilisateurs', path: '/utilisateurs', icon: '👥', permission: 'manageUsers' },
  { title: 'Paramétrage', path: '/parametrage', icon: '⚙️' },
  { title: 'Retours', path: '/retours', icon: '💬', permission: 'manageFeedback' },
  { title: 'Consommation IA', path: '/consommation', icon: '📊' },
];
