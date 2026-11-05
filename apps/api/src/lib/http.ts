import type { Context } from 'hono';
import type { z } from 'zod';
import { HttpError } from './util.js';

/** Lit et valide le corps JSON d'une requête (message d'erreur en français). */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'Corps de requête JSON invalide');
  }
  return parseBody(schema, raw);
}

/** Valide un objet déjà lu (message d'erreur en français). */
export function parseBody<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(400, first ? `${first.path.join('.') || 'requête'} : ${first.message}` : 'Requête invalide', parsed.error.issues);
  }
  return parsed.data;
}

export function intParam(c: Context, name: string): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `Paramètre ${name} invalide`);
  return n;
}
