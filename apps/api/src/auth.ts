import type { Context, MiddlewareHandler } from 'hono';
import { config } from './config.js';
import { HttpError } from './lib/util.js';

export interface User {
  id: string;
  email: string;
  name: string;
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
    const email = claims.email ?? claims['cognito:username'] ?? claims.sub;
    c.set('user', { id: claims.sub, email, name: claims.name || email });
  } else {
    const email = c.req.header('x-dev-user') || 'dev@local';
    c.set('user', { id: email, email, name: email });
  }
  await next();
};

export const userName = (c: Context) => c.get('user').email;
