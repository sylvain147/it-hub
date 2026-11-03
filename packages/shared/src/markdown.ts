/**
 * Conversion Markdown <-> contenu riche (ProseMirror/TipTap JSON).
 *
 * L'IA lit et écrit du Markdown : c'est 3 à 5 fois moins de tokens que le JSON
 * de l'éditeur. Les images sont conservées sous la forme `![alt](asset:…)`.
 */
import { Lexer, type Token, type Tokens } from 'marked';
import type { RichDoc, RichNode } from './cdc.js';

type Mark = NonNullable<RichNode['marks']>[number];

// ---------------------------------------------------------------------------
// Markdown -> riche
// ---------------------------------------------------------------------------

export function markdownToDoc(md: string): RichDoc {
  const tokens = new Lexer({ gfm: true }).lex(md.replace(/\r\n/g, '\n'));
  const content = blocks(tokens);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function blocks(tokens: Token[]): RichNode[] {
  const out: RichNode[] = [];
  for (const t of tokens) out.push(...block(t));
  return out;
}

function block(t: Token): RichNode[] {
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      // Dans une section, « ## » = sous-section (3.1), « ### » = sous-sous-section.
      const level = Math.min(Math.max(h.depth, 2), 3);
      return [{ type: 'heading', attrs: { level }, content: inline(h.tokens) }];
    }
    case 'paragraph': {
      const p = t as Tokens.Paragraph;
      return paragraphOrImages(inline(p.tokens));
    }
    case 'text': {
      const tx = t as Tokens.Text;
      return paragraphOrImages(tx.tokens ? inline(tx.tokens) : textNodes(tx.text, []));
    }
    case 'list': {
      const l = t as Tokens.List;
      const items = l.items.map((it) => {
        const content = blocks(it.tokens);
        return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] };
      });
      if (l.ordered) {
        const start = typeof l.start === 'number' ? l.start : 1;
        return [{ type: 'orderedList', attrs: { start }, content: items }];
      }
      return [{ type: 'bulletList', content: items }];
    }
    case 'blockquote': {
      const q = t as Tokens.Blockquote;
      return [{ type: 'blockquote', content: blocks(q.tokens) }];
    }
    case 'code': {
      const c = t as Tokens.Code;
      return [{ type: 'codeBlock', content: c.text ? [{ type: 'text', text: c.text }] : [] }];
    }
    case 'hr':
      return [{ type: 'horizontalRule' }];
    case 'table': {
      const tb = t as Tokens.Table;
      const row = (cells: Tokens.TableCell[], header: boolean): RichNode => ({
        type: 'tableRow',
        content: cells.map((c) => ({
          type: header ? 'tableHeader' : 'tableCell',
          content: [cellParagraph(inline(c.tokens))],
        })),
      });
      return [{ type: 'table', content: [row(tb.header, true), ...tb.rows.map((r) => row(r, false))] }];
    }
    case 'html': {
      const h = t as Tokens.HTML;
      const text = h.text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      return text ? [{ type: 'paragraph', content: textNodes(text, []) }] : [];
    }
    case 'space':
    case 'def':
      return [];
    default: {
      const raw = (t as { raw?: string }).raw?.trim();
      return raw ? [{ type: 'paragraph', content: textNodes(raw, []) }] : [];
    }
  }
}

/** Les images sont des blocs dans l'éditeur : on les sort des paragraphes. */
function paragraphOrImages(nodes: RichNode[]): RichNode[] {
  if (!nodes.some((n) => n.type === 'image')) return nodes.length ? [{ type: 'paragraph', content: nodes }] : [];
  const out: RichNode[] = [];
  let buf: RichNode[] = [];
  const flush = () => {
    if (buf.some((n) => n.type !== 'hardBreak' && (n.type !== 'text' || n.text?.trim()))) {
      out.push({ type: 'paragraph', content: buf });
    }
    buf = [];
  };
  for (const n of nodes) {
    if (n.type === 'image') {
      flush();
      out.push(n);
    } else buf.push(n);
  }
  flush();
  return out;
}

function cellParagraph(nodes: RichNode[]): RichNode {
  const content = nodes.filter((n) => n.type !== 'image');
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function inline(tokens: Token[] | undefined, marks: Mark[] = []): RichNode[] {
  const out: RichNode[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'text': {
        const tx = t as Tokens.Text;
        if (tx.tokens?.length) out.push(...inline(tx.tokens, marks));
        else out.push(...textNodes(tx.text, marks));
        break;
      }
      case 'escape':
        out.push(...textNodes((t as Tokens.Escape).text, marks));
        break;
      case 'strong':
        out.push(...inline((t as Tokens.Strong).tokens, [...marks, { type: 'bold' }]));
        break;
      case 'em':
        out.push(...inline((t as Tokens.Em).tokens, [...marks, { type: 'italic' }]));
        break;
      case 'del':
        out.push(...inline((t as Tokens.Del).tokens, [...marks, { type: 'strike' }]));
        break;
      case 'codespan':
        out.push(...textNodes(decodeEntities((t as Tokens.Codespan).text), [...marks, { type: 'code' }]));
        break;
      case 'link': {
        const l = t as Tokens.Link;
        out.push(...inline(l.tokens, [...marks, { type: 'link', attrs: { href: l.href } }]));
        break;
      }
      case 'image': {
        const im = t as Tokens.Image;
        out.push({ type: 'image', attrs: { src: im.href, alt: im.text || null, title: im.title || null } });
        break;
      }
      case 'br':
        out.push({ type: 'hardBreak' });
        break;
      case 'html': {
        const raw = (t as Tokens.Tag).raw;
        if (/^<br\s*\/?>$/i.test(raw)) out.push({ type: 'hardBreak' });
        else if (/^<\/?u>$/i.test(raw)) {
          /* soulignement : ignoré */
        } else out.push(...textNodes(raw, marks));
        break;
      }
      default: {
        const raw = (t as { raw?: string }).raw;
        if (raw) out.push(...textNodes(raw, marks));
      }
    }
  }
  return mergeText(out);
}

function textNodes(text: string, marks: Mark[]): RichNode[] {
  const decoded = decodeEntities(text);
  const parts = decoded.split('\n');
  const out: RichNode[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (p) out.push(marks.length ? { type: 'text', text: p, marks: [...marks] } : { type: 'text', text: p });
  });
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function sameMarks(a: Mark[] = [], b: Mark[] = []): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeText(nodes: RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  for (const n of nodes) {
    const prev = out.at(-1);
    if (prev && prev.type === 'text' && n.type === 'text' && sameMarks(prev.marks, n.marks)) {
      prev.text = (prev.text ?? '') + (n.text ?? '');
    } else out.push({ ...n });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Riche -> Markdown
// ---------------------------------------------------------------------------

export function docToMarkdown(doc: RichNode): string {
  return blocksToMd(doc.content ?? [], '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function blocksToMd(nodes: RichNode[], indent: string): string {
  return nodes.map((n) => blockToMd(n, indent)).filter((s) => s !== '').join('\n\n');
}

function blockToMd(n: RichNode, indent: string): string {
  switch (n.type) {
    case 'paragraph':
      return indentLines(inlineToMd(n.content ?? []), indent);
    case 'heading': {
      const level = Math.min(Math.max(Number(n.attrs?.level ?? 2), 2), 3);
      return indent + '#'.repeat(level) + ' ' + inlineToMd(n.content ?? []).replace(/\n/g, ' ');
    }
    case 'bulletList':
    case 'orderedList': {
      const ordered = n.type === 'orderedList';
      let i = Number(n.attrs?.start ?? 1);
      return (n.content ?? [])
        .map((item) => {
          const bullet = ordered ? `${i++}. ` : '- ';
          const pad = ' '.repeat(bullet.length);
          const inner = blocksToMd(item.content ?? [], '');
          const lines = inner.split('\n');
          return lines
            .map((l, idx) => (idx === 0 ? indent + bullet + l : l ? indent + pad + l : ''))
            .join('\n')
            .replace(/\n\n+/g, '\n');
        })
        .join('\n');
    }
    case 'blockquote':
      return blocksToMd(n.content ?? [], '')
        .split('\n')
        .map((l) => indent + '> ' + l)
        .join('\n');
    case 'codeBlock':
      return indent + '```\n' + (n.content ?? []).map((c) => c.text ?? '').join('') + '\n```';
    case 'horizontalRule':
      return indent + '---';
    case 'image':
      return indent + imageToMd(n);
    case 'table':
      return indentLines(tableToMd(n), indent);
    default:
      return n.content ? blocksToMd(n.content, indent) : '';
  }
}

function indentLines(s: string, indent: string): string {
  return indent ? s.split('\n').map((l) => indent + l).join('\n') : s;
}

function imageToMd(n: RichNode): string {
  const alt = String(n.attrs?.alt ?? '').replace(/[[\]]/g, '');
  return `![${alt}](${String(n.attrs?.src ?? '')})`;
}

function tableToMd(n: RichNode): string {
  const rows = (n.content ?? []).map((r) =>
    (r.content ?? []).map((c) =>
      (c.content ?? [])
        .map((p) => (p.type === 'paragraph' ? inlineToMd(p.content ?? []) : blockToMd(p, '')))
        .join('<br>')
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|'),
    ),
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const line = (r: string[]) => '| ' + pad(r).join(' | ') + ' |';
  const [head, ...body] = rows;
  return [line(head!), '| ' + Array(width).fill('---').join(' | ') + ' |', ...body.map(line)].join('\n');
}

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'];

function inlineToMd(nodes: RichNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'hardBreak') out += '  \n';
    else if (n.type === 'image') out += imageToMd(n);
    else if (n.type === 'text') out += wrapMarks(n.text ?? '', n.marks ?? []);
  }
  return out;
}

function wrapMarks(text: string, marks: Mark[]): string {
  const sorted = [...marks].sort((a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type));
  const isCode = marks.some((m) => m.type === 'code');
  let s = isCode ? text : escapeMd(text);
  // Les espaces en bord de texte doivent rester hors des marqueurs.
  const lead = /^\s*/.exec(s)![0];
  const trail = /\s*$/.exec(s)![0];
  s = s.slice(lead.length, s.length - trail.length || undefined);
  if (!s) return lead + trail;
  for (const m of sorted) {
    if (m.type === 'code') s = '`' + s + '`';
    else if (m.type === 'bold') s = `**${s}**`;
    else if (m.type === 'italic') s = `*${s}*`;
    else if (m.type === 'strike') s = `~~${s}~~`;
    else if (m.type === 'link') s = `[${s}](${String(m.attrs?.href ?? '')})`;
  }
  return lead + s + trail;
}

function escapeMd(s: string): string {
  return s.replace(/([\\*_`[\]~|])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3');
}

/** Texte brut (recherche, diff lisible). */
export function docToPlainText(doc: RichNode): string {
  const walk = (n: RichNode): string => {
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'image') return `[image${n.attrs?.alt ? ' : ' + String(n.attrs.alt) : ''}]`;
    const inner = (n.content ?? []).map(walk).join(n.type === 'tableRow' ? ' | ' : '');
    const isBlock = !['text', 'hardBreak'].includes(n.type) && n.type !== 'doc';
    return isBlock && n.type !== 'tableCell' && n.type !== 'tableHeader' ? inner + '\n' : inner;
  };
  return walk(doc).replace(/\n{3,}/g, '\n\n').trim();
}

/** Toutes les références d'images d'un contenu. */
export function collectImageSrcs(node: RichNode, acc: string[] = []): string[] {
  if (node.type === 'image' && typeof node.attrs?.src === 'string') acc.push(node.attrs.src);
  for (const c of node.content ?? []) collectImageSrcs(c, acc);
  return acc;
}
