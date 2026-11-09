/** Export Word, fidèle au modèle de CDC de l'équipe (couleurs, titres, tableau d'en-tête). */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import { markdownToDoc, sectionNumbers, type CdcDocument, type Language, type RichNode } from '@samm/shared';
import { COLORS, deadlineLines, estimateLine, fitImage, LABELS, phaseLine, type ExportLabels, type LoadedImage } from './common.js';

const FONT = 'Times New Roman';
/** Largeur utile de la page A4 avec les marges du modèle, en pixels à 96 dpi. */
const CONTENT_WIDTH_PX = 640;

interface Ctx {
  images: Map<string, LoadedImage>;
  labels: ExportLabels;
  sectionNumber: number | null;
  sub: number;
  listInstance: number;
}

type Block = Paragraph | Table;

export async function renderDocx(doc: CdcDocument, versionLabel: string, lang: Language, images: Map<string, LoadedImage>): Promise<Buffer> {
  const labels = LABELS[lang];
  const ctx: Ctx = { images, labels, sectionNumber: null, sub: 0, listInstance: 0 };
  const numbers = sectionNumbers(doc.sections);

  const children: Block[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: labels.heading, bold: true, color: COLORS.heading, size: 40, font: FONT })],
    }),
    new Paragraph({
      spacing: { after: 300 },
      children: [new TextRun({ text: doc.meta.title, italics: true, color: COLORS.subtitle, size: 26, font: FONT })],
    }),
    headerTable(doc, versionLabel, labels),
  ];

  doc.sections.forEach((section, i) => {
    ctx.sectionNumber = numbers[i] ?? null;
    ctx.sub = 0;
    const title = ctx.sectionNumber != null ? `${ctx.sectionNumber}. ${section.title}` : section.title.toUpperCase();
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 }, children: [new TextRun({ text: title })] }));
    children.push(...blocks(section.content.content ?? [], ctx, 0));
  });

  return pack(doc.meta.title, [`${doc.meta.title} – v${versionLabel} – ${labels.page} `, PageNumber.CURRENT, ` ${labels.of} `, PageNumber.TOTAL_PAGES], children);
}

/** Document Word simple à partir de Markdown (documents de sprint…), avec la même mise en forme que les CDC. */
export async function renderMarkdownDocx(title: string, subtitle: string, markdown: string): Promise<Buffer> {
  const labels = LABELS.fr;
  const ctx: Ctx = { images: new Map(), labels, sectionNumber: null, sub: 0, listInstance: 0 };
  const children: Block[] = [
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: title, bold: true, color: COLORS.heading, size: 36, font: FONT })] }),
    new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: subtitle, italics: true, color: COLORS.subtitle, size: 24, font: FONT })] }),
    ...blocks(markdownToDoc(markdown).content ?? [], ctx, 0),
  ];
  return pack(title, [`${title} – ${labels.page} `, PageNumber.CURRENT, ` ${labels.of} `, PageNumber.TOTAL_PAGES], children);
}

async function pack(title: string, footer: (string | (typeof PageNumber)[keyof typeof PageNumber])[], children: Block[]): Promise<Buffer> {
  const document = new Document({
    creator: 'Hobbit',
    title,
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 100, line: 264 } } },
        heading1: { run: { font: FONT, size: 32, color: COLORS.h1 }, paragraph: { keepNext: true } },
        heading2: { run: { font: FONT, size: 26, color: COLORS.h1 }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
        heading3: { run: { font: FONT, size: 24, color: COLORS.h3 }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
        hyperlink: { run: { color: '0563C1', underline: {} } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ['•', '◦', '▪', '•'][level]!,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
        {
          reference: 'ordered',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL][level]!,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, right: 1100, bottom: 1000, left: 1100 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    size: 18,
                    color: '7F7F7F',
                    children: footer,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

function headerTable(doc: CdcDocument, versionLabel: string, l: ExportLabels): Table {
  const deadlines = deadlineLines(doc, l);
  const row = (label: string, values: Paragraph[]) =>
    new TableRow({
      height: { value: 523, rule: 'atLeast' },
      children: [
        new TableCell({
          width: { size: 2800, type: WidthType.DXA },
          shading: { fill: COLORS.heading, type: ShadingType.CLEAR, color: 'auto' },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', size: 21 })] })],
        }),
        new TableCell({
          width: { size: 6550, type: WidthType.DXA },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: values,
        }),
      ],
    });
  const value = (text: string, bullet = false) =>
    new Paragraph({
      spacing: { after: 40 },
      numbering: bullet ? { reference: 'bullets', level: 0 } : undefined,
      children: [new TextRun({ text, size: 21 })],
    });
  return new Table({
    width: { size: 9350, type: WidthType.DXA },
    columnWidths: [2800, 6550],
    rows: [
      row(l.version, [value(`${l.version} ${versionLabel}`)]),
      row(l.deadline, deadlines.length > 1 ? deadlines.map((d) => value(d, true)) : [value(deadlines[0]!)]),
      row(l.status, [value(phaseLine(doc, l))]),
      row(l.estimate, [value(estimateLine(doc, l))]),
    ],
  });
}

function blocks(nodes: RichNode[], ctx: Ctx, listDepth: number): Block[] {
  return nodes.flatMap((n) => block(n, ctx, listDepth));
}

function block(n: RichNode, ctx: Ctx, listDepth: number): Block[] {
  switch (n.type) {
    case 'paragraph':
      return [new Paragraph({ children: inline(n.content ?? [], ctx) })];
    case 'heading': {
      const level = Number(n.attrs?.level ?? 2);
      if (level <= 2) {
        ctx.sub += 1;
        const prefix = ctx.sectionNumber != null ? `${ctx.sectionNumber}.${ctx.sub} ` : '';
        return [new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(prefix), ...inline(n.content ?? [], ctx)] })];
      }
      return [new Paragraph({ heading: HeadingLevel.HEADING_3, children: inline(n.content ?? [], ctx) })];
    }
    case 'bulletList':
    case 'orderedList':
      return list(n, ctx, listDepth);
    case 'blockquote':
      return (n.content ?? []).flatMap((c) =>
        c.type === 'paragraph'
          ? [
              new Paragraph({
                indent: { left: 567 },
                border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BFBFBF', space: 8 } },
                children: inline(c.content ?? [], ctx, { italics: true }),
              }),
            ]
          : block(c, ctx, listDepth),
      );
    case 'codeBlock':
      return (n.content ?? [])
        .map((c) => c.text ?? '')
        .join('')
        .split('\n')
        .map((line) => new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: line, font: 'Courier New', size: 19 })] }));
    case 'horizontalRule':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } }, children: [] })];
    case 'image':
      return [imageParagraph(n, ctx)];
    case 'table':
      return [table(n, ctx), new Paragraph({ children: [] })];
    default:
      return n.content ? blocks(n.content, ctx, listDepth) : [];
  }
}

function list(n: RichNode, ctx: Ctx, depth: number): Block[] {
  const ordered = n.type === 'orderedList';
  const instance = ordered ? ++ctx.listInstance : 0;
  const level = Math.min(depth, 3);
  const out: Block[] = [];
  for (const item of n.content ?? []) {
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph' && first) {
        out.push(
          new Paragraph({
            spacing: { after: 60 },
            numbering: ordered ? { reference: 'ordered', level, instance } : { reference: 'bullets', level },
            children: inline(child.content ?? [], ctx),
          }),
        );
        first = false;
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...list(child, ctx, depth + 1));
      } else if (child.type === 'paragraph') {
        out.push(new Paragraph({ indent: { left: 720 + level * 360 }, spacing: { after: 60 }, children: inline(child.content ?? [], ctx) }));
      } else {
        out.push(...block(child, ctx, depth + 1));
      }
    }
  }
  return out;
}

function table(n: RichNode, ctx: Ctx): Table {
  const rows = n.content ?? [];
  const cols = Math.max(1, ...rows.map((r) => r.content?.length ?? 0));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (r) =>
        new TableRow({
          tableHeader: r.content?.every((c) => c.type === 'tableHeader') ?? false,
          children: Array.from({ length: cols }, (_, i) => {
            const cell = r.content?.[i];
            const isHeader = cell?.type === 'tableHeader';
            const content = cell ? blocks(cell.content ?? [], ctx, 0).filter((b): b is Paragraph => b instanceof Paragraph) : [];
            return new TableCell({
              shading: isHeader ? { fill: COLORS.tableHeader, type: ShadingType.CLEAR, color: 'auto' } : undefined,
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              children: content.length
                ? isHeader
                  ? (cell?.content ?? []).map((p) => new Paragraph({ spacing: { after: 0 }, children: inline(p.content ?? [], ctx, { bold: true }) }))
                  : content
                : [new Paragraph({ children: [] })],
            });
          }),
        }),
    ),
  });
}

function imageParagraph(n: RichNode, ctx: Ctx): Paragraph {
  const img = ctx.images.get(String(n.attrs?.src ?? ''));
  if (!img) return new Paragraph({ children: [new TextRun({ text: ctx.labels.missingImage, italics: true, color: '7F7F7F' })] });
  const { width, height } = fitImage(img, CONTENT_WIDTH_PX);
  const caption = n.attrs?.alt ? String(n.attrs.alt) : '';
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new ImageRun({ type: img.type, data: img.data, transformation: { width, height }, altText: caption ? { name: caption, description: caption, title: caption } : undefined }),
      ...(caption ? [new TextRun({ text: caption, italics: true, size: 18, color: '595959', break: 1 })] : []),
    ],
  });
}

function inline(nodes: RichNode[], ctx: Ctx, base: IRunOptions = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      out.push(new TextRun({ ...base, break: 1 }));
      continue;
    }
    if (n.type === 'image') {
      const img = ctx.images.get(String(n.attrs?.src ?? ''));
      if (img) out.push(new ImageRun({ type: img.type, data: img.data, transformation: fitImage(img, CONTENT_WIDTH_PX) }));
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const marks = n.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    const opts: IRunOptions = {
      ...base,
      text: n.text,
      bold: has('bold') || base.bold,
      italics: has('italic') || base.italics,
      strike: has('strike'),
      underline: has('underline') ? {} : undefined,
      font: has('code') ? 'Courier New' : undefined,
    };
    const link = marks.find((m) => m.type === 'link');
    if (link && typeof link.attrs?.href === 'string') {
      out.push(new ExternalHyperlink({ link: link.attrs.href, children: [new TextRun({ ...opts, style: 'Hyperlink' })] }));
    } else out.push(new TextRun(opts));
  }
  return out;
}
