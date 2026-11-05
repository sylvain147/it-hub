import { Hono } from 'hono';
import {
  can,
  moveTaskBody,
  nameKey,
  PROJECT_ITEM_SCHEMAS,
  todoInputSchema,
  userInputSchema,
  userUpdateSchema,
  type HubUser,
  type Me,
  type PersonalTask,
  type TodosResponse,
  PERMISSIONS,
  type Permission,
} from '@samm/shared';
import { requirePermission, userName } from '../auth.js';
import { config } from '../config.js';
import { body, parseBody } from '../lib/http.js';
import { HttpError, newId, nowIso } from '../lib/util.js';
import * as pr from '../projects/repo.js';
import * as users from './repo.js';
import { inviteUser, resendInvitation, setUserEnabled, updateUserName } from './identity.js';

// ---------------------------------------------------------------------------
// Responsable des tâches de projet
// ---------------------------------------------------------------------------

/** Le texte saisi désigne-t-il cet utilisateur (e-mail, identifiant ou nom) ? */
function designates(text: string, u: HubUser): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const short = u.email.split('@')[0]!;
  return t === u.email || t === short || nameKey(text) === nameKey(u.name) || nameKey(text) === nameKey(short.replace(/[._-]+/g, ' '));
}

/**
 * Rattache le responsable d'une tâche de projet à un utilisateur du hub et recopie son nom.
 * Sans responsable à la création : la personne qui crée la tâche. Un texte qui ne correspond à aucun
 * utilisateur reste tel quel (personne extérieure : prestataire, métier…).
 */
export async function resolveTaskAssignee(raw: Record<string, unknown>, before: Record<string, unknown> | null, current: string): Promise<Record<string, unknown>> {
  const touches = 'assigneeId' in raw || 'assignee' in raw;
  if (before && !touches) return raw;
  const all = await users.listUsers();
  const id = String(raw.assigneeId ?? '').trim().toLowerCase();
  const text = String(raw.assignee ?? '').trim();
  if (id) {
    const u = all.find((x) => x.email === id);
    if (!u) throw new HttpError(400, 'Responsable inconnu : choisissez un utilisateur du hub.');
    if (!u.active && id !== String(before?.assigneeId ?? '')) throw new HttpError(400, `${u.name} est désactivé : choisissez un autre responsable.`);
    return { ...raw, assigneeId: u.email, assignee: u.name };
  }
  if (text) {
    const u = all.find((x) => x.active && designates(text, x));
    return u ? { ...raw, assigneeId: u.email, assignee: u.name } : { ...raw, assigneeId: '', assignee: text };
  }
  if (before) throw new HttpError(400, 'Une tâche doit avoir un responsable.');
  const me = all.find((x) => x.email === current);
  return { ...raw, assigneeId: current, assignee: me?.name ?? current };
}

/** Rattache à l'utilisateur les tâches qui le désignent en texte, et recopie son nom dans celles qui lui sont attribuées. */
async function syncUserTasks(u: HubUser, by: string): Promise<number> {
  const tasks = (await pr.listItemsAllProjects('tasks')).filter(
    ({ item }) => (item.assigneeId === u.email && item.assignee !== u.name) || (!item.assigneeId && designates(item.assignee, u)),
  );
  await pr.syncItems('tasks', tasks.map((x) => ({ projectId: x.projectId, itemId: x.item.id, fields: { assigneeId: u.email, assignee: u.name } })), by);
  return tasks.length;
}

function me(u: HubUser): Me {
  const permissions = Object.fromEntries(Object.keys(PERMISSIONS).map((p) => [p, can(u.role, p as Permission)])) as Me['permissions'];
  return { ...u, permissions, llm: config.llmProvider };
}

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

/** Routes des utilisateurs (montées sous /api/users). */
export function userRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await users.listUsers(true)));

  r.post('/', async (c) => {
    requirePermission(c, 'manageUsers', 'gérer les utilisateurs');
    const b = await body(c, userInputSchema);
    const now = nowIso();
    const by = userName(c);
    const u: HubUser = { ...b, active: true, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by, lastSeenAt: null, invitedAt: null };
    if (!(await users.createUser(u))) throw new HttpError(409, `${b.email} a déjà un accès au hub.`);
    if (await inviteUser(u.email, u.name)) {
      u.invitedAt = nowIso();
      await users.putUser(u);
    }
    const linked = await syncUserTasks(u, by);
    return c.json({ user: u, linkedTasks: linked }, 201);
  });

  r.put('/:email', async (c) => {
    requirePermission(c, 'manageUsers', 'gérer les utilisateurs');
    const email = c.req.param('email').toLowerCase();
    const b = await body(c, userUpdateSchema);
    const by = userName(c);
    const before = await users.getUser(email);
    if (email === by && !b.active) throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre accès.');
    const otherAdmins = (await users.listUsers(true)).filter((x) => x.email !== email && x.active && x.role === 'admin');
    if (before.role === 'admin' && before.active && (b.role !== 'admin' || !b.active) && !otherAdmins.length) {
      throw new HttpError(400, 'Le hub doit garder au moins un administrateur actif : nommez-en un autre d’abord.');
    }
    if (b.active !== before.active) await setUserEnabled(email, b.active);
    if (b.name !== before.name) await updateUserName(email, b.name);
    const u = await users.putUser({ ...before, ...b, updatedAt: nowIso(), updatedBy: by });
    if (b.name !== before.name) await syncUserTasks(u, by);
    return c.json(u);
  });

  r.post('/:email/invitation', async (c) => {
    requirePermission(c, 'manageUsers', 'gérer les utilisateurs');
    const u = await users.getUser(c.req.param('email'));
    if (!(await resendInvitation(u.email))) throw new HttpError(400, 'Pas de compte de connexion à inviter en local : l’invitation n’existe qu’en production.');
    return c.json(await users.putUser({ ...u, invitedAt: nowIso() }));
  });

  return r;
}

export async function meHandler(email: string): Promise<Me> {
  return me(await users.getUser(email));
}

// ---------------------------------------------------------------------------
// Tâches (personnelles et de projet)
// ---------------------------------------------------------------------------

async function assertAssignable(assigneeId: string, current: string, role: HubUser['role']) {
  if (assigneeId !== current && !can(role, 'assignOthers')) throw new HttpError(403, 'Votre rôle ne permet pas d’attribuer une tâche à quelqu’un d’autre.');
  const u = (await users.listUsers()).find((x) => x.email === assigneeId);
  if (!u) throw new HttpError(400, 'Responsable inconnu : choisissez un utilisateur du hub.');
  if (!u.active) throw new HttpError(400, `${u.name} est désactivé : choisissez un autre responsable.`);
}

function canEdit(t: PersonalTask, current: string, role: HubUser['role']) {
  return t.assigneeId === current || t.createdBy === current || can(role, 'seeAllTodos');
}

/** Routes des tâches (montées sous /api/todos). */
export function todoRoutes() {
  const r = new Hono();

  /** `?user=` : e-mail, ou « all » pour toute l'équipe (selon le rôle) ; par défaut, soi-même. */
  r.get('/', async (c) => {
    const current = userName(c);
    const scope = (c.req.query('user') || current).toLowerCase();
    if (scope !== current) requirePermission(c, 'seeAllTodos', 'voir les tâches des autres');
    const keep = (assigneeId: string) => scope === 'all' || assigneeId === scope;
    const [personal, project] = await Promise.all([users.listTodos(), pr.listOpenTasks()]);
    const res: TodosResponse = {
      scope,
      // Les tâches qu'on a confiées à quelqu'un restent visibles par leur auteur.
      personal: personal.filter((t) => keep(t.assigneeId) || (scope === current && t.createdBy === current)),
      project: project.filter((t) => keep(t.assigneeId)),
    };
    return c.json(res);
  });

  r.post('/', async (c) => {
    const current = userName(c);
    const b = await body(c, todoInputSchema);
    const assigneeId = b.assigneeId || current;
    await assertAssignable(assigneeId, current, c.get('user').role);
    const now = nowIso();
    const t: PersonalTask = { ...b, assigneeId, id: newId(), createdAt: now, createdBy: current, updatedAt: now, updatedBy: current, doneAt: b.done ? now : '' };
    return c.json(await users.putTodo(t), 201);
  });

  r.patch('/:id', async (c) => {
    const current = userName(c);
    const role = c.get('user').role;
    const before = await users.getTodo(c.req.param('id'));
    if (!canEdit(before, current, role)) throw new HttpError(403, 'Cette tâche ne vous concerne pas.');
    let raw: Record<string, unknown>;
    try {
      raw = (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Corps de requête JSON invalide');
    }
    const patch = parseBody(todoInputSchema.partial(), raw);
    const fields = Object.fromEntries(Object.entries(patch).filter(([k]) => k in raw));
    if (fields.assigneeId !== undefined && fields.assigneeId !== before.assigneeId) {
      if (!fields.assigneeId) throw new HttpError(400, 'Une tâche doit avoir un responsable.');
      await assertAssignable(String(fields.assigneeId), current, role);
    }
    const merged = parseBody(todoInputSchema, { ...before, ...fields });
    const now = nowIso();
    const doneAt = merged.done ? before.doneAt || now : '';
    return c.json(await users.putTodo({ ...before, ...merged, updatedAt: now, updatedBy: current, doneAt }));
  });

  /** Rattache une tâche à un projet, la rend personnelle ou la change de projet (même identifiant). */
  r.post('/move', async (c) => {
    const current = userName(c);
    const role = c.get('user').role;
    const b = await body(c, moveTaskBody);
    if (b.fromProjectId === b.toProjectId) throw new HttpError(400, 'La tâche est déjà à cet endroit.');
    let src: { title: string; details: string; done: boolean; dueDate: string; assigneeId: string; assignee?: string; doneAt: string };
    if (b.fromProjectId) {
      src = await pr.getItem(b.fromProjectId, 'tasks', b.id);
    } else {
      const todo = await users.getTodo(b.id);
      if (!canEdit(todo, current, role)) throw new HttpError(403, 'Cette tâche ne vous concerne pas.');
      src = todo;
    }
    const fields = { title: src.title, details: src.details, done: src.done, dueDate: src.dueDate };
    let task: unknown;
    if (b.toProjectId) {
      const who = await resolveTaskAssignee({ assigneeId: src.assigneeId, assignee: src.assigneeId ? '' : (src.assignee ?? '') }, null, current);
      task = await pr.createItem(b.toProjectId, 'tasks', parseBody(PROJECT_ITEM_SCHEMAS.tasks, { ...fields, ...who }), current, { itemId: b.id });
    } else {
      // Une tâche personnelle revient toujours à un utilisateur du hub.
      const assigneeId = src.assigneeId || current;
      await assertAssignable(assigneeId, current, role);
      const now = nowIso();
      task = await users.putTodo({ ...fields, assigneeId, id: b.id, createdAt: now, createdBy: current, updatedAt: now, updatedBy: current, doneAt: src.done ? src.doneAt || now : '' });
    }
    if (b.fromProjectId) await pr.deleteItem(b.fromProjectId, 'tasks', b.id, current);
    else await users.deleteTodo(b.id);
    return c.json({ projectId: b.toProjectId, task });
  });

  r.delete('/:id', async (c) => {
    const before = await users.getTodo(c.req.param('id'));
    if (!canEdit(before, userName(c), c.get('user').role)) throw new HttpError(403, 'Cette tâche ne vous concerne pas.');
    await users.deleteTodo(before.id);
    return c.body(null, 204);
  });

  return r;
}
