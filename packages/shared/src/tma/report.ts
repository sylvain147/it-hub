/**
 * Calculs des rapports de suivi TMA. Tous les chiffres sont calculés ici, par le code : l'IA ne fait que
 * rédiger la synthèse à partir de ces résultats.
 */
import { HOURS_PER_DAY, type TmaEntry } from './activity.js';
import type { DeskTicket } from './desk.js';

/** Ticket Desk tel que stocké : champs de l'export + thème attribué par l'IA. */
export interface StoredTicket extends DeskTicket {
  theme: string;
}

export interface Breakdown {
  key: string;
  hours: number;
  /** Nombre de tickets (ou de lignes selon le tableau). */
  count: number;
}

export interface TicketTime {
  id: string;
  hours: number;
  people: string[];
  /** Ticket retrouvé dans les exports Desk, sinon null. */
  ticket: Pick<StoredTicket, 'subject' | 'category' | 'status' | 'priority' | 'cause' | 'theme' | 'createdAt'> | null;
}

export interface MonthTotals {
  month: string;
  totalHours: number;
  ticketHours: number;
  pilotageHours: number;
  otherHours: number;
  /** Tickets Desk créés dans le mois. */
  createdTickets: number;
}

export interface TmaMonthReport extends MonthTotals {
  totalDays: number;
  entryCount: number;
  byPerson: (Breakdown & { ticketHours: number })[];
  byTicket: TicketTime[];
  /** Temps par catégorie Desk / par thème (tickets avec du temps imputé). */
  timeByCategory: Breakdown[];
  timeByTheme: Breakdown[];
  /** Tickets Desk créés dans le mois. */
  created: {
    byCategory: Breakdown[];
    byPriority: Breakdown[];
    byCause: Breakdown[];
    byTheme: Breakdown[];
    byStatus: Breakdown[];
  };
  /** Tickets cités dans le relevé mais absents des exports Desk importés. */
  unknownTickets: string[];
  /** Tickets créés dans le mois et pas encore classés par thème. */
  unclassified: number;
  /** Lignes du relevé sans ticket, les plus longues d'abord. */
  unattached: { date: string; person: string; hours: number; comment: string; activity: TmaEntry['activity'] }[];
  previous: MonthTotals | null;
}

export const NO_THEME = 'Non classé';
export const NO_VALUE = '(non renseigné)';

const round1 = (n: number) => Math.round(n * 10) / 10;

function group<T>(items: T[], key: (t: T) => string, hours: (t: T) => number = () => 0): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const it of items) {
    const k = key(it) || NO_VALUE;
    const b = map.get(k) ?? { key: k, hours: 0, count: 0 };
    b.hours += hours(it);
    b.count++;
    map.set(k, b);
  }
  return [...map.values()].map((b) => ({ ...b, hours: round1(b.hours) })).sort((a, b) => b.hours - a.hours || b.count - a.count || a.key.localeCompare(b.key));
}

export function monthTotals(month: string, entries: TmaEntry[], tickets: StoredTicket[]): MonthTotals {
  const sum = (f: (e: TmaEntry) => number) => round1(entries.reduce((n, e) => n + f(e), 0));
  return {
    month,
    totalHours: sum((e) => e.hours),
    ticketHours: sum((e) => e.hours - e.otherHours),
    pilotageHours: sum((e) => (e.activity === 'pilotage' ? e.otherHours : 0)),
    otherHours: sum((e) => (e.activity === 'pilotage' ? 0 : e.otherHours)),
    createdTickets: tickets.filter((t) => t.createdAt.startsWith(month)).length,
  };
}

/** Temps par ticket, à partir des lignes du relevé. */
export function timeByTicket(entries: TmaEntry[]): Map<string, { hours: number; people: Set<string> }> {
  const out = new Map<string, { hours: number; people: Set<string> }>();
  for (const e of entries) {
    for (const t of e.tickets) {
      const cur = out.get(t.id) ?? { hours: 0, people: new Set<string>() };
      cur.hours += t.hours;
      cur.people.add(e.person);
      out.set(t.id, cur);
    }
  }
  return out;
}

export function buildMonthReport(month: string, entries: TmaEntry[], tickets: StoredTicket[], previous: { month: string; entries: TmaEntry[] } | null): TmaMonthReport {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const totals = monthTotals(month, entries, tickets);
  const perTicket = timeByTicket(entries);
  const byTicket: TicketTime[] = [...perTicket.entries()]
    .map(([id, v]) => {
      const t = byId.get(id);
      return {
        id,
        hours: round1(v.hours),
        people: [...v.people].sort(),
        ticket: t ? { subject: t.subject, category: t.category, status: t.status, priority: t.priority, cause: t.cause, theme: t.theme, createdAt: t.createdAt } : null,
      };
    })
    .sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id));
  const known = byTicket.filter((t) => t.ticket);
  const created = tickets.filter((t) => t.createdAt.startsWith(month));
  const people = group(entries, (e) => e.person, (e) => e.hours);
  return {
    ...totals,
    totalDays: Math.round((totals.totalHours / HOURS_PER_DAY) * 100) / 100,
    entryCount: entries.length,
    byPerson: people.map((p) => ({
      ...p,
      ticketHours: round1(entries.filter((e) => e.person === p.key).reduce((n, e) => n + e.hours - e.otherHours, 0)),
    })),
    byTicket,
    timeByCategory: group(known, (t) => t.ticket!.category, (t) => t.hours),
    timeByTheme: group(known, (t) => t.ticket!.theme || NO_THEME, (t) => t.hours),
    created: {
      byCategory: group(created, (t) => t.category),
      byPriority: group(created, (t) => t.priority),
      byCause: group(created, (t) => t.cause),
      byTheme: group(created, (t) => t.theme || NO_THEME),
      byStatus: group(created, (t) => t.status),
    },
    unknownTickets: byTicket.filter((t) => !t.ticket).map((t) => t.id),
    unclassified: created.filter((t) => !t.theme).length,
    unattached: entries
      .filter((e) => e.otherHours > 0)
      .map((e) => ({ date: e.date, person: e.person, hours: e.otherHours, comment: e.comment, activity: e.activity }))
      .sort((a, b) => b.hours - a.hours || a.date.localeCompare(b.date)),
    previous: previous ? monthTotals(previous.month, previous.entries, tickets) : null,
  };
}

export interface ThemeStats {
  theme: string;
  tickets: number;
  /** Tickets créés par mois (AAAA-MM). */
  byMonth: Record<string, number>;
  /** Heures TMA imputées aux tickets du thème (tous les relevés importés). */
  hours: number;
  /** Quelques tickets du thème, les plus récents d'abord. */
  examples: { id: string; subject: string; createdAt: string }[];
}

/** Récurrences : tickets et temps par thème, sur toute la période importée. */
export function buildThemeStats(tickets: StoredTicket[], entries: TmaEntry[]): { months: string[]; themes: ThemeStats[] } {
  const hours = timeByTicket(entries);
  const months = [...new Set(tickets.map((t) => t.createdAt.slice(0, 7)))].sort();
  const map = new Map<string, ThemeStats>();
  for (const t of [...tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const theme = t.theme || NO_THEME;
    const s = map.get(theme) ?? { theme, tickets: 0, byMonth: {}, hours: 0, examples: [] };
    s.tickets++;
    const m = t.createdAt.slice(0, 7);
    s.byMonth[m] = (s.byMonth[m] ?? 0) + 1;
    s.hours += hours.get(t.id)?.hours ?? 0;
    if (s.examples.length < 5) s.examples.push({ id: t.id, subject: t.subject, createdAt: t.createdAt });
    map.set(theme, s);
  }
  const themes = [...map.values()].map((s) => ({ ...s, hours: round1(s.hours) })).sort((a, b) => b.tickets - a.tickets || b.hours - a.hours);
  return { months, themes };
}

/** Libellé « septembre 2026 ». */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Mois précédent (AAAA-MM). */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`;
}
