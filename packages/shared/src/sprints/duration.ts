/** Durées des tickets (temps estimé, temps passé) : enregistrées en heures, saisies et affichées en jours (de 8 h) et heures. */

import { HOURS_PER_DAY } from '../tma/activity.js';

const UNITS: Record<string, number> = { j: HOURS_PER_DAY, d: HOURS_PER_DAY, h: 1, m: 1 / 60 };
const PART = /(\d+(?:[.,]\d+)?)\s*(j(?:ours?)?|d(?:ays?)?|h(?:eures?)?|min|m)?\s*/giy;

/**
 * Texte saisi → heures (null si vide, NaN si illisible). « 2j 3h », « 2d3h », « 1,5 j », « 30min » ;
 * un nombre seul est en heures (« 4 », « 1j 4 » = 1 j 4 h), en minutes après des heures (« 1h30 »).
 */
export function parseDuration(text: string): number | null {
  const v = text.trim();
  if (!v) return null;
  PART.lastIndex = 0;
  let total = 0;
  let previous = '';
  let m: RegExpExecArray | null;
  while (PART.lastIndex < v.length && (m = PART.exec(v))) {
    // Sans unité : des minutes après des heures (« 1h30 »), sinon des heures.
    const unit = m[2] ? m[2][0]!.toLowerCase() : previous === 'h' ? 'm' : 'h';
    total += Number(m[1]!.replace(',', '.')) * UNITS[unit]!;
    previous = unit;
  }
  if (PART.lastIndex < v.length) return Number.NaN;
  return Math.round(total * 100) / 100;
}

const num = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/** Heures → « 1 j 4 h » (journées de 8 h), « 6 h », « 2 j ». Relu tel quel par `parseDuration`. */
export function formatDuration(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  const days = Math.floor(rounded / HOURS_PER_DAY);
  const rest = Math.round((rounded - days * HOURS_PER_DAY) * 100) / 100;
  if (!days) return `${num(rest)} h`;
  return rest ? `${days} j ${num(rest)} h` : `${days} j`;
}
