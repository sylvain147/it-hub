import { describe, expect, it } from 'vitest';
import { BedrockProvider } from '../src/ai/bedrock.js';
import { extractionSchema } from '../src/ai/schemas.js';
import { EXTRACTION_SYSTEM } from '../src/ai/prompts.js';

describe('fournisseur Bedrock', () => {
  it('envoie une requête Messages avec cache de prompt, effort et sortie structurée, et lit la réponse', async () => {
    let captured: { url: string; body: any } | null = null;
    const output = { titre: 'Migration', prestataire: 'Coqliqo', phase: null, jalons: [{ label: 'Production', date: '2026-11-16' }], estimationJours: 8, notes: '## Contexte\n- x' };
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'anthropic.claude-haiku-5-5',
          content: [{ type: 'text', text: JSON.stringify(output) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const provider = new BedrockProvider({ awsRegion: 'eu-west-3', skipAuth: true, fetch: fakeFetch as typeof fetch, maxRetries: 0 });
    const res = await provider.structured(
      { tier: 'fast', operation: 'extraction', system: EXTRACTION_SYSTEM, input: 'transcription', schema: extractionSchema, maxTokens: 8000, effort: 'low', ctx: { user: 'u', cdcId: 'c' } },
      'anthropic.claude-haiku-5-5',
    );

    expect(captured!.url).toBe('https://bedrock-mantle.eu-west-3.api.aws/anthropic/v1/messages');
    const body = captured!.body;
    expect(body.model).toBe('anthropic.claude-haiku-5-5');
    expect(body.max_tokens).toBe(8000);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.properties.notes).toBeTruthy();
    expect(body.tool_choice).toBeUndefined();
    expect(body.thinking?.budget_tokens).toBeUndefined();

    expect(res.output).toEqual(output);
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0 });
  });
});
