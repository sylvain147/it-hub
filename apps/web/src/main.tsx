import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { loadConfig } from './config';
import { AuthGate, configureAuth } from './auth';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { CdcList } from './pages/CdcList';
import { CdcNew } from './pages/CdcNew';
import { CdcEditorPage } from './cdc/CdcEditorPage';
import { Usage } from './pages/Usage';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'cdc', element: <CdcList /> },
      { path: 'cdc/nouveau', element: <CdcNew /> },
      { path: 'cdc/:id', element: <CdcEditorPage /> },
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
