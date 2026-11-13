/** Lecture d'un classeur Excel en texte (pour l'IA) et écriture d'un classeur simple (exports). Sans dépendance lourde. */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

const encodeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caractères de contrôle interdits en XML.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Texte d'un document Word (.docx) : un paragraphe par ligne, cellules de tableau séparées par « | ». */
export function docxToText(bytes: Uint8Array, maxChars = 400_000): string {
  const xml = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml'];
  if (!xml) throw new Error('Document Word illisible.');
  return decodeXml(
    strFromU8(xml)
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/w:p>\s*<\/w:tc>/g, ' | ')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ \| \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

/** Convertit chaque onglet en lignes « A | B | C » (lignes vides ignorées). */
export function xlsxToText(bytes: Uint8Array, maxChars = 400_000): { sheets: { name: string; text: string }[] } {
  const sheets: { name: string; text: string }[] = [];
  let total = 0;
  for (const sheet of readXlsx(bytes)) {
    const lines: string[] = [];
    for (const row of sheet.rows) {
      // Colonnes vides intermédiaires conservées (alignement des tableaux de spécification).
      const cells = row.map((v) => (v === null ? '' : String(v).replace(/\s*\n\s*/g, ' / ').trim()));
      if (cells.some((x) => x)) lines.push(cells.join(' | '));
    }
    const text = lines.join('\n');
    total += text.length;
    sheets.push({ name: sheet.name, text });
    if (total > maxChars) break;
  }
  return { sheets };
}

/**
 * Lit les cellules de chaque onglet : texte, nombre (les dates Excel sont des nombres de jours) ou null.
 * Chaque ligne est indexée par colonne (A = 0) ; les lignes entièrement vides sont ignorées.
 */
export function readXlsx(bytes: Uint8Array): { name: string; rows: CellValue[][] }[] {
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') });
  const read = (n: string) => (files[n] ? strFromU8(files[n]!) : '');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const workbook = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  const sheets: { name: string; rows: CellValue[][] }[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"/g)) {
    const name = decodeXml(m[1]!);
    const target = new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${m[2]}"`).exec(rels);
    const path = target ? 'xl/' + (target[1] ?? target[2])!.replace(/^\/?xl\//, '').replace(/^\.\//, '') : '';
    const xml = read(path);
    const rows: CellValue[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: CellValue[] = [];
      for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const inner = c[2] ?? '';
        const col = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let v: CellValue;
        if (type === 's') v = raw === undefined ? null : (shared[Number(raw)] ?? null);
        else if (type === 'inlineStr') v = decodeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (raw === undefined) v = null;
        else if (type === 'n') v = Number(raw);
        else v = decodeXml(raw);
        if (v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
        const idx = col ? colIndex(col) : cells.length;
        while (cells.length < idx) cells.push(null);
        cells[idx] = v;
      }
      if (cells.length) rows.push(cells);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

function colIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export type CellValue = string | number | null;

/** Écrit un classeur .xlsx (un onglet par tableau, première ligne en gras et figée). */
export function writeXlsx(sheets: { name: string; rows: CellValue[][] }[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => {
    let base = s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille';
    let n = base;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 28)} ${i}`;
    used.add(n.toLowerCase());
    return n;
  });
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${encodeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
  };
  sheets.forEach((s, i) => {
    const rows = s.rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) => {
              if (v === null || v === '') return '';
              const ref = `${colName(ci)}${ri + 1}`;
              const style = ri === 0 ? ' s="1"' : '';
              return typeof v === 'number' && Number.isFinite(v)
                ? `<c r="${ref}"${style}><v>${v}</v></c>`
                : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${encodeXml(String(v))}</t></is></c>`;
            })
            .join('')}</row>`,
      )
      .join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return zipSync(files, { level: 6 });
}
