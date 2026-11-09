import { Hono, type Context } from 'hono';
import {
  buildMonthReport,
  buildThemeStats,
  classifyBody,
  importDeskBody,
  importTmaBody,
  deskKey,
  MONTH_RE,
  previousMonth,
  ticketKey,
  type DeskTicketInfo,
  type HubTicketRef,
  type TmaMonthDetail,
  type TmaThemesResponse,
} from '@samm/shared';
import { userName } from '../auth.js';
import { HttpError } from '../lib/util.js';
import { body } from '../lib/http.js';
import { startJob } from '../jobs/runner.js';
import * as tma from './repo.js';
import * as pr from '../projects/repo.js';

function monthParam(c: Context): string {
  const m = c.req.param('month') ?? '';
  if (!MONTH_RE.test(m)) throw new HttpError(400, 'Mois invalide (AAAA-MM)');
  return m;
}

/** Tickets du hub par ticket Desk cité (clé : `deskKey`). */
async function hubTicketsByDesk(): Promise<Map<string, HubTicketRef[]>> {
  const map = new Map<string, HubTicketRef[]>();
  for (const t of await pr.listTickets()) {
    if (!t.deskId) continue;
    const k = deskKey(t.deskId);
    map.set(k, [...(map.get(k) ?? []), { id: t.id, key: ticketKey(t), title: t.title, projectId: t.projectId, projectName: t.projectName }]);
  }
  return map;
}

async function monthDetail(month: string): Promise<TmaMonthDetail> {
  const [m, tickets, prevEntries, hub] = await Promise.all([tma.getMonth(month), tma.listTickets(), tma.getMonthEntries(previousMonth(month)), hubTicketsByDesk()]);
  const cited = new Set(m.entries.flatMap((e) => e.tickets.map((t) => deskKey(t.id))));
  return {
    ...m,
    hubTickets: Object.fromEntries([...hub].filter(([k]) => cited.has(k))),
    report: buildMonthReport(month, m.entries, tickets, prevEntries ? { month: previousMonth(month), entries: prevEntries } : null),
  };
}

/** Routes du module « Suivi TMA » (montées sous /api/tma). */
export function tmaRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await tma.getOverview()));

  // ---- Tickets Desk ----------------------------------------------------------

  r.post('/desk/import', async (c) => {
    const b = await body(c, importDeskBody);
    return c.json(await tma.importTickets(b.tickets, b.fileName, userName(c)));
  });

  r.post('/desk/classify', async (c) => {
    const b = await body(c, classifyBody);
    const tickets = await tma.listTickets();
    if (!tickets.length) throw new HttpError(400, 'Importez d’abord un export de tickets Desk.');
    if (!b.all && tickets.every((t) => t.theme)) throw new HttpError(400, 'Tous les tickets sont déjà classés.');
    return c.json(await startJob('tma_classify', tma.DESK_TARGET, userName(c), { all: b.all }), 202);
  });

  /** Ticket Desk vu du hub : fiche importée, temps passé d'après les relevés, tickets du hub qui le citent. */
  r.get('/desk/tickets/:id', async (c) => {
    const id = deskKey(c.req.param('id'));
    if (!/^\d{1,9}$/.test(id)) throw new HttpError(400, 'Numéro de ticket Desk invalide');
    const [tickets, months, hub] = await Promise.all([tma.listTickets(), tma.listMonths(), hubTicketsByDesk()]);
    const perMonth: DeskTicketInfo['months'] = [];
    for (const m of months) {
      const hours = ((await tma.getMonthEntries(m.month)) ?? []).flatMap((e) => e.tickets).filter((t) => deskKey(t.id) === id).reduce((n, t) => n + t.hours, 0);
      if (hours) perMonth.push({ month: m.month, hours: Math.round(hours * 100) / 100 });
    }
    perMonth.sort((a, b) => a.month.localeCompare(b.month));
    const res: DeskTicketInfo = {
      id,
      ticket: tickets.find((t) => deskKey(t.id) === id) ?? null,
      hours: Math.round(perMonth.reduce((n, m) => n + m.hours, 0) * 100) / 100,
      months: perMonth,
      hubTickets: hub.get(id) ?? [],
    };
    return c.json(res);
  });

  r.get('/themes', async (c) => {
    const [tickets, months] = await Promise.all([tma.listTickets(), tma.listMonths()]);
    const entries = (await Promise.all(months.map((m) => tma.getMonthEntries(m.month)))).flatMap((e) => e ?? []);
    const res: TmaThemesResponse = buildThemeStats(tickets, entries);
    return c.json(res);
  });

  // ---- Relevés mensuels --------------------------------------------------------

  r.get('/months/:month', async (c) => c.json(await monthDetail(monthParam(c))));

  r.put('/months/:month', async (c) => {
    const month = monthParam(c);
    const b = await body(c, importTmaBody);
    const outside = b.entries.filter((e) => !e.date.startsWith(month)).length;
    if (outside > b.entries.length / 2) throw new HttpError(400, `La plupart des lignes ne sont pas datées de ${month} : vérifiez le mois choisi.`);
    await tma.putMonth(month, b.entries, b.fileName, userName(c));
    return c.json(await monthDetail(month));
  });

  r.delete('/months/:month', async (c) => {
    await tma.deleteMonth(monthParam(c));
    return c.body(null, 204);
  });

  r.post('/months/:month/synthesis', async (c) => {
    const month = monthParam(c);
    await tma.getMonth(month);
    return c.json(await startJob('tma_synthesis', month, userName(c), {}), 202);
  });

  return r;
}
