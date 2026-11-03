import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';
import { Authenticator, translations } from '@aws-amplify/ui-react';
import { I18n } from 'aws-amplify/utils';
import '@aws-amplify/ui-react/styles.css';
import { runtimeConfig } from './config';

interface AuthState {
  email: string;
  signOut: () => void;
}

const AuthContext = createContext<AuthState>({ email: '', signOut: () => {} });
export const useAuth = () => useContext(AuthContext);

const DEV_USER_KEY = 'hub-dev-user';

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
  I18n.putVocabularies(translations);
  I18n.setLanguage('fr');
  I18n.putVocabulariesForLanguage('fr', {
    'Setup TOTP': 'Configurer l’authentification à deux facteurs',
    'Confirm TOTP Code': 'Saisissez le code de votre application d’authentification',
  });
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (runtimeConfig().authMode !== 'cognito') return <DevAuth>{children}</DevAuth>;
  return (
    <div className="auth-shell">
      <Authenticator hideSignUp components={{ Header: () => <div className="auth-brand">Hub IT</div> }} formFields={{ setupTotp: { QR: { totpIssuer: 'Hub IT' } } }}>
        {({ user, signOut }) => (
          <AuthContext.Provider value={{ email: user?.signInDetails?.loginId ?? user?.username ?? '', signOut: () => signOut?.() }}>
            {children}
          </AuthContext.Provider>
        )}
      </Authenticator>
    </div>
  );
}

/** Mode développement : pas de Cognito, l'utilisateur est choisi localement. */
function DevAuth({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState(() => localStorage.getItem(DEV_USER_KEY) || 'dev@local');
  useEffect(() => localStorage.setItem(DEV_USER_KEY, email), [email]);
  return (
    <AuthContext.Provider
      value={{
        email,
        signOut: () => {
          const next = prompt('Mode développement — se connecter en tant que :', email);
          if (next) setEmail(next);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export async function signOutEverywhere() {
  if (runtimeConfig().authMode === 'cognito') await amplifySignOut();
}
