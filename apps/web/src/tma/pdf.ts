import { pdfTextItems, type PdfJsDocument, type PdfTextItem } from '@samm/shared';

/** Texte d'un PDF, lu sur ce poste par pdf.js (chargé seulement quand on dépose un PDF). */
export async function readPdfText(bytes: Uint8Array): Promise<PdfTextItem[]> {
  // Worker empaqueté par Vite en .js (un .mjs servi par S3 n'aurait pas le bon type MIME).
  const [pdfjs, { default: PdfWorker }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?worker')]);
  pdfjs.GlobalWorkerOptions.workerPort ??= new PdfWorker();
  const task = pdfjs.getDocument({ data: bytes });
  try {
    return await pdfTextItems((await task.promise) as unknown as PdfJsDocument);
  } finally {
    await task.destroy();
  }
}
