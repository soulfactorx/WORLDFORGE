import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient } from './openai-compatible';
import type { Meter } from './types';

/** v0.95: OpenRouter에는 생각 깊이를 보내고, 다른 호환 서버에는 보내지 않는다. 생각 토큰은 따로 센다 */
describe('OpenAI 호환: 생각 깊이', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 700 } } }) };
    });
    return bodies;
  };
  it('OpenRouter: 기본 low, 요청이 정하면 그 값', async () => {
    const bodies = stub();
    const llm = createOpenAiCompatibleClient({ provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'k' });
    const meter: Meter = { input: 0, output: 0, calls: 0 };
    await llm.json({ system: 's', user: 'u', maxTokens: 100, meter }, {});
    await llm.json({ system: 's', user: 'u', maxTokens: 100, effort: 'medium' }, {});
    expect(bodies[0]!.reasoning).toEqual({ effort: 'low' });
    expect(bodies[1]!.reasoning).toEqual({ effort: 'medium' });
    expect(meter).toMatchObject({ output: 900, reasoning: 700 });
  });
  it('다른 서버에는 보내지 않는다', async () => {
    const bodies = stub();
    await createOpenAiCompatibleClient({ provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'm', apiKey: '' }).json({ system: 's', user: 'u', maxTokens: 100 }, {});
    await createOpenAiCompatibleClient({ provider: 'openai-compatible', baseUrl: 'https://notopenrouter.ai.example.com/v1', model: 'm', apiKey: '' }).json({ system: 's', user: 'u', maxTokens: 100 }, {});
    expect(bodies.every((b) => !('reasoning' in b))).toBe(true);
  });
  it('minimal을 거절(400)하면 low로 다시 보내고, 그 뒤로는 low로 보낸다', async () => {
    const efforts: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      const e = JSON.parse(init.body).reasoning.effort as string; efforts.push(e);
      if (e === 'minimal') return { ok: false, status: 400, text: async () => 'bad effort' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }) };
    });
    const llm = createOpenAiCompatibleClient({ provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'k' });
    expect(await llm.json({ system: 's', user: 'u', maxTokens: 100, effort: 'minimal' }, {})).toEqual({ a: 1 });
    await llm.json({ system: 's', user: 'u', maxTokens: 100, effort: 'minimal' }, {});
    expect(efforts).toEqual(['minimal', 'low', 'low']);
  });
});
