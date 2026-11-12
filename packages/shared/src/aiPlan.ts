import type { JobType } from './cdc.js';

/**
 * Récapitulatif montré AVANT un traitement IA (« Voici ce que l'IA va faire ») : rédigé par le code à partir des
 * données, sans appel au modèle (donc gratuit). L'utilisateur lance ou annule. Obtenu en rejouant la requête de
 * lancement avec l'en-tête `AI_PREVIEW_HEADER` : la route répond `{ apercu: AiPlan }` sans rien lancer ni modifier.
 */
export const AI_PREVIEW_HEADER = 'x-ia-apercu';

export interface AiPlanCall {
  /** Ce que fait cet appel (« Classer 40 tickets par thème »). */
  label: string;
  /** `fast` : modèle rapide et économique ; `smart` : modèle de rédaction. */
  tier: 'fast' | 'smart';
  model: string;
  /** Nombre d'appels de ce genre (lots). */
  count: number;
  /** Estimation, par appel. */
  inputTokens: number;
  outputTokens: number;
}

export interface AiPlan {
  job: JobType;
  title: string;
  /** Ce que l'IA va faire, étape par étape. */
  steps: string[];
  /** Ce qui part au modèle (et ce qui n'y part pas). */
  sent: string[];
  /** Ce qui changera dans le hub une fois le traitement terminé. */
  changes: string[];
  calls: AiPlanCall[];
  /** Coût estimé (dollars, tarifs du tableau de consommation). */
  estimatedUsd: number;
  /** IA simulée (locale) : aucun appel réel, coût nul. */
  simulated: boolean;
  budget: { spentUsd: number; limitUsd: number };
}

export interface AiPreviewResponse {
  apercu: AiPlan;
}
