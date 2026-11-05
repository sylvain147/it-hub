/**
 * Masquage des données personnelles dans le texte libre des tickets (descriptions, sujets, commentaires TMA).
 * Exécuté dans le navigateur avant tout envoi au serveur. On garde le sens (montants, codes entité, vocabulaire
 * métier) et on retire ce qui identifie une personne : e-mails, téléphones, numéros de client / commande / chèque,
 * noms après une civilité, noms connus des demandeurs et signatures.
 *
 * Limite : un nom de client cité sans civilité au milieu d'une phrase peut subsister.
 */

const L = '\\p{L}';
/** Mot commençant par une majuscule (nom propre), traits d'union et apostrophes compris. */
const NAME = `[\\p{Lu}][${L}'’-]+`;

/** Libellé du numéro masqué d'après les mots qui le précèdent (le plus proche l'emporte). */
const NUMBER_CONTEXTS: [RegExp, string][] = [
  [/\bclient(?:e)?s?\b|\bcompte\b|\bcpte\b/giu, 'n° client'],
  [/\bcommandes?\b|\bcdes?\b|\bcmde?s?\b/giu, 'n° commande'],
  [/\bch[eè]ques?\b|\bchq\b/giu, 'n° chèque'],
  [/\bBAV\b|\bbons? d'achat\b/giu, 'n° BAV'],
  [/\bcolis\b|\bsuivi\b|\bexp[ée]dition\b/giu, 'n° colis'],
  [/\bfactures?\b/giu, 'n° facture'],
  [/\bcartes?\b|\bCB\b/giu, 'n° carte'],
];

function numberLabel(before: string): string {
  let best = { at: -1, label: 'numéro' };
  for (const [re, label] of NUMBER_CONTEXTS) {
    for (const m of before.matchAll(re)) if (m.index! > best.at) best = { at: m.index!, label };
  }
  return best.label;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parties d'un nom à masquer : le nom complet et chacun de ses mots d'au moins 3 lettres. */
export function namesToMask(fullNames: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const n of fullNames) {
    const name = n.trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.includes('@')) continue;
    out.add(name);
    for (const part of name.split(/[\s]+/)) if (part.replace(/[^\p{L}]/gu, '').length >= 3) out.add(part);
  }
  // Les plus longs d'abord : « Stella Koebel » avant « Stella ».
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Masque les données personnelles d'un texte.
 * @param names noms à retirer (déjà découpés par `namesToMask`), par exemple les demandeurs des tickets.
 */
export function maskPersonalData(text: string, names: string[] = []): string {
  if (!text) return text;
  let s = text;
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]');
  s = s.replace(/\bFR\d{2}(?:\s?[0-9A-Z]{4}){5}\s?[0-9A-Z]{1,3}\b/g, '[IBAN]');
  s = s.replace(/(?<!\d)(?:\+33\s?|0033\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/g, '[téléphone]');
  // Numéros longs (6 chiffres et plus) : client, commande, chèque… Les numéros de ticket (#12345) et les montants restent.
  s = s.replace(/(?<![\d#])\d{6,}(?!\d)/g, (_m, offset: number, all: string) => `[${numberLabel(all.slice(Math.max(0, offset - 40), offset))}]`);
  // Nom après une civilité.
  s = s.replace(new RegExp(`\\b(Mmes?|Mlles?|M\\.|MM\\.|Mr|Madame|Monsieur|Mademoiselle)\\s+(${NAME}(?:\\s+${NAME})?)`, 'gu'), '$1 [nom]');
  for (const n of names) {
    s = s.replace(new RegExp(`(?<![${L}\\[])${escapeRe(n)}(?![${L}\\]])`, 'giu'), '[nom]');
  }
  // Signature en fin de message (« Cordialement, Stella »).
  s = s.replace(
    new RegExp(`((?:[Cc]ordialement|[Bb]ien à vous|[Mm]erci d'avance|[Mm]erci par avance|[Mm]erci|[Bb]onne journée)[\\s,.!]*)(${NAME}(?:\\s+${NAME})?)([\\s".]*)$`, 'u'),
    (_m, before: string, _name: string, after: string) => `${before}[nom]${after}`,
  );
  s = s.replace(/\[nom\](?:\s+\[nom\])+/g, '[nom]');
  return s;
}
