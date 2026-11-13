import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { splitTail, tailFilter, TAIL_MARK } from './guide';
import { runTurn, startEvents } from './turn';

const start = () => replay(startEvents(sampleWorld, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const director = { action_summary: '둘러본다', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '' };
const tailJson = { summary: '무언가 수상하다.', suggestion: '저 문이 궁금하다.', choices: [{ text: '문을 두드린다', skill: '', kind: 'advance', scene: '' }, { text: '문지기에게 말을 건다', skill: 'persuasion', kind: 'bond', scene: '' }], move: { text: '', location: '' } };

describe('선택지 꼬리 (v0.111, 설계 v6 M1)', () => {
  it('서술과 꼬리를 나눈다', () => {
    const { narration, tail } = splitTail(`문이 닫혀 있다.\n\n${TAIL_MARK}\n${JSON.stringify(tailJson)}`);
    expect(narration).toBe('문이 닫혀 있다.');
    expect(tail?.choices).toHaveLength(2);
    expect(splitTail('그냥 서술').tail).toBeNull();
    expect(splitTail(`서술\n${TAIL_MARK}\n{깨진`).tail).toBeNull();
  });
  it('흘러나오는 글에서 꼬리 표시가 조각 사이에 걸쳐도 감춘다', () => {
    let shown = '';
    const f = tailFilter((d) => { shown += d; });
    const text = `첫 문단.\n\n${TAIL_MARK}\n{"summary":"x"}`;
    for (let i = 0; i < text.length; i += 3) f(text.slice(i, i + 3));
    expect(shown).toBe('첫 문단.\n\n');
  });
  it('꼬리가 있으면 안내를 따로 부르지 않는다', async () => {
    const systems: string[] = [];
    let shown = '';
    const llm: LlmClient = {
      stream: async (r, onText) => { systems.push(r.system); const t = `문이 닫혀 있다.\n\n${TAIL_MARK}\n${JSON.stringify(tailJson)}`; onText(t); return t; },
      json: async <T,>(r: { system: string }) => { systems.push(r.system); return (r.system.includes('판단 모듈') ? director : { facts: [], summary: '' }) as T; },
    };
    const r = await runTurn(llm, sampleWorld, start(), '둘러본다', (d) => { shown += d; });
    expect(systems.some((x) => x.includes('안내자') && !x.includes('서술자'))).toBe(false);
    expect(shown).not.toContain(TAIL_MARK);
    const n = r.events.find((e) => e.type === 'narration');
    expect(n?.type === 'narration' && n.text).toBe('문이 닫혀 있다.');
    const g = r.events.find((e) => e.type === 'gm_guide');
    expect(g?.type === 'gm_guide' && g.choices.slice(0, 2)).toEqual(['문을 두드린다', '문지기에게 말을 건다']);
  });
  it('꼬리가 없으면 예전처럼 안내를 부른다', async () => {
    const systems: string[] = [];
    const llm: LlmClient = {
      stream: async (_r, onText) => { onText('문이 닫혀 있다.'); return '문이 닫혀 있다.'; },
      json: async <T,>(r: { system: string }) => { systems.push(r.system); return (r.system.includes('판단 모듈') ? director : r.system.includes('안내자') ? tailJson : { facts: [], summary: '' }) as T; },
    };
    const r = await runTurn(llm, sampleWorld, start(), '둘러본다', () => {});
    expect(systems.some((x) => x.includes('안내자'))).toBe(true);
    expect(r.events.some((e) => e.type === 'gm_guide')).toBe(true);
  });
});

describe('NPC 연기 AI는 필요할 때만 (v0.111)', () => {
  it('알려 줄 것이 없는 인물은 GM 판단의 요지로 서술자가 쓴다', async () => {
    const w = structuredClone(sampleWorld);
    const here = w.start.locationId;
    w.characters = [{ ...w.characters[0]!, id: 'npc/plain', name: '행인', locationId: here, companion: undefined }];
    w.beliefs = w.beliefs.filter((b) => b.holder !== 'npc/plain');
    const st = replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    const systems: string[] = []; const users: string[] = [];
    const llm: LlmClient = {
      stream: async (r, onText) => { users.push(r.user); onText('.'); return '.'; },
      json: async <T,>(r: { system: string }) => { systems.push(r.system); return (r.system.includes('판단 모듈') ? { ...director, speakers: [{ npc_id: 'npc/plain', reacting_to: '인사', intent: '귀찮다는 듯 손을 젓는다', warmth: -1 }] } : { facts: [], summary: '' }) as T; },
    };
    const r = await runTurn(llm, w, st, '인사한다', () => {});
    expect(systems.some((x) => x.includes('한 명의 NPC'))).toBe(false);
    expect(users[0]).toContain('서술자가 쓴다');
    expect(r.events.some((e) => e.type === 'relationship_changed')).toBe(true);
  });
});
