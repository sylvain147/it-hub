/**
 * Reconstitution d'un tableau à partir du texte d'un PDF (export « Imprimer en PDF » d'un classeur Excel).
 * Le PDF ne garde que des morceaux de texte positionnés : les lignes du tableau se retrouvent par les bandes
 * horizontales sans texte qui les séparent, les colonnes par les bandes verticales sans texte, et chaque ligne
 * de données par sa « clé » (la date pour un relevé TMA). Les cellules sur plusieurs lignes sont recollées.
 * Indépendant de pdf.js : le navigateur fournit les morceaux (`pdfTextItems`).
 */

/** Morceau de texte d'une page : `x`, `y` = début de la ligne de base (repère PDF, `y` vers le haut). */
export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  str: string;
}

/** Sous-ensemble de l'API de pdf.js utilisé (document ouvert par `getDocument(...).promise`). */
export interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: ({ str: string; transform: number[]; width: number; height: number } | object)[] }>;
  }>;
}

/** Extrait les morceaux de texte de toutes les pages d'un document pdf.js. */
export async function pdfTextItems(doc: PdfJsDocument): Promise<PdfTextItem[]> {
  const out: PdfTextItem[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const { items } = await (await doc.getPage(page)).getTextContent();
    for (const it of items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const [, , c = 0, d = 0, x = 0, y = 0] = it.transform;
      out.push({ page, x, y, width: it.width, height: it.height || Math.hypot(c, d) || 10, str: it.str });
    }
  }
  return out;
}

const top = (i: PdfTextItem) => i.y + 0.85 * i.height;
const bottom = (i: PdfTextItem) => i.y - 0.25 * i.height;
const center = (i: PdfTextItem) => i.x + i.width / 2;

/** Découpe une page en blocs séparés par une bande horizontale sans texte. */
function blocks(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => top(b) - top(a));
  const out: PdfTextItem[][] = [];
  let low = Infinity;
  for (const it of sorted) {
    // Interligne d'une cellule : environ 0,1 × la hauteur du texte ; entre deux lignes du tableau : marges + bordure.
    if (!out.length || top(it) < low - 0.4 * it.height) {
      out.push([]);
      low = Infinity;
    }
    out.at(-1)!.push(it);
    low = Math.min(low, bottom(it));
  }
  return out;
}

/** Limites gauches des colonnes : milieux des bandes verticales sans texte. */
function columnStarts(items: PdfTextItem[]): number[] {
  const spans = items.map((i) => [i.x, i.x + i.width] as const).sort((a, b) => a[0] - b[0]);
  const starts = [-Infinity];
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (end > -Infinity && a > end + 0.5) starts.push((end + a) / 2);
    end = Math.max(end, b);
  }
  return starts;
}

/** Plus grande bande horizontale sans texte entre `hi` et `lo` (sinon le milieu). */
function cutBetween(items: PdfTextItem[], hi: number, lo: number): number {
  const inside = items.filter((i) => top(i) > lo && bottom(i) < hi).sort((a, b) => top(b) - top(a));
  let best = { gap: -Infinity, at: (hi + lo) / 2 };
  let low = hi;
  for (const it of inside) {
    if (low - top(it) > best.gap && top(it) < low) best = { gap: low - top(it), at: (low + top(it)) / 2 };
    low = Math.min(low, bottom(it));
  }
  if (low - lo > best.gap && low > lo) best = { gap: low - lo, at: (low + lo) / 2 };
  return best.at;
}

/** Recolle le texte d'une cellule, de haut en bas puis de gauche à droite. */
function cellText(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) < 0.3 * a.height ? a.x - b.x : b.y - a.y));
  let text = '';
  sorted.forEach((it, k) => {
    const prev = sorted[k - 1];
    const glued = prev && Math.abs(prev.y - it.y) < 0.3 * it.height && it.x - (prev.x + prev.width) < 0.15 * it.height;
    text += (k && !glued ? ' ' : '') + it.str.trim();
  });
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Lignes du tableau (en-têtes et totaux compris, dans l'ordre du document), une cellule par colonne.
 * `isKey` reconnaît la valeur présente une fois par ligne de données (sert à séparer des lignes trop serrées).
 */
export function pdfTableRows(items: PdfTextItem[], isKey: (s: string) => boolean): string[][] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const allBlocks = pages.flatMap((p) => blocks(items.filter((i) => i.page === p)));
  const dataBlocks = allBlocks.filter((b) => b.some((i) => isKey(i.str.trim())));
  if (!dataBlocks.length) return [];
  // Colonnes calculées sur le cœur des lignes de données, entre la première et la dernière clé de chaque bloc
  // (un en-tête collé au tableau, centré et plus large que sa colonne, fausserait les bandes vides).
  const core = dataBlocks.flatMap((b) => {
    const k = b.filter((i) => isKey(i.str.trim()));
    const hi = Math.max(...k.map(top));
    const lo = Math.min(...k.map(bottom));
    return b.filter((i) => i.y <= hi && i.y >= lo);
  });
  const starts = columnStarts(core);
  const colOf = (i: PdfTextItem) => {
    let c = 0;
    while (c + 1 < starts.length && starts[c + 1]! <= center(i)) c++;
    return c;
  };
  // Colonne de la clé : celle où on la trouve le plus souvent (une date peut aussi figurer dans un commentaire).
  const keys = dataBlocks.flat().filter((i) => isKey(i.str.trim()));
  const counts = new Map<number, number>();
  for (const k of keys) counts.set(colOf(k), (counts.get(colOf(k)) ?? 0) + 1);
  const keyCol = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  const toRow = (cells: PdfTextItem[]) => starts.map((_, c) => cellText(cells.filter((i) => colOf(i) === c)));
  const rows: string[][] = [];
  for (const block of allBlocks) {
    const anchors = block.filter((i) => colOf(i) === keyCol && isKey(i.str.trim())).sort((a, b) => b.y - a.y);
    if (anchors.length <= 1) {
      rows.push(toRow(block));
      continue;
    }
    // Plusieurs lignes de données collées : coupe entre deux clés successives, là où le blanc est le plus grand.
    const cuts = anchors.slice(1).map((a, k) => cutBetween(block, anchors[k]!.y, a.y));
    const parts: PdfTextItem[][] = anchors.map(() => []);
    for (const it of block) parts[cuts.filter((c) => it.y < c).length]!.push(it);
    rows.push(...parts.map(toRow));
  }
  return rows;
}
