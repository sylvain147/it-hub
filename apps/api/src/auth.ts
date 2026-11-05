import type { Context, MiddlewareHandler } from 'hono';
import { can, type Permission, type Role } from '@samm/shared';
import { config } from './config.js';
import { HttpError } from './lib/util.js';
import { currentHubUser } from './users/access.js';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

interface LambdaEnv {
  event?: { requestContext?: { authorizer?: { jwt?: { claims?: Record<string, string> } } } };
}

/**
 * En production, le jeton Cognito (MFA obligatoire) est vérifié par l'autorisateur JWT d'API Gateway :
 * une requête qui arrive ici est authentifiée, on lit simplement ses claims.
 * En local, l'utilisateur est simulé.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (config.authMode === 'cognito') {
    const claims = (c.env as LambdaEnv | undefined)?.event?.requestContext?.authorizer?.jwt?.claims;
    if (!claims?.sub) throw new HttpError(401, 'Non authentifié');
    const email = (claims.email ?? claims['cognito:username'] ?? claims.sub).toLowerCase();
    const u = await currentHubUser(email, claims.name ?? '');
    c.set('user', { id: claims.sub, email, name: u.name, role: u.role });
  } else {
    const email = (c.req.header('x-dev-user') || 'dev@local').trim().toLowerCase();
    const u = await currentHubUser(email);
    c.set('user', { id: email, email, name: u.name, role: u.role });
  }
  await next();
};

export const userName = (c: Context) => c.get('user').email;

/** Refuse la requête si le rôle de l'utilisateur ne porte pas ce droit. */
export function requirePermission(c: Context, perm: Permission, what: string) {
  if (!can(c.get('user').role, perm)) throw new HttpError(403, `Votre rôle ne permet pas de ${what}.`);
}
