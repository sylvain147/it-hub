/**
 * Serveur de développement : API + émulateur DynamoDB en mémoire persisté sur disque + fichiers sur disque + IA simulée.
 *   pnpm dev            → http://localhost:3001 (le front Vite proxifie /api et /local-blob)
 *   LLM_PROVIDER=bedrock pnpm dev   → vrais appels Bedrock (identifiants AWS locaux requis)
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { createApp } from './app.js';
import { ensureLocalTable } from './db/setup.js';
import { FsBlobStore, blobs } from './storage/blobs.js';

const DYNAMO_PORT = Number(process.env.DYNAMO_PORT ?? 4567);
const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  const dataDir = resolve(config.localDataDir);
  mkdirSync(dataDir, { recursive: true });
  const dynalite = (await import('dynalite')).default;
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((r) => server.listen(DYNAMO_PORT, () => r()));
  const endpoint = `http://127.0.0.1:${DYNAMO_PORT}`;
  process.env.DYNAMO_ENDPOINT = endpoint;
  config.dynamoEndpoint = endpoint;
  await ensureLocalTable(endpoint);

  const app = new Hono();
  const store = blobs() as FsBlobStore;
  // Envoi et lecture des fichiers locaux (remplace les URL pré-signées S3).
  app.put('/local-blob/*', async (c) => {
    const key = decodeURIComponent(c.req.path.slice('/local-blob/'.length));
    await store.put(key, Buffer.from(await c.req.arrayBuffer()), c.req.header('content-type') ?? 'application/octet-stream');
    return c.body(null, 200);
  });
  app.get('/local-blob/*', async (c) => {
    const key = decodeURIComponent(c.req.path.slice('/local-blob/'.length));
    const data = await store.get(key);
    if (!data) return c.text('Introuvable', 404);
    const name = c.req.query('name');
    const headers: Record<string, string> = { 'content-type': await store.contentType(key) };
    if (name) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
    return c.body(new Uint8Array(data), 200, headers);
  });
  app.route('/', createApp());

  serve({ fetch: app.fetch, port: PORT });
  console.log(`API locale : http://localhost:${PORT}  (IA : ${config.llmProvider}, données : ${join(dataDir)})`);
  console.log('⚠️  Base DynamoDB locale en mémoire : les données sont perdues au redémarrage (les fichiers restent dans .data).');
}

void main();
