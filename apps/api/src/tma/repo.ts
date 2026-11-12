/**
 * Stockage du module « Suivi TMA ».
 *
 *  pk                   sk              contenu
 *  TMA#DESK             META            dernier import Desk, job de classement actif
 *  TMA#DESK             TKT#<n° 9 ch.>  ticket Desk (champs utiles, textes masqués, thème)
 *  TMA#DESK             PROPOSAL        classement par thème proposé par l'IA, en attente de validation
 *  TMA#MONTH#<AAAA-MM>  META            relevé TMA du mois, synthèse IA (+ GSI1 pour la liste)
 *  bucket : tma/months/<AAAA-MM>.json   lignes du relevé
 */
import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DeskImportResult, DeskTicket, StoredTicket, ThemeProposal, TmaEntry, TmaMonthInfo, TmaOverview, TmaSynthesis } from '@samm/shared';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { GSI1 } from '../db/schema.js';
import { HttpError, notFound, nowIso } from '../lib/util.js';
import { blobs, getJson } from '../storage/blobs.js';

const T = () => config.tableName;
const DESK_PK = 'TMA#DESK';
const MONTH_LIST_PK = 'TMA_MONTH';
/** Cible des jobs de classement (identifiant du job). */
export const DESK_TARGET = 'desk';

export const tmaKeys = {
  desk: () => ({ pk: DESK_PK, sk: 'META' }),
  proposal: () => ({ pk: DESK_PK, sk: 'PROPOSAL' }),
  ticket: (id: string) => ({ pk: DESK_PK, sk: `TKT#${id.padStart(9, '0')}` }),
  month: (month: string) => ({ pk: `TMA#MONTH#${month}`, sk: 'META' }),
};
const entriesKey = (month: string) => `tma/months/${month}.json`;

interface DeskMeta {
  pk: string;
  sk: string;
  lastImportAt: string;
  lastImportBy: string;
  lastFileName: string;
  activeJobId: string | null;
  activeJobAt: string | null;
}

type TicketItem = StoredTicket & { pk: string; sk: string; importedAt: string };

interface MonthItem extends Omit<TmaMonthInfo, 'hasSynthesis'> {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  synthesis: TmaSynthesis | null;
  activeJobId: string | null;
  activeJobAt: string | null;
}

function activeJob(it: { activeJobId?: string | null; activeJobAt?: string | null } | undefined): string | null {
  if (!it?.activeJobId || !it.activeJobAt) return null;
  return (Date.now() - Date.parse(it.activeJobAt)) / 60000 > config.staleJobMinutes ? null : it.activeJobId;
}

async function batchPut(items: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    let pending: Record<string, unknown>[] | undefined = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending?.length && attempt < 5; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      const res = await ddb().send(new BatchWriteCommand({ RequestItems: { [T()]: pending as never } }));
      pending = res.UnprocessedItems?.[T()] as Record<string, unknown>[] | undefined;
    }
    if (pending?.length) throw new HttpError(503, 'Base de données saturée : relancez l’import.');
  }
}

// ---------------------------------------------------------------------------
// Tickets Desk
// ---------------------------------------------------------------------------

async function getDeskMeta(): Promise<DeskMeta | undefined> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: tmaKeys.desk() }));
  return res.Item as DeskMeta | undefined;
}

export async function listTickets(): Promise<StoredTicket[]> {
  const items = await queryAll<TicketItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)',
    ExpressionAttributeValues: { ':p': DESK_PK, ':t': 'TKT#' },
  });
  return items.map(({ pk: _pk, sk: _sk, importedAt: _i, ...t }) => t);
}

/** Ajoute ou met à jour des tickets ; le thème déjà attribué est conservé. */
export async function importTickets(tickets: DeskTicket[], fileName: string, user: string): Promise<DeskImportResult> {
  if (activeJob(await getDeskMeta())) throw new HttpError(409, 'Le classement des tickets est en cours. Attendez la fin du traitement pour importer.');
  const existing = new Map((await listTickets()).map((t) => [t.id, t]));
  const now = nowIso();
  const unique = new Map(tickets.map((t) => [t.id, t]));
  await batchPut([...unique.values()].map((t) => ({ ...tmaKeys.ticket(t.id), ...t, theme: existing.get(t.id)?.theme ?? '', importedAt: now })));
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: tmaKeys.desk(),
      UpdateExpression: 'SET lastImportAt = :now, lastImportBy = :u, lastFileName = :f',
      ExpressionAttributeValues: { ':now': now, ':u': user, ':f': fileName },
    }),
  );
  const created = [...unique.keys()].filter((id) => !existing.has(id)).length;
  return { created, updated: unique.size - created, total: existing.size + created };
}

export async function setThemes(themes: Map<string, string>): Promise<void> {
  const list = [...themes.entries()];
  for (let i = 0; i < list.length; i += 10) {
    await Promise.all(
      list.slice(i, i + 10).map(([id, theme]) =>
        ddb().send(
          new UpdateCommand({
            TableName: T(),
            Key: tmaKeys.ticket(id),
            ConditionExpression: 'attribute_exists(pk)',
            UpdateExpression: 'SET theme = :t',
            ExpressionAttributeValues: { ':t': theme },
          }),
        ),
      ),
    );
  }
}

/** Classement proposé par l'IA, en attente de validation (null : aucun). Peut dépasser 400 Ko : le détail est dans le bucket. */
export async function getThemeProposal(): Promise<ThemeProposal | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: tmaKeys.proposal() }));
  if (!res.Item) return null;
  return getJson<ThemeProposal>(blobs(), String(res.Item.blobKey));
}

export async function setThemeProposal(p: ThemeProposal | null): Promise<void> {
  if (!p) {
    await ddb().send(new DeleteCommand({ TableName: T(), Key: tmaKeys.proposal() }));
    return;
  }
  const blobKey = 'tma/theme-proposal.json';
  await blobs().put(blobKey, JSON.stringify(p), 'application/json');
  await ddb().send(new PutCommand({ TableName: T(), Item: { ...tmaKeys.proposal(), blobKey, count: p.items.length, createdAt: p.createdAt } }));
}

async function proposalCount(): Promise<number> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: tmaKeys.proposal() }));
  return Number(res.Item?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Relevés mensuels
// ---------------------------------------------------------------------------

function monthInfo(it: MonthItem): TmaMonthInfo {
  return {
    month: it.month,
    fileName: it.fileName,
    entryCount: it.entryCount,
    totalHours: it.totalHours,
    importedAt: it.importedAt,
    importedBy: it.importedBy,
    hasSynthesis: !!it.synthesis,
  };
}

async function getMonthItem(month: string): Promise<MonthItem> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: tmaKeys.month(month) }));
  if (!res.Item) throw notFound('Relevé TMA');
  return res.Item as MonthItem;
}

export async function listMonths(): Promise<TmaMonthInfo[]> {
  const items = await queryAll<MonthItem>({
    IndexName: GSI1,
    KeyConditionExpression: 'gsi1pk = :p',
    ExpressionAttributeValues: { ':p': MONTH_LIST_PK },
    ScanIndexForward: false,
  });
  return items.map(monthInfo);
}

export async function getOverview(): Promise<TmaOverview> {
  const [months, meta, tickets, pendingThemes] = await Promise.all([listMonths(), getDeskMeta(), listTickets(), proposalCount()]);
  const dates = tickets.map((t) => t.createdAt).sort();
  return {
    months,
    desk: {
      ticketCount: tickets.length,
      classifiedCount: tickets.filter((t) => t.theme).length,
      firstCreatedAt: dates[0] ?? null,
      lastCreatedAt: dates.at(-1) ?? null,
      lastImportAt: meta?.lastImportAt ?? null,
      lastImportBy: meta?.lastImportBy ?? null,
      activeJobId: activeJob(meta),
      pendingThemes,
    },
  };
}

/** Enregistre (ou remplace) le relevé d'un mois. La synthèse éventuelle, devenue obsolète, est effacée. */
export async function putMonth(month: string, entries: TmaEntry[], fileName: string, user: string): Promise<TmaMonthInfo> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: tmaKeys.month(month) }));
  if (activeJob(res.Item as MonthItem | undefined)) throw new HttpError(409, 'La synthèse de ce mois est en cours de rédaction. Attendez la fin du traitement.');
  await blobs().put(entriesKey(month), JSON.stringify(entries), 'application/json');
  const now = nowIso();
  const item: MonthItem = {
    ...tmaKeys.month(month),
    gsi1pk: MONTH_LIST_PK,
    gsi1sk: month,
    month,
    fileName,
    entryCount: entries.length,
    totalHours: Math.round(entries.reduce((n, e) => n + e.hours, 0) * 10) / 10,
    importedAt: now,
    importedBy: user,
    synthesis: null,
    activeJobId: null,
    activeJobAt: null,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  return monthInfo(item);
}

export async function getMonth(month: string): Promise<{ info: TmaMonthInfo; entries: TmaEntry[]; synthesis: TmaSynthesis | null; activeJobId: string | null }> {
  const it = await getMonthItem(month);
  const entries = (await getJson<TmaEntry[]>(blobs(), entriesKey(month))) ?? [];
  return { info: monthInfo(it), entries, synthesis: it.synthesis, activeJobId: activeJob(it) };
}

/** Lignes du relevé d'un mois, ou null s'il n'a pas été importé. */
export async function getMonthEntries(month: string): Promise<TmaEntry[] | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: tmaKeys.month(month) }));
  if (!res.Item) return null;
  return (await getJson<TmaEntry[]>(blobs(), entriesKey(month))) ?? [];
}

export async function setSynthesis(month: string, synthesis: TmaSynthesis): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: tmaKeys.month(month),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET synthesis = :s',
      ExpressionAttributeValues: { ':s': synthesis },
    }),
  );
}

export async function deleteMonth(month: string): Promise<void> {
  const it = await getMonthItem(month);
  if (activeJob(it)) throw new HttpError(409, 'La synthèse de ce mois est en cours de rédaction. Attendez la fin du traitement.');
  // Le relevé reste dans le bucket versionné ; seul le mois disparaît de la liste.
  await ddb().send(new DeleteCommand({ TableName: T(), Key: tmaKeys.month(month) }));
}
