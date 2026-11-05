/**
 * Stockage du paramétrage.
 *
 *  pk           sk          contenu
 *  REF#LISTS    LISTS       libellés, ordre et visibilité des statuts ; libellés de jalons et rôles proposés
 *  REF#PRESTA   P#<id>      prestataire et son carnet de contacts
 */
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { normalizeListSettings, type ListSettings, type Prestataire, type PrestataireContact } from '@samm/shared';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { notFound, nowIso } from '../lib/util.js';

const T = () => config.tableName;
const PRESTA_PK = 'REF#PRESTA';

export const settingsKeys = {
  lists: () => ({ pk: 'REF#LISTS', sk: 'LISTS' }),
  prestataire: (id: string) => ({ pk: PRESTA_PK, sk: `P#${id}` }),
};

/** Les libellés servent à chaque requête (historique, IA) : courte mise en cache dans le processus. */
let cache: { at: number; lists: ListSettings } | null = null;
const CACHE_MS = 10_000;

export async function getLists(): Promise<ListSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.lists;
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: settingsKeys.lists() }));
  const lists = normalizeListSettings((res.Item?.lists as Partial<ListSettings> | undefined) ?? null);
  cache = { at: Date.now(), lists };
  return lists;
}

export async function putLists(lists: ListSettings, user: string): Promise<ListSettings> {
  const clean = normalizeListSettings(lists);
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...settingsKeys.lists(), lists: clean, updatedAt: nowIso(), updatedBy: user } }));
  cache = { at: Date.now(), lists: clean };
  return clean;
}

type PrestataireItem = Prestataire & { pk: string; sk: string };

const strip = ({ pk: _pk, sk: _sk, ...p }: PrestataireItem): Prestataire => p;

export async function listPrestataires(): Promise<Prestataire[]> {
  const items = await queryAll<PrestataireItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
    ExpressionAttributeValues: { ':p': PRESTA_PK, ':s': 'P#' },
  });
  return items.map(strip).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function getPrestataire(id: string): Promise<Prestataire> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: settingsKeys.prestataire(id) }));
  if (!res.Item) throw notFound('Prestataire');
  return strip(res.Item as PrestataireItem);
}

export async function putPrestataire(p: Prestataire): Promise<Prestataire> {
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...settingsKeys.prestataire(p.id), ...p } }));
  return p;
}

export async function deletePrestataire(id: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: T(), Key: settingsKeys.prestataire(id) }));
}

/** Retrouve un contact du carnet, quel que soit son prestataire. */
export async function findDirectoryContact(contactId: string): Promise<{ prestataire: Prestataire; contact: PrestataireContact } | null> {
  for (const p of await listPrestataires()) {
    const contact = p.contacts.find((c) => c.id === contactId);
    if (contact) return { prestataire: p, contact };
  }
  return null;
}
