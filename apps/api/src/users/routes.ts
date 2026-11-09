import { Hono } from 'hono';
import {
  can,
  nameKey,
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
// Responsable des tickets
// ---------------------------------------------------------------------------

/** Le texte saisi désigne-t-il cet utilisateur (e-mail, identifiant ou nom) ? */
function designates(text: string, u: HubUser): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const short = u.email.split('@')[0]!;
  return t === u.email || t === short || nameKey(text) === nameKey(u.name) || nameKey(text) === nameKey(short.replace(/[._-]+/g, ' '));
}

/**
 * Rattache le responsable d'un ticket à un utilisateur du hub et recopie son nom.
 * Sans responsable à la création : la personne qui crée le ticket. Un texte qui ne correspond à aucun
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
  if (before) throw new HttpError(400, 'Un ticket doit avoir un responsable.');
  const me = all.find((x) => x.email === current);
  return { ...raw, assigneeId: current, assignee: me?.name ?? current };
}

/** Rattache à l'utilisateur les tickets qui le désignent en texte, et recopie son nom dans ceux qui lui sont attribués. */
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
// To-do (tâches personnelles)
// ---------------------------------------------------------------------------

async function assertAssignable(assigneeId: string, current: string, role: HubUser['role']) {
  if (assigneeId !== current && !can(role, 'assignOthers')) throw new HttpError(403, 'Votre rôle ne permet pas d’attribuer une tâche à quelqu’un d’autre.');
  const u = (await users.listUsers()).find((x) => x.email === assigneeId);
  if (!u) throw new HttpError(400, 'Responsable inconnu : choisissez un utilisateur du hub.');
  if (!u.active) throw new HttpError(400, `${u.name} est désactivé : choisissez un autre responsable.`);
}

/** Sa tâche, celle qu'on a confiée, celle d'un projet (partagée par l'équipe), ou toutes selon le rôle. */
function canEdit(t: PersonalTask, current: string, role: HubUser['role']) {
  return t.assigneeId === current || t.createdBy === current || !!t.projectId || can(role, 'seeAllTodos');
}

/** Routes de la to-do (montées sous /api/todos). Indépendantes des tickets et des sprints. */
export function todoRoutes() {
  const r = new Hono();

  /**
   * `?user=` : e-mail, ou « all » pour toute l'équipe (selon le rôle) ; par défaut, soi-même.
   * `?projet=` : la to-do d'un projet, visible de toute l'équipe comme le projet.
   */
  r.get('/', async (c) => {
    const current = userName(c);
    const todos = await users.listTodos();
    const projectId = c.req.query('projet');
    if (projectId) {
      const res: TodosResponse = { scope: 'projet', personal: todos.filter((t) => t.projectId === projectId) };
      return c.json(res);
    }
    const scope = (c.req.query('user') || current).toLowerCase();
    if (scope !== current) requirePermission(c, 'seeAllTodos', 'voir la to-do des autres');
    // Les tâches qu'on a confiées à quelqu'un restent visibles par leur auteur.
    const personal = todos.filter((t) => scope === 'all' || t.assigneeId === scope || (scope === current && t.createdBy === current));
    const res: TodosResponse = { scope, personal };
    return c.json(res);
  });

  r.post('/', async (c) => {
    const current = userName(c);
    const b = await body(c, todoInputSchema);
    const assigneeId = b.assigneeId || current;
    await assertAssignable(assigneeId, current, c.get('user').role);
    await pr.assertProjectRef(b.projectId);
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
    if (fields.projectId && fields.projectId !== before.projectId) await pr.assertProjectRef(String(fields.projectId));
    const merged = parseBody(todoInputSchema, { ...before, ...fields });
    const now = nowIso();
    const doneAt = merged.done ? before.doneAt || now : '';
    return c.json(await users.putTodo({ ...before, ...merged, updatedAt: now, updatedBy: current, doneAt }));
  });

  r.delete('/:id', async (c) => {
    const before = await users.getTodo(c.req.param('id'));
    if (!canEdit(before, userName(c), c.get('user').role)) throw new HttpError(403, 'Cette tâche ne vous concerne pas.');
    await users.deleteTodo(before.id);
    return c.body(null, 204);
  });

  return r;
}
