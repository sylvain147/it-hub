/**
 * Blocs de code des textes riches (journal, fiches…) : reconnaissance, mise en
 * forme et coloration du JSON, sans dépendance.
 */

export type CodeTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space' | 'other';

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

const TOKEN_RE = /("(?:[^"\\\n]|\\.)*"?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|([^\s"{}[\],:]+)/g;

/** Découpe un texte JSON (même invalide ou incomplet) en éléments à colorer. */
export function jsonTokens(text: string): CodeToken[] {
  const out: CodeToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const kind: CodeTokenKind = m[1] !== undefined ? 'string' : m[2] !== undefined ? 'number' : m[3] !== undefined ? 'literal' : m[4] !== undefined ? 'punct' : m[5] !== undefined ? 'space' : 'other';
    out.push({ kind, text: m[0] });
  }
  // Une chaîne suivie de « : » est une clé.
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.kind !== 'string') continue;
    let j = i + 1;
    while (out[j]?.kind === 'space') j++;
    if (out[j]?.text === ':') out[i]!.kind = 'key';
  }
  return out;
}

/** Vrai si le texte est un objet ou un tableau JSON valide. */
export function isJsonText(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remet en forme un JSON valide (indentation de 2 espaces), en gardant
 * l'écriture d'origine des valeurs (nombres, échappements). `null` si invalide.
 */
export function formatJson(text: string): string | null {
  if (!isJsonText(text)) return null;
  const tokens = jsonTokens(text.trim()).filter((t) => t.kind !== 'space');
  let out = '';
  let depth = 0;
  const nl = () => '\n' + '  '.repeat(depth);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if (t.text === '{' || t.text === '[') {
      // Objet ou tableau vide : gardé sur une ligne.
      if (next && (next.text === '}' || next.text === ']')) {
        out += t.text + next.text;
        i++;
        continue;
      }
      depth++;
      out += t.text + nl();
    } else if (t.text === '}' || t.text === ']') {
      depth--;
      out += nl() + t.text;
    } else if (t.text === ',') out += ',' + nl();
    else if (t.text === ':') out += ': ';
    else out += t.text;
  }
  return out;
}

/** Langage à colorer : « json » déclaré, ou contenu reconnu comme du JSON. */
export function codeLanguage(language: unknown, text: string): 'json' | null {
  if (typeof language === 'string' && /^json/i.test(language)) return 'json';
  if (language && language !== 'text') return null;
  return /^\s*[[{]/.test(text) && /[\]}]\s*$/.test(text) ? 'json' : null;
}
