import { Hono } from 'hono';
import { teamsSettingsBody } from '@samm/shared';
import { requirePermission, userName } from '../auth.js';
import { body } from '../lib/http.js';
import { HttpError, nowIso } from '../lib/util.js';
import { getTeamsConfig, putTeamsConfig, sendTeams, teamsSettingsView } from './teams.js';

/** Adresse du hub vue par le navigateur (liens des cartes Teams). */
function appOrigin(origin: string | undefined): string {
  try {
    return origin ? new URL(origin).origin : '';
  } catch {
    return '';
  }
}

/** Routes de la connexion Teams (montées sous /api/notifications). */
export function notificationRoutes() {
  const r = new Hono();

  r.get('/teams', async (c) => {
    requirePermission(c, 'manageIntegrations', 'gérer la connexion Teams');
    return c.json(teamsSettingsView(await getTeamsConfig()));
  });

  r.put('/teams', async (c) => {
    requirePermission(c, 'manageIntegrations', 'gérer la connexion Teams');
    const b = await body(c, teamsSettingsBody);
    const before = await getTeamsConfig();
    const webhookUrl = b.webhookUrl ?? before.webhookUrl;
    const next = {
      ...before,
      webhookUrl,
      events: { ...before.events, ...b.events },
      appUrl: appOrigin(c.req.header('origin') ?? c.req.header('referer')) || before.appUrl,
      lastError: webhookUrl === before.webhookUrl ? before.lastError : null,
      updatedAt: nowIso(),
      updatedBy: userName(c),
    };
    await putTeamsConfig(next);
    return c.json(teamsSettingsView(next));
  });

  /** Message d'essai, pour vérifier la connexion (l'erreur de Teams est renvoyée telle quelle). */
  r.post('/teams/test', async (c) => {
    requirePermission(c, 'manageIntegrations', 'gérer la connexion Teams');
    const conf = await getTeamsConfig();
    if (!conf.webhookUrl) throw new HttpError(400, 'Collez d’abord l’adresse du flux Teams.');
    const u = c.get('user');
    try {
      await sendTeams(conf.webhookUrl, { title: '👋 Hobbit est connecté à ce canal', text: `Message d’essai envoyé par ${u.name || userName(c)}. Les notifications activées dans le paramétrage arriveront ici.`, path: '/' }, conf.appUrl);
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
    if (conf.lastError) await putTeamsConfig({ ...conf, lastError: null });
    return c.json({ ok: true });
  });

  return r;
}
