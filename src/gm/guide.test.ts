import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { basicGuide, gmGuide } from './guide';
import { startEvents } from './turn';

const state = () => replay(startEvents(sampleWorld, legacyCharacter('나'), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

describe('GM 안내', () => {
  it('시작 장면에 기본 안내와 선택지가 붙는다', () => {
    const s = state();
    const g = s.log.at(-1)!;
    expect(g.kind).toBe('guide');
    expect(g.choices!.length).toBeGreaterThanOrEqual(2);
    expect(g.choices![0]).toBe('주변을 자세히 살펴본다');
  });
  it('AI 안내: 플레이어가 아는 것만 보내고, 형식이 잘못되면 기본 안내', async () => {
    const s = state();
    let sent = '';
    const llm = (out: unknown): LlmClient => ({ stream: async () => '', json: async <T,>(r: { user: string }) => { sent = r.user; return out as T; } });
    const g = await gmGuide(llm({ summary: '요약', suggestion: '제안', choices: ['a', 'b', 'c', 'd', 'e'] }), sampleWorld, s, '서술');
    expect(g).toEqual({ type: 'gm_guide', summary: '요약', suggestion: '제안', choices: ['a', 'b', 'c', 'd'] });
    for (const f of sampleWorld.facts) expect(sent).not.toContain(f.statement);
    expect(await gmGuide(llm({ facts: [] }), sampleWorld, s, '서술')).toEqual(basicGuide(sampleWorld, s));
  });
});
