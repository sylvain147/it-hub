/**
 * Stockage du module Jira.
 *
 *  pk                   sk         contenu
 *  JIRA#CONF            CONF       connexion (site, compte, jeton d'API), champs personnalisés retenus, tableaux suivis
 *  JIRA#IMPORT          META       dernier import (date, auteur, nombre de tickets)
 *  JIRA#SPRINT#<id>     META       sprint importé, documents rédigés (compte rendu, préparation), job actif
 *  JIRA#LINK            L#<clé>    rattachement d'un ticket Jira à un projet du hub
 *  bucket : jira/import.json          dernier import : tickets (lecture seule), sprints, vélocité par tableau
 *  bucket : jira/sprints/<id>.json    instantané du sprint (tickets et historique)
 */
import { BatchWriteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  JIRA_DEMO_SITE,
  type JiraBoard,
  type JiraConfigInfo,
  type JiraFieldRef,
  type JiraSprintInfo,
  type SprintDocKind,
  type SprintDocument,
  type SprintSnapshot,
} from '@samm/shared';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { HttpError, notFound, nowIso } from '../lib/util.js';
import { blobs, getJson } from '../storage/blobs.js';
import type { JiraConnection } from './client.js';
import type { ImportResult } from './sync.js';

const T = () => config.tableName;

export const jiraKeys = {
  conf: () => ({ pk: 'JIRA#CONF', sk: 'CONF' }),
  import: () => ({ pk: 'JIRA#IMPORT', sk: 'META' }),
  sprint: (id: string | number) => ({ pk: `JIRA#SPRINT#${id}`, sk: 'META' }),
  link: (key: string) => ({ pk: 'JIRA#LINK', sk: `L#${key}` }),
};
const snapshotKey = (id: string | number) => `jira/sprints/${id}.json`;
const IMPORT_KEY = 'jira/import.json';

export interface JiraConf extends JiraConnection {
  storyPoints: JiraFieldRef | null;
  deskRef: JiraFieldRef | null;
  sprintField: string | null;
  accountName: string;
  /** Tableaux suivis (importés). */
  boards?: JiraBoard[];
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

export async function setBoards(boards: JiraBoard[]): Promise<void> {
  await ddb().send(
    new UpdateCommand({ TableName: T(), Key: jiraKeys.conf(), ConditionExpression: 'attribute_exists(pk)', UpdateExpression: 'SET boards = :b', ExpressionAttributeValues: { ':b': boards } }),
  );
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
// Import
// ---------------------------------------------------------------------------

export type StoredImport = Omit<ImportResult, 'snapshots'> & { syncedBy: string };

interface SprintItem {
  pk: string;
  sk: string;
  sprint: JiraSprintInfo;
  syncedAt: string;
  syncedBy: string;
  issueCount: number;
  compteRendu: SprintDocument | null;
  preparation?: SprintDocument | null;
  activeJobId: string | null;
  activeJobAt: string | null;
}

const DOC_ATTR: Record<SprintDocKind, 'compteRendu' | 'preparation'> = { compte_rendu: 'compteRendu', preparation: 'preparation' };

function activeJob(it: SprintItem): string | null {
  if (!it.activeJobId || !it.activeJobAt) return null;
  return (Date.now() - Date.parse(it.activeJobAt)) / 60000 > config.staleJobMinutes ? null : it.activeJobId;
}

export async function getSprintItem(id: string | number): Promise<SprintItem | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: jiraKeys.sprint(id) }));
  return (res.Item as SprintItem | undefined) ?? null;
}

export async function getImport(): Promise<StoredImport | null> {
  return getJson<StoredImport>(blobs(), IMPORT_KEY);
}

/** Enregistre un import. Les documents déjà rédigés des sprints sont conservés (ils restent datés). */
export async function saveImport(res: ImportResult, user: string): Promise<void> {
  const before = await Promise.all(res.snapshots.map((s) => getSprintItem(s.sprint.id)));
  const busy = before.find((it) => it && activeJob(it));
  if (busy) throw new HttpError(409, `Un document du sprint « ${busy.sprint.name} » est en cours de rédaction. Attendez la fin du traitement.`);
  for (const snap of res.snapshots) {
    await blobs().put(snapshotKey(snap.sprint.id), JSON.stringify(snap), 'application/json');
    await ddb().send(
      new UpdateCommand({
        TableName: T(),
        Key: jiraKeys.sprint(snap.sprint.id),
        UpdateExpression:
          'SET sprint = :s, syncedAt = :at, syncedBy = :u, issueCount = :n, compteRendu = if_not_exists(compteRendu, :null), preparation = if_not_exists(preparation, :null), activeJobId = if_not_exists(activeJobId, :null), activeJobAt = if_not_exists(activeJobAt, :null)',
        ExpressionAttributeValues: { ':s': snap.sprint, ':at': snap.syncedAt, ':u': user, ':n': snap.issues.length, ':null': null },
      }),
    );
  }
  const { snapshots: _s, ...rest } = res;
  const stored: StoredImport = { ...rest, syncedBy: user };
  await blobs().put(IMPORT_KEY, JSON.stringify(stored), 'application/json');
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...jiraKeys.import(), syncedAt: res.syncedAt, syncedBy: user, issueCount: res.tasks.length } }));
}

/** Sprints importés : documents présents. */
export async function sprintDocFlags(ids: number[]): Promise<Map<number, { compteRendu: boolean; preparation: boolean }>> {
  const items = await Promise.all(ids.map((id) => getSprintItem(id)));
  return new Map(items.filter((x): x is SprintItem => !!x).map((x) => [x.sprint.id, { compteRendu: !!x.compteRendu, preparation: !!x.preparation }]));
}

export async function getSprint(id: string | number): Promise<{ item: SprintItem; snapshot: SprintSnapshot; activeJobId: string | null }> {
  const item = await getSprintItem(id);
  if (!item) throw notFound('Sprint (importez les données depuis Jira)');
  const snapshot = await getJson<SprintSnapshot>(blobs(), snapshotKey(id));
  if (!snapshot) throw notFound('Instantané du sprint');
  return { item, snapshot, activeJobId: activeJob(item) };
}

export function sprintDocs(item: SprintItem): Record<SprintDocKind, SprintDocument | null> {
  return { compte_rendu: item.compteRendu ?? null, preparation: item.preparation ?? null };
}

export async function setDocument(id: string | number, kind: SprintDocKind, doc: SprintDocument): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: jiraKeys.sprint(id),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET #d = :d',
      ExpressionAttributeNames: { '#d': DOC_ATTR[kind] },
      ExpressionAttributeValues: { ':d': doc },
    }),
  );
}

export function newDocument(markdown: string, user: string): SprintDocument {
  return { markdown, createdAt: nowIso(), createdBy: user, editedAt: null, editedBy: null };
}

// ---------------------------------------------------------------------------
// Rattachement des tickets aux projets
// ---------------------------------------------------------------------------

/** Projet du hub de chaque ticket rattaché, par clé. */
export async function listLinks(): Promise<Map<string, string>> {
  const items = await queryAll<{ key: string; projectId: string }>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
    ExpressionAttributeValues: { ':p': 'JIRA#LINK', ':s': 'L#' },
  });
  return new Map(items.map((x) => [x.key, x.projectId]));
}

export async function setLinks(keys: string[], projectId: string | null, user: string): Promise<void> {
  const at = nowIso();
  const requests = keys.map((key) =>
    projectId ? { PutRequest: { Item: { ...jiraKeys.link(key), key, projectId, linkedAt: at, linkedBy: user } } } : { DeleteRequest: { Key: jiraKeys.link(key) } },
  );
  for (let i = 0; i < requests.length; i += 25) {
    await ddb().send(new BatchWriteCommand({ RequestItems: { [T()]: requests.slice(i, i + 25) } }));
  }
}
