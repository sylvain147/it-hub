/**
 * Accès aux modèles. Deux niveaux :
 *  - `fast`  (Haiku)  : tri des transcriptions, traductions — très peu cher ;
 *  - `smart` (Sonnet) : rédaction et mise à jour du cahier des charges.
 *
 * Chaque appel est tracé (tokens + coût estimé) et refusé si le budget mensuel est atteint.
 */
import type { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';
import { monthCostUsd, recordUsage } from '../db/repo.js';

export type Tier = 'fast' | 'smart';
export type Effort = 'low' | 'medium' | 'high';

export interface StructuredCall<T> {
  tier: Tier;
  /** Opération (pour le suivi de consommation et le mode simulé). */
  operation: string;
  /** Instructions stables : mises en cache côté modèle d'un appel à l'autre. */
  system: string;
  /**
   * Contexte volumineux et stable d'un appel à l'autre (documentation d'un format…) :
   * envoyé comme second bloc système, lui aussi mis en cache.
   */
  context?: string;
  /** Données variables de l'appel. */
  input: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort: Effort;
  /** Délai maximal de la réponse (ms), sans nouvelle tentative : appels synchrones de l'API. */
  timeoutMs?: number;
  ctx: { user: string; cdcId: string };
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmProvider {
  structured<T>(call: StructuredCall<T>, model: string): Promise<{ output: T; usage: LlmUsage }>;
}

export function modelFor(tier: Tier): string {
  if (config.llmProvider === 'mock') return 'mock';
  return tier === 'fast' ? config.modelFast : config.modelSmart;
}

export function costUsd(model: string, u: LlmUsage): number {
  const p = config.pricing[model];
  if (!p) return 0;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

export async function assertBudget(): Promise<void> {
  const spent = await monthCostUsd();
  if (spent >= config.monthlyBudgetUsd) {
    throw new HttpError(
      429,
      `Budget IA mensuel atteint (${spent.toFixed(2)} $ / ${config.monthlyBudgetUsd} $). Les fonctions IA sont suspendues jusqu’au mois prochain ; l’édition manuelle reste disponible.`,
    );
  }
}

let provider: LlmProvider | null = null;

async function getProvider(): Promise<LlmProvider> {
  if (!provider) {
    provider =
      config.llmProvider === 'bedrock'
        ? new (await import('./bedrock.js')).BedrockProvider()
        : new (await import('./mock.js')).MockProvider();
  }
  return provider;
}

export function setProvider(p: LlmProvider | null) {
  provider = p;
}

export async function callStructured<T>(call: StructuredCall<T>): Promise<T> {
  const model = modelFor(call.tier);
  const p = await getProvider();
  const { output, usage } = await p.structured(call, model);
  await recordUsage({
    operation: call.operation,
    model,
    user: call.ctx.user,
    cdcId: call.ctx.cdcId,
    ...usage,
    costUsd: costUsd(model, usage),
  });
  return output;
}
