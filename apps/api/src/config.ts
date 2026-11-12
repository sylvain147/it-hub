/**
 * Configuration lue depuis l'environnement.
 * En local (`pnpm dev`) les valeurs par défaut suffisent : DynamoDB émulé, fichiers sur disque, IA simulée.
 */
export interface ModelPricing {
  /** USD par million de tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const env = process.env;

function num(name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Variable ${name} invalide : ${v}`);
  return n;
}

/**
 * Tarifs publics Anthropic (USD / million de tokens). Sur Bedrock les tarifs sont fixés par AWS
 * (+10 % sur les endpoints régionaux) : ajuster via PRICING_JSON si besoin.
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'anthropic.claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'anthropic.claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  mock: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export const config = {
  /** `local` : serveur Node + émulateurs ; `aws` : Lambda. */
  runtime: (env.APP_RUNTIME ?? 'local') as 'local' | 'aws',
  authMode: (env.AUTH_MODE ?? 'dev') as 'dev' | 'cognito',
  /** Annuaire Cognito : création des comptes à l'invitation, désactivation. */
  userPoolId: env.USER_POOL_ID ?? '',
  tableName: env.TABLE_NAME ?? 'samm-local',
  bucketName: env.BUCKET_NAME ?? '',
  /** Endpoint DynamoDB local (émulateur). */
  dynamoEndpoint: env.DYNAMO_ENDPOINT,
  localDataDir: env.LOCAL_DATA_DIR ?? '.data',
  workerFunctionName: env.WORKER_FUNCTION_NAME ?? '',
  llmProvider: (env.LLM_PROVIDER ?? 'mock') as 'mock' | 'bedrock',
  bedrockRegion: env.BEDROCK_REGION ?? env.AWS_REGION ?? 'eu-west-3',
  /** Modèle rapide et économique : tri des transcriptions, traductions. */
  modelFast: env.MODEL_FAST ?? 'anthropic.claude-haiku-5-5',
  /** Modèle de rédaction : génération et mise à jour du CDC. */
  modelSmart: env.MODEL_SMART ?? 'anthropic.claude-sonnet-5-5',
  monthlyBudgetUsd: num('MONTHLY_BUDGET_USD', 30),
  pricing: { ...DEFAULT_PRICING, ...(env.PRICING_JSON ? (JSON.parse(env.PRICING_JSON) as Record<string, ModelPricing>) : {}) },
  /**
   * Expéditeur des e-mails du hub (demandes de validation de CDC), adresse vérifiée dans Amazon SES. Vide : pas d'envoi
   * (en local, les e-mails sont écrits dans `<localDataDir>/emails` et le lien est affiché au demandeur).
   */
  mailFrom: env.MAIL_FROM ?? '',
  sesRegion: env.SES_REGION ?? env.AWS_REGION ?? 'eu-west-3',
  /** Durée au-delà de laquelle un job « en cours » est considéré comme abandonné. */
  staleJobMinutes: 20,
};

export type Config = typeof config;
