import { deskKey, withTmaHours, type TicketView } from '@samm/shared';
import * as pr from '../projects/repo.js';
import * as tma from './repo.js';

/** Temps passé par le prestataire par ticket Desk (clé : `deskKey`), tous relevés confondus. */
export async function tmaHoursByDesk(): Promise<Map<string, number>> {
  const months = await tma.listMonths();
  const entries = (await Promise.all(months.map((m) => tma.getMonthEntries(m.month)))).flatMap((e) => e ?? []);
  const map = new Map<string, number>();
  for (const t of entries.flatMap((e) => e.tickets)) map.set(deskKey(t.id), (map.get(deskKey(t.id)) ?? 0) + t.hours);
  return map;
}

/**
 * Reporte le temps des relevés TMA sur les tickets du hub rattachés au même ticket Desk (`deskId`) : leur temps passé
 * comprend celui du prestataire (`withTmaHours`). Sans `only`, tous les tickets ; renvoie le nombre de tickets modifiés.
 */
export async function syncTmaHours(only?: (t: TicketView) => boolean): Promise<number> {
  const tickets = (await pr.listTickets()).filter((t) => (t.deskId || t.tmaHours != null) && (!only || only(t)));
  if (!tickets.length) return 0;
  const hours = await tmaHoursByDesk();
  let changed = 0;
  for (const t of tickets) {
    const next = withTmaHours(t, t.deskId ? (hours.get(deskKey(t.deskId)) ?? 0) : 0);
    if (next.spentHours === t.spentHours && next.tmaHours === t.tmaHours) continue;
    // Champs recopiés, sans historique ; les indicateurs des projets ne dépendent pas des temps.
    await pr.setItemFields(t.projectId, 'tasks', t.id, next);
    changed++;
  }
  return changed;
}
