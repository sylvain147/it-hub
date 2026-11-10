/**
 * Intervenants des relevés TMA rattachés aux contacts des prestataires du paramétrage : le temps du relevé
 * s'ajoute au contact (et à son prestataire) ; un intervenant absent des carnets de contacts est signalé.
 */
import { nameKey, type Prestataire } from '../settings.js';
import type { TmaEntry } from './activity.js';

/** Clé de comparaison d'un intervenant : « Durand Romain », « ROMAIN DURAND » et « Romain Durand » sont identiques. */
export const personKey = (s: string) => nameKey(s).replace(/-/g, ' ').split(' ').filter(Boolean).sort().join(' ');

/** Contact du paramétrage correspondant à un intervenant du relevé. */
export interface TmaPersonLink {
  prestataireId: string;
  prestataireName: string;
  contactId: string;
  contactName: string;
}

/**
 * Contact de chaque intervenant (clé : nom tel qu'écrit dans le relevé), null s'il n'est dans aucun carnet de contacts.
 * Les contacts actifs et les prestataires actifs passent avant les archivés en cas d'homonymes.
 */
export function matchTmaPeople(people: Iterable<string>, prestataires: Prestataire[]): Map<string, TmaPersonLink | null> {
  const index = new Map<string, TmaPersonLink & { rank: number }>();
  for (const p of prestataires) {
    for (const c of p.contacts) {
      const k = personKey(c.name);
      const rank = (c.active ? 0 : 1) + (p.active ? 0 : 2);
      if (!k || (index.get(k)?.rank ?? Infinity) <= rank) continue;
      index.set(k, { prestataireId: p.id, prestataireName: p.name, contactId: c.id, contactName: c.name, rank });
    }
  }
  const res = new Map<string, TmaPersonLink | null>();
  for (const person of people) {
    const hit = index.get(personKey(person));
    res.set(person, hit ? { prestataireId: hit.prestataireId, prestataireName: hit.prestataireName, contactId: hit.contactId, contactName: hit.contactName } : null);
  }
  return res;
}

/** Intervenants du relevé absents des carnets de contacts, triés. */
export function unknownTmaPeople(entries: Pick<TmaEntry, 'person'>[], prestataires: Prestataire[]): string[] {
  return [...matchTmaPeople(new Set(entries.map((e) => e.person)), prestataires)]
    .filter(([, link]) => !link)
    .map(([person]) => person)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Temps des relevés TMA d'un contact ou d'un prestataire (heures, au total et par mois). */
export interface TmaHoursTotal {
  hours: number;
  months: { month: string; hours: number }[];
}

export interface TmaPrestataireHours {
  byContact: Record<string, TmaHoursTotal>;
  byPrestataire: Record<string, TmaHoursTotal>;
  /** Intervenants des relevés absents des carnets de contacts. */
  unknown: { person: string; hours: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Additionne le temps des relevés (tous mois confondus) par contact et par prestataire. */
export function tmaHoursByContact(months: { month: string; entries: TmaEntry[] }[], prestataires: Prestataire[]): TmaPrestataireHours {
  const links = matchTmaPeople(new Set(months.flatMap((m) => m.entries.map((e) => e.person))), prestataires);
  const byContact = new Map<string, Map<string, number>>();
  const byPrestataire = new Map<string, Map<string, number>>();
  const unknown = new Map<string, number>();
  const add = (map: Map<string, Map<string, number>>, id: string, month: string, h: number) => {
    const m = map.get(id) ?? new Map<string, number>();
    m.set(month, (m.get(month) ?? 0) + h);
    map.set(id, m);
  };
  for (const { month, entries } of months) {
    for (const e of entries) {
      const link = links.get(e.person);
      if (!link) {
        unknown.set(e.person, (unknown.get(e.person) ?? 0) + e.hours);
        continue;
      }
      add(byContact, link.contactId, month, e.hours);
      add(byPrestataire, link.prestataireId, month, e.hours);
    }
  }
  const total = (map: Map<string, Map<string, number>>) =>
    Object.fromEntries(
      [...map].map(([id, m]) => {
        const months = [...m].map(([month, hours]) => ({ month, hours: round2(hours) })).sort((a, b) => a.month.localeCompare(b.month));
        return [id, { hours: round2(months.reduce((n, x) => n + x.hours, 0)), months }];
      }),
    );
  return {
    byContact: total(byContact),
    byPrestataire: total(byPrestataire),
    unknown: [...unknown].map(([person, hours]) => ({ person, hours: round2(hours) })).sort((a, b) => b.hours - a.hours || a.person.localeCompare(b.person, 'fr')),
  };
}
