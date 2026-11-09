/**
 * Modules du hub. Pour ajouter une fonctionnalité : créer ses pages, puis la déclarer ici
 * (elle apparaît dans le menu et sur l'accueil) et dans les routes de `main.tsx`.
 */
import type { Permission } from '@samm/shared';

export interface HubModule {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: string;
}

export const MODULES: HubModule[] = [
  {
    id: 'todo',
    title: 'To-do',
    description: 'Ma liste de choses à faire, à cocher, rattachées ou non à un projet (sans lien avec les tickets). Selon le rôle, celles de toute l’équipe.',
    path: '/todo',
    icon: '✅',
  },
  {
    id: 'notes',
    title: 'Notes',
    description: 'Mon bloc-notes personnel : des notes en vrac, rattachées ou non à un projet, que je suis seul à voir.',
    path: '/notes',
    icon: '📝',
  },
  {
    id: 'reunion',
    title: 'Transcrire une réunion',
    description: 'Un clic au début de la réunion (Teams, Zoom…) : ce qui est dit s’écrit au fil de l’eau, sans enregistrer le son. L’assistant en fait ensuite le compte rendu dans le projet.',
    path: '/reunion',
    icon: '🎙️',
  },
  {
    id: 'projets',
    title: 'Projets',
    description:
      'Suivre chaque projet : intervenants, prestations et budget, tickets, planning, documents et liens, journal, risques. Les cahiers des charges se rédigent depuis le projet.',
    path: '/projets',
    icon: '📁',
  },
  {
    id: 'idees',
    title: 'Idées d’amélioration',
    description: 'La liste des idées d’amélioration de l’équipe (ERP, outils…), classées par priorité. Une idée retenue devient un ticket en un clic ; une liste Notion s’importe en un copier-coller.',
    path: '/idees',
    icon: '💡',
  },
  {
    id: 'planning',
    title: 'Planning',
    description: 'Les jalons de tous les projets sur une même frise : ce qui arrive, ce qui glisse, ce qui est en retard.',
    path: '/planning',
    icon: '🗓️',
  },
  {
    id: 'sprints',
    title: 'Sprints',
    description: 'Planifier les tickets des projets dans des sprints, les faire avancer sur le tableau, et faire rédiger par l’IA la préparation ou le compte rendu d’un sprint.',
    path: '/sprints',
    icon: '🧭',
  },
  {
    id: 'fichiers',
    title: 'Lecteur de fichiers',
    description: 'Décortiquer les fichiers à plat, CSV et exports des flux : l’assistant apprend chaque format une fois, la lecture est ensuite instantanée et reste sur votre poste.',
    path: '/fichiers',
    icon: '🗂️',
  },
  {
    id: 'tma',
    title: 'Suivi TMA',
    description: 'Importer les exports de tickets Desk et le relevé mensuel du prestataire : temps passé par ticket et par intervenant, récurrences par thème, synthèse rédigée par l’IA.',
    path: '/tma',
    icon: '⏱️',
  },
];

export const ADMIN_LINKS: { title: string; path: string; icon: string; permission?: Permission }[] = [
  { title: 'Utilisateurs', path: '/utilisateurs', icon: '👥', permission: 'manageUsers' },
  { title: 'Paramétrage', path: '/parametrage', icon: '⚙️' },
  { title: 'Retours', path: '/retours', icon: '💬', permission: 'manageFeedback' },
  { title: 'Consommation IA', path: '/consommation', icon: '📊' },
];
