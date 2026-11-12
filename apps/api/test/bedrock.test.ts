import { describe, expect, it } from 'vitest';
import { BedrockProvider } from '../src/ai/bedrock.js';
import { extractionSchema } from '../src/ai/schemas.js';
import { EXTRACTION_SYSTEM } from '../src/ai/prompts.js';

const output = { titre: 'Migration', prestataire: 'Coqliqo', phase: null, jalons: [{ label: 'Production', date: '2026-11-16' }], estimationJours: 8, notes: '## Contexte\n- x' };

/** Envoie un appel par le fournisseur Bedrock vers un faux serveur ; renvoie la requête reçue et le résultat. */
async function send(api: 'runtime' | 'mantle', model: string) {
  let captured: { url: string; body: any } | null = null;
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text: JSON.stringify(output) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const provider = new BedrockProvider({ api, awsRegion: 'eu-west-3', skipAuth: true, fetch: fakeFetch as typeof fetch, maxRetries: 0 });
  const res = await provider.structured(
    { tier: 'fast', operation: 'extraction', system: EXTRACTION_SYSTEM, input: 'transcription', schema: extractionSchema, maxTokens: 8000, effort: 'low', ctx: { user: 'u', cdcId: 'c' } },
    model,
  );
  return { captured: captured!, res };
}

function expectCommonBody(body: any) {
  expect(body.max_tokens).toBe(8000);
  expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(body.output_config.effort).toBe('low');
  expect(body.output_config.format.type).toBe('json_schema');
  expect(body.output_config.format.schema.properties.notes).toBeTruthy();
  expect(body.tool_choice).toBeUndefined();
  expect(body.thinking?.budget_tokens).toBeUndefined();
  expect(body.temperature).toBeUndefined();
}

describe('fournisseur Bedrock', () => {
  it('appelle InvokeModel (bedrock-runtime) avec le profil d’inférence européen, et lit la réponse', async () => {
    const { captured, res } = await send('runtime', 'eu.anthropic.claude-haiku-5-5');
    expect(captured.url).toBe('https://bedrock-runtime.eu-west-3.amazonaws.com/model/eu.anthropic.claude-haiku-5-5/invoke');
    expect(captured.body.model).toBeUndefined();
    expect(captured.body.anthropic_version).toBeTruthy();
    expectCommonBody(captured.body);
    expect(res.output).toEqual(output);
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0 });
  });

  it('peut aussi appeler l’API Messages native (bedrock-mantle)', async () => {
    const { captured, res } = await send('mantle', 'anthropic.claude-haiku-5-5');
    expect(captured.url).toBe('https://bedrock-mantle.eu-west-3.api.aws/anthropic/v1/messages');
    expect(captured.body.model).toBe('anthropic.claude-haiku-5-5');
    expectCommonBody(captured.body);
    expect(res.output).toEqual(output);
  });
});
