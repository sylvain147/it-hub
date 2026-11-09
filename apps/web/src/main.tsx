import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { loadConfig } from './config';
import { AuthGate, configureAuth } from './auth';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { CdcList } from './pages/CdcList';
import { ProjectsList } from './projects/ProjectsList';
import { ProjectPage } from './projects/ProjectPage';
import { GlobalPlanningPage } from './projects/GlobalPlanningPage';
import { NotesPage } from './notes/NotesPage';
import { SprintPage } from './sprints/SprintPage';
import { SprintsPage } from './sprints/SprintsPage';
import { CdcEditorPage } from './cdc/CdcEditorPage';
import { Usage } from './pages/Usage';
import { FilesHome } from './files/FilesHome';
import { FileTypeNew } from './files/FileTypeNew';
import { FileTypePage } from './files/FileTypePage';
import { FileViewer } from './files/FileViewer';
import { TmaHome } from './tma/TmaHome';
import { SettingsPage } from './settings/SettingsPage';
import { TodoPage } from './users/TodoPage';
import { FeedbackPage } from './feedback/FeedbackPage';
import { UsersPage } from './users/UsersPage';
import { TmaMonthPage } from './tma/TmaMonthPage';
import { TmaThemesPage } from './tma/TmaThemesPage';
import { MurDeLaHonte } from './bouton/BoutonRouge';
import { IdeasPage } from './ideas/IdeasPage';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'projets', element: <ProjectsList /> },
      { path: 'projets/:id', element: <ProjectPage /> },
      { path: 'planning', element: <GlobalPlanningPage /> },
      { path: 'idees', element: <IdeasPage /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'cdc', element: <CdcList /> },
      // Les cahiers des charges se créent désormais depuis un projet.
      { path: 'cdc/nouveau', element: <Navigate to="/projets" replace /> },
      { path: 'cdc/:id', element: <CdcEditorPage /> },
      { path: 'fichiers', element: <FilesHome /> },
      { path: 'fichiers/types/nouveau', element: <FileTypeNew /> },
      { path: 'fichiers/types/:id', element: <FileTypePage /> },
      { path: 'fichiers/lecture', element: <FileViewer /> },
      { path: 'tma', element: <TmaHome /> },
      { path: 'tma/mois/:month', element: <TmaMonthPage /> },
      { path: 'tma/themes', element: <TmaThemesPage /> },
      { path: 'todo', element: <TodoPage /> },
      // Anciennes adresses : « Tâches » est devenue la to-do, Jira a laissé place aux sprints du hub.
      { path: 'taches', element: <Navigate to="/todo" replace /> },
      { path: 'jira/*', element: <Navigate to="/sprints" replace /> },
      { path: 'sprints', element: <SprintsPage /> },
      { path: 'sprints/:sprintId', element: <SprintPage /> },
      { path: 'utilisateurs', element: <UsersPage /> },
      { path: 'parametrage', element: <SettingsPage /> },
      { path: 'retours', element: <FeedbackPage /> },
      { path: 'consommation', element: <Usage /> },
      // Sans lien dans le menu : il faut connaître l'adresse.
      { path: 'mur-de-la-honte', element: <MurDeLaHonte /> },
      { path: '*', element: <div className="page"><h1>Page introuvable</h1></div> },
    ],
  },
]);

void loadConfig().then(() => {
  configureAuth();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </StrictMode>,
  );
});
