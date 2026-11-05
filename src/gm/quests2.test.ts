import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { jobStatus } from '../engine/jobs';
import { validateWorld } from '../engine/package/validate';
import { evalCondition } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { availableEncounters, beginEncounter, playerGear } from './combat';
import { acceptJob } from './economy';
import { scenarioEvents } from './scenario';
import { startEvents } from './turn';

const world = (): WorldPackage => {
  const w = structuredClone(sampleWorld);
  w.factions = [{ id: 'fac/village', name: '마을', description: '' }];
  w.quests = [
    ...(w.quests ?? []),
    { id: 'quest/escort-ilse', name: '일제 호위', kind: 'side', type: 'escort', giver: 'npc/bran', target: 'npc/ilse', start: { flag: 'escort_on' }, timeLimit: { days: 2 },
      stages: [{ objective: '일제를 숲 공터까지 데려간다', hint: '', complete: { npcAt: 'npc/ilse', at: 'loc/forest-clearing' } }],
      rewards: { money: 40, cards: [{ who: 'player', cardId: 'rogue/steady_aim' }, { who: 'npc/bran', cardId: 'rogue/cunning_dash' }] } },
    { id: 'quest/wolves', name: '늑대 사냥', kind: 'side', type: 'hunt', start: { all: [] },
      stages: [{ objective: '늑대 둘을 잡는다', hint: '', complete: { defeated: 'wolf', n: 2 } }], fail: { flag: 'wolves_fled' } },
  ];
  w.flags = [...(w.flags ?? []), { id: 'escort_on', when: '(테스트)' }, { id: 'wolves_fled', when: '(테스트)' }];
  const gate = w.locations.find((l) => l.id === 'loc/village-gate')!;
  gate.board = { name: '마을 게시판', jobs: [
    { id: 'job/goblins', name: '고블린 퇴치', type: 'hunt', description: '낡은 숲길의 고블린을 쫓아내라', locationId: 'loc/old-road', enemies: [{ monsterId: 'goblin_warrior', zone: 2 }], timeLimit: { days: 3 } },
    { id: 'job/elite', name: '정예 의뢰', type: 'hunt', description: '평판이 좋아야 맡긴다', locationId: 'loc/old-road', enemies: [{ monsterId: 'ogre', zone: 2 }], requires: { reputation: 'fac/village', gte: 30 } },
  ] };
  return w;
};
const fighter = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w: WorldPackage) => replay(startEvents(w, fighter(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);
const run = (w: WorldPackage, s: GameState, extra: GameEvent[] = []) => apply(apply(s, extra), scenarioEvents(w, apply(s, extra)).events);

describe('퀘스트 2.0 (설계 v3 6장)', () => {
  it('검사기 통과', () => {
    expect(validateWorld(world()).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('대상이 죽으면 실패, 기한이 지나면 실패, 실패 조건이면 실패', () => {
    const w = world();
    const s = run(w, start(w), [{ type: 'flag_set', flag: 'escort_on' }]);
    expect(s.quests['quest/escort-ilse']).toMatchObject({ stage: 0, done: false });
    const dead = run(w, s, [{ type: 'npc_killed', npcId: 'npc/ilse', name: '일제' }]);
    expect(dead.quests['quest/escort-ilse']).toMatchObject({ done: true, failed: true });
    expect(dead.log.some((l) => l.text.startsWith('임무 실패 — 일제 호위'))).toBe(true);
    expect(evalCondition(w, dead, { questFailed: 'quest/escort-ilse' })).toBe(true);
    expect(evalCondition(w, dead, { questDone: 'quest/escort-ilse' })).toBe(false);
    const late = run(w, s, [{ type: 'time_advanced', minutes: 3 * 1440 }]);
    expect(late.quests['quest/escort-ilse']!.failed).toBe(true);
    const fled = run(w, s, [{ type: 'flag_set', flag: 'wolves_fled' }]);
    expect(fled.quests['quest/wolves']!.failed).toBe(true);
  });
  it('호위 성공: 인물 위치 조건, 보상 돈·전용 카드 (플레이어·동료)', () => {
    const w = world();
    let s = run(w, start(w), [{ type: 'flag_set', flag: 'escort_on' }]);
    s = run(w, s, [{ type: 'npc_moved', npcId: 'npc/ilse', to: 'loc/forest-clearing' }]);
    expect(s.quests['quest/escort-ilse']).toMatchObject({ done: true });
    expect(s.money).toBe(55);
    expect(s.grantedCards).toEqual({ player: ['rogue/steady_aim'], 'npc/bran': ['rogue/cunning_dash'] });
    expect(playerGear(w, s).cards).toContain('rogue/steady_aim');
  });
  it('쓰러뜨린 적 수 (defeated)', () => {
    const w = world();
    let s = start(w);
    s = run(w, s, [{ type: 'enemies_defeated', counts: { wolf: 1 } }]);
    expect(s.quests['quest/wolves']!.done).toBe(false);
    s = run(w, s, [{ type: 'enemies_defeated', counts: { wolf: 1, goblin_warrior: 2 } }]);
    expect(s.quests['quest/wolves']).toMatchObject({ done: true });
    expect(s.quests['quest/wolves']!.failed).toBeUndefined();
  });
});

describe('의뢰판 (설계 v3 6.3)', () => {
  const at = (s: GameState, loc: string): GameState => ({ ...s, player: { ...s.player, locationId: loc } });
  it('받으면 토벌 조우가 생기고, 이기면 보상(위협도 기준), 다시 받을 수 있다', () => {
    const w = world();
    let s = at(start(w), 'loc/village-gate');
    const job = w.locations.find((l) => l.id === 'loc/village-gate')!.board!.jobs[0]!;
    expect(jobStatus(w, s, job)).toBe('available');
    expect(() => acceptJob(w, s, 'job/elite')).toThrow(/맡을 수 없다/);
    s = apply(s, acceptJob(w, s, 'job/goblins'));
    expect(jobStatus(w, s, job)).toBe('active');
    expect(() => acceptJob(w, s, 'job/goblins')).toThrow(/이미/);
    expect(availableEncounters(w, at(s, 'loc/old-road')).map((e) => e.id)).toContain('job/goblins#1');
    // 이긴 것으로 처리
    s = run(w, s, [{ type: 'combat_started', combat: { ...beginCombatStub('job/goblins#1') }, rngState: 1 }, { type: 'combat_ended', outcome: 'victory', hp: 12, resources: {} }]);
    expect(s.jobs['job/goblins']).toEqual({ done: 1, failed: 0 });
    expect(s.money).toBe(15 + 13); // 고블린 50 XP / 4
    expect(jobStatus(w, s, job)).toBe('available');
    s = apply(s, acceptJob(w, s, 'job/goblins'));
    expect(s.jobs['job/goblins']!.active!.instance).toBe(2);
    expect(availableEncounters(w, at(s, 'loc/old-road')).map((e) => e.id)).toContain('job/goblins#2');
  });
  it('기한이 지나면 의뢰 실패, 평판이 오르면 잠긴 의뢰가 열린다', () => {
    const w = world();
    let s = at(start(w), 'loc/village-gate');
    s = apply(s, acceptJob(w, s, 'job/goblins'));
    s = run(w, s, [{ type: 'time_advanced', minutes: 4 * 1440 }]);
    expect(s.jobs['job/goblins']).toEqual({ done: 0, failed: 1 });
    s = { ...s, reputation: { 'fac/village': 35 } };
    expect(acceptJob(w, s, 'job/elite')[0]).toMatchObject({ type: 'job_accepted' });
  });
  it('의뢰 토벌은 실제 전투로 시작할 수 있다', () => {
    const w = world();
    let s = at(start(w), 'loc/village-gate');
    s = apply(s, acceptJob(w, s, 'job/goblins'));
    s = apply(at(s, 'loc/old-road'), beginEncounter(w, at(s, 'loc/old-road'), 'job/goblins#1', 1));
    expect(s.combat?.encounterId).toBe('job/goblins#1');
  });
});

/** 승리 처리만 보려는 최소 전투 상태 */
function beginCombatStub(encounterId: string) {
  return { encounterId, round: 1, order: [], turnIndex: 0, combatants: {}, economy: { action: true, bonus: true, move: true }, sneakUsed: false };
}
