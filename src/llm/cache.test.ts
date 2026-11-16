import { describe, expect, it, vi } from 'vitest';

/** v0.141: 프롬프트 캐싱 — 긴 시스템 프롬프트와 user 글의 바뀌지 않는 앞부분에 캐시 표시, 캐시 사용량을 계측 */
const bodies: { system: unknown; messages: { content: unknown }[] }[] = [];
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    static BadRequestError = class extends Error {};
    beta = { messages: { stream: (body: { system: unknown; messages: { content: unknown }[] }) => {
      bodies.push(body);
      const msg = { id: 'm', model: 'x', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: '좋다' }] };
      return { on: () => {}, finalMessage: async () => msg };
    } } };
  }
  return { default: Anthropic };
});

describe('프롬프트 캐싱 (v0.141)', () => {
  it('긴 시스템 프롬프트 · 바뀌지 않는 앞부분에 표시, 짧으면 표시하지 않는다', async () => {
    const { createAnthropicClient } = await import('./anthropic');
    const llm = createAnthropicClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5-5' });
    const longSys = '규칙 '.repeat(800), brief = '세계 개요 '.repeat(400), rest = '\n## 지금 장면\n바뀌는 것';
    const meter = { input: 0, output: 0, calls: 0 };
    await llm.stream({ system: longSys, user: brief + rest, maxTokens: 100, stablePrefix: brief.length, meter }, () => {});
    const b = bodies.at(-1)!;
    expect(b.system).toEqual([{ type: 'text', text: longSys, cache_control: { type: 'ephemeral' } }]);
    expect(b.messages[0]!.content).toEqual([{ type: 'text', text: brief, cache_control: { type: 'ephemeral' } }, { type: 'text', text: rest }]);
    expect(meter).toMatchObject({ input: 1000, cacheRead: 900 });
    await llm.stream({ system: '짧은 규칙', user: '짧은 글', maxTokens: 100, stablePrefix: 3 }, () => {});
    expect(bodies.at(-1)!.system).toBe('짧은 규칙');
    expect(bodies.at(-1)!.messages[0]!.content).toEqual([{ type: 'text', text: '짧은 글' }]);
  });
});
