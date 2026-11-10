/**
 * Notifications Teams : envoi de cartes adaptatives à un flux « Workflows » du canal de l'équipe.
 *
 *  pk           sk      contenu
 *  REF#TEAMS    TEAMS   adresse du flux, évènements activés, adresse du hub (liens des cartes), dernier échec
 *
 * Un envoi raté ne fait jamais échouer l'action de l'utilisateur : l'erreur est gardée et affichée dans le paramétrage.
 */
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { defaultNotificationEvents, maskWebhookUrl, teamsWebhookError, type NotificationEvent, type TeamsSettings } from '@samm/shared';
import { config } from '../config.js';
import { ddb } from '../db/client.js';
import { nowIso } from '../lib/util.js';

const KEY = { pk: 'REF#TEAMS', sk: 'TEAMS' };
/** Délai d'envoi : l'API doit répondre bien avant la limite de 29 s. */
const SEND_TIMEOUT_MS = 5000;

export interface TeamsConfig {
  webhookUrl: string;
  events: Record<NotificationEvent, boolean>;
  /** Adresse du hub (origine de la page qui a enregistré la connexion) : liens « Ouvrir dans Hobbit ». */
  appUrl: string;
  updatedAt: string | null;
  updatedBy: string | null;
  lastError: { message: string; at: string } | null;
}

export async function getTeamsConfig(): Promise<TeamsConfig> {
  const res = await ddb().send(new GetCommand({ TableName: config.tableName, Key: KEY }));
  const it = res.Item ?? {};
  return {
    webhookUrl: String(it.webhookUrl ?? ''),
    events: { ...defaultNotificationEvents(), ...(it.events ?? {}) },
    appUrl: String(it.appUrl ?? ''),
    updatedAt: it.updatedAt ?? null,
    updatedBy: it.updatedBy ?? null,
    lastError: it.lastError ?? null,
  };
}

export async function putTeamsConfig(c: TeamsConfig): Promise<void> {
  await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...KEY, ...c } }));
}

export function teamsSettingsView(c: TeamsConfig): TeamsSettings {
  return {
    connected: !!c.webhookUrl,
    webhookHint: c.webhookUrl ? maskWebhookUrl(c.webhookUrl) : '',
    events: c.events,
    updatedAt: c.updatedAt,
    updatedBy: c.updatedBy,
    lastError: c.lastError,
  };
}

async function setLastError(lastError: TeamsConfig['lastError']) {
  await ddb().send(
    new UpdateCommand({ TableName: config.tableName, Key: KEY, UpdateExpression: 'SET lastError = :e', ExpressionAttributeValues: { ':e': lastError } }),
  );
}

export interface TeamsMessage {
  title: string;
  /** Texte de la carte (Markdown simple accepté par Teams). */
  text?: string;
  /** Lignes « libellé : valeur ». */
  facts?: { title: string; value: string }[];
  /** Chemin dans le hub (« /sprints/4 ») : bouton « Ouvrir dans Hobbit ». */
  path?: string;
}

/** Corps attendu par les flux Workflows (et les anciens connecteurs) : un message portant une carte adaptative. */
export function teamsPayload(m: TeamsMessage, appUrl: string) {
  const body: unknown[] = [{ type: 'TextBlock', text: m.title, weight: 'Bolder', size: 'Medium', wrap: true }];
  if (m.text) body.push({ type: 'TextBlock', text: m.text, wrap: true });
  const facts = (m.facts ?? []).filter((f) => f.value);
  if (facts.length) body.push({ type: 'FactSet', facts });
  const actions = m.path && appUrl ? [{ type: 'Action.OpenUrl', title: 'Ouvrir dans Hobbit', url: appUrl + m.path }] : [];
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body, actions, msteams: { width: 'Full' } },
      },
    ],
  };
}

/** Envoie un message ; lève une erreur lisible en cas d'échec. */
export async function sendTeams(webhookUrl: string, m: TeamsMessage, appUrl: string): Promise<void> {
  const invalid = teamsWebhookError(webhookUrl);
  if (invalid) throw new Error(invalid);
  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(teamsPayload(m, appUrl)),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error((e as Error).name === 'TimeoutError' ? 'Teams n’a pas répondu à temps.' : `Teams est injoignable (${(e as Error).message}).`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Teams a refusé le message (erreur ${res.status})${detail ? ` : ${detail}` : ''}. Vérifiez que le flux Workflows est toujours actif.`);
  }
}

/**
 * Notifie le canal Teams si la connexion existe et que l'évènement est activé. Ne lève jamais d'erreur :
 * l'action de l'utilisateur est déjà faite, l'échec est seulement noté.
 */
export async function notify(event: NotificationEvent, m: TeamsMessage): Promise<void> {
  try {
    const c = await getTeamsConfig();
    if (!c.webhookUrl || !c.events[event]) return;
    try {
      await sendTeams(c.webhookUrl, m, c.appUrl);
      if (c.lastError) await setLastError(null);
    } catch (e) {
      console.warn(`Notification Teams « ${event} » non envoyée :`, (e as Error).message);
      await setLastError({ message: (e as Error).message, at: nowIso() });
    }
  } catch (e) {
    console.error('Notification Teams :', e);
  }
}
