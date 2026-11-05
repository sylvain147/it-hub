/**
 * Comptes de connexion (Cognito) des utilisateurs du hub. En production, créer un utilisateur envoie
 * l'invitation par e-mail (mot de passe temporaire), le désactiver bloque sa connexion et ferme ses sessions.
 * En local et dans les tests, il n'y a pas de Cognito : ces opérations ne font rien.
 */
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';

let client: CognitoIdentityProviderClient | null = null;

function cognito(): CognitoIdentityProviderClient | null {
  if (config.authMode !== 'cognito' || !config.userPoolId) return null;
  client ??= new CognitoIdentityProviderClient({});
  return client;
}

async function run<T>(what: string, fn: (c: CognitoIdentityProviderClient, pool: string) => Promise<T>): Promise<T | null> {
  const c = cognito();
  if (!c) return null;
  try {
    return await fn(c, config.userPoolId);
  } catch (e) {
    console.error(`Cognito : ${what}`, e);
    throw new HttpError(502, `Le service de connexion a refusé l’opération (${what}) : ${(e as Error).message}`);
  }
}

/** Crée le compte et envoie l'invitation. Renvoie false si le compte existait déjà (rien n'est envoyé). */
export async function inviteUser(email: string, name: string): Promise<boolean> {
  const c = cognito();
  if (!c) return false;
  try {
    await c.send(
      new AdminCreateUserCommand({
        UserPoolId: config.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: name },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    return true;
  } catch (e) {
    if (e instanceof UsernameExistsException) return false;
    console.error('Cognito : création du compte', e);
    throw new HttpError(502, `Impossible de créer le compte de connexion : ${(e as Error).message}`);
  }
}

/** Renvoie l'invitation (nouveau mot de passe temporaire) à un utilisateur qui ne s'est jamais connecté. */
export async function resendInvitation(email: string): Promise<boolean> {
  const res = await run('renvoi de l’invitation', (c, pool) =>
    c.send(new AdminCreateUserCommand({ UserPoolId: pool, Username: email, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] })),
  );
  return res !== null;
}

export async function setUserEnabled(email: string, enabled: boolean): Promise<void> {
  await run(enabled ? 'réactivation' : 'désactivation', async (c, pool) => {
    if (enabled) return c.send(new AdminEnableUserCommand({ UserPoolId: pool, Username: email }));
    await c.send(new AdminDisableUserCommand({ UserPoolId: pool, Username: email }));
    return c.send(new AdminUserGlobalSignOutCommand({ UserPoolId: pool, Username: email }));
  });
}

export async function updateUserName(email: string, name: string): Promise<void> {
  await run('changement de nom', (c, pool) =>
    c.send(new AdminUpdateUserAttributesCommand({ UserPoolId: pool, Username: email, UserAttributes: [{ Name: 'name', Value: name }] })),
  );
}
