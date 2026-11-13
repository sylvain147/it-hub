/**
 * Fichiers manipulés uniquement dans le navigateur : ils ne sont jamais envoyés au serveur
 * (seul un extrait, anonymisé par défaut, part à l'IA lors de la création d'un type).
 */
import { decodeFile, docxToText, guessEncoding, xlsxToText } from '@samm/shared';

export interface LocalFile {
  name: string;
  size: number;
  bytes: Uint8Array;
}

export async function readLocalFile(file: File): Promise<LocalFile> {
  return { name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export function decodeGuess(f: LocalFile): { text: string; encoding: string } {
  return decodeFile(f.bytes, guessEncoding(f.bytes));
}

/** Documentation (spec Excel, code source, texte) convertie en texte pour l'IA. */
export async function documentToText(file: File): Promise<{ name: string; text: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.xlsx$/i.test(file.name)) {
    const { sheets } = xlsxToText(bytes);
    return { name: file.name, text: sheets.map((s) => `--- Onglet « ${s.name} » ---\n${s.text}`).join('\n\n') };
  }
  if (/\.docx$/i.test(file.name)) return { name: file.name, text: docxToText(bytes) };
  if (/\.(xls|doc|pdf)$/i.test(file.name)) throw new Error(`« ${file.name} » : format non pris en charge pour l’instant (Excel .xlsx, Word .docx, CSV ou texte uniquement).`);
  return { name: file.name, text: decodeFile(bytes, guessEncoding(bytes)).text };
}

/** Fichier ouvert dans le lecteur et exemple en cours de mise au point (conservés en mémoire, pas sur le disque). */
export const session: { reading: { file: LocalFile; typeId: string } | null; samples: Map<string, LocalFile> } = {
  reading: null,
  samples: new Map(),
};

export function formatSize(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}
