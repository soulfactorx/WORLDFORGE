import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { encounterBlocked, forcedEncounter, openEncounters, stageGates } from './encounter';
import { validateWorld } from './package/validate';
import { flagFlows, linkWarnings } from './package/flow';
import { evalCondition } from './scenario';
import { offerableScenes, sceneEntry } from './scene';
import type { SceneDef, WorldPackage } from './schema';
import type { GameEvent } from './state/events';
import { applyEvent, type GameState, replay } from './state/state';
import { effectEvents } from '../gm/story';
import { scenarioEvents } from '../gm/scenario';
import { startEvents } from '../gm/turn';

/** 연결 (v0.85): 조우 잠금·재시도·결과 조건, 전환 효과, 장면 진입 방식 */
const ch = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w: WorldPackage) => replay(startEvents(w, ch(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: GameEvent[], turn = s.turn) => evs.reduce((st, e) => applyEvent(st, e, turn), s);
const world = (): WorldPackage => structuredClone(sampleWorld);
const at = (s: GameState, loc: string): GameState => ({ ...s, player: { ...s.player, locationId: loc } });
const GOBLINS = 'enc/road-goblins';
const WOLVES = 'enc/clearing-wolves';

describe('조우가 일어날 수 있는가 (v0.85)', () => {
  it('임무 단계에 걸린 조우는 그 단계가 진행 중일 때만 열린다', () => {
    const w = world();
    const q = w.quests!.find((x) => x.id === 'quest/road-goblins')!;
    expect(stageGates(q.stages.find((st) => JSON.stringify(st.complete).includes(GOBLINS))!).encounters).toContain(GOBLINS);
    const idx = q.stages.findIndex((st) => JSON.stringify(st.complete).includes(GOBLINS));
    const s0 = at({ ...start(w), quests: {} }, 'loc/old-road');
    expect(encounterBlocked(w, s0, w.encounters!.find((e) => e.id === GOBLINS)!)).toMatch(/임무 단계/);
    expect(openEncounters(w, s0).map((e) => e.id)).not.toContain(GOBLINS);
    const s1 = { ...s0, quests: { [q.id]: { stage: idx, done: false } } };
    expect(openEncounters(w, s1).map((e) => e.id)).toContain(GOBLINS);
  });

  it('when을 주면 잠금 대신 그 조건을 따른다 ({ all: [] } = 언제나)', () => {
    const w = world();
    w.encounters!.find((e) => e.id === GOBLINS)!.when = { all: [] };
    const s = at({ ...start(w), quests: {} }, 'loc/old-road');
    expect(openEncounters(w, s).map((e) => e.id)).toContain(GOBLINS);
  });

  it('지거나 달아나면 기본 3턴 쉬고, retry로 바꿀 수 있다', () => {
    const w = world();
    const enc = w.encounters!.find((e) => e.id === WOLVES)!;
    enc.when = { all: [] };
    const base = at(start(w), enc.locationId);
    const lost = (turn: number): GameState => ({ ...base, turn, encounterResults: { [WOLVES]: { outcome: 'defeat', turn: 5 } } });
    expect(encounterBlocked(w, lost(6), enc)).toMatch(/3턴/);
    expect(encounterBlocked(w, lost(8), enc)).toBeNull();
    enc.retry = 0;
    expect(encounterBlocked(w, lost(5), enc)).toBeNull();
    enc.retry = 'gone';
    expect(encounterBlocked(w, lost(50), enc)).toMatch(/사라졌다/);
    expect(evalCondition(w, lost(6), { encounter: WOLVES, is: 'defeat' })).toBe(true);
    expect(evalCondition(w, lost(6), { encounter: WOLVES, is: 'victory' })).toBe(false);
    expect(evalCondition(w, { ...base, clearedEncounters: [WOLVES] }, { encounter: WOLVES, is: 'victory' })).toBe(true);
  });

  it('force 조건이 참이면 GM 판단 없이 시작된다', () => {
    const w = world();
    const enc = w.encounters!.find((e) => e.id === WOLVES)!;
    enc.when = { all: [] };
    enc.force = { flag: 'ambush' };
    w.flags = [...(w.flags ?? []), { id: 'ambush', when: '(엔진)' }];
    const s = at(start(w), enc.locationId);
    expect(forcedEncounter(w, s)).toBeUndefined();
    const armed = { ...s, flags: [...s.flags, 'ambush'] };
    expect(forcedEncounter(w, armed)?.id).toBe(WOLVES);
    const after = apply(armed, scenarioEvents(w, armed).events);
    expect(after.combat?.encounterId ?? after.encounterResults?.[WOLVES]?.outcome).toBeTruthy();
  });
});

describe('전환 효과 · 장면 진입 (v0.85)', () => {
  const talk: SceneDef = {
    id: 'scene/talk', name: '담판', description: '담판을 짓는다', npcId: 'npc/ilse', oppose: false,
    gauges: [{ id: 'deal', name: '합의', start: 0, max: 10 }],
    actions: [{ id: 'ask', name: '묻기', success: { gauges: { deal: 10 } } }],
    ends: [{ id: 'ok', name: '합의', when: { gauge: 'deal', gte: 10 }, outcome: 'success' }],
  };

  it('startScene·startEncounter는 예약되고 시나리오 평가가 하나씩 시작한다', () => {
    const w: WorldPackage = { ...world(), scenes: [structuredClone(talk)] };
    const s0 = start(w);
    const queued = apply(s0, effectEvents(w, s0, [{ startScene: 'scene/talk' }, { startEncounter: WOLVES }], '시험'));
    expect(queued.pendingTransitions).toEqual([{ kind: 'scene', id: 'scene/talk' }, { kind: 'encounter', id: WOLVES }]);
    const s1 = apply(queued, scenarioEvents(w, queued).events);
    expect(s1.scene?.sceneId).toBe('scene/talk');
    expect(s1.pendingTransitions).toEqual([{ kind: 'encounter', id: WOLVES }]);
  });

  it('moveTo는 플레이어를 옮긴다', () => {
    const w = world();
    const s0 = start(w);
    const to = w.locations.find((l) => l.id !== s0.player.locationId)!.id;
    expect(apply(s0, effectEvents(w, s0, [{ moveTo: to }], '시험')).player.locationId).toBe(to);
  });

  it('진입 방식: 기본은 상대가 있으면 offer·없으면 button, 사용자 정의는 그대로', () => {
    expect(sceneEntry(talk).mode).toBe('offer');
    expect(sceneEntry({ ...talk, npcId: undefined }).mode).toBe('button');
    expect(sceneEntry({ ...talk, auto: true }).mode).toBe('auto');
    expect(sceneEntry({ ...talk, entry: { mode: 'button' } })).toMatchObject({ mode: 'button', custom: true });
    const w: WorldPackage = { ...world(), scenes: [{ ...structuredClone(talk), entry: { mode: 'button' } }] };
    const npc = w.characters.find((c) => c.id === 'npc/ilse')!;
    const s = at(start(w), npc.locationId);
    expect(offerableScenes(w, s)).toEqual([]);
    w.scenes![0]!.entry = { mode: 'offer', trigger: '방값을 두고 흥정을 건다' };
    expect(offerableScenes(w, s).map((d) => d.id)).toEqual(['scene/talk']);
  });

  it('검사기: 깨진 참조를 잡는다', () => {
    const w: WorldPackage = { ...world(), scenes: [structuredClone(talk)] };
    w.encounters![0]!.onDefeat = [{ startScene: 'scene/none' }];
    w.encounters![0]!.retry = -1 as never;
    w.quests![0]!.stages[0]!.via = { encounter: 'enc/none' };
    const errs = validateWorld(w).filter((i) => i.level === 'error').map((i) => i.path);
    expect(errs).toEqual(expect.arrayContaining(['encounters[0].onDefeat[0]', 'encounters[0].retry', 'quests[0].stages[0].via.encounter']));
  });
});

describe('연결 검사 (v0.85)', () => {
  it('곁가지 조우·장면을 알리고, 이어 주면 사라진다', () => {
    const w = world();
    const lone = linkWarnings(w).filter((x) => x.includes('굶주린 늑대들'));
    expect(lone.length).toBe(1);
    w.encounters!.find((e) => e.id === WOLVES)!.onDefeat = [{ moveTo: w.locations[0]!.id }];
    expect(linkWarnings(w).some((x) => x.includes('굶주린 늑대들'))).toBe(false);
    expect(linkWarnings(w).some((x) => x.includes('고블린 매복'))).toBe(false); // 임무 단계가 읽는다
  });

  it('장면만 읽는 플래그도 읽는 곳으로 센다', () => {
    const w: WorldPackage = { ...world(), flags: [...(sampleWorld.flags ?? []), { id: 'door_open', when: '문을 열었다' }] };
    w.scenes = [{ id: 'scene/x', name: '문 너머', description: '', start: { flag: 'door_open' }, gauges: [{ id: 'g', name: 'g', start: 0 }], actions: [{ id: 'a', name: 'a', success: { gauges: { g: 1 } } }], ends: [{ id: 'e', name: 'e', when: { gauge: 'g', gte: 1 }, outcome: 'success' }] }];
    expect(flagFlows(w).find((f) => f.id === 'door_open')?.readBy.length).toBe(1);
  });
});
