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
    id: 'cdc',
    title: 'Cahiers des charges',
    description: 'Générer un cahier des charges à partir d’une transcription de réunion, le compléter, le versionner et l’exporter.',
    path: '/cdc',
    icon: '📄',
  },
];

export const ADMIN_LINKS = [{ title: 'Consommation IA', path: '/consommation', icon: '📊' }];
