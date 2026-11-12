/**
 * Récapitulatif d'un traitement IA, avant son lancement (`AiPlan`) : chaque route de lancement, rejouée avec l'en-tête
 * `AI_PREVIEW_HEADER`, décrit ce que l'IA va faire, ce qui lui est envoyé, ce qui changera et le coût estimé, puis
 * s'arrête (`if (wantsPreview(c)) return preview(c, …)`) avant tout enregistrement. Aucun appel au modèle ici.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context, MiddlewareHandler } from 'hono';
import { AI_PREVIEW_HEADER, docToMarkdown, type AiPlan, type AiPlanCall, type CdcDocument, type JobType } from '@samm/shared';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';
import { monthCostUsd } from '../db/repo.js';
import type { Tier } from './llm.js';

const previewing = new AsyncLocalStorage<boolean>();

/** Note, pour toute la requête, qu'elle ne demande que le récapitulatif (lu par `assertNotPreview`). */
export const previewMiddleware: MiddlewareHandler = (c, next) => previewing.run(c.req.header(AI_PREVIEW_HEADER) === '1', next);

/** Garde-fou de `startJob` : une demande de récapitulatif ne lance jamais de traitement, même sur une route qui ne sait pas le décrire. */
export function assertNotPreview() {
  if (previewing.getStore()) throw new HttpError(400, 'Le récapitulatif n’est pas disponible pour ce traitement.');
}

/** La requête demande seulement le récapitulatif. */
export const wantsPreview = (c: Context) => c.req.header(AI_PREVIEW_HEADER) === '1';

/** Tokens estimés d'un texte (≈ 3,5 caractères par token en français). */
export const tokensOf = (chars: number) => Math.ceil(chars / 3.5);
/** Instructions envoyées à chaque appel (prompt système), en tokens, en ordre de grandeur. */
const SYSTEM_TOKENS = 1500;

const modelOf = (tier: Tier) => (tier === 'fast' ? config.modelFast : config.modelSmart);
const MODEL_NAMES: Record<Tier, string> = { fast: 'modèle rapide et économique', smart: 'modèle de rédaction' };

/** Un appel (ou `count` appels semblables) : `inputChars` de données variables, `outputTokens` de réponse attendus. */
export function aiCall(label: string, tier: Tier, inputChars: number, outputTokens: number, count = 1): AiPlanCall {
  return { label, tier, model: `${MODEL_NAMES[tier]} (${modelOf(tier)})`, count, inputTokens: SYSTEM_TOKENS + tokensOf(inputChars), outputTokens };
}

/** Texte d'un CDC en Markdown (pour en mesurer la taille). */
export const docChars = (doc: CdcDocument) => doc.sections.reduce((n, s) => n + s.title.length + docToMarkdown(s.content).length, 0);

/** Nombre en clair (« 12 400 caractères »). */
export const n = (x: number) => x.toLocaleString('fr-FR');

export async function buildPlan(job: JobType, title: string, parts: { steps: string[]; sent: string[]; changes: string[]; calls: AiPlanCall[] }): Promise<AiPlan> {
  const estimatedUsd = parts.calls.reduce((sum, c) => {
    const p = config.pricing[modelOf(c.tier)];
    return p ? sum + (c.count * (c.inputTokens * p.input + c.outputTokens * p.output)) / 1_000_000 : sum;
  }, 0);
  return { job, title, ...parts, estimatedUsd, simulated: config.llmProvider === 'mock', budget: { spentUsd: await monthCostUsd(), limitUsd: config.monthlyBudgetUsd } };
}

export const preview = (c: Context, plan: AiPlan) => c.json({ apercu: plan });
