import { useEffect, useState } from 'react';
import { ALLOWED_ASSET_TYPES, MAX_ASSET_BYTES } from '@samm/shared';
import { api } from '../api';

/** Résolution des images `asset:…` en URL temporaires, regroupée et mise en cache. */
const cache = new Map<string, { url: string; at: number }>();
const pending = new Map<string, ((url: string) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
const TTL = 50 * 60 * 1000;

function flush() {
  timer = null;
  const refs = [...pending.keys()];
  const waiting = new Map(pending);
  pending.clear();
  api
    .resolveAssets(refs)
    .then((urls) => {
      for (const ref of refs) {
        const url = urls[ref] ?? '';
        if (url) cache.set(ref, { url, at: Date.now() });
        waiting.get(ref)?.forEach((cb) => cb(url));
      }
    })
    .catch(() => refs.forEach((ref) => waiting.get(ref)?.forEach((cb) => cb(''))));
}

export function resolveAsset(ref: string): Promise<string> {
  if (!ref.startsWith('asset:')) return Promise.resolve(ref);
  const hit = cache.get(ref);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    pending.set(ref, [...(pending.get(ref) ?? []), resolve]);
    timer ??= setTimeout(flush, 30);
  });
}

export function useAssetUrl(ref: string): string | null {
  const [url, setUrl] = useState<string | null>(() => (ref.startsWith('asset:') ? cache.get(ref)?.url ?? null : ref));
  useEffect(() => {
    let alive = true;
    void resolveAsset(ref).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [ref]);
  return url;
}

/** Envoie une image (PNG/JPEG) dans le stockage et renvoie sa référence `asset:…`. */
export async function uploadImage(cdcId: string, file: File): Promise<string> {
  if (!(ALLOWED_ASSET_TYPES as readonly string[]).includes(file.type)) throw new Error('Formats d’image acceptés : PNG et JPEG.');
  if (file.size > MAX_ASSET_BYTES) throw new Error('Image trop lourde (10 Mo maximum).');
  const { ref, upload } = await api.createAsset(cdcId, file.type, file.size);
  const res = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
  if (!res.ok) throw new Error(`Échec de l’envoi de l’image (${res.status}).`);
  cache.set(ref, { url: URL.createObjectURL(file), at: Date.now() });
  return ref;
}
