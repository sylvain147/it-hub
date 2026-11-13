/** Routes des tableaux de tickets (montées sous /api/boards). */
import { Hono } from 'hono';
import { boardInputSchema, boardOf, boardRulesBody, DEFAULT_BOARD_ID } from '@samm/shared';
import { requirePermission, userName } from '../auth.js';
import { body } from '../lib/http.js';
import { HttpError, newId, nowIso } from '../lib/util.js';
import * as pr from '../projects/repo.js';
import * as boards from './boards.js';
import { listSprintItems } from './repo.js';

export function boardRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await boards.listBoards()));

  /** Nouveau tableau (administrateurs) : vide, sans règles d'affichage. */
  r.post('/', async (c) => {
    requirePermission(c, 'manageBoards', 'créer un tableau');
    const b = await body(c, boardInputSchema);
    if ((await boards.listBoards()).some((x) => x.name.toLowerCase() === b.name.toLowerCase())) throw new HttpError(409, `Le tableau « ${b.name} » existe déjà.`);
    return c.json(await boards.putBoard(boards.newBoard(b.name, userName(c), newId())), 201);
  });

  r.put('/:id', async (c) => {
    requirePermission(c, 'manageBoards', 'renommer un tableau');
    const b = await body(c, boardInputSchema);
    const before = await boards.requireBoard(c.req.param('id'));
    return c.json(await boards.putBoard({ ...before, ...b, updatedAt: nowIso(), updatedBy: userName(c) }));
  });

  /** Règles d'affichage des cartes du tableau : réglées par toute l'équipe. */
  r.put('/:id/regles', async (c) => {
    const b = await body(c, boardRulesBody);
    const before = await boards.requireBoard(c.req.param('id'));
    return c.json(await boards.putBoard({ ...before, cardRules: b.cardRules, updatedAt: nowIso(), updatedBy: userName(c) }));
  });

  /** Supprime un tableau vide (ni ticket, ni sprint) ; le tableau principal reste. */
  r.delete('/:id', async (c) => {
    requirePermission(c, 'manageBoards', 'supprimer un tableau');
    const b = await boards.requireBoard(c.req.param('id'));
    if (b.id === DEFAULT_BOARD_ID) throw new HttpError(400, 'Le tableau principal ne se supprime pas.');
    const tickets = (await pr.listTickets()).filter((t) => boardOf(t) === b.id).length;
    const sprints = (await listSprintItems(b.id)).length;
    if (tickets || sprints) {
      throw new HttpError(409, `Le tableau « ${b.name} » contient encore ${[tickets && `${tickets} ticket(s)`, sprints && `${sprints} sprint(s)`].filter(Boolean).join(' et ')} : déplacez ses tickets dans un autre tableau avant de le supprimer.`);
    }
    await boards.deleteBoard(b.id);
    return c.body(null, 204);
  });

  return r;
}
