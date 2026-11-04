/**
 * Moteur de lecture : applique une fiche de lecture (FileSpec) à un fichier.
 * Tourne dans le navigateur (les fichiers ne quittent pas le poste) et côté serveur (diagnostics pour l'IA).
 *
 * Pour tenir de gros fichiers, on ne conserve que la ligne brute et son type ;
 * les valeurs sont recalculées à la demande par `readRecord`.
 */
import type { CheckSpec, FieldSpec, FileSpec, RecordTypeSpec } from './spec.js';

export interface ParsedRecord {
  /** Numéro de ligne dans le fichier (à partir de 1). */
  line: number;
  /** Code du type d'enregistrement, null si la ligne n'est reconnue par aucun type. */
  type: string | null;
  raw: string;
  /** Index (dans `records`) de l'enregistrement parent. */
  parent: number | null;
}

export interface FieldValue {
  raw: string;
  value: string | number | null;
  display: string;
  error: string | null;
}

export interface FieldError {
  record: number;
  field: string;
  message: string;
}

export interface CheckResult {
  label: string;
  line: number;
  expected: number | null;
  actual: number;
  ok: boolean;
}

export interface ParseResult {
  spec: FileSpec;
  lineCount: number;
  emptyLines: number;
  records: ParsedRecord[];
  /** Index des enregistrements par type. */
  byType: Map<string, number[]>;
  /** Index des enfants de chaque enregistrement. */
  children: Map<number, number[]>;
  unknown: number[];
  fieldErrors: FieldError[];
  fieldErrorCount: number;
  checks: CheckResult[];
}

const MAX_STORED_ERRORS = 2000;

// ---------------------------------------------------------------------------
// Décodage et découpage
// ---------------------------------------------------------------------------

/** Décode le fichier ; un fichier annoncé UTF-8 mais invalide est relu en Windows-1252 (ANSI). */
export function decodeFile(bytes: Uint8Array, encoding: string): { text: string; encoding: string } {
  if (encoding === 'utf-8') {
    try {
      return { text: stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'utf-8' };
    } catch {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
    }
  }
  return { text: stripBom(new TextDecoder(encoding).decode(bytes)), encoding };
}

/** Devine l'encodage d'un fichier inconnu. */
export function guessEncoding(bytes: Uint8Array): 'utf-8' | 'windows-1252' {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 1_000_000));
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Découpe une ligne délimitée (guillemets gérés, sans retour à la ligne dans les champs). */
export function splitDelimited(line: string, delimiter: string, quote: string): string[] {
  if (!delimiter) return [line];
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote && ch === quote) {
      if (inQuotes && line[i + 1] === quote) {
        cur += quote;
        i++;
      } else inQuotes = !inQuotes;
    } else if (!inQuotes && line.startsWith(delimiter, i)) {
      out.push(cur);
      cur = '';
      i += delimiter.length - 1;
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

interface Compiled {
  spec: FileSpec;
  ordered: RecordTypeSpec[];
  byCode: Map<string, RecordTypeSpec>;
}

function compile(spec: FileSpec): Compiled {
  const weight = (r: RecordTypeSpec) => (r.match.length ? 1000 + r.match.reduce((n, m) => n + Math.max(m.length, m.value.length), 0) : 0);
  const ordered = [...spec.recordTypes].sort((a, b) => weight(b) - weight(a));
  return { spec, ordered, byCode: new Map(spec.recordTypes.map((r) => [r.code, r])) };
}

function cellsOf(spec: FileSpec, line: string): string[] | null {
  return spec.format === 'delimited' ? splitDelimited(line, spec.delimiter, spec.quote) : null;
}

function slice(spec: FileSpec, line: string, cells: string[] | null, start: number, length: number): string {
  if (spec.format === 'delimited') return cells?.[start - 1] ?? '';
  return line.substring(start - 1, start - 1 + length);
}

function classify(c: Compiled, line: string, cells: string[] | null): RecordTypeSpec | null {
  for (const r of c.ordered) {
    if (r.match.every((m) => slice(c.spec, line, cells, m.start, m.length).trim() === m.value.trim())) return r;
  }
  return null;
}

export function parseFile(spec: FileSpec, text: string): ParseResult {
  const c = compile(spec);
  const lines = splitLines(text);
  const records: ParsedRecord[] = [];
  const byType = new Map<string, number[]>();
  const children = new Map<number, number[]>();
  const unknown: number[] = [];
  const fieldErrors: FieldError[] = [];
  let fieldErrorCount = 0;
  let emptyLines = 0;
  const lastOfType = new Map<string, number>();

  for (let i = spec.skipLines; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) {
      emptyLines++;
      continue;
    }
    const cells = cellsOf(spec, raw);
    const rt = classify(c, raw, cells);
    const idx = records.length;
    let parent: number | null = null;
    if (rt?.parent) parent = lastOfType.get(rt.parent) ?? null;
    records.push({ line: i + 1, type: rt?.code ?? null, raw, parent });
    if (!rt) {
      unknown.push(idx);
      continue;
    }
    lastOfType.set(rt.code, idx);
    (byType.get(rt.code) ?? byType.set(rt.code, []).get(rt.code)!).push(idx);
    if (parent != null) (children.get(parent) ?? children.set(parent, []).get(parent)!).push(idx);
    for (const f of rt.fields) {
      const v = convert(f, slice(spec, raw, cells, f.start, f.length), false);
      if (v.error) {
        fieldErrorCount++;
        if (fieldErrors.length < MAX_STORED_ERRORS) fieldErrors.push({ record: idx, field: f.key, message: v.error });
      }
    }
  }

  const result: ParseResult = { spec, lineCount: lines.length, emptyLines, records, byType, children, unknown, fieldErrors, fieldErrorCount, checks: [] };
  result.checks = runChecks(result, c);
  return result;
}

/** Valeurs de tous les champs d'un enregistrement. */
export function readRecord(result: ParseResult, index: number): { type: RecordTypeSpec | null; values: FieldValue[] } {
  const rec = result.records[index]!;
  const rt = rec.type ? result.spec.recordTypes.find((r) => r.code === rec.type) ?? null : null;
  if (!rt) return { type: null, values: [] };
  const cells = cellsOf(result.spec, rec.raw);
  return { type: rt, values: rt.fields.map((f) => convert(f, slice(result.spec, rec.raw, cells, f.start, f.length))) };
}

export function readField(result: ParseResult, index: number, key: string): FieldValue | null {
  const rec = result.records[index]!;
  const rt = rec.type ? result.spec.recordTypes.find((r) => r.code === rec.type) : undefined;
  const f = rt?.fields.find((x) => x.key === key);
  if (!f) return null;
  return convert(f, slice(result.spec, rec.raw, cellsOf(result.spec, rec.raw), f.start, f.length));
}

// ---------------------------------------------------------------------------
// Conversion des valeurs
// ---------------------------------------------------------------------------

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 });

/**
 * Convertit une valeur brute. Avec `withDisplay = false` (passe de validation sur tout le fichier),
 * le libellé d'affichage n'est pas calculé : c'est la partie la plus coûteuse.
 */
export function convert(f: FieldSpec, raw: string, withDisplay = true): FieldValue {
  const t = raw.trim();
  const label = (code: string) => (withDisplay && f.values.length ? f.values.find((v) => v.code.trim() === code)?.label : undefined);
  const ok = (value: string | number | null, display: string): FieldValue => ({ raw, value, display, error: null });
  const ko = (message: string): FieldValue => ({ raw, value: null, display: t, error: message });

  switch (f.type) {
    case 'text': {
      const l = t ? label(t) : undefined;
      return ok(t || null, l ? `${l} (${t})` : t);
    }
    case 'code': {
      if (!t) return ok(null, '');
      const l = label(t);
      return ok(t, l ? `${l} (${t})` : t);
    }
    case 'integer': {
      if (!t) return ok(null, '');
      const m = /^([+-]?)(\d+)([+-]?)$/.exec(t.replace(/\s/g, ''));
      if (!m) return ko('Nombre entier attendu');
      const negative = m[1] === '-' || m[3] === '-';
      const digits = m[2]!.replace(/^0+(?=\d)/, '');
      // Au-delà de 15 chiffres (identifiants, n° de commande…), un nombre perdrait sa précision : on garde le texte.
      if (digits.length > 15) return ok((negative ? '-' : '') + digits, (negative ? '-' : '') + digits);
      const n = Number(digits) * (negative ? -1 : 1);
      const l = label(t);
      return ok(n, l ? `${l} (${t})` : withDisplay ? nf.format(n) : '');
    }
    case 'decimal': {
      const n = parseDecimal(t, f.impliedDecimals);
      if (n === undefined) return ko('Nombre attendu');
      return ok(n, n === null || !withDisplay ? '' : nf.format(n));
    }
    case 'date':
    case 'time':
    case 'datetime': {
      // Vide ou uniquement des zéros (« 00000000 ») : pas de date.
      if (!t || !/[1-9]/.test(t)) return ok(null, '');
      const d = parseDateTime(t, f.dateFormat, f.type);
      if (!d) return ko(`Date/heure invalide${f.dateFormat ? ` (format ${f.dateFormat})` : ''}`);
      return ok(d.iso, d.display);
    }
  }
}

/** undefined = invalide, null = vide. */
export function parseDecimal(t: string, impliedDecimals: number): number | null | undefined {
  let s = t.replace(/\s/g, '');
  if (!s) return null;
  let sign = 1;
  if (/^[+-]/.test(s)) {
    if (s[0] === '-') sign = -1;
    s = s.slice(1);
  } else if (/[+-]$/.test(s)) {
    if (s.endsWith('-')) sign = -1;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return undefined;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let n: number;
  if (lastSep >= 0) {
    const int = s.slice(0, lastSep).replace(/[.,]/g, '');
    n = Number(`${int || '0'}.${s.slice(lastSep + 1)}`);
  } else {
    n = Number(s) / 10 ** impliedDecimals;
  }
  return Number.isFinite(n) ? sign * n : undefined;
}

const pad = (n: number, l = 2) => String(n).padStart(l, '0');

export function parseDateTime(t: string, format: string, type: 'date' | 'time' | 'datetime'): { iso: string; display: string } | null {
  const formats = format ? [format] : type === 'time' ? ['HHmmss', 'HH:mm:ss', 'HHmm', 'HH:mm'] : ['YYYYMMDD', 'YYYY-MM-DD', 'DD/MM/YYYY', 'YYYY-MM-DDTHH:mm:ss', 'YYYYMMDDHHmmss', 'DD/MM/YYYY HH:mm:ss'];
  for (const fmt of formats) {
    const parts = matchFormat(t, fmt);
    if (!parts) continue;
    const { Y, M, D, h, m, s } = parts;
    if (type !== 'time') {
      if (Y == null || M == null || D == null || M < 1 || M > 12 || D < 1 || D > 31) continue;
      const dt = new Date(Date.UTC(Y, M - 1, D));
      if (dt.getUTCMonth() !== M - 1) continue;
    }
    if ((h ?? 0) > 23 || (m ?? 0) > 59 || (s ?? 0) > 59) continue;
    const dateIso = Y != null ? `${pad(Y, 4)}-${pad(M!)}-${pad(D!)}` : '';
    const timeIso = h != null ? `${pad(h)}:${pad(m ?? 0)}${s != null ? ':' + pad(s) : ''}` : '';
    const dateFr = Y != null ? `${pad(D!)}/${pad(M!)}/${pad(Y, 4)}` : '';
    if (type === 'time') return timeIso ? { iso: timeIso, display: timeIso } : null;
    if (type === 'date') return { iso: dateIso, display: dateFr };
    return { iso: timeIso ? `${dateIso}T${timeIso}` : dateIso, display: timeIso ? `${dateFr} ${timeIso}` : dateFr };
  }
  return null;
}

const DATE_TOKENS = ['YYYY', 'YY', 'MM', 'DD', 'HH', 'mm', 'ss'];
const compiledFormats = new Map<string, { re: RegExp; order: string[] }>();

function compileFormat(fmt: string) {
  let c = compiledFormats.get(fmt);
  if (c) return c;
  let re = '^';
  const order: string[] = [];
  for (let i = 0; i < fmt.length; ) {
    const tok = DATE_TOKENS.find((k) => fmt.startsWith(k, i));
    if (tok) {
      re += `(\\d{${tok.length}})`;
      order.push(tok);
      i += tok.length;
    } else {
      re += fmt[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  c = { re: new RegExp(re + '$'), order };
  compiledFormats.set(fmt, c);
  return c;
}

function matchFormat(t: string, fmt: string): { Y?: number; M?: number; D?: number; h?: number; m?: number; s?: number } | null {
  const { re, order } = compileFormat(fmt);
  const m = re.exec(t);
  if (!m) return null;
  const out: Record<string, number> = {};
  for (let i = 0; i < order.length; i++) {
    const tok = order[i]!;
    const v = Number(m[i + 1]);
    if (tok === 'YYYY') out.Y = v;
    else if (tok === 'YY') out.Y = 2000 + v;
    else if (tok === 'MM') out.M = v;
    else if (tok === 'DD') out.D = v;
    else if (tok === 'HH') out.h = v;
    else if (tok === 'mm') out.m = v;
    else if (tok === 'ss') out.s = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------

function numericValue(result: ParseResult, c: Compiled, index: number, key: string): number | null {
  const rec = result.records[index]!;
  const rt = rec.type ? c.byCode.get(rec.type) : undefined;
  const f = rt?.fields.find((x) => x.key === key);
  if (!f) return null;
  const raw = slice(c.spec, rec.raw, cellsOf(c.spec, rec.raw), f.start, f.length);
  const v = convert(f.type === 'decimal' ? f : { ...f, type: 'decimal', impliedDecimals: f.type === 'integer' ? 0 : f.impliedDecimals }, raw);
  return typeof v.value === 'number' ? v.value : null;
}

function runChecks(result: ParseResult, c: Compiled): CheckResult[] {
  const out: CheckResult[] = [];
  for (const chk of c.spec.checks) {
    for (const idx of result.byType.get(chk.expectedRecord) ?? []) {
      const expected = numericValue(result, c, idx, chk.expectedField);
      const actual = computeActual(result, c, chk, idx);
      out.push({
        label: chk.label,
        line: result.records[idx]!.line,
        expected,
        actual,
        ok: expected !== null && Math.abs(expected - actual) < 0.005,
      });
    }
  }
  return out;
}

function computeActual(result: ParseResult, c: Compiled, chk: CheckSpec, trailerIdx: number): number {
  let from = 0;
  let to = result.records.length - 1;
  if (chk.blockStart) {
    from = 0;
    for (let i = trailerIdx; i >= 0; i--) {
      if (result.records[i]!.type === chk.blockStart) {
        from = i;
        break;
      }
    }
    to = trailerIdx;
  }
  const targets = new Set(chk.targetRecords);
  let total = 0;
  for (let i = from; i <= to; i++) {
    const t = result.records[i]!.type;
    if (!t || !targets.has(t)) continue;
    if (chk.kind === 'count') total++;
    else total += numericValue(result, c, i, chk.targetField) ?? 0;
  }
  return Math.round(total * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Reconnaissance du type d'un fichier
// ---------------------------------------------------------------------------

/** Note de 0 à 1 : part des lignes reconnues par une règle explicite, pénalisée par les erreurs de champs. */
export function scoreSpec(spec: FileSpec, text: string, fileName = ''): number {
  const sample = splitLines(text).slice(0, 500).join('\n');
  let r: ParseResult;
  try {
    r = parseFile(spec, sample);
  } catch {
    return 0;
  }
  const n = r.records.length || 1;
  const explicit = r.records.filter((rec) => rec.type && (spec.recordTypes.find((t) => t.code === rec.type)?.match.length ?? 0) > 0).length;
  const fieldsRead = r.records.reduce((acc, rec) => acc + (rec.type ? spec.recordTypes.find((t) => t.code === rec.type)?.fields.length ?? 0 : 0), 0) || 1;
  let score = explicit / n - (r.fieldErrorCount / fieldsRead) * 2 - (r.unknown.length / n);
  if (spec.fileNamePattern && fileName && globMatch(spec.fileNamePattern, fileName)) score += 0.3;
  return Math.max(0, Math.min(1, score));
}

export function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(name);
}

// ---------------------------------------------------------------------------
// Diagnostic lisible (envoyé à l'IA pour qu'elle corrige la fiche)
// ---------------------------------------------------------------------------

export function diagnostics(result: ParseResult, maxChars = 40_000): string {
  const { spec, records } = result;
  const out: string[] = [];
  out.push(`Lignes : ${result.lineCount} (vides : ${result.emptyLines}) ; enregistrements reconnus : ${records.length - result.unknown.length} ; non reconnus : ${result.unknown.length}`);
  for (const rt of spec.recordTypes) out.push(`- [${rt.code}] ${rt.name} : ${result.byType.get(rt.code)?.length ?? 0} ligne(s)`);
  if (result.unknown.length) {
    out.push('', 'Lignes non reconnues (exemples) :');
    for (const idx of result.unknown.slice(0, 8)) out.push(`  l.${records[idx]!.line} «${records[idx]!.raw}»`);
  }
  if (result.fieldErrorCount) {
    out.push('', `Erreurs de conversion : ${result.fieldErrorCount}`);
    const seen = new Set<string>();
    for (const e of result.fieldErrors) {
      const rec = records[e.record]!;
      const k = `${rec.type}.${e.field}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const fv = readField(result, e.record, e.field);
      out.push(`  [${rec.type}] ${e.field} l.${rec.line} : ${e.message} — lu «${fv?.raw ?? ''}»`);
      if (seen.size >= 30) break;
    }
  }
  if (result.checks.length) {
    out.push('', 'Contrôles :');
    for (const ch of result.checks.slice(0, 20)) out.push(`  ${ch.ok ? 'OK' : 'ÉCHEC'} ${ch.label} (l.${ch.line}) : attendu ${ch.expected ?? '?'}, constaté ${ch.actual}`);
  }
  out.push('', 'Premier enregistrement décodé de chaque type :');
  for (const rt of spec.recordTypes) {
    const idx = result.byType.get(rt.code)?.[0];
    if (idx === undefined) continue;
    const { values } = readRecord(result, idx);
    out.push(`[${rt.code}] l.${records[idx]!.line} «${records[idx]!.raw}»`);
    rt.fields.slice(0, 80).forEach((f, i) => {
      const v = values[i]!;
      const pos = spec.format === 'fixed' ? `${f.start}-${f.start + f.length - 1}` : `col ${f.start}`;
      out.push(`  ${pos} ${f.key} (${f.type}${f.dateFormat ? ' ' + f.dateFormat : ''}${f.impliedDecimals ? ' ' + f.impliedDecimals + 'déc' : ''}) «${v.raw}»${v.error ? ' ⚠ ' + v.error : v.display && v.display !== v.raw.trim() ? ' → ' + v.display : ''}`);
    });
    if (out.join('\n').length > maxChars) break;
  }
  const text = out.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + '\n[…tronqué]' : text;
}

/** Vue compacte d'une fiche (une ligne par champ) : plus économique que le JSON pour l'IA. */
export function specToText(spec: FileSpec): string {
  const out: string[] = [];
  out.push(`format=${spec.format} encodage=${spec.encoding}${spec.format === 'delimited' ? ` séparateur=«${spec.delimiter}» guillemet=«${spec.quote}»` : ''} lignes_ignorées=${spec.skipLines} motif_nom=«${spec.fileNamePattern}»`);
  for (const rt of spec.recordTypes) {
    const match = rt.match.map((m) => `${m.start}${spec.format === 'fixed' ? '+' + m.length : ''}=«${m.value}»`).join(' & ') || '(par défaut)';
    out.push('', `## [${rt.code}] ${rt.name} — rôle=${rt.role} parent=${rt.parent ?? '-'} reconnaissance=${match}`);
    if (rt.description) out.push(`  ${rt.description}`);
    for (const f of rt.fields) {
      const pos = spec.format === 'fixed' ? `${f.start}+${f.length}` : `col${f.start}`;
      const extra = [f.dateFormat && `fmt=${f.dateFormat}`, f.impliedDecimals && `déc=${f.impliedDecimals}`, f.values.length && `valeurs=${f.values.map((v) => `${v.code}:${v.label}`).join(',')}`, f.hidden && 'masqué'].filter(Boolean).join(' ');
      out.push(`  ${pos} ${f.key} ${f.type} «${f.label}»${extra ? ' ' + extra : ''}`);
    }
  }
  if (spec.checks.length) {
    out.push('', '## Contrôles');
    for (const c of spec.checks) out.push(`  ${c.kind} «${c.label}» attendu=${c.expectedRecord}.${c.expectedField} cibles=${c.targetRecords.join(',')}${c.targetField ? '.' + c.targetField : ''} bloc=${c.blockStart ?? '-'}`);
  }
  return out.join('\n');
}
