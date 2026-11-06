import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import { evalCondition } from '../engine/scenario';
import { availableScenes, edgeOf, sceneActions } from '../engine/scene';
import type { SceneDef, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { abandonSceneEvents, sceneActionEvents, startSceneEvents } from './scene';
import { scenarioEvents } from './scenario';
import { startEvents } from './turn';

/** 장면 엔진 (v0.47): 사용자 정의 수치·상태·단계·행동 */
const haggle: SceneDef = {
  id: 'scene/haggle', name: '여관 값 흥정', description: '일제와 방값을 두고 흥정한다', npcId: 'npc/ilse',
  gauges: [{ id: 'patience', name: '인내심', start: 3, min: 0, max: 5 }, { id: 'deal', name: '합의', start: 0, max: 10 }],
  states: [{ id: 'charmed', name: '기분 좋음', edge: 1 }],
  phases: [{ id: 'talk', name: '이야기' }, { id: 'close', name: '마무리' }],
  likes: ['칭찬'], dislikes: ['위협'],
  actions: [
    { id: 'praise', name: '여관 칭찬', tags: ['칭찬'], success: { gauges: { deal: 4 }, addStates: ['charmed'], text: '일제가 웃는다' } },
    { id: 'push', name: '값 깎기', check: 'skill:persuasion', dc: 30, tags: ['위협'], success: { gauges: { deal: 10 } }, failure: { gauges: { patience: -2 }, phase: 'close' } },
    { id: 'shake', name: '악수', phases: ['close'], success: { gauges: { deal: 10 } } },
  ],
  ends: [
    { id: 'deal', name: '합의', when: { gauge: 'deal', gte: 10 }, outcome: 'success', effects: [{ setFlag: 'cheap_room' }], rewards: { money: 5 } },
    { id: 'walk', name: '결렬', when: { gauge: 'patience', lte: 0 }, outcome: 'failure' },
  ],
  maxRounds: 6, timeoutEnd: 'walk',
};
const world = (): WorldPackage => ({ ...structuredClone(sampleWorld), scenes: [structuredClone(haggle)], flags: [...(sampleWorld.flags ?? []), { id: 'cheap_room', when: '(엔진)' }] });
const ch = () => createCharacter({ name: '나', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: ['persuasion', 'performance', 'insight'] });
const start = (w: WorldPackage) => replay(startEvents(w, ch(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);

describe('장면 엔진 (v0.47)', () => {
  it('검사기: 올바른 장면은 통과, 깨진 참조는 오류', () => {
    expect(validateWorld(world()).filter((i) => i.level === 'error')).toEqual([]);
    const bad = world();
    bad.scenes![0]!.actions[0]!.success = { gauges: { nope: 1 }, phase: 'nowhere' };
    bad.scenes![0]!.ends[0]!.when = { state: 'ghost' };
    bad.quests = [...(bad.quests ?? []), { id: 'quest/x', name: 'x', kind: 'side', start: { sceneEnd: 'scene/haggle', is: 'nope' }, stages: [{ objective: 'x', hint: '', complete: { all: [] } }] }];
    expect(validateWorld(bad).filter((i) => i.level === 'error').length).toBeGreaterThanOrEqual(4);
  });
  it('상대가 그 자리에 있어야 열리고, 시작하면 진행 중 — 다른 장면·자동 시작은 막힌다', () => {
    const w = world();
    let s = start(w);
    expect(availableScenes(w, s).map((d) => d.id)).toEqual([]);
    s = apply(s, [{ type: 'moved', to: 'loc/village-gate' }, { type: 'moved', to: 'loc/inn' }]);
    expect(availableScenes(w, s).map((d) => d.id)).toEqual(['scene/haggle']);
    s = apply(s, startSceneEvents(w, s, 'scene/haggle'));
    expect(s.scene).toMatchObject({ sceneId: 'scene/haggle', gauges: { patience: 3, deal: 0 }, phase: 'talk', round: 0 });
    expect(availableScenes(w, s)).toEqual([]);
  });
  it('행동: 수치·상태가 바뀌고, 성향(좋아함)과 상태가 이점, 단계가 막는다, 끝나면 효과·보상·결과 조건', () => {
    const w = world();
    let s = apply(start(w), [{ type: 'moved', to: 'loc/village-gate' }, { type: 'moved', to: 'loc/inn' }]);
    s = apply(s, startSceneEvents(w, s, 'scene/haggle'));
    const def = w.scenes![0]!;
    expect(edgeOf(def, s.scene!, def.actions[0]!)).toBe('advantage');
    expect(sceneActions(def, s.scene!).find((a) => a.action.id === 'shake')!.ok).toBe(false);
    s = apply(s, sceneActionEvents(w, s, 'praise'));
    expect(s.scene).toMatchObject({ gauges: { deal: 4 }, states: ['charmed'], round: 1 });
    expect(s.log.at(-1)!.text).toContain('합의 +4');
    // 위협(싫어함) + 기분 좋음(이점) = 보통, DC 30이라 실패 → 인내심 −2, 마무리 단계
    expect(edgeOf(def, s.scene!, def.actions[1]!)).toBe('normal');
    s = apply(s, sceneActionEvents(w, s, 'push'));
    expect(s.scene).toMatchObject({ gauges: { patience: 1 }, phase: 'close' });
    const money = s.money;
    s = apply(s, sceneActionEvents(w, s, 'shake'));
    expect(s.scene).toBeUndefined();
    expect(s.sceneResults?.['scene/haggle']).toMatchObject({ endId: 'deal', outcome: 'success' });
    expect(s.flags).toContain('cheap_room');
    expect(s.money).toBeGreaterThan(money);
    expect(evalCondition(w, s, { sceneEnd: 'scene/haggle', outcome: 'success' })).toBe(true);
    expect(availableScenes(w, s)).toEqual([]); // 다시 할 수 없는 장면
  });
  it('차례 한도 → 정한 끝, 그만두기는 효과 없이 끝', () => {
    const w = world();
    w.scenes![0]!.actions.push({ id: 'wait', name: '기다리기' });
    let s = apply(start(w), [{ type: 'moved', to: 'loc/village-gate' }, { type: 'moved', to: 'loc/inn' }]);
    s = apply(s, startSceneEvents(w, s, 'scene/haggle'));
    for (let i = 0; i < 6; i++) s = apply(s, sceneActionEvents(w, s, 'wait'));
    expect(s.sceneResults?.['scene/haggle']).toMatchObject({ endId: 'walk', outcome: 'failure' });
    let t = apply(start(w), [{ type: 'moved', to: 'loc/village-gate' }, { type: 'moved', to: 'loc/inn' }]);
    t = apply(t, startSceneEvents(w, t, 'scene/haggle'));
    t = apply(t, abandonSceneEvents(w, t));
    expect(t.scene).toBeUndefined();
    expect(t.flags).not.toContain('cheap_room');
    expect(evalCondition(w, t, { sceneEnd: 'scene/haggle' })).toBe(false);
  });
  it('자동 장면은 조건이 맞으면 저절로 시작', () => {
    const w = world();
    w.scenes![0]!.auto = true;
    let s = apply(start(w), [{ type: 'moved', to: 'loc/village-gate' }, { type: 'moved', to: 'loc/inn' }]);
    s = apply(s, scenarioEvents(w, s).events);
    expect(s.scene?.sceneId).toBe('scene/haggle');
  });
});

describe('공식 세계의 장면 (v0.47)', () => {
  it('세 장면 모두 끝까지 진행된다 (매번 쓸 수 있는 첫 행동, 차례 한도 안에 끝)', async () => {
    const { aetheriaWorld } = await import('../data/official/aetheria');
    const { cheonhaWorld } = await import('../data/official/cheonha');
    const { everheartWorld } = await import('../data/official/everheart');
    const { newRun } = await import('../engine/scene');
    for (const w of [aetheriaWorld, cheonhaWorld, everheartWorld]) {
      const def = w.scenes![0]!;
      let s: GameState = { ...replay(startEvents(w, ch(), 11).map((event, seq) => ({ saveId: 's', seq, turn: 0, event }))), scene: newRun(def) };
      for (let i = 0; i <= (def.maxRounds ?? 20) && s.scene; i++) {
        const pick = sceneActions(def, s.scene).find((a) => a.ok)!;
        s = apply(s, sceneActionEvents(w, s, pick.action.id));
      }
      expect(s.scene).toBeUndefined();
      expect(s.sceneResults?.[def.id]?.outcome).toMatch(/success|failure|neutral/);
    }
  });
});

describe('장면 2.0 (v0.48): 수치 판정·반작용·대성공·프리셋', () => {
  it('수치가 굴림에 더해지고(±max), 반작용이 행동마다 일어나며, 대성공이 따로 있다', async () => {
    const { gaugeMods, applyReactions, newRun } = await import('../engine/scene');
    const def: SceneDef = { ...structuredClone(haggle), reactions: [{ delta: { gauges: { patience: -1 }, text: '한숨' } }, { when: { gauge: 'deal', gte: 5 }, chance: 0.5, delta: { gauges: { deal: 1 } } }] };
    def.actions[1]!.mods = [{ gauge: 'patience', per: 2, max: 4 }, { gauge: 'deal', per: -1 }];
    const run = { ...newRun(def), gauges: { patience: 3, deal: 2 } };
    expect(gaugeMods(def, run, def.actions[1]!)).toEqual([{ label: '인내심', value: 4 }, { label: '합의', value: -2 }]);
    const r1 = applyReactions(def, run);
    expect(r1.run.gauges.patience).toBe(2);
    expect(r1.texts).toEqual(['한숨']);
    const r2 = applyReactions(def, { ...run, gauges: { patience: 3, deal: 6 } }, () => 0.1);
    expect(r2.run.gauges.deal).toBe(7);
    // 대성공: DC를 5 이상 넘기면 great
    const w = world();
    w.scenes![0]!.actions[1]!.dc = 5;
    w.scenes![0]!.actions[1]!.great = { gauges: { deal: 7 }, text: '대성공' };
    let s = apply(start(w), [{ type: 'moved', to: 'loc/village-gate' }, { type: 'moved', to: 'loc/inn' }]);
    s = apply(s, startSceneEvents(w, s, 'scene/haggle'));
    s = apply(s, sceneActionEvents(w, s, 'push'));
    expect(s.log.find((l) => l.text.startsWith('🎭 값 깎기'))!.text).toMatch(/대성공|→ 성공/);
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('프리셋 9개: 검사기 통과, 끝까지 진행된다', async () => {
    const { SCENE_PRESETS } = await import('../data/scenePresets');
    const { newRun } = await import('../engine/scene');
    expect(SCENE_PRESETS.map((p) => p.label)).toEqual(['협상', '추격', '의식', '제작', '심문', '비무', '데이트', '경매', '잠입 경보']);
    const w = world();
    w.scenes = SCENE_PRESETS.map((p) => p.make());
    const issues = validateWorld(w).filter((i) => i.path.startsWith('scenes'));
    expect(issues).toEqual([]);
    for (const def of w.scenes) {
      for (let seed = 1; seed <= 5; seed++) {
        let s: GameState = { ...replay(startEvents(w, ch(), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event }))), scene: newRun(def) };
        for (let i = 0; i <= (def.maxRounds ?? 20) && s.scene; i++) {
          const opts = sceneActions(def, s.scene).filter((a) => a.ok);
          s = apply(s, sceneActionEvents(w, s, opts[(i * 7 + seed) % opts.length]!.action.id));
        }
        expect(s.scene, `${def.name} seed ${seed}`).toBeUndefined();
      }
    }
  });
});
