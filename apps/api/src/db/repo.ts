import { randomBytes } from 'node:crypto';
import { BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  nextVersionNumber,
  versionLabel,
  type CdcDetail,
  type CdcDocument,
  type CdcStatus,
  type CdcSummary,
  type Jalon,
  type JobInfo,
  type JobStatus,
  type JobType,
  type Question,
  type SourceInfo,
  type TranslationInfo,
  type TranslationLanguage,
  type UsageBreakdownRow,
  type UsageReport,
  type VersionInfo,
  type VersionOrigin,
} from '@samm/shared';
import { config } from '../config.js';
import { blobs, getJson } from '../storage/blobs.js';
import { HttpError, newId, notFound, nowIso, monthOf } from '../lib/util.js';
import { ddb, isConditionFailed, queryAll } from './client.js';
import { blobKeys, CDC_LIST_PK, GSI1, keys, ttlInDays } from './schema.js';

const T = () => config.tableName;

// ---------------------------------------------------------------------------
// CDC
// ---------------------------------------------------------------------------

interface CdcItem {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  id: string;
  title: string;
  prestataire: string;
  projet: string;
  status: CdcStatus;
  phase: CdcSummary['phase'];
  nextJalon: Jalon | null;
  estimationJours: number | null;
  currentSeq: number;
  currentMajor: number;
  currentMinor: number;
  currentBlobKey: string;
  openQuestions: number;
  activeJobId: string | null;
  activeJobAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

interface VersionItem extends VersionInfo {
  pk: string;
  sk: string;
  blobKey: string;
  status: CdcStatus;
}

export function pickNextJalon(jalons: Jalon[], today = new Date().toISOString().slice(0, 10)): Jalon | null {
  const dated = jalons.filter((j) => j.date).sort((a, b) => a.date.localeCompare(b.date));
  return dated.find((j) => j.date >= today) ?? dated.at(-1) ?? null;
}

function toSummary(it: CdcItem): CdcSummary {
  return {
    id: it.id,
    title: it.title,
    prestataire: it.prestataire,
    projet: it.projet,
    status: it.status,
    phase: it.phase,
    nextJalon: it.nextJalon,
    estimationJours: it.estimationJours,
    currentVersion: { seq: it.currentSeq, label: versionLabel(it.currentMajor, it.currentMinor) },
    openQuestions: it.openQuestions,
    createdAt: it.createdAt,
    createdBy: it.createdBy,
    updatedAt: it.updatedAt,
    updatedBy: it.updatedBy,
  };
}

async function getCdcItem(id: string): Promise<CdcItem | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: keys.cdc(id) }));
  return (res.Item as CdcItem | undefined) ?? null;
}

export async function requireCdc(id: string): Promise<CdcSummary & { activeJobId: string | null }> {
  const it = await getCdcItem(id);
  if (!it) throw notFound('Cahier des charges');
  return { ...toSummary(it), activeJobId: activeJob(it) };
}

function activeJob(it: CdcItem): string | null {
  if (!it.activeJobId || !it.activeJobAt) return null;
  const ageMin = (Date.now() - Date.parse(it.activeJobAt)) / 60000;
  return ageMin > config.staleJobMinutes ? null : it.activeJobId;
}

export async function listCdcs(): Promise<CdcSummary[]> {
  const items = await queryAll<CdcItem>({
    IndexName: GSI1,
    KeyConditionExpression: 'gsi1pk = :p',
    ExpressionAttributeValues: { ':p': CDC_LIST_PK },
    ScanIndexForward: false,
  });
  return items.map(toSummary);
}

export async function getCdcDetail(id: string): Promise<CdcDetail> {
  const it = await getCdcItem(id);
  if (!it) throw notFound('Cahier des charges');
  const document = await getJson<CdcDocument>(blobs(), it.currentBlobKey);
  if (!document) throw new HttpError(500, 'Contenu de la version courante introuvable');
  return { ...toSummary(it), document, activeJobId: activeJob(it) };
}

export async function createCdc(document: CdcDocument, user: string): Promise<{ id: string; version: VersionInfo }> {
  const id = newId();
  const now = nowIso();
  const { major, minor } = nextVersionNumber(null, document.meta.status);
  const blobKey = blobKeys.version(id, 1, randomBytes(4).toString('hex'));
  await blobs().put(blobKey, JSON.stringify(document), 'application/json');
  const version: VersionItem = {
    ...keys.version(id, 1),
    seq: 1,
    major,
    minor,
    label: versionLabel(major, minor),
    origin: 'creation',
    comment: '',
    author: user,
    createdAt: now,
    blobKey,
    status: document.meta.status,
  };
  const item: CdcItem = {
    ...keys.cdc(id),
    gsi1pk: CDC_LIST_PK,
    gsi1sk: now,
    id,
    ...metaFields(document),
    currentSeq: 1,
    currentMajor: major,
    currentMinor: minor,
    currentBlobKey: blobKey,
    openQuestions: 0,
    activeJobId: null,
    activeJobAt: null,
    createdAt: now,
    createdBy: user,
    updatedAt: now,
    updatedBy: user,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: version }));
  await ddb().send(new PutCommand({ TableName: T(), Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  return { id, version: stripVersion(version) };
}

function metaFields(doc: CdcDocument) {
  return {
    title: doc.meta.title,
    prestataire: doc.meta.prestataire,
    projet: doc.meta.projet,
    status: doc.meta.status,
    phase: doc.meta.phase,
    nextJalon: pickNextJalon(doc.meta.jalons),
    estimationJours: doc.meta.estimationJours,
  };
}

function stripVersion(v: VersionItem): VersionInfo {
  const { seq, major, minor, label, origin, comment, author, createdAt } = v;
  return { seq, major, minor, label, origin, comment, author, createdAt };
}

/**
 * Enregistre une nouvelle version. `baseSeq` doit être la version courante (verrouillage optimiste) :
 * si quelqu'un a enregistré entre-temps, on renvoie un conflit plutôt que d'écraser son travail.
 */
export async function saveVersion(
  id: string,
  baseSeq: number,
  document: CdcDocument,
  opts: { user: string; origin: VersionOrigin; comment: string },
): Promise<VersionInfo> {
  const it = await getCdcItem(id);
  if (!it) throw notFound('Cahier des charges');
  if (it.currentSeq !== baseSeq) throw conflict(it);

  const seq = baseSeq + 1;
  const { major, minor } = nextVersionNumber({ major: it.currentMajor, minor: it.currentMinor, status: it.status }, document.meta.status);
  const blobKey = blobKeys.version(id, seq, randomBytes(4).toString('hex'));
  await blobs().put(blobKey, JSON.stringify(document), 'application/json');
  const now = nowIso();
  const version: VersionItem = {
    ...keys.version(id, seq),
    seq,
    major,
    minor,
    label: versionLabel(major, minor),
    origin: opts.origin,
    comment: opts.comment,
    author: opts.user,
    createdAt: now,
    blobKey,
    status: document.meta.status,
  };
  // L'élément de version sert de verrou : un seul écrivain peut créer la version N+1.
  try {
    await ddb().send(new PutCommand({ TableName: T(), Item: version, ConditionExpression: 'attribute_not_exists(pk)' }));
  } catch (e) {
    if (isConditionFailed(e)) throw conflict((await getCdcItem(id)) ?? it);
    throw e;
  }
  const meta = metaFields(document);
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: keys.cdc(id),
      ConditionExpression: 'currentSeq = :base',
      UpdateExpression:
        'SET currentSeq = :seq, currentMajor = :maj, currentMinor = :min, currentBlobKey = :blob, title = :title, prestataire = :prest, projet = :projet, #st = :status, phase = :phase, nextJalon = :nj, estimationJours = :est, updatedAt = :now, updatedBy = :user, gsi1sk = :now',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':base': baseSeq,
        ':seq': seq,
        ':maj': major,
        ':min': minor,
        ':blob': blobKey,
        ':title': meta.title,
        ':prest': meta.prestataire,
        ':projet': meta.projet,
        ':status': meta.status,
        ':phase': meta.phase,
        ':nj': meta.nextJalon,
        ':est': meta.estimationJours,
        ':now': now,
        ':user': opts.user,
      },
    }),
  );
  return stripVersion(version);
}

function conflict(it: CdcItem) {
  return new HttpError(
    409,
    `Le cahier des charges a été modifié entre-temps (version ${versionLabel(it.currentMajor, it.currentMinor)} par ${it.updatedBy}). Rechargez pour récupérer la dernière version.`,
    { currentSeq: it.currentSeq },
  );
}

export async function listVersions(id: string): Promise<VersionInfo[]> {
  const items = await queryAll<VersionItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :v)',
    ExpressionAttributeValues: { ':p': `CDC#${id}`, ':v': 'VER#' },
    ScanIndexForward: false,
  });
  return items.map(stripVersion);
}

export async function getVersion(id: string, seq: number): Promise<{ info: VersionInfo; document: CdcDocument }> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: keys.version(id, seq) }));
  const v = res.Item as VersionItem | undefined;
  if (!v) throw notFound('Version');
  const document = await getJson<CdcDocument>(blobs(), v.blobKey);
  if (!document) throw new HttpError(500, 'Contenu de la version introuvable');
  return { info: stripVersion(v), document };
}

/** Réserve le CDC pour un job IA (un seul à la fois). */
export async function claimForJob(id: string, jobId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - config.staleJobMinutes * 60000).toISOString();
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: T(),
        Key: keys.cdc(id),
        ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(activeJobId) OR activeJobId = :null OR activeJobAt < :stale)',
        UpdateExpression: 'SET activeJobId = :job, activeJobAt = :now',
        ExpressionAttributeValues: { ':job': jobId, ':now': nowIso(), ':null': null, ':stale': staleBefore },
      }),
    );
  } catch (e) {
    if (isConditionFailed(e)) throw new HttpError(409, 'Une tâche IA est déjà en cours sur ce cahier des charges. Patientez quelques instants.');
    throw e;
  }
}

export async function releaseJob(id: string, jobId: string): Promise<void> {
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: T(),
        Key: keys.cdc(id),
        ConditionExpression: 'activeJobId = :job',
        UpdateExpression: 'SET activeJobId = :null, activeJobAt = :null',
        ExpressionAttributeValues: { ':job': jobId, ':null': null },
      }),
    );
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

type QuestionItem = Question & { pk: string; sk: string };

export async function listQuestions(cdcId: string): Promise<Question[]> {
  const items = await queryAll<QuestionItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :q)',
    ExpressionAttributeValues: { ':p': `CDC#${cdcId}`, ':q': 'Q#' },
  });
  return items.map(({ pk: _pk, sk: _sk, ...q }) => q);
}

export async function putQuestions(cdcId: string, questions: Question[]): Promise<void> {
  for (let i = 0; i < questions.length; i += 25) {
    const chunk = questions.slice(i, i + 25);
    await ddb().send(
      new BatchWriteCommand({
        RequestItems: { [T()]: chunk.map((q) => ({ PutRequest: { Item: { ...keys.question(cdcId, q.id), ...q } } })) },
      }),
    );
  }
  await refreshOpenQuestions(cdcId);
}

export async function getQuestion(cdcId: string, qid: string): Promise<Question> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: keys.question(cdcId, qid) }));
  if (!res.Item) throw notFound('Question');
  const { pk: _pk, sk: _sk, ...q } = res.Item as QuestionItem;
  return q;
}

export async function refreshOpenQuestions(cdcId: string): Promise<void> {
  const qs = await listQuestions(cdcId);
  const open = qs.filter((q) => q.status === 'ouverte').length;
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: keys.cdc(cdcId),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET openQuestions = :n',
      ExpressionAttributeValues: { ':n': open },
    }),
  );
}

// ---------------------------------------------------------------------------
// Sources (transcriptions)
// ---------------------------------------------------------------------------

type SourceItem = SourceInfo & { pk: string; sk: string; blobKey: string };

export async function addSource(cdcId: string, input: { title: string; text: string; notes: string; user: string }): Promise<SourceInfo> {
  const id = newId();
  const blobKey = blobKeys.source(cdcId, id);
  await blobs().put(blobKey, input.text, 'text/plain; charset=utf-8');
  const item: SourceItem = {
    ...keys.source(cdcId, id),
    id,
    title: input.title,
    charCount: input.text.length,
    notes: input.notes,
    createdAt: nowIso(),
    createdBy: input.user,
    blobKey,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  const { pk: _pk, sk: _sk, blobKey: _b, ...info } = item;
  return info;
}

export async function listSources(cdcId: string): Promise<SourceInfo[]> {
  const items = await queryAll<SourceItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
    ExpressionAttributeValues: { ':p': `CDC#${cdcId}`, ':s': 'SRC#' },
  });
  return items.map(({ pk: _pk, sk: _sk, blobKey: _b, ...s }) => s);
}

export async function getSourceText(cdcId: string, sid: string): Promise<string> {
  const buf = await blobs().get(blobKeys.source(cdcId, sid));
  if (!buf) throw notFound('Transcription');
  return buf.toString('utf8');
}

// ---------------------------------------------------------------------------
// Traductions
// ---------------------------------------------------------------------------

interface TranslationItem {
  pk: string;
  sk: string;
  lang: TranslationLanguage;
  versionSeq: number;
  versionLabel: string;
  createdAt: string;
  createdBy: string;
  blobKey: string;
}

export async function putTranslation(
  cdcId: string,
  info: Omit<TranslationInfo, 'outdated' | 'createdAt'>,
  document: CdcDocument,
): Promise<void> {
  const blobKey = blobKeys.translation(cdcId, info.lang, info.versionSeq);
  await blobs().put(blobKey, JSON.stringify(document), 'application/json');
  const item: TranslationItem = { ...keys.translation(cdcId, info.lang), ...info, createdAt: nowIso(), blobKey };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
}

export async function listTranslations(cdcId: string, currentSeq: number): Promise<TranslationInfo[]> {
  const items = await queryAll<TranslationItem>({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)',
    ExpressionAttributeValues: { ':p': `CDC#${cdcId}`, ':t': 'TR#' },
  });
  return items.map((t) => ({
    lang: t.lang,
    versionSeq: t.versionSeq,
    versionLabel: t.versionLabel,
    createdAt: t.createdAt,
    createdBy: t.createdBy,
    outdated: t.versionSeq !== currentSeq,
  }));
}

export async function getTranslation(cdcId: string, lang: TranslationLanguage): Promise<{ info: TranslationItem; document: CdcDocument } | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: keys.translation(cdcId, lang) }));
  const info = res.Item as TranslationItem | undefined;
  if (!info) return null;
  const document = await getJson<CdcDocument>(blobs(), info.blobKey);
  return document ? { info, document } : null;
}

/** Cache de traduction : clé = hash(langue + texte source). */
export async function getCachedTranslations(hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(hashes)];
  for (let i = 0; i < unique.length; i += 100) {
    let request: Record<string, { Keys: Record<string, unknown>[] }> | undefined = {
      [T()]: { Keys: unique.slice(i, i + 100).map((h) => keys.translationCache(h)) },
    };
    while (request && Object.keys(request).length) {
      const res = await ddb().send(new BatchGetCommand({ RequestItems: request }));
      for (const it of res.Responses?.[T()] ?? []) out.set(String(it.pk).slice(4), String(it.text));
      request = res.UnprocessedKeys as typeof request;
    }
  }
  return out;
}

export async function putCachedTranslations(entries: { hash: string; text: string }[]): Promise<void> {
  const ttl = ttlInDays(365);
  for (let i = 0; i < entries.length; i += 25) {
    await ddb().send(
      new BatchWriteCommand({
        RequestItems: {
          [T()]: entries.slice(i, i + 25).map((e) => ({ PutRequest: { Item: { ...keys.translationCache(e.hash), text: e.text, ttl } } })),
        },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobItem extends JobInfo {
  pk: string;
  sk: string;
  user: string;
  /** Paramètres du job (transcription, réponses, instruction…). */
  payload: Record<string, unknown>;
  ttl: number;
}

export async function createJob(input: { type: JobType; cdcId: string; user: string; payload: Record<string, unknown> }): Promise<JobItem> {
  const id = newId();
  const now = nowIso();
  const job: JobItem = {
    ...keys.job(id),
    id,
    type: input.type,
    status: 'en_attente',
    cdcId: input.cdcId,
    step: 'En file d’attente',
    error: '',
    createdAt: now,
    updatedAt: now,
    resultVersionSeq: null,
    user: input.user,
    payload: input.payload,
    ttl: ttlInDays(30),
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: job }));
  return job;
}

export async function getJob(id: string): Promise<JobItem | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: keys.job(id) }));
  return (res.Item as JobItem | undefined) ?? null;
}

export function jobInfo(j: JobItem): JobInfo {
  const { id, type, status, cdcId, step, error, createdAt, updatedAt, resultVersionSeq } = j;
  return { id, type, status, cdcId, step, error, createdAt, updatedAt, resultVersionSeq };
}

export async function updateJob(
  id: string,
  patch: { status?: JobStatus; step?: string; error?: string; resultVersionSeq?: number | null },
): Promise<void> {
  const sets: string[] = ['updatedAt = :now'];
  const values: Record<string, unknown> = { ':now': nowIso() };
  const names: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: keys.job(id),
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
    }),
  );
}

/** Le payload peut contenir une longue transcription : on le vide une fois le job terminé. */
export async function clearJobPayload(id: string): Promise<void> {
  await ddb().send(
    new UpdateCommand({ TableName: T(), Key: keys.job(id), UpdateExpression: 'SET payload = :e', ExpressionAttributeValues: { ':e': {} } }),
  );
}

// ---------------------------------------------------------------------------
// Consommation IA
// ---------------------------------------------------------------------------

export interface UsageEntry {
  operation: string;
  model: string;
  user: string;
  cdcId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export async function recordUsage(e: UsageEntry): Promise<void> {
  const at = nowIso();
  const month = monthOf(at);
  const costMicros = Math.round(e.costUsd * 1_000_000);
  await ddb().send(
    new PutCommand({ TableName: T(), Item: { ...keys.usage(month, `CALL#${newId()}`), at, ...e, costMicros } }),
  );
  const counters = ['TOTAL', `OP#${e.operation}`, `MODEL#${e.model}`, `USER#${e.user}`];
  await Promise.all(
    counters.map((sk) =>
      ddb().send(
        new UpdateCommand({
          TableName: T(),
          Key: keys.usage(month, sk),
          UpdateExpression: 'ADD calls :one, inputTokens :in, outputTokens :out, cacheReadTokens :cr, costMicros :c',
          ExpressionAttributeValues: {
            ':one': 1,
            ':in': e.inputTokens,
            ':out': e.outputTokens,
            ':cr': e.cacheReadTokens,
            ':c': costMicros,
          },
        }),
      ),
    ),
  );
}

export async function monthCostUsd(month = monthOf(nowIso())): Promise<number> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: keys.usage(month, 'TOTAL') }));
  return Number(res.Item?.costMicros ?? 0) / 1_000_000;
}

export async function usageReport(month: string): Promise<UsageReport> {
  const items = await queryAll<Record<string, unknown>>({
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': `USAGE#${month}` },
  });
  const row = (it: Record<string, unknown>, key: string): UsageBreakdownRow => ({
    key,
    calls: Number(it.calls ?? 0),
    inputTokens: Number(it.inputTokens ?? 0),
    outputTokens: Number(it.outputTokens ?? 0),
    cacheReadTokens: Number(it.cacheReadTokens ?? 0),
    costUsd: Number(it.costMicros ?? 0) / 1_000_000,
  });
  const by = (prefix: string) =>
    items
      .filter((it) => String(it.sk).startsWith(prefix))
      .map((it) => row(it, String(it.sk).slice(prefix.length)))
      .sort((a, b) => b.costUsd - a.costUsd);
  const total = items.find((it) => it.sk === 'TOTAL');
  const recent = items
    .filter((it) => String(it.sk).startsWith('CALL#'))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 50)
    .map((it) => ({
      at: String(it.at),
      operation: String(it.operation),
      model: String(it.model),
      user: String(it.user),
      cdcId: String(it.cdcId),
      inputTokens: Number(it.inputTokens),
      outputTokens: Number(it.outputTokens),
      cacheReadTokens: Number(it.cacheReadTokens),
      costUsd: Number(it.costMicros) / 1_000_000,
    }));
  return {
    month,
    budgetUsd: config.monthlyBudgetUsd,
    totalCostUsd: total ? row(total, 'TOTAL').costUsd : 0,
    calls: total ? Number(total.calls ?? 0) : 0,
    byOperation: by('OP#'),
    byModel: by('MODEL#'),
    byUser: by('USER#'),
    recent,
  };
}

/** Utilisé par les tests. */
export async function deleteItem(key: { pk: string; sk: string }) {
  await ddb().send(new DeleteCommand({ TableName: T(), Key: key }));
}
