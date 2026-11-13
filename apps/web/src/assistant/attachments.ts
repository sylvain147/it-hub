/**
 * Pièces jointes de Gandalf, préparées dans le navigateur : les images (collées, glissées ou jointes) sont réduites
 * (côté le plus long à 1568 px, ce que le modèle lit sans perte) et partent avec le PDF tels quels ; les fichiers
 * texte, Word et Excel sont lus ici et ajoutés au texte de la question. Rien n'est envoyé avant le clic « Envoyer ».
 */
import { ASSISTANT_IMAGE_TYPES, type AssistantAttachment } from '@samm/shared';
import { documentToText, formatSize } from '../files/local';

/** Pièce jointe prête à partir. */
export type PendingFile =
  | { kind: 'binary'; name: string; size: number; attachment: AssistantAttachment; /** Vignette (data URL) d'une image. */ thumb?: string }
  | { kind: 'text'; name: string; size: number; text: string };

/** Ce que le chat garde d'une pièce jointe (dans le `sessionStorage`) : le nom et la vignette. */
export interface SentFile {
  name: string;
  thumb?: string;
}

/** Formats acceptés par le sélecteur de fichiers. */
export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt,.csv,.md,.json,.log,.xml,.eml';

const MAX_SIDE = 1568;
/** Au-delà, une image est ré-encodée même si ses dimensions conviennent. */
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_PDF_BYTES = 3_000_000;
const TEXT_FILE = /\.(txt|csv|md|json|log|xml|eml|docx|xlsx)$/i;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(blob);
  });
}

function canvasOf(img: ImageBitmap, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * k));
  canvas.height = Math.max(1, Math.round(img.height * k));
  const g = canvas.getContext('2d')!;
  // Fond blanc : la transparence d'une capture PNG deviendrait noire en JPEG.
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image illisible.'))), type, quality));

async function imageFile(file: File, name: string): Promise<PendingFile> {
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(file);
  } catch {
    throw new Error(`« ${name} » : image illisible.`);
  }
  const keep = (ASSISTANT_IMAGE_TYPES as readonly string[]).includes(file.type) && file.size <= MAX_IMAGE_BYTES && Math.max(img.width, img.height) <= MAX_SIDE;
  const blob = keep ? file : await toBlob(canvasOf(img, MAX_SIDE), 'image/jpeg', 0.85);
  const thumb = canvasOf(img, 160).toDataURL('image/jpeg', 0.7);
  img.close();
  return { kind: 'binary', name, size: blob.size, thumb, attachment: { name, mediaType: (keep ? file.type : 'image/jpeg') as AssistantAttachment['mediaType'], data: await toBase64(blob) } };
}

/** Prépare un fichier joint, collé ou glissé ; erreur en clair si le format n'est pas pris en charge. */
export async function prepareFile(file: File): Promise<PendingFile> {
  const name = file.name || `capture-${new Date().toLocaleTimeString('fr-FR').replace(/:/g, 'h').slice(0, 5)}.png`;
  if (file.type.startsWith('image/')) return imageFile(file, name);
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error(`« ${name} » : PDF trop lourd (${formatSize(file.size)}, 3 Mo au plus).`);
    return { kind: 'binary', name, size: file.size, attachment: { name, mediaType: 'application/pdf', data: await toBase64(file) } };
  }
  if (TEXT_FILE.test(name) || file.type.startsWith('text/')) {
    const { text } = await documentToText(file);
    if (!text.trim()) throw new Error(`« ${name} » : aucun texte à lire.`);
    return { kind: 'text', name, size: file.size, text };
  }
  throw new Error(`« ${name} » : format non pris en charge (images, PDF, Word .docx, Excel .xlsx ou fichier texte).`);
}

/** Question envoyée : le texte saisi suivi du contenu des fichiers texte joints. */
export function questionWithTexts(question: string, files: PendingFile[]): string {
  const texts = files.flatMap((f) => (f.kind === 'text' ? [`--- Pièce jointe « ${f.name} » ---\n${f.text.trim()}`] : []));
  return [question.trim(), ...texts].filter(Boolean).join('\n\n');
}
