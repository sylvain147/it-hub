/**
 * Stockage du module Jira.
 *
 *  pk                   sk      contenu
 *  JIRA#CONF            CONF    connexion (site, compte, jeton d'API) et champs personnalisés retenus
 *  JIRA#SPRINT#<id>     META    sprint synchronisé, compte rendu, job actif (+ GSI1 « JIRA_BOARD#<tableau> »)
 *  bucket : jira/sprints/<id>.json   instantané du sprint (tickets et historique)
 */
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { JIRA_DEMO_SITE, type JiraConfigInfo, type JiraFieldRef, type JiraSprintInfo, type SprintCompteRendu, type SprintSnapshot } from '@samm/shared';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { GSI1 } from '../db/schema.js';
import { HttpError, notFound, nowIso } from '../lib/util.js';
import { blobs, getJson } from '../storage/blobs.js';
import type { JiraConnection } from './client.js';

const T = () => config.tableName;

export const jiraKeys = {
  conf: () => ({ pk: 'JIRA#CONF', sk: 'CONF' }),
  sprint: (id: string | number) => ({ pk: `JIRA#SPRINT#${id}`, sk: 'META' }),
};
const snapshotKey = (id: string | number) => `jira/sprints/${id}.json`;
const boardPk = (boardId: number) => `JIRA_BOARD#${boardId}`;

export interface JiraConf extends JiraConnection {
  storyPoints: JiraFieldRef | null;
  deskRef: JiraFieldRef | null;
  sprintField: string | null;
  accountName: string;
  updatedAt: string;
  updatedBy: string;
}

export async function getConf(): Promise<JiraConf | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: jiraKeys.conf() }));
  if (!res.Item) return null;
  const { pk: _pk, sk: _sk, ...conf } = res.Item as JiraConf & { pk: string; sk: string };
  return conf;
}

export async function requireConf(): Promise<JiraConf> {
  const conf = await getConf();
  if (!conf?.token && conf?.site !== JIRA_DEMO_SITE) throw new HttpError(400, 'Jira n’est pas encore connecté : renseignez le site et le jeton d’API dans Paramétrage → Jira.');
  return conf!;
}

export async function putConf(conf: JiraConf): Promise<void> {
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...jiraKeys.conf(), ...conf } }));
}

/** Vue de la connexion pour le navigateur : le jeton n'en sort jamais. */
export function confInfo(conf: JiraConf | null): JiraConfigInfo {
  return {
    configured: !!conf && (!!conf.token || conf.site === JIRA_DEMO_SITE),
    site: conf?.site ?? '',
    email: conf?.email ?? '',
    tokenHint: conf?.token ? `…${conf.token.slice(-4)}` : '',
    storyPoints: conf?.storyPoints ?? null,
    deskRef: conf?.deskRef ?? null,
    accountName: conf?.accountName ?? '',
    updatedAt: conf?.updatedAt ?? null,
    updatedBy: conf?.updatedBy ?? null,
    demoAvailable: config.runtime !== 'aws',
  };
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

interface SprintItem {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  sprint: JiraSprintInfo;
  syncedAt: string;
  syncedBy: string;
  issueCount: number;
  compteRendu: SprintCompteRendu | null;
  activeJobId: string | null;
  activeJobAt: string | null;
}

function activeJob(it: SprintItem): string | null {
  if (!it.activeJobId || !it.activeJobAt) return null;
  return (Date.now() - Date.parse(it.activeJobAt)) / 60000 > config.staleJobMinutes ? null : it.activeJobId;
}

export async function getSprintItem(id: string | number): Promise<SprintItem | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: jiraKeys.sprint(id) }));
  return (res.Item as SprintItem | undefined) ?? null;
}

export async function listBoardSprints(boardId: number): Promise<SprintItem[]> {
  return queryAll<SprintItem>({ IndexName: GSI1, KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': boardPk(boardId) } });
}

/** Enregistre un nouvel instantané. Le compte rendu existant est conservé (il reste daté). */
export async function saveSnapshot(boardId: number, snap: SprintSnapshot, user: string): Promise<void> {
  const before = await getSprintItem(snap.sprint.id);
  if (before && activeJob(before)) throw new HttpError(409, 'Le compte rendu de ce sprint est en cours de rédaction. Attendez la fin du traitement.');
  await blobs().put(snapshotKey(snap.sprint.id), JSON.stringify(snap), 'application/json');
  const item: SprintItem = {
    ...jiraKeys.sprint(snap.sprint.id),
    gsi1pk: boardPk(boardId),
    gsi1sk: snap.sprint.startDate ?? '9999',
    sprint: snap.sprint,
    syncedAt: snap.syncedAt,
    syncedBy: user,
    issueCount: snap.issues.length,
    compteRendu: before?.compteRendu ?? null,
    activeJobId: null,
    activeJobAt: null,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
}

export async function getSprint(id: string | number): Promise<{ item: SprintItem; snapshot: SprintSnapshot; activeJobId: string | null }> {
  const item = await getSprintItem(id);
  if (!item) throw notFound('Sprint (synchronisez-le depuis Jira)');
  const snapshot = await getJson<SprintSnapshot>(blobs(), snapshotKey(id));
  if (!snapshot) throw notFound('Instantané du sprint');
  return { item, snapshot, activeJobId: activeJob(item) };
}

export async function setCompteRendu(id: string | number, cr: SprintCompteRendu): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: jiraKeys.sprint(id),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET compteRendu = :c',
      ExpressionAttributeValues: { ':c': cr },
    }),
  );
}

export function newCompteRendu(markdown: string, user: string): SprintCompteRendu {
  return { markdown, createdAt: nowIso(), createdBy: user, editedAt: null, editedBy: null };
}
