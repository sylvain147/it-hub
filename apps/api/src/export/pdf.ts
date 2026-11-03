/** Export PDF : même mise en page que l'export Word (pdfmake, polices standard PDF, aucun fichier à embarquer). */
import { createRequire } from 'node:module';
import { sectionNumbers, type CdcDocument, type Language, type RichNode } from '@samm/shared';
import { COLORS, deadlineLines, estimateLine, fitImage, LABELS, phaseLine, type ExportLabels, type LoadedImage } from './common.js';

// pdfmake est un module CommonJS sans types pour son API serveur 0.3.
interface PdfMake {
  setFonts(fonts: unknown): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (path: string) => boolean): void;
  createPdf(def: unknown): { getBuffer(): Promise<Buffer> };
}
const require = createRequire(import.meta.url);
const STANDARD_FONTS = new Set(['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']);
let pdfmake: PdfMake | null = null;
function engine(): PdfMake {
  if (!pdfmake) {
    pdfmake = require('pdfmake') as PdfMake;
    pdfmake.setFonts({ Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' }, Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' } });
    // Aucune ressource externe ni fichier local, hormis les polices standard PDF : les images sont fournies en mémoire.
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));
  }
  return pdfmake;
}

type Content = Record<string, unknown> | string | Content[];

interface Ctx {
  images: Map<string, LoadedImage>;
  labels: ExportLabels;
  sectionNumber: number | null;
  sub: number;
}

/** Largeur utile en points (A4 = 595 pt, marges 55 pt). */
const CONTENT_WIDTH_PT = 485;
const hex = (c: string) => `#${c}`;

export async function renderPdf(doc: CdcDocument, versionLabel: string, lang: Language, images: Map<string, LoadedImage>): Promise<Buffer> {
  const labels = LABELS[lang];
  const ctx: Ctx = { images, labels, sectionNumber: null, sub: 0 };
  const numbers = sectionNumbers(doc.sections);
  const content: Content[] = [
    { text: labels.heading, bold: true, color: hex(COLORS.heading), fontSize: 20, margin: [0, 0, 0, 2] },
    { text: doc.meta.title, italics: true, color: hex(COLORS.subtitle), fontSize: 13, margin: [0, 0, 0, 15] },
    headerTable(doc, versionLabel, labels),
  ];
  doc.sections.forEach((section, i) => {
    ctx.sectionNumber = numbers[i] ?? null;
    ctx.sub = 0;
    const title = ctx.sectionNumber != null ? `${ctx.sectionNumber}. ${section.title}` : section.title.toUpperCase();
    content.push({ text: title, style: 'h1' });
    content.push(...blocks(section.content.content ?? [], ctx));
  });

  const def = {
    pageSize: 'A4',
    pageMargins: [55, 50, 55, 50],
    info: { title: doc.meta.title, creator: 'Hub IT' },
    defaultStyle: { font: 'Times', fontSize: 11, lineHeight: 1.15 },
    styles: {
      h1: { fontSize: 16, color: hex(COLORS.h1), margin: [0, 16, 0, 6] },
      h2: { fontSize: 13, color: hex(COLORS.h1), margin: [0, 10, 0, 4] },
      h3: { fontSize: 12, color: hex(COLORS.h3), margin: [0, 8, 0, 3] },
      p: { margin: [0, 0, 0, 5] },
    },
    footer: (page: number, pages: number) => ({
      text: `${doc.meta.title} – v${versionLabel} – ${labels.page} ${page} ${labels.of} ${pages}`,
      alignment: 'right',
      fontSize: 9,
      color: '#7F7F7F',
      margin: [55, 15, 55, 0],
    }),
    content,
  };
  return engine().createPdf(def).getBuffer();
}

function headerTable(doc: CdcDocument, versionLabel: string, l: ExportLabels): Content {
  const label = (text: string) => ({ text, bold: true, color: 'white', fillColor: hex(COLORS.heading), fontSize: 10.5, margin: [4, 6, 4, 6] });
  const value = (c: Content) => ({ stack: [c], fontSize: 10.5, margin: [4, 6, 4, 6] });
  const deadlines = deadlineLines(doc, l);
  return {
    table: {
      widths: [140, '*'],
      body: [
        [label(l.version), value(`${l.version} ${versionLabel}`)],
        [label(l.deadline), value(deadlines.length > 1 ? { ul: deadlines } : deadlines[0]!)],
        [label(l.status), value(phaseLine(doc, l))],
        [label(l.estimate), value(estimateLine(doc, l))],
      ],
    },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000000', vLineColor: () => '#000000' },
    margin: [0, 0, 0, 10],
  };
}

function blocks(nodes: RichNode[], ctx: Ctx): Content[] {
  return nodes.flatMap((n) => block(n, ctx));
}

function block(n: RichNode, ctx: Ctx): Content[] {
  switch (n.type) {
    case 'paragraph': {
      const text = inline(n.content ?? [], ctx);
      return [{ text: text.length ? text : ' ', style: 'p' }];
    }
    case 'heading': {
      const level = Number(n.attrs?.level ?? 2);
      if (level <= 2) {
        ctx.sub += 1;
        const prefix = ctx.sectionNumber != null ? `${ctx.sectionNumber}.${ctx.sub} ` : '';
        return [{ text: [prefix, ...inline(n.content ?? [], ctx)], style: 'h2' }];
      }
      return [{ text: inline(n.content ?? [], ctx), style: 'h3' }];
    }
    case 'bulletList':
    case 'orderedList':
      return [list(n, ctx)];
    case 'blockquote':
      return [{ stack: blocks(n.content ?? [], ctx), italics: true, margin: [16, 0, 0, 5], color: '#404040' }];
    case 'codeBlock':
      return [{ text: (n.content ?? []).map((c) => c.text ?? '').join(''), font: 'Courier', fontSize: 9.5, margin: [0, 0, 0, 5], preserveLeadingSpaces: true }];
    case 'horizontalRule':
      return [{ canvas: [{ type: 'line', x1: 0, y1: 4, x2: CONTENT_WIDTH_PT, y2: 4, lineWidth: 0.5, lineColor: '#BFBFBF' }], margin: [0, 2, 0, 8] }];
    case 'image':
      return [image(n, ctx)];
    case 'table':
      return [table(n, ctx)];
    default:
      return n.content ? blocks(n.content, ctx) : [];
  }
}

function list(n: RichNode, ctx: Ctx): Content {
  const items = (n.content ?? []).map((item) => {
    const parts = blocks(item.content ?? [], ctx).map((c) => (typeof c === 'object' && !Array.isArray(c) && c.style === 'p' ? { ...c, margin: [0, 0, 0, 2] } : c));
    return parts.length === 1 ? parts[0]! : { stack: parts };
  });
  if (n.type === 'orderedList') return { ol: items, start: Number(n.attrs?.start ?? 1), margin: [10, 0, 0, 5] };
  return { ul: items, margin: [10, 0, 0, 5] };
}

function table(n: RichNode, ctx: Ctx): Content {
  const rows = n.content ?? [];
  const cols = Math.max(1, ...rows.map((r) => r.content?.length ?? 0));
  const headerRows = rows[0]?.content?.every((c) => c.type === 'tableHeader') ? 1 : 0;
  return {
    table: {
      headerRows,
      widths: Array(cols).fill('*'),
      body: rows.map((r) =>
        Array.from({ length: cols }, (_, i) => {
          const cell = r.content?.[i];
          const isHeader = cell?.type === 'tableHeader';
          return {
            stack: cell ? blocks(cell.content ?? [], ctx) : [''],
            bold: isHeader,
            fillColor: isHeader ? hex(COLORS.tableHeader) : undefined,
            fontSize: 10,
          };
        }),
      ),
    },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#808080', vLineColor: () => '#808080' },
    margin: [0, 2, 0, 8],
  };
}

function image(n: RichNode, ctx: Ctx): Content {
  const img = ctx.images.get(String(n.attrs?.src ?? ''));
  if (!img) return { text: ctx.labels.missingImage, italics: true, color: '#7F7F7F' };
  // 1 px (96 dpi) = 0,75 pt
  const { width } = fitImage(img, CONTENT_WIDTH_PT / 0.75, 950);
  const picture = {
    image: `data:image/${img.type === 'jpg' ? 'jpeg' : 'png'};base64,${img.data.toString('base64')}`,
    width: width * 0.75,
    alignment: 'center',
    margin: [0, 6, 0, 6],
  };
  const caption = n.attrs?.alt ? String(n.attrs.alt) : '';
  if (!caption) return picture;
  return { stack: [{ ...picture, margin: [0, 6, 0, 2] }, { text: caption, italics: true, fontSize: 9, color: '#595959', alignment: 'center', margin: [0, 0, 0, 6] }], unbreakable: true };
}

function inline(nodes: RichNode[], ctx: Ctx): Content[] {
  const out: Content[] = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') out.push('\n');
    else if (n.type === 'image') out.push(ctx.labels.missingImage);
    else if (n.type === 'text' && n.text) {
      const marks = n.marks ?? [];
      const has = (t: string) => marks.some((m) => m.type === t);
      const link = marks.find((m) => m.type === 'link');
      out.push({
        text: n.text,
        bold: has('bold') || undefined,
        italics: has('italic') || undefined,
        decoration: has('strike') ? 'lineThrough' : has('underline') || link ? 'underline' : undefined,
        font: has('code') ? 'Courier' : undefined,
        color: link ? '#0563C1' : undefined,
        link: typeof link?.attrs?.href === 'string' ? link.attrs.href : undefined,
      });
    }
  }
  return out;
}
