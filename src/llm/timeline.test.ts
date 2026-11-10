import { describe, expect, it } from 'vitest';
import { createLimiter, limited } from './limiter';
import { metered, type CallRecord } from './metrics';
import { runTimeline, timelineText, type UsageRow } from './usage';
import type { LlmClient } from './types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('작업 타임라인 (v0.93)', () => {
  it('호출마다 기다린 시간·보낸 출력 한도·노력을 기록한다', async () => {
    const raw: LlmClient = { stream: async () => '', json: async <T,>() => { await wait(20); return {} as T; } };
    const out: CallRecord[] = [];
    const llm = metered(limited(raw, createLimiter(1)), 'm', (r) => out.push(r));
    await Promise.all([llm.json({ system: '', user: 'a', maxTokens: 111, effort: 'medium', label: '첫째' }, {}), llm.json({ system: '', user: 'b', maxTokens: 222, label: '둘째' }, {})]);
    const second = out.find((r) => r.label === '둘째')!;
    expect(out.find((r) => r.label === '첫째')).toMatchObject({ maxTokens: 111, effort: 'medium' });
    expect(second.maxTokens).toBe(222);
    expect(second.waitMs).toBeGreaterThanOrEqual(15); // 첫째가 끝나기를 기다렸다
  });

  it('시작 순서·겹침·가장 오래 걸린 단계를 계산하고 글로 내보낸다', () => {
    const row = (label: string, start: number, ms: number, extra: Partial<UsageRow> = {}): UsageRow => ({ at: 1000 + start + ms, role: 'worldgen', model: 'm', ms, input: 100, output: 500, calls: 1, ok: true, label, ...extra });
    const t = runTimeline([row('세계 구조', 0, 60000), row('번역 1/2 묶음', 0, 20000), row('이야기 뼈대 + 장면', 60000, 90000, { waitMs: 5000, maxTokens: 12000, effort: 'medium', calls: 2 }), row('임무·조우·결말', 150000, 40000)]);
    expect(t.steps.map((s) => s.label)).toEqual(['세계 구조', '번역 1/2 묶음', '이야기 뼈대 + 장면', '임무·조우·결말']);
    expect(t.wallMs).toBe(190000);
    expect(t.sumMs).toBe(210000);
    expect(t.peak).toBe(2);
    expect(t.steps[2]!.tps).toBe(Math.round(500 / 85)); // 기다린 시간은 빼고 잰 속도
    const text = timelineText('카드 변환', t);
    expect(text).toContain('전체 190.0s');
    expect(text).toContain('이야기 뼈대 + 장면');
    expect(text).toContain('12000·medium');
    expect(text).toContain('1회');
  });
});
