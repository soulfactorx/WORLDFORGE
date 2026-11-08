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
    expect(g.choices!.length).toBe(5);
    expect(g.choiceKinds).toEqual(['advance', 'bond', 'bold', 'wild', 'move']);
    expect(g.choices!.at(-1)).toMatch(/(으로|로) 향한다$/); // 이동 선택지 (v0.82.1)
    expect(g.choices).not.toContain('주변을 자세히 살펴본다');
  });
  it('AI 안내: 플레이어가 아는 것만 보내고, 형식이 잘못되면 기본 안내', async () => {
    const s = state();
    let sent = '';
    const llm = (out: unknown): LlmClient => ({ stream: async () => '', json: async <T,>(r: { user: string }) => { sent = r.user; return out as T; } });
    const g = await gmGuide(llm({ summary: '요약', suggestion: '제안', choices: ['a', 'b', 'c', 'd', 'e'] }), sampleWorld, s, '서술');
    expect(g.type === 'gm_guide' && g.choices.slice(0, 4)).toEqual(['a', 'b', 'c', 'd']);
    expect(g.type === 'gm_guide' && g.choices[4]).toMatch(/향한다/); // 엔진이 고른 이동 선택지
    for (const f of sampleWorld.facts) expect(sent).not.toContain(f.statement);
    expect(await gmGuide(llm({ facts: [] }), sampleWorld, s, '서술')).toEqual(basicGuide(sampleWorld, s));
  });
  it('AI 안내 (v0.58): 선택지 성격·세계 문체·이야기 정체·지난 선택지를 보낸다', async () => {
    const s0 = state();
    // 같은 장소에서 4턴 동안 별일이 없었다
    const s = { ...s0, turn: s0.turn + 4 };
    let sys = '', user = '';
    const llm: LlmClient = { stream: async () => '', json: async <T,>(r: { system: string; user: string }) => { sys = r.system; user = r.user; return { summary: '안개 속에서 누군가 당신을 지켜본다.', suggestion: '저 시선의 주인이 궁금하지 않은가?', choices: [
      { text: '마을로 향한다', skill: '', kind: 'advance' }, { text: '장로를 떠본다', skill: 'insight', kind: 'bond' },
      { text: '제단을 부순다', skill: 'athletics', kind: 'bold' }, { text: '제단에 피 한 방울을 떨어뜨린다', skill: '', kind: 'wild' }],
      move: { text: '개 짖는 소리를 따라 마을로 내려간다', location: 'loc/village-gate' } } as T; } };
    const g = await gmGuide(llm, { ...sampleWorld, style: '건조하고 음산한 문체' }, s, '서술');
    expect(g.type === 'gm_guide' && g.choiceKinds).toEqual(['advance', 'bond', 'bold', 'wild', 'move']);
    expect(g.type === 'gm_guide' && g.choices[4]).toContain('마을 입구'); // AI 글에 장소 이름이 없으면 붙인다
    expect(sys).toContain('move: 이동 선택지');
    expect(sys).toContain('wild');
    expect(sys).toContain('건조하고 음산한 문체');
    expect(user).toContain('이야기가 정체되어 있다');
    expect(user).toContain('## 지난 선택지');
    expect(user).toContain(s0.log.at(-1)!.choices![0]!);
  });
});
