import { describe, expect, it } from 'vitest';
import { cached, repairJson, resetTokenBoost, robust, tokenBoost } from './robust';
import { LlmHttpError, LlmRefusalError, LlmTruncatedError, type LlmClient } from './types';

const seq = (outs: (() => unknown)[]) => {
  const calls: { maxTokens: number; system: string }[] = [];
  const c: LlmClient = { stream: async () => '', json: async <T,>(r: { maxTokens: number; system: string }) => { calls.push(r); return outs[Math.min(calls.length - 1, outs.length - 1)]!() as T; } };
  return { c, calls };
};

describe('AI 호출 안정화', () => {
  it('잘린 JSON을 복구한다 (불완전한 마지막 항목은 버린다)', () => {
    expect(repairJson('{"a":[1,2,{"x":"ab')).toEqual({ a: [1, 2] });
    expect(repairJson('{"name":"x","items":[{"k":1},{"k":2}],"more":"wor')).toEqual({ name: 'x', items: [{ k: 1 }, { k: 2 }] });
    expect(repairJson('앞말 {"ok":true}')).toEqual({ ok: true });
  });
  it('서버 오류·잘린 응답은 다시 시도하고, 잘리면 한도를 늘리고 짧게 하라고 한다', async () => {
    const { c, calls } = seq([() => { throw new LlmHttpError(529, 'overloaded'); }, () => { throw new LlmTruncatedError('{"a":[1,'); }, () => ({ a: [1, 2] })]);
    const retries: string[] = [];
    expect(await robust(c, { baseDelayMs: 1, onRetry: (n, w) => retries.push(`${n}:${w}`) }).json({ system: 's', user: 'u', maxTokens: 1000 }, {})).toEqual({ a: [1, 2] });
    expect(calls.map((x) => x.maxTokens)).toEqual([1000, 1000, 1500]);
    expect(calls[2]!.system).toContain('길이 제한');
    expect(retries.length).toBe(2);
  });
  it('계속 잘리면 마지막에 잘린 응답을 복구해 쓴다. 거절·잘못된 요청은 다시 하지 않는다', async () => {
    const t = seq([() => { throw new LlmTruncatedError('{"list":[{"n":1},{"n":2},{"n'); }]);
    expect(await robust(t.c, { baseDelayMs: 1 }).json({ system: '', user: '', maxTokens: 100 }, {})).toEqual({ list: [{ n: 1 }, { n: 2 }] });
    const r = seq([() => { throw new LlmRefusalError('no'); }]);
    await expect(robust(r.c, { baseDelayMs: 1 }).json({ system: '', user: '', maxTokens: 1 }, {})).rejects.toThrow('no');
    expect(r.calls.length).toBe(1);
    const b = seq([() => { throw new LlmHttpError(401, 'bad key'); }]);
    await expect(robust(b.c, { baseDelayMs: 1 }).json({ system: '', user: '', maxTokens: 1 }, {})).rejects.toThrow('bad key');
    expect(b.calls.length).toBe(1);
  });
  it('같은 요청은 저장된 결과를 다시 쓴다', async () => {
    const { c, calls } = seq([() => ({ v: Math.random() })]);
    const store = new Map<string, unknown>();
    let hits = 0;
    const llm = cached(c, { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } }, () => hits++);
    const a = await llm.json({ system: 's', user: 'u', maxTokens: 1 }, { x: 1 });
    expect(await llm.json({ system: 's', user: 'u', maxTokens: 999 }, { x: 1 })).toEqual(a);
    await llm.json({ system: 's', user: 'other', maxTokens: 1 }, { x: 1 });
    expect([calls.length, hits]).toEqual([2, 1]);
  });
});

describe('재시도 안내에 단계 이름 (v0.37.10)', () => {
  it('잘린 응답의 재시도는 어느 단계인지 함께 알리고, 기다리지 않고 바로 다시 요청한다', async () => {
    const { c } = seq([() => { throw new LlmTruncatedError('{"a":['); }, () => ({ a: [] })]);
    const seen: (string | undefined)[] = [];
    const t0 = Date.now();
    await robust(c, { baseDelayMs: 5000, onRetry: (_n, _w, label) => seen.push(label) }).json({ system: '', user: '', maxTokens: 100, label: '번역 3/8 묶음' }, {});
    expect(seen).toEqual(['번역 3/8 묶음']);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('잘려서 늘린 한도로 성공하면 그 한도를 기억해 다음 요청부터 처음부터 쓴다 (v0.83.1)', async () => {
    resetTokenBoost();
    const a = seq([() => { throw new LlmTruncatedError('{"a":['); }, () => ({ a: 1 })]);
    await robust(a.c, { baseDelayMs: 1, learnKey: 'm' }).json({ system: 's', user: 'u', maxTokens: 1000 }, {});
    expect(a.calls.map((x) => x.maxTokens)).toEqual([1000, 1500]);
    expect(tokenBoost('m')).toBe(1.5);
    // 새 클라이언트·다른 단계여도 같은 모델이면 재시도 없이 한 번에
    const b = seq([() => ({ b: 1 })]);
    await robust(b.c, { baseDelayMs: 1, learnKey: 'm' }).json({ system: 's2', user: 'u2', maxTokens: 4000 }, {});
    expect(b.calls.map((x) => x.maxTokens)).toEqual([6000]);
    expect(b.calls[0]!.system).toBe('s2'); // "짧게" 지시는 붙이지 않는다
    // 다른 모델은 따로
    const c = seq([() => ({ c: 1 })]);
    await robust(c.c, { baseDelayMs: 1, learnKey: 'other' }).json({ system: 's', user: 'u', maxTokens: 4000 }, {});
    expect(c.calls[0]!.maxTokens).toBe(4000);
    // 모델이 그 한도를 받지 못하면 배운 배율을 버리고 원래 한도로
    const d = seq([() => { throw new LlmHttpError(400, 'LLM 요청 실패 (400): max_tokens is too large'); }, () => ({ d: 1 })]);
    await robust(d.c, { baseDelayMs: 1, learnKey: 'm' }).json({ system: 's', user: 'u', maxTokens: 4000 }, {});
    expect(d.calls.map((x) => x.maxTokens)).toEqual([6000, 4000]);
    expect(tokenBoost('m')).toBe(1);
  });
});
