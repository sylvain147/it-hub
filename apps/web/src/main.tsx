import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { loadConfig } from './config';
import { AuthGate, configureAuth } from './auth';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { ProjectsList } from './projects/ProjectsList';
import { ProjectPage } from './projects/ProjectPage';
import { GlobalPlanningPage } from './projects/GlobalPlanningPage';
import { NotesPage } from './notes/NotesPage';
import { SprintPage } from './sprints/SprintPage';
import { PatchNotePage } from './patchnotes/PatchNotePage';
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
import { MePage } from './users/MePage';
import { TmaMonthPage } from './tma/TmaMonthPage';
import { TmaThemesPage } from './tma/TmaThemesPage';
import { IdeasPage } from './ideas/IdeasPage';
import { FaqPage } from './faq/FaqPage';
import { PatchPage } from './patch/PatchPage';
import { MeetingRedirect } from './meetings/recorder';
import { applyStoredTheme } from './theme';
import { PublicReviewPage } from './cdc/PublicReviewPage';
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
      { path: 'faq', element: <FaqPage /> },
      { path: 'patch', element: <PatchPage /> },
      // La transcription de réunion a rejoint la page Notes.
      { path: 'reunion', element: <MeetingRedirect /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'cdc', element: <Navigate to="/projets" replace /> },
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
      // L'assistant est devenu Gandalf, la bulle en bas à droite de chaque page.
      { path: 'assistant', element: <Navigate to="/" replace /> },
      { path: 'sprints', element: <SprintsPage /> },
      { path: 'sprints/:sprintId', element: <SprintPage /> },
      { path: 'utilisateurs', element: <UsersPage /> },
      { path: 'moi', element: <MePage /> },
      { path: 'parametrage', element: <SettingsPage /> },
      { path: 'retours', element: <FeedbackPage /> },
      { path: 'patch-note', element: <PatchNotePage /> },
      { path: 'consommation', element: <Usage /> },
      // Sans lien dans le menu : il faut connaître l'adresse.
      { path: '*', element: <div className="page"><h1>Page introuvable</h1></div> },
    ],
  },
]);

applyStoredTheme();

// Lien de validation d'un CDC reçu par e-mail : page publique, sans connexion au hub.
const reviewToken = /^\/validation\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname)?.[1];

void loadConfig().then(() => {
  const root = createRoot(document.getElementById('root')!);
  if (reviewToken) {
    root.render(
      <StrictMode>
        <PublicReviewPage token={reviewToken} />
      </StrictMode>,
    );
    return;
  }
  configureAuth();
  root.render(
    <StrictMode>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </StrictMode>,
  );
});
