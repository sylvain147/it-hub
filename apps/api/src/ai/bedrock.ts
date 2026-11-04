import { AnthropicBedrockMantle, type BedrockMantleClientOptions } from '@anthropic-ai/bedrock-sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';
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
    // Les instructions système (et le contexte stable éventuel) sont identiques d'un appel à l'autre : on les met en cache.
    const system = [
      { type: 'text' as const, text: call.system, cache_control: { type: 'ephemeral' as const } },
      ...(call.context ? [{ type: 'text' as const, text: call.context, cache_control: { type: 'ephemeral' as const } }] : []),
    ];
    const params = {
      model,
      max_tokens: call.maxTokens,
      system,
      messages: [{ role: 'user' as const, content: call.input }],
      output_config: { effort: call.effort, format: zodOutputFormat(call.schema) },
    };
    // Au-delà de 16 000 tokens de sortie, la réponse est reçue en flux (évite les délais d'attente HTTP).
    const response =
      call.maxTokens > 16000
        ? await this.client.messages.stream(params, { timeout: 7 * 60 * 1000, maxRetries: 0 }).finalMessage()
        : await this.client.messages.parse(params);

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
