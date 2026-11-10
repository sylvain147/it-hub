/**
 * Annonce d'une mise en production sur Teams : à chaque déploiement, l'infrastructure invoque le worker avec les
 * dernières entrées du patch note (`infra/lib/hub-stack.ts`). Seules les entrées pas encore annoncées sont publiées ;
 * la dernière annoncée est retenue :
 *
 *  pk           sk        contenu
 *  REF#TEAMS    RELEASE   dernière entrée annoncée (commit), instant
 *
 * Premier déploiement (rien de retenu) : seule la dernière entrée est annoncée, pas tout l'historique.
 */
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { ReleaseNote } from '@samm/shared';
import { config } from '../config.js';
import { ddb } from '../db/client.js';
import { nowIso } from '../lib/util.js';
import { notify, type TeamsMessage } from './teams.js';

const KEY = { pk: 'REF#TEAMS', sk: 'RELEASE' };
/** Détail affiché par entrée (titres de commits). */
const MAX_CHANGES = 6;

/** Entrées à annoncer (les plus récentes d'abord) : celles d'après la dernière annoncée. */
export function newReleaseNotes(entries: ReleaseNote[], lastId: string | null): ReleaseNote[] {
  if (!lastId) return entries.slice(0, 1);
  const i = entries.findIndex((e) => e.id === lastId);
  // Introuvable : plus de mises à jour que d'entrées transmises depuis la dernière annonce.
  return i < 0 ? entries : entries.slice(0, i);
}

export function releaseMessage(notes: ReleaseNote[]): TeamsMessage {
  const text = notes
    .map((n) => {
      const changes = n.changes.filter((c) => c.trim() && c.trim() !== n.title.trim()).slice(0, MAX_CHANGES);
      return [`**${n.title}**`, ...changes.map((c) => `- ${c}`)].join('\n');
    })
    .join('\n\n');
  return {
    title: notes.length > 1 ? `🚀 Nouvelle version de Hobbit en ligne : ${notes.length} nouveautés` : '🚀 Nouvelle version de Hobbit en ligne',
    text,
    path: '/patch-note',
  };
}

/** Publie les nouveautés du déploiement (si l'évènement est activé) et retient la dernière entrée. */
export async function notifyRelease(entries: ReleaseNote[]): Promise<number> {
  if (!entries.length) return 0;
  const res = await ddb().send(new GetCommand({ TableName: config.tableName, Key: KEY }));
  const fresh = newReleaseNotes(entries, (res.Item?.lastId as string | undefined) ?? null);
  if (fresh.length) await notify('mise_en_prod', releaseMessage(fresh));
  await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...KEY, lastId: entries[0]!.id, at: nowIso() } }));
  return fresh.length;
}
