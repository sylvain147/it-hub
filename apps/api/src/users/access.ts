/**
 * Utilisateur du hub correspondant à l'identité authentifiée.
 *  - le tout premier utilisateur devient administrateur (démarrage d'un hub vide) ;
 *  - une personne authentifiée mais inconnue de l'annuaire y est ajoutée comme chargé de projet (en production,
 *    seuls les comptes créés par un administrateur peuvent se connecter : l'inscription libre est fermée) ;
 *  - un utilisateur désactivé est refusé.
 */
import { DEFAULT_THEME, type HubUser } from '@samm/shared';
import { HttpError, nowIso } from '../lib/util.js';
import * as users from './repo.js';

/** « alice.martin@exemple.fr » → « Alice Martin ». */
export function nameFromEmail(email: string): string {
  return (email.split('@')[0] ?? email)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export async function currentHubUser(email: string, displayName = ''): Promise<HubUser> {
  const key = email.trim().toLowerCase();
  let u = (await users.listUsers()).find((x) => x.email === key);
  if (!u) {
    const all = await users.listUsers(true);
    u = all.find((x) => x.email === key);
    if (!u) {
      const now = nowIso();
      const created: HubUser = {
        email: key,
        name: (displayName && displayName !== email ? displayName : nameFromEmail(key)).slice(0, 120),
        role: all.length === 0 ? 'admin' : 'membre',
        active: true,
        jobTitle: '',
        backupId: '',
        perimeters: [],
        theme: DEFAULT_THEME,
        tools: null,
        createdAt: now,
        createdBy: key,
        updatedAt: now,
        updatedBy: key,
        lastSeenAt: null,
        invitedAt: null,
      };
      u = (await users.createUser(created)) ? created : await users.getUser(key);
    }
  }
  if (!u.active) throw new HttpError(403, 'Votre accès à Hobbit a été désactivé. Contactez un administrateur.');
  await users.touchLastSeen(u);
  return u;
}
