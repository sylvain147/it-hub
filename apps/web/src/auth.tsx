import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import type { Me } from '@samm/shared';
import { DEV_USER_KEY, runtimeConfig } from './config';
import { api, ApiError } from './api';
import { LoginPage } from './auth/LoginPage';
import { Spinner } from './components/ui';
import { Brand } from './components/Brand';
import { applyTheme } from './theme';

interface AuthState {
  email: string;
  /** Utilisateur du hub : nom, rôle et droits. */
  me: Me;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
export function useAuth(): AuthState {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth hors de la session');
  return c;
}

/** En-têtes d'authentification à joindre aux appels API. */
export async function authHeaders(): Promise<Record<string, string>> {
  if (runtimeConfig().authMode === 'cognito') {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  return { 'x-dev-user': localStorage.getItem(DEV_USER_KEY) || 'dev@local' };
}

export function configureAuth() {
  const cfg = runtimeConfig();
  if (cfg.authMode !== 'cognito') return;
  Amplify.configure({ Auth: { Cognito: { userPoolId: cfg.userPoolId!, userPoolClientId: cfg.userPoolClientId! } } });
}

async function hasSession(): Promise<boolean> {
  if (runtimeConfig().authMode !== 'cognito') return !!localStorage.getItem(DEV_USER_KEY);
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

/** Affiche la page de connexion tant qu'il n'y a pas de session, puis charge l'utilisateur du hub. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'chargement' | 'deconnecte' | 'connecte'>('chargement');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const loaded = await api.me();
      applyTheme(loaded.theme);
      setMe(loaded);
      setError(null);
      setState('connecte');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('deconnecte');
      else {
        setError((e as Error).message);
        setState('connecte');
      }
    }
  }, []);

  useEffect(() => {
    void hasSession().then((ok) => (ok ? loadMe() : setState('deconnecte')));
  }, [loadMe]);

  const signOut = useCallback(async () => {
    if (runtimeConfig().authMode === 'cognito') await amplifySignOut();
    else localStorage.removeItem(DEV_USER_KEY);
    setMe(null);
    setError(null);
    setState('deconnecte');
  }, []);

  if (state === 'chargement') return <div className="auth-shell"><Spinner /></div>;
  if (state === 'deconnecte') return <LoginPage onSignedIn={() => void loadMe()} />;
  if (error || !me) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-logo"><Brand /></div>
          <div className="alert alert-error">{error ?? 'Session invalide.'}</div>
          <button className="btn btn-block" onClick={() => void signOut()}>Se déconnecter</button>
        </div>
      </div>
    );
  }
  return <AuthContext.Provider value={{ email: me.email, me, signOut, reloadMe: loadMe }}>{children}</AuthContext.Provider>;
}
