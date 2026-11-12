import { AnthropicBedrockMantle, type BedrockMantleClientOptions } from '@anthropic-ai/bedrock-sdk';
import { APIError } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';
import type { LlmProvider, LlmUsage, StructuredCall } from './llm.js';

/**
 * Claude via Amazon Bedrock (API Messages, endpoint `bedrock-mantle`).
 * Les identifiants AWS viennent du rôle IAM de la Lambda.
 */
export class BedrockProvider implements LlmProvider {
  private client: AnthropicBedrockMantle;

  constructor(options: Partial<BedrockMantleClientOptions> = {}) {
    // 2 tentatives de 4 min au plus : reste sous la durée maximale de la Lambda worker (10 min).
    this.client = new AnthropicBedrockMantle({ awsRegion: config.bedrockRegion, timeout: 4 * 60 * 1000, maxRetries: 1, ...options });
  }

  async structured<T>(call: StructuredCall<T>, model: string): Promise<{ output: T; usage: LlmUsage }> {
    const params = bedrockParams(call, model);
    let response;
    try {
      // Au-delà de 16 000 tokens de sortie, la réponse est reçue en flux (évite les délais d'attente HTTP).
      response =
        call.maxTokens > 16000
          ? await this.client.messages.stream(params, { timeout: 7 * 60 * 1000, maxRetries: 0 }).finalMessage()
          : await this.client.messages.parse(params, call.timeoutMs ? { timeout: call.timeoutMs, maxRetries: 0 } : undefined);
    } catch (e) {
      throw bedrockError(e, model);
    }

    if (response.stop_reason === 'refusal') {
      throw new Error('Le modèle a refusé de traiter la demande. Reformulez ou retirez le contenu sensible.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('La réponse du modèle a été tronquée (document trop long). Réessayez sur une partie plus réduite.');
    }
    const output = 'parsed_output' in response && response.parsed_output != null ? response.parsed_output : parseText(response.content, call.schema);
    if (output == null) {
      throw new Error('Réponse du modèle illisible. Réessayez.');
    }
    const u = response.usage;
    return {
      output: output as T,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/**
 * Erreur d'appel à Bedrock rendue lisible (au lieu de « Erreur interne ») : code HTTP et message renvoyés par
 * Bedrock (droits, accès au modèle, quota…), ou cause technique (identifiants AWS, réseau). Détail complet dans les logs.
 */
export function bedrockError(e: unknown, model: string): HttpError {
  console.error(`Appel Bedrock (${model}, ${config.bedrockRegion}) en échec`, e);
  if (e instanceof APIError && e.status) {
    const status = e.status;
    const hint =
      status === 403 ? ' Vérifiez l’accès au modèle dans la console Bedrock et les droits IAM de la fonction.'
      : status === 404 ? ' Vérifiez le nom du modèle et la région.'
      : status === 429 ? ' Quota Bedrock atteint : réessayez dans une minute.'
      : '';
    return new HttpError(status === 429 ? 429 : 502, `L’IA (Bedrock, ${model}) a refusé l’appel : HTTP ${status} — ${e.message}.${hint}`);
  }
  const err = e as Error;
  return new HttpError(502, `Appel à l’IA (Bedrock, ${model}, ${config.bedrockRegion}) impossible : ${err?.name ?? 'Erreur'} — ${err?.message ?? String(e)}`);
}

/** Paramètres de l'appel Messages. */
function bedrockParams<T>(call: StructuredCall<T>, model: string) {
  // Les instructions système (et le contexte stable éventuel) sont identiques d'un appel à l'autre : on les met en cache.
  const system = [
    { type: 'text' as const, text: call.system, cache_control: { type: 'ephemeral' as const } },
    ...(call.context ? [{ type: 'text' as const, text: call.context, cache_control: { type: 'ephemeral' as const } }] : []),
  ];
  return {
    model,
    max_tokens: call.maxTokens,
    system,
    messages: [{ role: 'user' as const, content: call.input }],
    output_config: { effort: call.effort, format: zodOutputFormat(call.schema) },
  };
}

/** Requête HTTP que le SDK enverrait à Bedrock. */
export interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

class Captured extends Error {
  constructor(readonly request: CapturedRequest) {
    super('requête capturée');
  }
}

/**
 * Construit la requête exactement comme pour un vrai appel (même SDK, mêmes paramètres), mais l'intercepte avant
 * l'envoi : rien ne part sur le réseau, aucun coût. Sert à exporter le prompt pour le rejouer ailleurs (tests).
 */
export async function captureBedrockRequest<T>(call: StructuredCall<T>, model: string): Promise<CapturedRequest> {
  const capture = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    throw new Captured({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
  };
  const client = new AnthropicBedrockMantle({ awsRegion: config.bedrockRegion, skipAuth: true, fetch: capture as typeof fetch, maxRetries: 0 });
  try {
    const params = bedrockParams(call, model);
    if (call.maxTokens > 16000) await client.messages.stream(params).finalMessage();
    else await client.messages.parse(params);
  } catch (e) {
    let cur: unknown = e;
    // Le SDK peut envelopper l'erreur levée par `fetch`.
    for (let i = 0; i < 5 && cur; i++) {
      if (cur instanceof Captured) return cur.request;
      cur = (cur as { cause?: unknown }).cause;
    }
    throw e;
  }
  throw new Error('Requête Bedrock non capturée');
}

function parseText<T>(content: { type: string; text?: string }[], schema: StructuredCall<T>['schema']): T | null {
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}
