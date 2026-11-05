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
    id: 'taches',
    title: 'Tâches',
    description: 'Mes tâches de tous les projets et mes tâches personnelles, au même endroit. Selon le rôle, celles de toute l’équipe.',
    path: '/taches',
    icon: '✅',
  },
  {
    id: 'projets',
    title: 'Projets',
    description:
      'Suivre chaque projet : intervenants, prestations et budget, tâches, planning, documents et liens, journal, risques. Les cahiers des charges se rédigent depuis le projet.',
    path: '/projets',
    icon: '📁',
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
  { title: 'Consommation IA', path: '/consommation', icon: '📊' },
];
