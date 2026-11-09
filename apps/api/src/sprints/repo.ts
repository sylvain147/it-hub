/**
 * Stockage des sprints.
 *
 *  pk          sk               contenu
 *  SPRINT      S#<n° 6 chiffres> sprint (nom, objectif, dates, état), documents rédigés (compte rendu, préparation), job actif
 *  COUNTER     SPRINT           dernier numéro de sprint attribué
 *
 * Les tickets restent des éléments de leur projet (`projects/repo.ts`) : ils portent le numéro de leur sprint.
 * L'équipe ne compte que quelques sprints par trimestre : la partition se lit en entier.
 */
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Sprint, SprintDocKind, SprintDocument } from '@samm/shared';
import { config } from '../config.js';
import { ddb, nextCounter, queryAll } from '../db/client.js';
import { HttpError, notFound, nowIso } from '../lib/util.js';

const T = () => config.tableName;
const SPRINT_PK = 'SPRINT';

export const sprintKeys = {
  sprint: (id: string | number) => ({ pk: SPRINT_PK, sk: `S#${String(id).padStart(6, '0')}` }),
};

export interface SprintItem extends Sprint {
  pk: string;
  sk: string;
  compteRendu: SprintDocument | null;
  preparation: SprintDocument | null;
  activeJobId: string | null;
  activeJobAt: string | null;
}

const DOC_ATTR: Record<SprintDocKind, 'compteRendu' | 'preparation'> = { compte_rendu: 'compteRendu', preparation: 'preparation' };

export function toSprint(it: SprintItem): Sprint {
  const { pk: _pk, sk: _sk, compteRendu: _c, preparation: _p, activeJobId: _j, activeJobAt: _a, ...s } = it;
  return s;
}

export function activeJob(it: SprintItem): string | null {
  if (!it.activeJobId || !it.activeJobAt) return null;
  return (Date.now() - Date.parse(it.activeJobAt)) / 60000 > config.staleJobMinutes ? null : it.activeJobId;
}

export async function getSprintItem(id: string | number): Promise<SprintItem | null> {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: sprintKeys.sprint(id) }));
  return (res.Item as SprintItem | undefined) ?? null;
}

export async function requireSprintItem(id: string | number): Promise<SprintItem> {
  const it = await getSprintItem(id);
  if (!it) throw notFound('Sprint');
  return it;
}

/** Tous les sprints, par numéro. */
export async function listSprintItems(): Promise<SprintItem[]> {
  const items = await queryAll<SprintItem>({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': SPRINT_PK } });
  return items.sort((a, b) => a.id - b.id);
}

export async function createSprint(fields: Pick<Sprint, 'name' | 'goal' | 'startDate' | 'endDate'>, user: string): Promise<Sprint> {
  const id = await nextCounter('SPRINT');
  const now = nowIso();
  const item: SprintItem = {
    ...sprintKeys.sprint(id),
    ...fields,
    name: fields.name || `Sprint ${id}`,
    id,
    state: 'future',
    startedAt: null,
    completedAt: null,
    createdAt: now,
    createdBy: user,
    updatedAt: now,
    updatedBy: user,
    compteRendu: null,
    preparation: null,
    activeJobId: null,
    activeJobAt: null,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  return toSprint(item);
}

/** Met à jour des champs du sprint (sans toucher aux documents ni au job). */
export async function setSprintFields(id: number, fields: Partial<Sprint>, user: string): Promise<void> {
  const all: Record<string, unknown> = { ...fields, updatedAt: nowIso(), updatedBy: user };
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries(all)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: sprintKeys.sprint(id),
      ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteSprint(id: number): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: T(), Key: sprintKeys.sprint(id) }));
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function sprintDocs(item: SprintItem): Record<SprintDocKind, SprintDocument | null> {
  return { compte_rendu: item.compteRendu ?? null, preparation: item.preparation ?? null };
}

export async function setDocument(id: string | number, kind: SprintDocKind, doc: SprintDocument): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: sprintKeys.sprint(id),
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

/** Un ticket ne se planifie que dans un sprint en cours ou à venir. */
export async function assertPlannable(sprintId: number): Promise<void> {
  const it = await getSprintItem(sprintId);
  if (!it) throw new HttpError(400, `Le sprint ${sprintId} n’existe pas.`);
  if (it.state === 'closed') throw new HttpError(400, `Le sprint « ${it.name} » est clos : choisissez un sprint en cours ou à venir.`);
}
