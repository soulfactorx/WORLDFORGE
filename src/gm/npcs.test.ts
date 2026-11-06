import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import { relationsOf } from '../engine/relationship';
import { evalCondition } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { npcLocationOf } from '../engine/world';
import { activeGoals, buildActorContext } from './context';
import { BEAT_TURNS, scenarioEvents } from './scenario';
import { effectEvents } from './story';
import { startEvents } from './turn';

/** NPC 목표 · 먼저 다가오기 · 인물끼리 관계 (설계 v4 E7) */
const world = (): WorldPackage => {
  const w = structuredClone(sampleWorld);
  w.flags = [...(w.flags ?? []), { id: 'call_ilse', when: '(테스트)' }, { id: 'call_bran', when: '(테스트)' }, { id: 'altar_broken', when: '(테스트)' }, { id: 'ritual_done', when: '(엔진)' }];
  w.relationBeats = [
    { id: 'beat/ilse', npcId: 'npc/ilse', name: '고백', condition: { flag: 'call_ilse' }, hint: '그녀가 비밀을 털어놓는다' },
    { id: 'beat/bran', npcId: 'npc/bran', name: '부탁', condition: { flag: 'call_bran' }, hint: '그가 부탁한다', approach: 'message', message: '경비 초소로 와 달라고 한다.' },
  ];
  w.relations = [{ a: 'npc/orvin', b: 'npc/ilse', kind: 'ally' }];
  w.characters.find((c) => c.id === 'npc/orvin')!.goals = [
    { id: 'goal/ritual', text: '제단 의식을 끝낸다', days: 2, stop: { flag: 'altar_broken' }, effects: [{ setFlag: 'ritual_done' }, { npcRelation: 'npc/orvin', with: 'npc/ilse', kind: 'enemy' }], announce: '밤새 제단 쪽에서 붉은 빛이 번졌다.', stopped: '의식이 무너졌다.' },
  ];
  return w;
};
const fighter = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w: WorldPackage) => replay(startEvents(w, fighter(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);
const run = (w: WorldPackage, s: GameState, extra: GameEvent[] = []) => { const a = apply(s, extra); return apply(a, scenarioEvents(w, a).events); };
const later = (s: GameState, turns: number, minutes = 0): GameState => ({ ...s, turn: s.turn + turns, worldMinutes: s.worldMinutes + minutes });

describe('NPC 목표 · 먼저 다가오기 (설계 v4 E7)', () => {
  it('검사기 통과, 잘못된 값은 오류', () => {
    expect(validateWorld(world()).filter((i) => i.level === 'error')).toEqual([]);
    const bad = world();
    bad.relationBeats![0]!.approach = 'shout' as never;
    bad.characters[0]!.goals = [{ id: 'goal/ritual', text: '중복', days: 1 }];
    bad.quests = [...(bad.quests ?? []), { id: 'quest/x', name: 'x', kind: 'side', start: { npcGoal: 'goal/none' }, stages: [{ objective: 'x', hint: '', complete: { all: [] } }] }];
    expect(validateWorld(bad).filter((i) => i.level === 'error').length).toBeGreaterThanOrEqual(3);
  });
  it('관계 사건이 열리면 다른 곳에 있던 인물이 찾아오고, 그 턴부터 셈한다', () => {
    const w = world();
    let s = start(w);
    const ilse = w.characters.find((c) => c.id === 'npc/ilse')!;
    expect(npcLocationOf(s, ilse)).not.toBe(s.player.locationId);
    s = run(w, s, [{ type: 'flag_set', flag: 'call_ilse' }]);
    expect(npcLocationOf(s, ilse)).toBe(s.player.locationId);
    expect(s.log.some((l) => l.text.includes('당신을 찾아왔다'))).toBe(true);
    expect(buildActorContext(w, s, ilse)).toContain('일부러 찾아왔다');
    s = run(w, later(s, BEAT_TURNS - 1));
    expect(s.beats['beat/ilse']?.done).toBe(false);
    s = run(w, later(s, 1));
    expect(s.beats['beat/ilse']?.done).toBe(true);
    // 머무는 시간이 지나면 원래 자리로
    expect(npcLocationOf(later(s, 3), ilse)).toBe(ilse.locationId);
  });
  it('전갈: 인물은 그 자리에 있고 기록에 전갈이 뜬다, 더 오래 기다린다', () => {
    const w = world();
    let s = start(w);
    s = run(w, s, [{ type: 'moved', to: 'loc/inn' }, { type: 'flag_set', flag: 'call_bran' }]);
    s = run(w, s);
    expect(s.log.some((l) => l.text.includes('전갈') && l.text.includes('경비 초소'))).toBe(true);
    expect(s.visits?.['npc/bran']).toBeUndefined();
    s = run(w, later(s, BEAT_TURNS + 1));
    expect(s.beats['beat/bran']?.done).toBe(false);
  });
  it('NPC 목표: 날 수가 지나면 이뤄지고 효과(관계 변화 포함), 막으면 꺾인다', () => {
    const w = world();
    let s = run(w, start(w));
    expect(activeGoals(w, s).map((g) => g.goal.id)).toEqual(['goal/ritual']);
    expect(evalCondition(w, s, { npcGoal: 'goal/ritual', is: 'active' })).toBe(true);
    s = run(w, later(s, 1, 2 * 1440));
    expect(evalCondition(w, s, { npcGoal: 'goal/ritual' })).toBe(true);
    expect(s.flags).toContain('ritual_done');
    expect(s.log.some((l) => l.text.includes('붉은 빛'))).toBe(true);
    expect(relationsOf(w, 'npc/orvin', s)).toEqual([expect.objectContaining({ other: 'npc/ilse', kind: 'enemy' })]);
    let t = run(w, start(w));
    t = run(w, t, [{ type: 'flag_set', flag: 'altar_broken' }]);
    expect(evalCondition(w, t, { npcGoal: 'goal/ritual', is: 'stopped' })).toBe(true);
    expect(t.flags).not.toContain('ritual_done');
  });
  it('관계 끊기 · 만난 두 사람이면 기록에 보인다', () => {
    const w = world();
    let s = start(w);
    s = { ...s, relationships: { ...s.relationships, 'npc/orvin': { affinity: 0, trust: 0, respect: 0, fear: 0, grudge: 0, intimacy: 0 }, 'npc/ilse': { affinity: 0, trust: 0, respect: 0, fear: 0, grudge: 0, intimacy: 0 } } };
    s = apply(s, effectEvents(w, s, [{ npcRelation: 'npc/ilse', with: 'npc/orvin', kind: 'none' }], '테스트'));
    expect(relationsOf(w, 'npc/orvin', s)).toEqual([]);
    expect(s.log.some((l) => l.text.startsWith('🔗'))).toBe(true);
    expect(effectEvents(w, s, [{ npcRelation: 'npc/ilse', with: 'npc/orvin', kind: 'none' }], '테스트')).toEqual([]);
  });
});
