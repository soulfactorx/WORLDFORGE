import { describe, expect, it } from 'vitest';
import { createLimiter, limited } from './limiter';
import { connectionDropped, rateLimited, robust } from './robust';
import { simulateVisibility } from './visibility';
import { LlmHttpError, type LlmClient } from './types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('동시 요청 제한 (v0.92)', () => {
  it('한 번에 정해진 수까지만 보내고 나머지는 순서대로 기다린다', async () => {
    const lim = createLimiter(3);
    let live = 0, peak = 0;
    const done: number[] = [];
    await Promise.all(Array.from({ length: 10 }, (_, i) => lim.run(async () => { live++; peak = Math.max(peak, live); await wait(5); live--; done.push(i); })));
    expect(peak).toBe(3);
    expect(done.length).toBe(10);
  });

  it('요청 한도에 걸리면 동시 수를 줄이고, 한동안 걸리지 않으면 되돌린다', async () => {
    const lim = createLimiter(4, 20);
    lim.penalize(); lim.penalize();
    expect(lim.limit).toBe(2);
    let live = 0, peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => lim.run(async () => { live++; peak = Math.max(peak, live); await wait(3); live--; })));
    expect(peak).toBe(2);
    await wait(30);
    await lim.run(async () => {});
    expect(lim.limit).toBeGreaterThan(2);
    for (let i = 0; i < 9; i++) lim.penalize();
    expect(lim.limit).toBe(1); // 하나 아래로는 내려가지 않는다
  });

  it('실패해도 자리를 돌려준다', async () => {
    const lim = createLimiter(1);
    await expect(lim.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(lim.run(async () => 7)).resolves.toBe(7);
  });
});

describe('다시 보내기 판단 (v0.92)', () => {
  it('서버가 답한 오류(429·500)는 연결 끊김이 아니다', () => {
    expect(connectionDropped(new TypeError('Failed to fetch'))).toBe(true);
    expect(connectionDropped(new LlmHttpError(0, 'network'))).toBe(true);
    expect(connectionDropped(new LlmHttpError(429, 'rate limit'))).toBe(false);
    expect(connectionDropped(Object.assign(new Error('Connection error.'), { status: 500 }))).toBe(false);
    expect(rateLimited(new LlmHttpError(429, 'x'))).toBe(true);
    expect(rateLimited(new Error('Overloaded'))).toBe(true);
    expect(rateLimited(new LlmHttpError(500, 'server'))).toBe(false);
  });

  it('요청 중 화면이 가려졌어도 한도 초과는 "앱을 벗어남"으로 다루지 않는다 — 기다렸다 다시 보내고 동시 수를 줄인다', async () => {
    let calls = 0;
    const reasons: string[] = [];
    let limitedHits = 0;
    const raw: LlmClient = {
      stream: async () => '',
      json: async <T,>() => { calls++; if (calls === 1) { simulateVisibility(true); simulateVisibility(false); throw new LlmHttpError(429, 'rate limit exceeded'); } return { ok: true } as T; },
    };
    const llm = robust(raw, { baseDelayMs: 1, onRetry: (_n, why) => reasons.push(why), onRateLimit: () => { limitedHits++; } });
    await expect(llm.json({ system: '', user: '', maxTokens: 10 }, {})).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(limitedHits).toBe(1);
    expect(reasons[0]).toContain('요청 한도');
    expect(reasons.join(' ')).not.toContain('앱을 벗어나');
  });

  it('제한은 실제 요청 구간에만 걸린다', async () => {
    const lim = createLimiter(1);
    const order: string[] = [];
    const raw: LlmClient = { stream: async () => '', json: async <T,>(req: { user: string }) => { order.push(`s:${req.user}`); await wait(3); order.push(`e:${req.user}`); return {} as T; } };
    const llm = limited(raw, lim);
    await Promise.all(['a', 'b'].map((user) => llm.json({ system: '', user, maxTokens: 1 }, {})));
    expect(order).toEqual(['s:a', 'e:a', 's:b', 'e:b']);
  });
});
