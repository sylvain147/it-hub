import { inflateSync } from 'node:zlib';
import { imageSize } from 'image-size';
import { collectImageSrcs, parseAssetRef, PROJECT_PHASES, type CdcDocument, type Language, type ProjectPhase } from '@samm/shared';
import { blobs } from '../storage/blobs.js';
import { blobKeys } from '../db/schema.js';

export interface ExportLabels {
  heading: string;
  version: string;
  deadline: string;
  status: string;
  currentPhase: string;
  estimate: string;
  days: (n: number) => string;
  toDefine: string;
  page: string;
  of: string;
  locale: string;
  phases: Record<ProjectPhase, string>;
  missingImage: string;
}

export const LABELS: Record<Language, ExportLabels> = {
  fr: {
    heading: 'CAHIER DES CHARGES',
    version: 'Version',
    deadline: 'Échéance cible',
    status: 'Statut',
    currentPhase: 'Phase actuelle',
    estimate: 'Estimation',
    days: (n) => `${fmtNum(n, 'fr-FR')} jour${n > 1 ? 's' : ''}`,
    toDefine: 'À préciser',
    page: 'Page',
    of: 'sur',
    locale: 'fr-FR',
    phases: { cadrage: 'Cadrage', developpement: 'Développement', testing: 'Testing', production: 'Production', termine: 'Terminé' },
    missingImage: '[image introuvable]',
  },
  en: {
    heading: 'SPECIFICATIONS',
    version: 'Version',
    deadline: 'Target dates',
    status: 'Status',
    currentPhase: 'Current phase',
    estimate: 'Estimate',
    days: (n) => `${fmtNum(n, 'en-GB')} man-day${n > 1 ? 's' : ''}`,
    toDefine: 'To be specified',
    page: 'Page',
    of: 'of',
    locale: 'en-GB',
    phases: { cadrage: 'Scoping', developpement: 'Development', testing: 'Testing', production: 'Production', termine: 'Completed' },
    missingImage: '[missing image]',
  },
  de: {
    heading: 'LASTENHEFT',
    version: 'Version',
    deadline: 'Zieltermine',
    status: 'Status',
    currentPhase: 'Aktuelle Phase',
    estimate: 'Aufwandsschätzung',
    days: (n) => `${fmtNum(n, 'de-DE')} Personentag${n > 1 ? 'e' : ''}`,
    toDefine: 'Noch festzulegen',
    page: 'Seite',
    of: 'von',
    locale: 'de-DE',
    phases: { cadrage: 'Konzeption', developpement: 'Entwicklung', testing: 'Test', production: 'Produktion', termine: 'Abgeschlossen' },
    missingImage: '[Bild fehlt]',
  },
};

function fmtNum(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
}

export function formatDate(iso: string, locale: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
}

/** Lignes du bloc « Échéance cible » (« Testing phase 1 : 23 octobre 2026 »). */
export function deadlineLines(doc: CdcDocument, l: ExportLabels): string[] {
  const lines = doc.meta.jalons.map((j) => {
    const date = j.date ? formatDate(j.date, l.locale) : l.toDefine;
    return j.label ? `${j.label} : ${date}` : date;
  });
  return lines.length ? lines : [l.toDefine];
}

export function phaseLine(doc: CdcDocument, l: ExportLabels): string {
  const phase = doc.meta.phase && PROJECT_PHASES.includes(doc.meta.phase) ? l.phases[doc.meta.phase] : l.toDefine;
  return `${l.currentPhase} : ${phase.toLowerCase()}`;
}

export function estimateLine(doc: CdcDocument, l: ExportLabels): string {
  return doc.meta.estimationJours != null ? l.days(doc.meta.estimationJours) : l.toDefine;
}

export interface LoadedImage {
  data: Buffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

/** Charge toutes les images référencées par le document (depuis le bucket). */
export async function loadImages(doc: CdcDocument): Promise<Map<string, LoadedImage>> {
  const refs = [...new Set(doc.sections.flatMap((s) => collectImageSrcs(s.content)))];
  const out = new Map<string, LoadedImage>();
  await Promise.all(
    refs.map(async (ref) => {
      const parsed = parseAssetRef(ref);
      if (!parsed) return;
      const data = await blobs().get(blobKeys.asset(parsed.cdcId, parsed.assetId));
      if (!data) return;
      try {
        const size = imageSize(data);
        if (!size.width || !size.height || (size.type !== 'png' && size.type !== 'jpg')) return;
        if (size.type === 'png' && !pngDataIsValid(data)) return;
        out.set(ref, { data, type: size.type, width: size.width, height: size.height });
      } catch {
        /* image illisible : ignorée */
      }
    }),
  );
  return out;
}

/** Une image PNG corrompue ferait planter le moteur PDF : on vérifie que ses données se décompressent. */
function pngDataIsValid(png: Buffer): boolean {
  const parts: Buffer[] = [];
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    if (type === 'IDAT') parts.push(png.subarray(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  try {
    inflateSync(Buffer.concat(parts));
    return parts.length > 0;
  } catch {
    return false;
  }
}

/** Dimensions d'affichage (pixels à 96 dpi) bornées à la largeur utile de la page. */
export function fitImage(img: LoadedImage, maxWidth: number, maxHeight = 820): { width: number; height: number } {
  const ratio = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  return { width: Math.round(img.width * ratio), height: Math.round(img.height * ratio) };
}

/** Nom de fichier lisible pour l'export. */
export function exportFileName(doc: CdcDocument, versionLabel: string, lang: Language, ext: string): string {
  const slug = doc.meta.title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  return `CDC_${slug || 'document'}_v${versionLabel}${lang === 'fr' ? '' : '_' + lang.toUpperCase()}.${ext}`;
}

export const COLORS = {
  heading: '1F3864',
  h1: '2E74B5',
  h3: '1F4D78',
  subtitle: '2E74B5',
  tableHeader: 'DEEAF6',
};
