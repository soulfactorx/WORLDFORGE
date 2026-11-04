import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { activeQuests, evalCondition, flagAllowed, pendingDiscoveries, questTransitions, reachedEnding } from './scenario';
import { initialState, type GameState } from './state/state';
import type { Belief } from './schema';

const base = (o: Partial<GameState> = {}): GameState => ({
  ...initialState(), packageId: 'p', packageVersion: '0', player: { ...initialState().player, locationId: 'loc/forest-clearing' }, ...o,
});
const knows = (claim: string, state: Belief['state'] = 'partial'): Belief => ({ holder: 'player', claim, state });

describe('조건식', () => {
  it('all / any / not / knows / at / flag / level', () => {
    const s = base({ beliefs: [knows('claim/altar-cursed', 'rumor')], flags: ['x'] });
    expect(evalCondition(sampleWorld, s, { all: [] })).toBe(true);
    expect(evalCondition(sampleWorld, s, { knows: 'claim/altar-cursed' })).toBe(true);
    expect(evalCondition(sampleWorld, s, { knows: 'claim/altar-cursed', min: 'partial' })).toBe(false);
    expect(evalCondition(sampleWorld, s, { any: [{ at: 'loc/inn' }, { flag: 'x' }] })).toBe(true);
    expect(evalCondition(sampleWorld, s, { not: { at: 'loc/forest-clearing' } })).toBe(false);
    expect(evalCondition(sampleWorld, s, { level: 2 })).toBe(false);
  });
  it('관계 조건은 패키지 초기값을 쓴다', () => {
    expect(evalCondition(sampleWorld, base(), { relationship: 'npc/bran', axis: 'trust', lte: -10 })).toBe(true);
    expect(evalCondition(sampleWorld, base(), { relationship: 'npc/ilse', axis: 'trust', gte: 20 })).toBe(false);
  });
});

describe('퀘스트 진행', () => {
  it('게임 시작 시 메인 퀘스트가 시작된다', () => {
    const t = questTransitions(sampleWorld, base());
    expect(t).toEqual([{ kind: 'started', quest: expect.objectContaining({ id: 'quest/why-am-i-here' }) }]);
  });
  it('여러 단계가 한 번에 완료될 수 있다', () => {
    const s = base({
      quests: { 'quest/why-am-i-here': { stage: 0, done: false } },
      player: { ...base().player, locationId: 'loc/village-gate' },
      beliefs: [knows('claim/elder-strange'), knows('claim/altar-fresh-ash', 'confirmed')],
    });
    const t = questTransitions(sampleWorld, s);
    expect(t.map((x) => x.kind === 'advanced' ? x.stage : x.kind)).toEqual([1, 2, 3]);
  });
  it('완료와 결말', () => {
    const s = base({
      quests: { 'quest/why-am-i-here': { stage: 4, done: false } }, flags: ['chose_stay'],
      beliefs: [knows('claim/altar-summoning')],
    });
    const t = questTransitions(sampleWorld, s);
    expect(t.at(-1)!.kind).toBe('completed');
    expect(reachedEnding(sampleWorld, s)).toBeNull(); // 아직 퀘스트 완료 전 상태
    const done = { ...s, quests: { 'quest/why-am-i-here': { stage: 5, done: true } } };
    expect(reachedEnding(sampleWorld, done)?.id).toBe('ending/stay');
    expect(reachedEnding(sampleWorld, { ...done, ending: 'ending/stay' })).toBeNull();
  });
  it('사이드 퀘스트: 소문을 들으면 시작, 조우를 끝내면 완료', () => {
    const s = base({ beliefs: [knows('claim/goblins-road', 'rumor')], quests: { 'quest/why-am-i-here': { stage: 0, done: false } } });
    expect(questTransitions(sampleWorld, s).map((x) => x.quest.id)).toContain('quest/road-goblins');
    const s2 = { ...s, quests: { ...s.quests, 'quest/road-goblins': { stage: 0, done: false } }, clearedEncounters: ['enc/road-goblins'] };
    expect(questTransitions(sampleWorld, s2)).toEqual([{ kind: 'completed', quest: expect.objectContaining({ id: 'quest/road-goblins' }) }]);
    expect(activeQuests(sampleWorld, s2).map((q) => q.quest.id)).toEqual(['quest/why-am-i-here', 'quest/road-goblins']);
  });
});

describe('플래그와 발견', () => {
  it('선언된 플래그만, 지정 장소에서, 조건을 만족할 때만', () => {
    expect(flagAllowed(sampleWorld, base(), 'made_up')).toBe(false);
    expect(flagAllowed(sampleWorld, base(), 'chose_return')).toBe(false); // way-home 모름
    expect(flagAllowed(sampleWorld, base({ beliefs: [knows('claim/way-home')] }), 'chose_return')).toBe(true);
    expect(flagAllowed(sampleWorld, base({ beliefs: [knows('claim/way-home')], player: { ...base().player, locationId: 'loc/inn' } }), 'chose_return')).toBe(false);
  });
  it('이미 아는 것은 다시 발견하지 않는다', () => {
    expect(pendingDiscoveries(sampleWorld, base()).map((d) => d.claim)).toEqual(['claim/altar-fresh-ash']);
    expect(pendingDiscoveries(sampleWorld, base({ beliefs: [knows('claim/altar-fresh-ash', 'confirmed')] }))).toEqual([]);
  });
});
