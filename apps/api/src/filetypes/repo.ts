/**
 * Stockage des types de fichiers (module « Lecteur de fichiers »).
 *
 *  pk              sk                    contenu
 *  FTYPE#<id>      META                  fiche (+ GSI1 pour la liste)
 *  FTYPE#<id>      VER#<seq>             version de la fiche de lecture (spec JSON dans le bucket)
 *  bucket : ftypes/<id>/context.json     extrait anonymisé, notes, documentation (texte)
 */
import { randomBytes } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { FileSpec, FileTypeDetail, FileTypeSummary, FileTypeVersionInfo } from '@samm/shared';
import { config } from '../config.js';
import { ddb, isConditionFailed, queryAll } from '../db/client.js';
import { GSI1 } from '../db/schema.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';
import { blobs, getJson } from '../storage/blobs.js';

const T = () => config.tableName;
const LIST_PK = 'FTYPE';

export const fileTypeKeys = {
  meta: (id: string) => ({ pk: `FTYPE#${id}`, sk: 'META' }),
  version: (id: string, seq: number) => ({ pk: `FTYPE#${id}`, sk: `VER#${String(seq).padStart(10, '0')}` }),
};
const contextKey = (id: string) => `ftypes/${id}/context.json`;
const versionBlobKey = (id: string, seq: number) => `ftypes/${id}/versions/${String(seq).padStart(10, '0')}-${randomBytes(4).toString('hex')}.json`;

export interface FileTypeContext {
  excerpt: string;
  anonymized: boolean;
  documents: { name: string; text: string }[];
}

interface MetaItem {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  id: string;
  name: string;
  description: string;
  notes: string;
  sampleFileName: string;
  documents: { name: string; chars: number }[];
  format: FileSpec['format'] | null;
  fileNamePattern: string;
  recordTypeCount: number;
  currentSeq: number;
  currentBlobKey: string;
  remarks: string[];
  activeJobId: string | null;
  activeJobAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

interface VersionItem extends FileTypeVersionInfo {
  pk: string;
  sk: string;
  blobKey: string;
}

function summary(it: MetaItem): FileTypeSummary {
  return {
    id: it.id,
    name: it.name,
    description: it.description,
    format: it.format,
    fileNamePattern: it.fileNamePattern,
    recordTypeCount: it.recordTypeCount,
    currentVersion: it.currentSeq ? { seq: it.currentSeq, label: String(it.currentSeq) } : null,
    createdAt: it.createdAt,
    createdBy: it.createdBy,
    updatedAt: it.updatedAt,
    updatedBy: it.updatedBy,
  };
}

function activeJob(it: MetaItem): string | null {
  if (!it.activeJobId || !it.activeJobAt) return null;
  return (Date.now() - Date.parse(it.activeJobAt)) / 60000 > config.staleJobMinutes ? null : it.activeJobId;
}

async function getMeta(id: string): Promise<MetaItem> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: fileTypeKeys.meta(id) }));
  if (!res.Item) throw notFound('Type de fichier');
  return res.Item as MetaItem;
}

export async function listFileTypes(): Promise<FileTypeSummary[]> {
  const items = await queryAll<MetaItem>({
    IndexName: GSI1,
    KeyConditionExpression: 'gsi1pk = :p',
    ExpressionAttributeValues: { ':p': LIST_PK },
    ScanIndexForward: false,
  });
  return items.map(summary);
}

export async function getContext(id: string): Promise<FileTypeContext> {
  return (await getJson<FileTypeContext>(blobs(), contextKey(id))) ?? { excerpt: '', anonymized: true, documents: [] };
}

export async function putContext(id: string, ctx: FileTypeContext): Promise<void> {
  await blobs().put(contextKey(id), JSON.stringify(ctx), 'application/json');
}

export async function getSpec(id: string): Promise<{ seq: number; spec: FileSpec | null }> {
  const it = await getMeta(id);
  if (!it.currentSeq) return { seq: 0, spec: null };
  return { seq: it.currentSeq, spec: await getJson<FileSpec>(blobs(), it.currentBlobKey) };
}

export async function getFileTypeDetail(id: string): Promise<FileTypeDetail> {
  const it = await getMeta(id);
  const [ctx, spec] = await Promise.all([getContext(id), it.currentSeq ? getJson<FileSpec>(blobs(), it.currentBlobKey) : null]);
  return {
    ...summary(it),
    spec,
    remarks: it.remarks,
    excerpt: ctx.excerpt,
    anonymized: ctx.anonymized,
    sampleFileName: it.sampleFileName,
    notes: it.notes,
    documents: it.documents,
    activeJobId: activeJob(it),
  };
}

export async function createFileType(input: {
  name: string;
  description: string;
  notes: string;
  sampleFileName: string;
  context: FileTypeContext;
  user: string;
}): Promise<string> {
  const id = newId();
  const now = nowIso();
  await putContext(id, input.context);
  const item: MetaItem = {
    ...fileTypeKeys.meta(id),
    gsi1pk: LIST_PK,
    gsi1sk: now,
    id,
    name: input.name,
    description: input.description,
    notes: input.notes,
    sampleFileName: input.sampleFileName,
    documents: input.context.documents.map((d) => ({ name: d.name, chars: d.text.length })),
    format: null,
    fileNamePattern: '',
    recordTypeCount: 0,
    currentSeq: 0,
    currentBlobKey: '',
    remarks: [],
    activeJobId: null,
    activeJobAt: null,
    createdAt: now,
    createdBy: input.user,
    updatedAt: now,
    updatedBy: input.user,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  return id;
}

export async function updateFileTypeInfo(id: string, name: string, description: string, user: string): Promise<void> {
  await getMeta(id);
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: fileTypeKeys.meta(id),
      UpdateExpression: 'SET #n = :n, description = :d, updatedAt = :now, updatedBy = :u, gsi1sk = :now',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': name, ':d': description, ':now': nowIso(), ':u': user },
    }),
  );
}

export async function deleteFileType(id: string): Promise<void> {
  await getMeta(id);
  // Les versions et fichiers associés restent dans le bucket versionné ; seule la fiche disparaît de la liste.
  await ddb().send(new DeleteCommand({ TableName: T(), Key: fileTypeKeys.meta(id) }));
}

/** Enregistre une nouvelle version de la fiche de lecture (verrouillage optimiste sur `baseSeq`). */
export async function saveSpecVersion(
  id: string,
  baseSeq: number,
  spec: FileSpec,
  opts: { user: string; origin: FileTypeVersionInfo['origin']; comment: string; remarks?: string[] },
): Promise<FileTypeVersionInfo> {
  const it = await getMeta(id);
  if (it.currentSeq !== baseSeq) {
    throw new HttpError(409, `La fiche a été modifiée entre-temps (version ${it.currentSeq} par ${it.updatedBy}). Rechargez la page.`);
  }
  const seq = baseSeq + 1;
  const blobKey = versionBlobKey(id, seq);
  await blobs().put(blobKey, JSON.stringify(spec), 'application/json');
  const now = nowIso();
  const version: VersionItem = {
    ...fileTypeKeys.version(id, seq),
    seq,
    label: String(seq),
    origin: opts.origin,
    comment: opts.comment,
    author: opts.user,
    createdAt: now,
    blobKey,
  };
  try {
    await ddb().send(new PutCommand({ TableName: T(), Item: version, ConditionExpression: 'attribute_not_exists(pk)' }));
  } catch (e) {
    if (isConditionFailed(e)) throw new HttpError(409, 'La fiche a été modifiée entre-temps. Rechargez la page.');
    throw e;
  }
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: fileTypeKeys.meta(id),
      ConditionExpression: 'currentSeq = :base',
      UpdateExpression:
        'SET currentSeq = :seq, currentBlobKey = :blob, #f = :f, fileNamePattern = :pat, recordTypeCount = :n, remarks = :rem, updatedAt = :now, updatedBy = :u, gsi1sk = :now',
      ExpressionAttributeNames: { '#f': 'format' },
      ExpressionAttributeValues: {
        ':base': baseSeq,
        ':seq': seq,
        ':blob': blobKey,
        ':f': spec.format,
        ':pat': spec.fileNamePattern,
        ':n': spec.recordTypes.length,
        ':rem': opts.remarks ?? it.remarks,
        ':now': now,
        ':u': opts.user,
      },
    }),
  );
  const { pk: _pk, sk: _sk, blobKey: _b, ...info } = version;
  return info;
}

export async function listSpecVersions(id: string): Promise<FileTypeVersionInfo[]> {
  const items = await queryAll<VersionItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :v)',
    ExpressionAttributeValues: { ':p': `FTYPE#${id}`, ':v': 'VER#' },
    ScanIndexForward: false,
  });
  return items.map(({ pk: _pk, sk: _sk, blobKey: _b, ...v }) => v);
}

export async function getSpecVersion(id: string, seq: number): Promise<FileSpec> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: fileTypeKeys.version(id, seq) }));
  const v = res.Item as VersionItem | undefined;
  if (!v) throw notFound('Version');
  const spec = await getJson<FileSpec>(blobs(), v.blobKey);
  if (!spec) throw new HttpError(500, 'Contenu de la version introuvable');
  return spec;
}

export async function requireNoActiveJob(id: string): Promise<void> {
  if (activeJob(await getMeta(id))) throw new HttpError(409, 'L’assistant travaille sur cette fiche. Attendez la fin du traitement.');
}
