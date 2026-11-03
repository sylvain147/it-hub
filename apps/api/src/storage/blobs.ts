/**
 * Stockage des fichiers : contenu des versions, transcriptions, images, exports.
 * S3 en production, disque local en développement.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

export interface BlobStore {
  put(key: string, body: Buffer | string, contentType: string, downloadName?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  /** URL temporaire de lecture (images, exports). */
  downloadUrl(key: string, opts?: { fileName?: string; expiresIn?: number }): Promise<string>;
  /** URL temporaire d'envoi direct depuis le navigateur. */
  uploadUrl(key: string, contentType: string, size: number): Promise<{ url: string; headers: Record<string, string> }>;
}

export async function getJson<T>(store: BlobStore, key: string): Promise<T | null> {
  const buf = await store.get(key);
  return buf ? (JSON.parse(buf.toString('utf8')) as T) : null;
}

// ---------------------------------------------------------------------------

class S3BlobStore implements BlobStore {
  private s3 = new S3Client({});
  constructor(private bucket: string) {}

  async put(key: string, body: Buffer | string, contentType: string, downloadName?: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: downloadName ? contentDisposition(downloadName) : undefined,
      }),
    );
  }

  async get(key: string) {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async exists(key: string) {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return false;
      throw e;
    }
  }

  downloadUrl(key: string, opts: { fileName?: string; expiresIn?: number } = {}) {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: opts.fileName ? contentDisposition(opts.fileName) : undefined,
      }),
      { expiresIn: opts.expiresIn ?? 3600 },
    );
  }

  async uploadUrl(key: string, contentType: string, size: number) {
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
      { expiresIn: 600 },
    );
    return { url, headers: { 'Content-Type': contentType } };
  }
}

// ---------------------------------------------------------------------------

/** Stockage disque pour le développement local ; servi par le serveur local sous /local-blob/. */
export class FsBlobStore implements BlobStore {
  constructor(private root: string) {}

  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error('Clé invalide');
    return p;
  }

  async put(key: string, body: Buffer | string, contentType: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    await writeFile(p + '.meta', contentType);
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }

  async contentType(key: string) {
    try {
      return (await readFile(this.path(key) + '.meta', 'utf8')) || 'application/octet-stream';
    } catch {
      return 'application/octet-stream';
    }
  }

  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  async downloadUrl(key: string, opts: { fileName?: string } = {}) {
    const q = opts.fileName ? `?name=${encodeURIComponent(opts.fileName)}` : '';
    return `/local-blob/${key}${q}`;
  }

  async uploadUrl(key: string, contentType: string) {
    return { url: `/local-blob/${key}`, headers: { 'Content-Type': contentType } };
  }
}

function contentDisposition(fileName: string) {
  const ascii = fileName.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

let store: BlobStore | null = null;
export function blobs(): BlobStore {
  if (!store) store = config.bucketName ? new S3BlobStore(config.bucketName) : new FsBlobStore(join(config.localDataDir, 'blobs'));
  return store;
}
export function setBlobStore(s: BlobStore) {
  store = s;
}
