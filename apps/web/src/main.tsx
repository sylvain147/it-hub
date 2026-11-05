import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router';
import { loadConfig } from './config';
import { AuthGate, configureAuth } from './auth';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { CdcList } from './pages/CdcList';
import { ProjectsList } from './projects/ProjectsList';
import { ProjectPage } from './projects/ProjectPage';
import { SprintPage } from './jira/SprintPage';
import { JiraPage } from './jira/JiraPage';
import { CdcEditorPage } from './cdc/CdcEditorPage';
import { Usage } from './pages/Usage';
import { FilesHome } from './files/FilesHome';
import { FileTypeNew } from './files/FileTypeNew';
import { FileTypePage } from './files/FileTypePage';
import { FileViewer } from './files/FileViewer';
import { TmaHome } from './tma/TmaHome';
import { SettingsPage } from './settings/SettingsPage';
import { TasksPage } from './users/TasksPage';
import { UsersPage } from './users/UsersPage';
import { TmaMonthPage } from './tma/TmaMonthPage';
import { TmaThemesPage } from './tma/TmaThemesPage';
import './styles.css';

function OldSprintRedirect() {
  const { sprintId } = useParams();
  return <Navigate to={`/jira/sprints/${sprintId}`} replace />;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'projets', element: <ProjectsList /> },
      { path: 'projets/:id', element: <ProjectPage /> },
      // Ancienne adresse des revues de sprint (onglet « Sprints » des projets).
      { path: 'projets/:id/sprints/:sprintId', element: <OldSprintRedirect /> },
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
      { path: 'taches', element: <TasksPage /> },
      { path: 'jira', element: <JiraPage /> },
      { path: 'jira/sprints/:sprintId', element: <SprintPage /> },
      { path: 'utilisateurs', element: <UsersPage /> },
      { path: 'parametrage', element: <SettingsPage /> },
      { path: 'consommation', element: <Usage /> },
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
