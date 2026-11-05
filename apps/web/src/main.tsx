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
import { CdcEditorPage } from './cdc/CdcEditorPage';
import { Usage } from './pages/Usage';
import { FilesHome } from './files/FilesHome';
import { FileTypeNew } from './files/FileTypeNew';
import { FileTypePage } from './files/FileTypePage';
import { FileViewer } from './files/FileViewer';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'projets', element: <ProjectsList /> },
      { path: 'projets/:id', element: <ProjectPage /> },
      { path: 'cdc', element: <CdcList /> },
      // Les cahiers des charges se créent désormais depuis un projet.
      { path: 'cdc/nouveau', element: <Navigate to="/projets" replace /> },
      { path: 'cdc/:id', element: <CdcEditorPage /> },
      { path: 'fichiers', element: <FilesHome /> },
      { path: 'fichiers/types/nouveau', element: <FileTypeNew /> },
      { path: 'fichiers/types/:id', element: <FileTypePage /> },
      { path: 'fichiers/lecture', element: <FileViewer /> },
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
