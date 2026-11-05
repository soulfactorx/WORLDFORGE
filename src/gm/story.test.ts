import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import { evalCondition } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { pendingChoice } from '../engine/story';
import type { LlmClient } from '../llm/types';
import { scenarioEvents } from './scenario';
import { runTurn, startEvents } from './turn';

/** 샘플 세계 + 이야기 엔진 데이터 */
const world = (): WorldPackage => ({
  ...structuredClone(sampleWorld),
  flags: [...(sampleWorld.flags ?? []), { id: 'warned_village', when: '마을에 위험을 알렸을 때' }, { id: 'raid_happened', when: '(엔진)' }, { id: 'sided_elder', when: '(엔진)' }, { id: 'sided_ilse', when: '(엔진)' }],
  arcs: [{
    id: 'arc/shadow', name: '숲의 그림자', kind: 'main', start: { all: [] },
    chapters: [
      { name: '낯선 땅', goal: '마을에 닿는다', summary: '사람이 사는 곳을 찾자', complete: { at: 'loc/village-gate' } },
      { name: '제단의 비밀', goal: '제단과 장로의 관계를 알아낸다', complete: { knows: 'claim/altar-summoning' }, fail: { flag: 'raid_happened' }, effects: [{ reputation: 'fac/village', delta: 5 }] },
    ],
  }],
  factions: [{ id: 'fac/village', name: '미스트베일', description: '안개 골짜기 마을' }],
  clocks: [{
    id: 'clock/raid', name: '도적의 습격 준비', segments: 4,
    tick: [{ every: 'day', by: 1 }, { on: { flag: 'warned_village' }, by: -2 }],
    at: [{ segment: 2, omen: '숲 쪽에서 낯선 말발굽 자국이 발견됐다는 이야기가 돈다.' }, { segment: 4, effects: [{ setFlag: 'raid_happened' }], omen: '밤사이 마을 창고가 불탔다.' }],
  }],
  events: [
    { id: 'event/fair', name: '수확 장터', when: { day: 1 }, effects: [{ reveal: 'claim/village-name', state: 'confirmed' }], announce: '📜 마을 광장에 장터가 섰다.' },
    { id: 'event/ilse-leaves', name: '일제가 떠난다', when: { day: 2 }, unless: { flag: 'warned_village' }, effects: [{ moveNpc: 'npc/ilse', to: 'loc/old-road' }] },
  ],
  choices: [{
    id: 'choice/side', name: '누구 편인가', prompt: '장로와 일제, 누구의 말을 믿을 것인가?', when: { knows: 'claim/altar-cursed' },
    options: [{ id: 'elder', text: '장로를 믿는다', effects: [{ setFlag: 'sided_elder' }] }, { id: 'ilse', text: '일제를 믿는다', effects: [{ setFlag: 'sided_ilse' }, { relationship: 'npc/ilse', delta: { trust: 10 } }] }],
  }],
});
const start = (w: WorldPackage) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const run = (w: WorldPackage, s: GameState, extra: GameEvent[] = []) => {
  for (const e of extra) s = applyEvent(s, e, s.turn);
  for (const e of scenarioEvents(w, s).events) s = applyEvent(s, e, s.turn);
  return s;
};
const days = (n: number): GameEvent => ({ type: 'time_advanced', minutes: n * 1440 });

describe('이야기 엔진 (설계 v3 5장)', () => {
  it('검사기를 통과한다', () => {
    expect(validateWorld(world()).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('줄기: 시작과 함께 열리고, 장을 끝내면 다음 장·효과, 실패 조건이면 실패로 끝난다', () => {
    const w = world();
    let s = start(w);
    expect(s.arcs['arc/shadow']).toEqual({ chapter: 0, done: false });
    s = run(w, s, [{ type: 'moved', to: 'loc/village-gate' }]);
    expect(s.arcs['arc/shadow']!.chapter).toBe(1);
    expect(evalCondition(w, s, { chapter: 'arc/shadow', gte: 1 })).toBe(true);
    const ok = run(w, s, [{ type: 'knowledge_revealed', belief: { holder: 'player', claim: 'claim/altar-summoning', state: 'confirmed' } }]);
    expect(ok.arcs['arc/shadow']).toEqual({ chapter: 2, done: true });
    expect(ok.reputation['fac/village']).toBe(5);
    expect(evalCondition(w, ok, { arcDone: 'arc/shadow', failed: false })).toBe(true);
    const bad = run(w, s, [{ type: 'flag_set', flag: 'raid_happened' }]);
    expect(bad.arcs['arc/shadow']).toEqual({ chapter: 1, done: true, failed: true });
  });
  it('진행 시계: 하루마다 차고, 칸에 이르면 징조·효과. 조건 눈금은 한 번만', () => {
    const w = world();
    let s = start(w);
    expect(s.clocks['clock/raid']!.value).toBe(0);
    s = run(w, s, [days(2)]);
    expect(s.clocks['clock/raid']!.value).toBe(2);
    expect(s.log.some((l) => l.kind === 'omen' && l.text.includes('말발굽'))).toBe(true);
    s = run(w, s, [{ type: 'flag_set', flag: 'warned_village' }]);
    expect(s.clocks['clock/raid']!.value).toBe(0);
    s = run(w, s);
    expect(s.clocks['clock/raid']!.value).toBe(0); // 다시 깎이지 않는다
    s = run(w, s, [days(5)]);
    expect(s.clocks['clock/raid']!.value).toBe(4);
    expect(s.flags).toContain('raid_happened');
  });
  it('연표 사건: 날이 되면 일어나고, unless가 참이면 막힌다', () => {
    const w = world();
    let s = run(w, start(w), [days(1)]);
    expect(s.worldEvents['event/fair']).toMatchObject({ skipped: false });
    expect(s.beliefs.some((b) => b.holder === 'player' && b.claim === 'claim/village-name')).toBe(true);
    expect(s.log.some((l) => l.kind === 'omen' && l.text.includes('장터'))).toBe(true);
    const warned = run(w, s, [{ type: 'flag_set', flag: 'warned_village' }, days(1)]);
    expect(warned.worldEvents['event/ilse-leaves']).toMatchObject({ skipped: true });
    expect(warned.npcLocations['npc/ilse']).toBeUndefined();
    const not = run(w, s, [days(1)]);
    expect(not.npcLocations['npc/ilse']).toBe('loc/old-road');
  });
  it('날짜 사건은 달력 기준', () => {
    const w = { ...world(), calendar: { era: '', year: 100, month: 1, day: 30 }, events: [{ id: 'event/feb', name: '2월', when: { date: { year: 100, month: 2, day: 2 } }, effects: [{ setFlag: 'warned_village' }] }] };
    let s = run(w, start(w), [days(2)]);
    expect(s.flags).not.toContain('warned_village');
    s = run(w, s, [days(1)]);
    expect(s.flags).toContain('warned_village');
  });
});

describe('결정적 선택 (D4)', () => {
  const mock: LlmClient = {
    stream: async (_r, on) => { on('당신은 결심했다.'); return '당신은 결심했다.'; },
    json: async <T,>(r: { system: string }) => {
      if (r.system.includes('판단 모듈')) return { action_summary: '결정', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '' } as T;
      if (r.system.includes('안내자')) return { summary: '', suggestion: '', choices: [] } as T;
      return { facts: [] } as T;
    },
  };
  it('조건이 맞으면 나타나고, 고르면 플래그·효과가 엔진에서 적용된다', async () => {
    const w = world();
    const s = run(w, start(w), [{ type: 'knowledge_revealed', belief: { holder: 'player', claim: 'claim/altar-cursed', state: 'rumor' } }]);
    expect(pendingChoice(w, s)?.id).toBe('choice/side');
    await expect(runTurn(mock, w, s, '아무거나', () => {}, undefined, undefined, undefined, { choiceId: 'choice/side', optionId: 'nope' })).rejects.toThrow();
    const r = await runTurn(mock, w, s, '일제를 믿는다', () => {}, undefined, undefined, undefined, { choiceId: 'choice/side', optionId: 'ilse' });
    expect(r.state.flags).toContain('sided_ilse');
    expect(r.state.choices['choice/side']!.chosen).toBe('ilse');
    expect(r.state.relationships['npc/ilse']!.trust).toBeGreaterThanOrEqual(10);
    expect(pendingChoice(w, r.state)).toBeUndefined();
    expect(evalCondition(w, r.state, { choice: 'choice/side', is: 'ilse' })).toBe(true);
    expect(r.state.log.some((l) => l.text.includes('◆ 결정'))).toBe(true);
  });
});
