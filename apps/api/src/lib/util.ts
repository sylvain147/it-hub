import { randomBytes, createHash } from 'node:crypto';

/** Identifiant triable par date de création (base36 horodatage + aléa). */
export function newId(): string {
  return Date.now().toString(36).padStart(9, '0') + randomBytes(6).toString('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Ressource') => new HttpError(404, `${what} introuvable`);
