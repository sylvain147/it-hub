import { deflateSync } from 'node:zlib';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import dynalite from 'dynalite';
import { config } from '../src/config.js';
import { ensureLocalTable } from '../src/db/setup.js';
import { resetDdb } from '../src/db/client.js';
import { FsBlobStore, setBlobStore } from '../src/storage/blobs.js';
import { setProvider } from '../src/ai/llm.js';
import { MockProvider } from '../src/ai/mock.js';
import { createApp } from '../src/app.js';

export async function setupTestEnv() {
  const server = dynalite({ createTableMs: 0 });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  config.dynamoEndpoint = `http://127.0.0.1:${port}`;
  config.tableName = 'samm-test';
  config.authMode = 'dev';
  config.runtime = 'local';
  config.llmProvider = 'mock';
  resetDdb();
  await ensureLocalTable(config.dynamoEndpoint);
  const dir = mkdtempSync(join(tmpdir(), 'samm-test-'));
  const store = new FsBlobStore(dir);
  setBlobStore(store);
  setProvider(new MockProvider(0));
  const app = createApp();

  /** `user` vide : requête sans utilisateur (pages publiques). */
  async function call<T = any>(method: string, path: string, body?: unknown, user = 'alice@test', headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { 'x-dev-user': user } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  async function waitJob(id: string) {
    for (let i = 0; i < 200; i++) {
      const { json } = await call('GET', `/jobs/${id}`);
      if (json.status === 'termine' || json.status === 'erreur') return json;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('job timeout');
  }

  return { call, waitJob, store, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Petite image PNG valide (4x2, RGBA). */
export const TINY_PNG = makePng(4, 2);

function makePng(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4), 0x80);
  for (let y = 0; y < h; y++) raw[y * (1 + w * 4)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
