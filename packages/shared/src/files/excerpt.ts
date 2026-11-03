/**
 * Extrait d'un fichier exemple envoyé à l'IA : les premières lignes + quelques lignes de chaque « forme » de ligne,
 * anonymisé par défaut (lettres et chiffres remplacés au hasard, longueurs et séparateurs conservés).
 */
import { splitLines } from './parse.js';

export interface ExcerptOptions {
  anonymize: boolean;
  /** Nombre de caractères conservés tels quels en début de ligne (zone du code d'enregistrement). */
  keepPrefix: number;
  /** Première ligne conservée telle quelle (titres de colonnes d'un CSV). */
  keepFirstLine?: boolean;
  maxLines?: number;
  maxChars?: number;
}

export interface Excerpt {
  text: string;
  /** Numéros de lignes d'origine. */
  lines: number[];
  totalLines: number;
}

/** Forme d'une ligne : son début (zone du code) et sa longueur, pour échantillonner chaque type de ligne. */
function shapeOf(line: string, keepPrefix: number): string {
  return `${line.slice(0, Math.max(keepPrefix, 2))}|${line.length}`;
}

export function buildExcerpt(text: string, opts: ExcerptOptions): Excerpt {
  const all = splitLines(text);
  const maxLines = opts.maxLines ?? 150;
  const maxChars = opts.maxChars ?? 30_000;
  const picked = new Set<number>();
  for (let i = 0; i < Math.min(all.length, 30); i++) picked.add(i);
  const perShape = new Map<string, number>();
  for (let i = 0; i < all.length && picked.size < maxLines; i++) {
    const shape = shapeOf(all[i]!, opts.keepPrefix);
    const n = perShape.get(shape) ?? 0;
    if (n < 3) {
      picked.add(i);
      perShape.set(shape, n + 1);
    }
  }
  // Les dernières lignes (fin de fichier, totaux).
  for (let i = Math.max(0, all.length - 5); i < all.length; i++) picked.add(i);

  const lines = [...picked].sort((a, b) => a - b);
  const out: string[] = [];
  const kept: number[] = [];
  let size = 0;
  for (const i of lines) {
    const raw = all[i]!;
    const l = opts.anonymize && !(i === 0 && opts.keepFirstLine) ? anonymizeLine(raw, opts.keepPrefix) : raw;
    if (size + l.length > maxChars) break;
    out.push(l);
    kept.push(i + 1);
    size += l.length + 1;
  }
  return { text: out.join('\n'), lines: kept, totalLines: all.length };
}

/** Rendu avec numéros de ligne d'origine, pour l'IA. */
export function excerptWithLineNumbers(e: Excerpt): string {
  return e.text
    .split('\n')
    .map((l, i) => `${String(e.lines[i] ?? i + 1).padStart(6)}│${l}`)
    .join('\n');
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';

function rnd(chars: string) {
  return chars[Math.floor(Math.random() * chars.length)]!;
}

/**
 * Anonymise une ligne en conservant la structure :
 *  - le préfixe (code d'enregistrement) est gardé ;
 *  - les dates plausibles sont gardées (utiles pour reconnaître les formats) ;
 *  - les codes courts en majuscules (≤ 3 lettres : EUR, CE, N…) sont gardés ;
 *  - toute autre lettre / chiffre est remplacé au hasard (majuscule → majuscule, chiffre → chiffre).
 */
export function anonymizeLine(line: string, keepPrefix: number): string {
  const prefix = line.slice(0, keepPrefix);
  const rest = line.slice(keepPrefix);
  const keep = new Array<boolean>(rest.length).fill(false);
  const mark = (re: RegExp, test: (m: RegExpExecArray) => boolean = () => true) => {
    for (const m of rest.matchAll(re)) if (test(m as RegExpExecArray)) for (let i = 0; i < m[0].length; i++) keep[m.index! + i] = true;
  };
  // Dates : AAAA-MM-JJ, JJ/MM/AAAA, AAAAMMJJ (19xx/20xx).
  mark(/(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/g);
  mark(/(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(19|20)\d\d/g);
  mark(/(?<!\d)(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g);
  // Codes courts en majuscules, isolés.
  mark(/(?<![A-Za-zÀ-ÿ])[A-Z]{1,3}(?![A-Za-zÀ-ÿ])/g);
  let out = '';
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (keep[i]) out += ch;
    else if (/\d/.test(ch)) out += rnd('0123456789');
    else if (/[A-ZÀ-Þ]/.test(ch)) out += rnd(UPPER);
    else if (/[a-zß-ÿ]/.test(ch)) out += rnd(LOWER);
    else out += ch;
  }
  return prefix + out;
}
