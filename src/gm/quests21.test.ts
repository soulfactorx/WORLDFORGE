import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import { evalCondition, varLabel, varValue } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { scenarioEvents } from './scenario';
import { effectEvents } from './story';
import { startEvents } from './turn';

/** 퀘스트 2.1 · 세계 수치 (설계 v4 E6) */
const world = (): WorldPackage => {
  const w = structuredClone(sampleWorld);
  w.vars = [{ id: 'var/safety', name: '마을 치안', initial: 50, min: 0, max: 100, labels: [[0, '무법'], [40, '불안'], [70, '평온']], visible: true }];
  w.flags = [...(w.flags ?? []), { id: 'q_go', when: '(테스트)' }, { id: 'q_done', when: '(테스트)' }, { id: 'talked', when: '(테스트)' }, { id: 'thanked', when: '(테스트)' }];
  w.quests = [
    ...(w.quests ?? []),
    {
      id: 'quest/bandits', name: '도적 문제', kind: 'side', start: { flag: 'q_go' }, motive: '마을이 불안하다',
      approaches: [{ hint: '설득', skills: ['persuasion'] }, { hint: '힘으로', risk: '다친다' }],
      clues: ['claim/village-name'],
      stages: [{ objective: '도적을 처리한다', hint: '', complete: { flag: 'q_done' } }],
      outcomes: [
        { id: 'peace', name: '평화로운 해결', when: { flag: 'talked' }, text: '피 한 방울 흘리지 않았다.', effects: [{ var: 'var/safety', add: 30 }], rewards: { money: 7 } },
        { id: 'force', name: '힘으로', when: { all: [] }, effects: [{ var: 'var/safety', add: -60 }] },
      ],
    },
    { id: 'quest/after', name: '후속', kind: 'side', start: { questOutcome: 'quest/bandits', is: 'peace' }, stages: [{ objective: '감사 인사', hint: '', complete: { flag: 'thanked' } }] },
  ];
  return w;
};
const fighter = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w: WorldPackage) => replay(startEvents(w, fighter(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);
const run = (w: WorldPackage, s: GameState, extra: GameEvent[] = []) => { const a = apply(s, extra); return apply(a, scenarioEvents(w, a).events); };

describe('퀘스트 2.1 · 세계 수치', () => {
  it('검사기 통과, 잘못된 수치·결과는 오류', () => {
    const w = world();
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
    const bad = world();
    bad.quests!.at(-2)!.outcomes!.push({ id: 'peace', name: '중복', when: { var: 'var/nope', gte: 1 } });
    expect(validateWorld(bad).filter((i) => i.level === 'error').length).toBeGreaterThan(0);
  });
  it('수치: 초기값·효과·한계·단계 이름·조건', () => {
    const w = world();
    let s = start(w);
    expect(varValue(w, s, 'var/safety')).toBe(50);
    expect(varLabel(w.vars![0]!, 50)).toBe('불안');
    s = apply(s, effectEvents(w, s, [{ var: 'var/safety', add: 80 }], '테스트'));
    expect(varValue(w, s, 'var/safety')).toBe(100);
    expect(s.log.some((l) => l.text.includes('마을 치안') && l.text.includes('평온'))).toBe(true);
    expect(evalCondition(w, s, { var: 'var/safety', gte: 70 })).toBe(true);
    s = apply(s, effectEvents(w, s, [{ var: 'var/safety', set: -5 }], '테스트'));
    expect(varValue(w, s, 'var/safety')).toBe(0);
    expect(evalCondition(w, s, { var: 'var/safety', lte: 10 })).toBe(true);
  });
  it('여러 결과: 조건에 맞는 첫 결과가 붙고, 효과·보상이 들어가고, 후속 임무가 열린다', () => {
    const w = world();
    let s = run(w, start(w), [{ type: 'flag_set', flag: 'q_go' }]);
    const money = s.money ?? 0;
    s = run(w, s, [{ type: 'flag_set', flag: 'talked' }, { type: 'flag_set', flag: 'q_done' }]);
    expect(s.quests['quest/bandits']).toMatchObject({ done: true, outcome: 'peace' });
    expect(varValue(w, s, 'var/safety')).toBe(80);
    expect((s.money ?? 0) - money).toBeGreaterThanOrEqual(7);
    expect(s.log.some((l) => l.text.includes('평화로운 해결'))).toBe(true);
    expect(evalCondition(w, s, { questOutcome: 'quest/bandits', is: 'peace' })).toBe(true);
    s = run(w, s);
    expect(s.quests['quest/after']).toBeTruthy();
  });
  it('기본 결과로 떨어지면 다른 결과, 후속은 열리지 않는다', () => {
    const w = world();
    let s = run(w, start(w), [{ type: 'flag_set', flag: 'q_go' }]);
    s = run(w, s, [{ type: 'flag_set', flag: 'q_done' }]);
    expect(s.quests['quest/bandits']?.outcome).toBe('force');
    expect(varValue(w, s, 'var/safety')).toBe(0);
    s = run(w, s);
    expect(s.quests['quest/after']).toBeUndefined();
    expect(evalCondition(w, s, { questOutcome: 'quest/bandits' })).toBe(true);
  });
});
