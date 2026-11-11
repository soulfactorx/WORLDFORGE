import { describe, expect, it, vi } from 'vitest';

/** v0.102: 스키마가 커서 구조화 출력이 거절되면(400) 스키마를 프롬프트로 보내 JSON을 받는다 */
const calls: { format: boolean; system: string }[] = [];
vi.mock('@anthropic-ai/sdk', () => {
  class BadRequestError extends Error { status = 400; }
  class Anthropic {
    static BadRequestError = BadRequestError;
    beta = { messages: { create: async (body: { system: string; output_config: { format?: unknown } }) => {
      calls.push({ format: !!body.output_config.format, system: body.system });
      if (body.output_config.format && body.system.includes('큰 스키마')) throw new BadRequestError('400 {"type":"error","error":{"type":"invalid_request_error","message":"The compiled grammar is too large, which would cause performance issues."}}');
      if (body.system.includes('다른 오류')) throw new BadRequestError('400 max_tokens: too large');
      return { id: 'm', model: 'x', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: body.output_config.format ? '{"a":1}' : '```json\n{"a":2}\n```' }] };
    } } };
  }
  return { default: Anthropic };
});

describe('Claude: 큰 스키마', () => {
  it('거절되면 스키마를 프롬프트로 보내 다시 받고, 그 스키마는 다음부터 바로 그렇게 보낸다', async () => {
    const { createAnthropicClient } = await import('./anthropic');
    const llm = createAnthropicClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5' });
    const big = { type: 'object' }, small = { type: 'object' };
    expect(await llm.json({ system: '큰 스키마', user: 'u', maxTokens: 100 }, big)).toEqual({ a: 2 });
    expect(calls.map((c) => c.format)).toEqual([true, false]);
    expect(calls[1]!.system).toContain('JSON 스키마에 맞는 JSON 객체 하나만');
    expect(await llm.json({ system: '큰 스키마', user: 'u', maxTokens: 100 }, big)).toEqual({ a: 2 });
    expect(calls.map((c) => c.format)).toEqual([true, false, false]); // 기억한다
    expect(await llm.json({ system: '작은 것', user: 'u', maxTokens: 100 }, small)).toEqual({ a: 1 });
    expect(calls.at(-1)!.format).toBe(true); // 다른 스키마는 그대로 구조화 출력
  });
  it('다른 400은 그대로 알린다', async () => {
    const { createAnthropicClient } = await import('./anthropic');
    const llm = createAnthropicClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5' });
    await expect(llm.json({ system: '다른 오류', user: 'u', maxTokens: 100 }, { type: 'object' })).rejects.toThrow('max_tokens');
  });
});
