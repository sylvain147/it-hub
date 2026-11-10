/**
 * Idées d'amélioration (ERP, outils…) : liste partagée de l'équipe.
 *
 *  pk     sk        contenu
 *  IDEA   I#<id>    idée (priorité, statut, domaine, soutiens, ticket créé)
 *
 * Quelques centaines d'idées au plus : une partition lue en entier.
 */
import { Hono } from 'hono';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ideaInputSchema, ideaTicketBody, NO_PROJECT_ID, PROJECT_ITEM_SCHEMAS, updateIdeaBody, voteIdeaBody, type Idea } from '@samm/shared';
import { userName } from '../auth.js';
import { config } from '../config.js';
import { ddb, queryAll } from '../db/client.js';
import { body, parseBody } from '../lib/http.js';
import { HttpError, newId, notFound, nowIso } from '../lib/util.js';
import * as pr from '../projects/repo.js';
import { resolveTaskAssignee } from '../users/routes.js';

const PK = 'IDEA';
const key = (id: string) => ({ pk: PK, sk: `I#${id}` });

type Item = Idea & { pk: string; sk: string };
const strip = ({ pk: _pk, sk: _sk, ...i }: Item): Idea => i;

export async function listIdeas(): Promise<Idea[]> {
  const items = await queryAll<Item>({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': PK } });
  return items.map(strip);
}

async function getIdea(id: string): Promise<Idea> {
  const res = await ddb().send(new GetCommand({ TableName: config.tableName, Key: key(id) }));
  if (!res.Item) throw notFound('Idée');
  return strip(res.Item as Item);
}

export async function putIdea(i: Idea) {
  await ddb().send(new PutCommand({ TableName: config.tableName, Item: { ...key(i.id), ...i } }));
}

function newIdea(input: ReturnType<typeof ideaInputSchema.parse>, user: string): Idea {
  const now = nowIso();
  return { ...input, id: newId(), votes: [], ticket: null, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
}

/** Routes des idées d'amélioration (montées sous /api/idees). */
export function ideaRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await listIdeas()));

  r.post('/', async (c) => {
    const b = await body(c, ideaInputSchema);
    await pr.assertProjectRef(b.projectId);
    const i = newIdea(b, userName(c));
    await putIdea(i);
    return c.json(i, 201);
  });

  r.patch('/:id', async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Corps de requête JSON invalide');
    const b = parseBody(updateIdeaBody, raw);
    // Les valeurs par défaut du schéma ne doivent pas écraser les champs absents de la requête.
    const patch = Object.fromEntries(Object.entries(b).filter(([k]) => k in raw));
    if (typeof patch.projectId === 'string') await pr.assertProjectRef(patch.projectId);
    const i: Idea = { ...(await getIdea(c.req.param('id'))), ...patch, updatedAt: nowIso(), updatedBy: userName(c) };
    await putIdea(i);
    return c.json(i);
  });

  /** Soutenir une idée (+1), ou retirer son soutien. */
  r.put('/:id/vote', async (c) => {
    const b = await body(c, voteIdeaBody);
    const user = userName(c);
    const before = await getIdea(c.req.param('id'));
    const rest = before.votes.filter((e) => e !== user);
    const i: Idea = { ...before, votes: b.vote ? [...rest, user] : rest };
    await putIdea(i);
    return c.json(i);
  });

  /** Crée un ticket (backlog) à partir de l'idée, sur action explicite ; l'idée passe « en cours ». */
  r.post('/:id/ticket', async (c) => {
    const b = await body(c, ideaTicketBody);
    const user = userName(c);
    const idea = await getIdea(c.req.param('id'));
    if (idea.ticket) throw new HttpError(409, `Un ticket a déjà été créé pour cette idée (T-${idea.ticket.number}).`);
    const projectId = b.projectId || idea.projectId || NO_PROJECT_ID;
    if (projectId !== NO_PROJECT_ID) await pr.requireProject(projectId);
    const who = await resolveTaskAssignee({}, null, user);
    const details = [idea.details, `Issu de l’idée d’amélioration (${idea.domain || 'sans domaine'}).`].filter((x) => x.trim()).join('\n\n');
    const ticket = await pr.createItem(projectId, 'tasks', parseBody(PROJECT_ITEM_SCHEMAS.tasks, { title: idea.title, details, priority: idea.priority, ...who }), user);
    const i: Idea = { ...idea, projectId: projectId === NO_PROJECT_ID ? idea.projectId : projectId, status: 'en_cours', ticket: { projectId, ticketId: ticket.id, number: ticket.number }, updatedAt: nowIso(), updatedBy: user };
    await putIdea(i);
    return c.json(i, 201);
  });

  r.delete('/:id', async (c) => {
    const i = await getIdea(c.req.param('id'));
    await ddb().send(new DeleteCommand({ TableName: config.tableName, Key: key(i.id) }));
    return c.body(null, 204);
  });

  return r;
}
