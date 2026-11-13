/**
 * Relevé mensuel du temps passé par le prestataire (fichier Excel « TMA » : une ligne par activité,
 * date, nombre de jours, nom, prénom, commentaire libre citant les tickets Desk).
 * Lu dans le navigateur ; les heures sont réparties entre les tickets cités par le code, sans IA.
 */
import { readXlsx, type CellValue } from '../files/xlsx.js';
import { maskPersonalData } from './mask.js';

/** Une journée de TMA = 8 heures. */
export const HOURS_PER_DAY = 8;

export type ActivityKind = 'pilotage' | 'autre';

export interface TmaEntry {
  /** AAAA-MM-JJ */
  date: string;
  /** « Prénom Nom » */
  person: string;
  hours: number;
  comment: string;
  /** Tickets Desk cités et heures attribuées à chacun. */
  tickets: { id: string; hours: number }[];
  /** Heures non rattachées à un ticket (pilotage, réunions, analyses…). */
  otherHours: number;
  /** Nature des heures hors ticket. */
  activity: ActivityKind;
}

export interface TmaImport {
  entries: TmaEntry[];
  /** Mois couvert (AAAA-MM), d'après la majorité des dates. */
  month: string;
  /** Lignes ignorées (sans date, sans durée ou totaux). */
  skipped: number;
  /** Dates hors du mois principal (signalées à l'utilisateur). */
  outOfMonth: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Activités de pilotage et de gouvernance (comités, coordination, réunions). */
const PILOTAGE = /pilotage|copro|copil|comit[ée]|r[ée]union|point (?:hebdo|mensuel|sur)|suivi\b|coordination/i;

/** Durées écrites dans les commentaires : « (40 min) », « (1h15) », « (2h) ». */
const DURATION = /\(\s*(\d{1,2})\s*h\s*(\d{1,2})?\s*\)|\(\s*(\d{1,3})\s*min\s*\)/gi;

function durationHours(m: RegExpMatchArray): number {
  if (m[3] !== undefined) return Number(m[3]) / 60;
  return Number(m[1]) + Number(m[2] ?? 0) / 60;
}

/**
 * Répartit les heures d'une ligne entre les tickets cités (« Desk #11373, #11375 », « Desk365#8720 (45 min) »,
 * « #11445 - Sujet »). Si chaque ticket est suivi d'une durée, la répartition suit ces durées (et les durées
 * d'activités sans ticket restent hors ticket) ; sinon, parts égales.
 */
export function allocateHours(comment: string, hours: number): { tickets: { id: string; hours: number }[]; otherHours: number } {
  const refs = [...comment.matchAll(/#\s?(\d{3,6})(?!\d)/g)];
  if (!refs.length) return { tickets: [], otherHours: round2(hours) };
  const ids: string[] = [];
  const own = new Map<string, number>();
  let allTimed = true;
  refs.forEach((m, i) => {
    const id = m[1]!;
    const segment = comment.slice(m.index! + m[0].length, refs[i + 1]?.index ?? comment.length);
    const d = [...segment.matchAll(DURATION)][0];
    if (!ids.includes(id)) ids.push(id);
    if (d) own.set(id, (own.get(id) ?? 0) + durationHours(d));
    else allTimed = false;
  });
  const total = [...comment.matchAll(DURATION)].reduce((n, m) => n + durationHours(m), 0);
  if (allTimed && total > 0) {
    const timed = ids.reduce((n, id) => n + own.get(id)!, 0);
    const ticketHours = Math.min(hours, round2((hours * timed) / total));
    const parts = splitHours(ticketHours, ids.map((id) => own.get(id)!));
    return { tickets: ids.map((id, i) => ({ id, hours: parts[i]! })), otherHours: round2(hours - ticketHours) };
  }
  const parts = splitHours(hours, ids.map(() => 1));
  return { tickets: ids.map((id, i) => ({ id, hours: parts[i]! })), otherHours: 0 };
}

/**
 * Partage des heures au prorata des poids, au centième près, sans que la somme des parts arrondies
 * dépasse le total (sinon les heures hors ticket deviendraient négatives : 2 h sur 3 tickets ≠ 3 × 0,67 h).
 */
function splitHours(hours: number, weights: number[]): number[] {
  const cents = Math.round(hours * 100);
  const sum = weights.reduce((n, w) => n + w, 0);
  const exact = weights.map((w) => (cents * w) / sum);
  const parts = exact.map(Math.floor);
  let rest = cents - parts.reduce((n, c) => n + c, 0);
  // Les centimes restants vont aux plus grosses parties décimales.
  for (const i of exact.map((e, i) => i).sort((a, b) => exact[b]! - parts[b]! - (exact[a]! - parts[a]!))) {
    if (rest-- <= 0) break;
    parts[i]!++;
  }
  return parts.map((c) => c / 100);
}

const norm = (v: CellValue) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/** Date Excel (nombre de jours depuis le 30/12/1899) ou texte JJ/MM/AAAA → AAAA-MM-JJ. */
export function excelDate(v: CellValue): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v ?? '').trim()) ?? null;
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

const toNumber = (v: CellValue) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.').trim()));
const capitalize = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

/** Lit le relevé TMA (premier onglet dont l'en-tête contient une date, une durée et un nom). */
export function parseTmaWorkbook(bytes: Uint8Array): TmaImport {
  for (const sheet of readXlsx(bytes)) {
    const headerIdx = sheet.rows.findIndex((r) => r.some((c) => norm(c).startsWith('date')) && r.some((c) => /jour|heure/.test(norm(c))));
    if (headerIdx < 0) continue;
    const header = sheet.rows[headerIdx]!.map(norm);
    const col = (test: (h: string) => boolean) => header.findIndex(test);
    const cDate = col((h) => h.startsWith('date'));
    const cDays = col((h) => /jour/.test(h));
    const cHours = col((h) => /heure/.test(h));
    const cLast = col((h) => h === 'nom' || h === 'nom de famille');
    const cFirst = col((h) => h === 'prenom');
    const cPerson = col((h) => /intervenant|consultant|collaborateur|ressource/.test(h));
    // « Commentaires » de préférence (« Date de l'activité » contient aussi « activité »).
    const cComment = [/comment/, /libell|descript|tache|activit/].map((re) => header.findIndex((h, i) => i !== cDate && re.test(h))).find((i) => i >= 0) ?? -1;
    if (cLast < 0 && cPerson < 0) continue;

    const entries: TmaEntry[] = [];
    let skipped = 0;
    for (const r of sheet.rows.slice(headerIdx + 1)) {
      const date = excelDate(r[cDate] ?? null);
      const hours = cDays >= 0 ? toNumber(r[cDays] ?? null) * HOURS_PER_DAY : toNumber(r[cHours] ?? null);
      const person = cPerson >= 0 ? String(r[cPerson] ?? '').trim() : `${String(r[cFirst] ?? '').trim()} ${String(r[cLast] ?? '').trim()}`.trim();
      if (!date || !Number.isFinite(hours) || hours <= 0 || !person) {
        skipped++;
        continue;
      }
      const comment = maskPersonalData(String(r[cComment] ?? '').trim());
      const h = round2(hours);
      const { tickets, otherHours } = allocateHours(comment, h);
      entries.push({ date, person: capitalize(person), hours: h, comment, tickets, otherHours, activity: PILOTAGE.test(comment) ? 'pilotage' : 'autre' });
    }
    if (!entries.length) continue;
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.date.slice(0, 7), (counts.get(e.date.slice(0, 7)) ?? 0) + 1);
    const month = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return { entries: entries.sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person)), month, skipped, outOfMonth: entries.length - counts.get(month)! };
  }
  throw new Error('Relevé TMA non reconnu : un onglet avec les colonnes « Date », « Nb jours » (ou heures), « Nom » et « Commentaires » est attendu.');
}
