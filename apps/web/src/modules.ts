/**
 * Modules du hub. Pour ajouter une fonctionnalité : créer ses pages, puis la déclarer ici
 * (elle apparaît dans le menu, dans sa section) et dans les routes de `main.tsx`.
 *
 * Le menu doit rester court : une entrée par module (les sous-pages s'ouvrent depuis la page du module),
 * quatre entrées au plus par section, et ce qui est déjà accessible ailleurs reste hors du menu (`menu: false`).
 * L'assistant (Gandalf) n'est pas un module : c'est la bulle en bas à droite. L'administration est dans le menu
 * de l'utilisateur, en bas.
 */
import type { Permission } from '@samm/shared';

export const MENU_SECTIONS = [
  { id: 'projets', title: 'Projets' },
  { id: 'quotidien', title: 'Au quotidien' },
  /** Composée par chacun sur sa fiche (« Ma fiche ») : outils du hub de cette section et liens personnels. */
  { id: 'outils', title: 'Outils' },
] as const;
export type MenuSection = (typeof MENU_SECTIONS)[number]['id'];

export interface HubModule {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: string;
  section: MenuSection;
  /** false : hors du menu (accessible autrement). */
  menu?: boolean;
}

export const MODULES: HubModule[] = [
  {
    id: 'todo',
    title: 'To-do',
    description: 'Ma liste de choses à faire, à cocher, rattachées ou non à un projet (sans lien avec les tickets). Selon le rôle, celles de toute l’équipe.',
    path: '/todo',
    icon: '✅',
    section: 'quotidien',
  },
  {
    id: 'notes',
    title: 'Notes',
    description: 'Mon bloc-notes personnel : des notes en vrac, rattachées ou non à un projet, que je suis seul à voir. On y transcrit aussi une réunion en direct.',
    path: '/notes',
    icon: '📝',
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
    description: 'La liste des idées d’amélioration de l’équipe (ERP, outils…), classées par priorité. Une idée retenue devient un ticket en un clic.',
    path: '/idees',
    icon: '💡',
    section: 'quotidien',
  },
  {
    id: 'faq',
    title: 'FAQ',
    description: 'Les questions qui reviennent et leurs réponses, rangées par thème. Chacun ajoute une question, même sans réponse, et complète celles des autres.',
    path: '/faq',
    icon: '❓',
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
    title: 'Tickets',
    description: 'Tous les tickets, avec une recherche ; les planifier dans des sprints, les faire avancer sur le tableau, et faire rédiger par l’IA la préparation ou le compte rendu d’un sprint.',
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
    section: 'outils',
  },
  {
    id: 'tma',
    title: 'Suivi TMA',
    description: 'Importer les exports de tickets Desk et le relevé mensuel du prestataire : temps passé par ticket et par intervenant, récurrences par thème, synthèse rédigée par l’IA.',
    path: '/tma',
    icon: '⏱️',
    section: 'outils',
  },
];

/** Outils du hub que chacun peut mettre dans sa section « Outils ». */
export const TOOL_MODULES = MODULES.filter((m) => m.section === 'outils');

export const ADMIN_LINKS: { title: string; path: string; icon: string; permission?: Permission }[] = [
  { title: 'Utilisateurs', path: '/utilisateurs', icon: '👥', permission: 'manageUsers' },
  { title: 'Paramétrage', path: '/parametrage', icon: '⚙️' },
  { title: 'Retours', path: '/retours', icon: '💬', permission: 'manageFeedback' },
  { title: 'Consommation IA', path: '/consommation', icon: '📊' },
];
