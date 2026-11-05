/**
 * Modules du hub. Pour ajouter une fonctionnalité : créer ses pages, puis la déclarer ici
 * (elle apparaît dans le menu et sur l'accueil) et dans les routes de `main.tsx`.
 */
export interface HubModule {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: string;
}

export const MODULES: HubModule[] = [
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
];

export const ADMIN_LINKS = [{ title: 'Consommation IA', path: '/consommation', icon: '📊' }];
