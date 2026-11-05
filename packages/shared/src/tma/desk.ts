/**
 * Export des tickets du prestataire (Desk365, CSV). Lu dans le navigateur : seules les colonnes utiles sont
 * conservées, descriptions et sujets masqués (`maskPersonalData`) ; e-mails des demandeurs et colonnes
 * sans intérêt ne quittent pas le poste.
 */
import { maskPersonalData, namesToMask } from './mask.js';

export interface DeskTicket {
  /** Numéro du ticket Desk (celui que reprend le champ « Réf Ticket Desk » de Jira). */
  id: string;
  subject: string;
  description: string;
  /** Date de création, AAAA-MM-JJTHH:mm (heure locale de l'export). */
  createdAt: string;
  requester: string;
  assignee: string;
  category: string;
  priority: string;
  status: string;
  product: string;
  cause: string;
  entity: string;
}

/** Longueur maximale conservée pour une description (les fils de discussion très longs sont tronqués). */
export const MAX_DESCRIPTION_CHARS = 4000;

/** Découpe un CSV complet (guillemets doublés, retours à la ligne dans les champs). */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const sep = delimiter ?? ([';', ',', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === sep) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Colonnes reconnues (noms d'en-tête normalisés possibles). */
const COLUMNS: Record<keyof DeskTicket, string[]> = {
  id: ['ticket number', 'numero', 'numero du ticket', 'ticket id', 'id'],
  subject: ['sujet', 'subject', 'objet'],
  description: ['description'],
  createdAt: ['created time', 'date de creation', 'cree le', 'created'],
  requester: ['contact name', 'demandeur', 'contact'],
  assignee: ['assign to', 'assigned to', 'assigne a', 'assigne'],
  category: ['category', 'categorie'],
  priority: ['priorite', 'priority'],
  status: ['statut', 'status'],
  product: ['produit', 'product'],
  cause: ['cause'],
  entity: ['entite magasin', 'entite', 'magasin'],
};

/** « 09/10/2026 08:34 AM » (jour en premier) ou « 2026-10-09 08:34 » → « 2026-10-09T08:34 ». */
export function parseDeskDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?$/i.exec(t);
  if (m) {
    let h = Number(m[4] ?? 0);
    if (m[6]) h = (h % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
    return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[5] ?? '00'}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}`;
  return null;
}

export interface DeskImport {
  tickets: DeskTicket[];
  /** Lignes ignorées (numéro ou date illisible). */
  skipped: number;
  /** Colonnes de l'export non reprises (pour information). */
  ignoredColumns: string[];
}

/** Lit un export CSV de tickets Desk et masque les données personnelles. */
export function parseDeskExport(text: string): DeskImport {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map(norm);
  const index = {} as Record<keyof DeskTicket, number>;
  for (const [key, names] of Object.entries(COLUMNS) as [keyof DeskTicket, string[]][]) {
    index[key] = names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  }
  const missing = (['id', 'subject', 'createdAt'] as const).filter((k) => index[k] < 0);
  if (missing.length) {
    throw new Error('Ce fichier ne ressemble pas à un export de tickets Desk : colonnes « Ticket Number », « Sujet » et « Created Time » attendues.');
  }
  const used = new Set(Object.values(index));
  const ignoredColumns = (rows[0] ?? []).filter((_, i) => !used.has(i));
  const cell = (r: string[], k: keyof DeskTicket) => (index[k] >= 0 ? (r[index[k]] ?? '').trim() : '');
  const body = rows.slice(1);
  // Les demandeurs sont connus : leurs noms (et prénoms, souvent en signature) sont retirés des textes.
  const names = namesToMask(new Set(body.map((r) => cell(r, 'requester')).filter(Boolean)));
  const tickets: DeskTicket[] = [];
  let skipped = 0;
  for (const r of body) {
    const id = cell(r, 'id').replace(/^#/, '');
    const createdAt = parseDeskDate(cell(r, 'createdAt'));
    if (!/^\d+$/.test(id) || !createdAt) {
      skipped++;
      continue;
    }
    const description = cell(r, 'description').replace(/^"+|"+$/g, '').trim();
    tickets.push({
      id,
      subject: maskPersonalData(cell(r, 'subject'), names),
      description: maskPersonalData(description, names).slice(0, MAX_DESCRIPTION_CHARS),
      createdAt,
      requester: cell(r, 'requester'),
      assignee: cell(r, 'assignee'),
      category: cell(r, 'category'),
      priority: cell(r, 'priority'),
      status: cell(r, 'status'),
      product: cell(r, 'product'),
      cause: cell(r, 'cause'),
      entity: cell(r, 'entity'),
    });
  }
  return { tickets, skipped, ignoredColumns };
}
