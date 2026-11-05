/** Configuration d'exécution, fournie en production par `/config.json` (généré au déploiement). */
export interface RuntimeConfig {
  authMode: 'dev' | 'cognito';
  region?: string;
  userPoolId?: string;
  userPoolClientId?: string;
}

let current: RuntimeConfig = { authMode: 'dev' };

export async function loadConfig(): Promise<RuntimeConfig> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (res.ok && res.headers.get('content-type')?.includes('json')) current = (await res.json()) as RuntimeConfig;
  } catch {
    /* développement local : valeurs par défaut */
  }
  return current;
}

export const runtimeConfig = () => current;

/** Mode développement : compte utilisé (pas de mot de passe). */
export const DEV_USER_KEY = 'hub-dev-user';
