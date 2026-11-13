/**
 * Patch management : tests à réaliser après chaque patch et leurs résultats par session (monté sous /api/patch).
 *
 *  pk      sk         contenu
 *  PATCH   T#<id>     test (qui, quoi, description, résultat attendu, adresses, rang, retiré)
 *  PATCH   S#<id>     session (environnement, date, précision) et résultats de chaque test
 *
 * Quelques dizaines de tests et de sessions par an : la partition se lit en entier. Toute l'équipe modifie tout.
 */
import { Hono } from 'hono';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  byRecentSession,
  patchImportBody,
  patchResultBody,
  patchSessionInputSchema,
  patchTestInputSchema,
  reorderPatchTestsBody,
  updatePatchTestBody,
  type PatchOverview,
  type PatchResult,
  type PatchSession,
  type PatchTest,
} from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { body, parseBody } from '../lib/http.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';

const PK = 'PATCH';
const testKey = (id: string) => ({ pk: PK, sk: `T#${id}` });
const sessionKey = (id: string) => ({ pk: PK, sk: `S#${id}` });
const T = () => config.tableName;

type Stored = { pk: string; sk: string } & Record<string, unknown>;
const strip = <X>({ pk: _pk, sk: _sk, ...x }: Stored) => x as X;

export async function patchOverview(): Promise<PatchOverview> {
  const items = await queryAll<Stored>({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': PK } });
  return {
    tests: items.filter((i) => i.sk.startsWith('T#')).map((i) => strip<PatchTest>(i)).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
    sessions: items.filter((i) => i.sk.startsWith('S#')).map((i) => strip<PatchSession>(i)).sort(byRecentSession),
  };
}

async function getTest(id: string): Promise<PatchTest> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: testKey(id) }));
  if (!res.Item) throw notFound('Test');
  return strip<PatchTest>(res.Item as Stored);
}

async function getSession(id: string): Promise<PatchSession> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: sessionKey(id) }));
  if (!res.Item) throw notFound('Session de patch');
  return strip<PatchSession>(res.Item as Stored);
}

const putTest = (t: PatchTest) => ddb().send(new PutCommand({ TableName: T(), Item: { ...testKey(t.id), ...t } }));
const putSession = (s: PatchSession) => ddb().send(new PutCommand({ TableName: T(), Item: { ...sessionKey(s.id), ...s } }));

function newTest(input: ReturnType<typeof patchTestInputSchema.parse>, position: number, user: string): PatchTest {
  const now = nowIso();
  return { ...input, id: newId(), position, archived: false, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
}

function newSession(input: ReturnType<typeof patchSessionInputSchema.parse>, user: string): PatchSession {
  return { ...input, id: newId(), results: {}, createdAt: nowIso(), createdBy: user };
}

export function patchRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await patchOverview()));

  // ---- Lignes de tests ------------------------------------------------------------------

  r.post('/tests', async (c) => {
    const b = await body(c, patchTestInputSchema);
    if (!b.what && !b.description) throw new HttpError(400, 'Indiquez ce qui est testé ou la description du test.');
    const { tests } = await patchOverview();
    const t = newTest(b, Math.max(0, ...tests.map((x) => x.position)) + 1, userName(c));
    await putTest(t);
    return c.json(t, 201);
  });

  r.patch('/tests/:id', async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Corps de requête JSON invalide');
    const b = parseBody(updatePatchTestBody, raw);
    // Les valeurs par défaut du schéma ne doivent pas écraser les champs absents de la requête.
    const patch = Object.fromEntries(Object.entries(b).filter(([k]) => k in raw));
    const t: PatchTest = { ...(await getTest(c.req.param('id'))), ...patch, updatedAt: nowIso(), updatedBy: userName(c) };
    await putTest(t);
    return c.json(t);
  });

  /** Nouvel ordre des lignes (glisser ou flèches) : les tests cités prennent les rangs 1, 2, 3… */
  r.put('/tests/ordre', async (c) => {
    const { ids } = await body(c, reorderPatchTestsBody);
    const { tests } = await patchOverview();
    const user = userName(c);
    for (const [i, id] of ids.entries()) {
      const t = tests.find((x) => x.id === id);
      if (t && t.position !== i + 1) await putTest({ ...t, position: i + 1, updatedAt: nowIso(), updatedBy: user });
    }
    return c.json(await patchOverview());
  });

  /** Supprime un test jamais renseigné ; un test qui a des résultats se retire (`archived`) pour garder l'historique. */
  r.delete('/tests/:id', async (c) => {
    const t = await getTest(c.req.param('id'));
    const { sessions } = await patchOverview();
    if (sessions.some((s) => s.results[t.id]?.status)) throw new HttpError(409, 'Ce test a des résultats dans des sessions passées : retirez-le plutôt, il restera dans l’historique.');
    await ddb().send(new DeleteCommand({ TableName: T(), Key: testKey(t.id) }));
    return c.body(null, 204);
  });

  // ---- Sessions ---------------------------------------------------------------------------

  r.post('/sessions', async (c) => {
    const s = newSession(await body(c, patchSessionInputSchema), userName(c));
    await putSession(s);
    return c.json(s, 201);
  });

  r.put('/sessions/:id', async (c) => {
    const b = await body(c, patchSessionInputSchema);
    const s: PatchSession = { ...(await getSession(c.req.param('id'))), ...b };
    await putSession(s);
    return c.json(s);
  });

  r.delete('/sessions/:id', async (c) => {
    const s = await getSession(c.req.param('id'));
    await ddb().send(new DeleteCommand({ TableName: T(), Key: sessionKey(s.id) }));
    return c.body(null, 204);
  });

  /** Résultat d'un test dans une session ; mis à jour seul, pour que deux personnes renseignent la même session en même temps. */
  r.put('/sessions/:id/resultats/:testId', async (c) => {
    const b = await body(c, patchResultBody);
    const [s, t] = await Promise.all([getSession(c.req.param('id')), getTest(c.req.param('testId'))]);
    const result: PatchResult = { ...b, at: nowIso(), by: userName(c) };
    await ddb().send(
      new UpdateCommand({
        TableName: T(),
        Key: sessionKey(s.id),
        ConditionExpression: 'attribute_exists(pk)',
        UpdateExpression: 'SET #r.#t = :v',
        ExpressionAttributeNames: { '#r': 'results', '#t': t.id },
        ExpressionAttributeValues: { ':v': result },
      }),
    );
    return c.json(await getSession(s.id));
  });

  /** Reprise de l'ancien classeur (lu dans le navigateur), seulement quand il n'y a encore aucun test. */
  r.post('/import', async (c) => {
    const b = await body(c, patchImportBody);
    const user = userName(c);
    if ((await patchOverview()).tests.length) throw new HttpError(409, 'Des tests existent déjà : la reprise du classeur ne se fait qu’une fois, au départ.');
    const tests = b.tests.map((t, i) => newTest(t, i + 1, user));
    for (const t of tests) await putTest(t);
    for (const s of b.sessions) {
      const session = newSession(s, user);
      for (const res of s.results) {
        const t = tests[res.test];
        if (t) session.results[t.id] = { status: res.status, comment: res.comment, at: session.createdAt, by: user };
      }
      await putSession(session);
    }
    return c.json(await patchOverview(), 201);
  });

  return r;
}
