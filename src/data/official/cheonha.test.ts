import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../engine/package/validate';
import { flowWarnings } from '../../engine/package/flow';
import { simulateWorld } from '../../gm/simulate';
import { sceneActionEvents } from '../../gm/scene';
import { startEvents } from '../../gm/turn';
import { createCharacter, suggestedStandardArray } from '../../engine/character/sheet';
import { availableScenes, newRun, sceneActions } from '../../engine/scene';
import { evalCondition } from '../../engine/scenario';
import type { SceneDef } from '../../engine/schema';
import type { GameEvent } from '../../engine/state/events';
import { applyEvent, type GameState, replay } from '../../engine/state/state';
import { stockDataUrl } from '../stockart';
import { cheonhaWorld } from './cheonha';

describe('공식 세계: 천하무림', () => {
  it('검사기 오류가 없다 (경고는 의도한 고레벨 조우 난이도뿐)', () => {
    const issues = validateWorld(cheonhaWorld);
    const errors = issues.filter((i) => i.level === 'error');
    const warnings = issues.filter((i) => i.level === 'warning');
    if (warnings.length) console.log(warnings.map((w) => `${w.path}: ${w.message}`).join('\n'));
    expect(errors).toEqual([]);
    // 후반부 조우(혈도문·사도명·위천광·검총)는 1레벨 기준 치명적인 것이 의도다
    expect(warnings.filter((w) => !/^encounters\[\d+\]$/.test(w.path) || !w.message.includes('치명적'))).toEqual([]);
  });

  it('플래그 흐름에 막힌 곳이 없다', () => {
    expect(flowWarnings(cheonhaWorld).filter((x) => x.includes('세우는 곳이 없습니다'))).toEqual([]);
  });

  it('규모: 장소·인물·임무·명제·조우', () => {
    expect(cheonhaWorld.locations.length).toBeGreaterThanOrEqual(14);
    expect(cheonhaWorld.characters.length).toBeGreaterThanOrEqual(12);
    expect(cheonhaWorld.characters.filter((c) => c.companion).length).toBeGreaterThanOrEqual(3);
    expect(cheonhaWorld.quests!.length).toBeGreaterThanOrEqual(9);
    expect(cheonhaWorld.claims.length).toBeGreaterThanOrEqual(25);
    expect(cheonhaWorld.encounters!.length).toBeGreaterThanOrEqual(6);
    expect(cheonhaWorld.arcs!.find((a) => a.kind === 'main')!.chapters).toHaveLength(5);
  });

  it('모든 기본 이미지가 그려진다', () => {
    for (const a of cheonhaWorld.assets ?? []) expect(stockDataUrl(a.id), a.id).toBeTruthy();
  });

  it('12일 시뮬레이션: 세계가 스스로 흘러간다', () => {
    const r = simulateWorld(cheonhaWorld, 12);
    expect(r.days).toHaveLength(13);
    const all = r.days.flatMap((d) => d.lines.map((l) => `${d.day}:${l}`));
    expect(all.some((l) => l.startsWith('2:') && l.includes('두 번째 시체'))).toBe(true);
    expect(all.some((l) => l.includes('혈풍령의 북소리'))).toBe(true);
    // 아무도 막지 않으면 9일째 종리휘의 탄핵 공작이 이뤄지고 맹주가 끌려간다
    expect(r.state.npcGoals?.['goal/jongri-coup']?.done).toBe(true);
    expect(r.state.npcLocations['npc/namgung']).toBe('loc/capital');
    expect(r.state.clocks['clock/cult-march']!.value).toBeGreaterThanOrEqual(12);
    expect(r.state.vars?.['pact']).toBeLessThan(55);
    expect(r.state.ending).toBeFalsy();
  });

  it('다른 시작: 생존자는 사부와 원수 줄기로 시작한다', () => {
    const r = simulateWorld(cheonhaWorld, 1, { startId: 'start/survivor' });
    expect(r.state.player.locationId).toBe('loc/ruined-sect');
    expect(r.state.arcs['arc/master']).toBeTruthy();
  });

  // ---- 장면 (v0.48)
  const ch = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'insight'] });
  const begin = (seed: number) => replay(startEvents(cheonhaWorld, ch(), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
  const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);
  const playOut = (def: SceneDef, seed: number) => {
    let s: GameState = { ...begin(seed), scene: newRun(def) };
    for (let i = 0; i <= (def.maxRounds ?? 20) && s.scene; i++) {
      const opts = sceneActions(def, s.scene, s.player.sheet).filter((a) => a.ok);
      expect(opts.length, `${def.name} ${i}차례`).toBeGreaterThan(0);
      s = apply(s, sceneActionEvents(cheonhaWorld, s, opts[(i * 7 + seed) % opts.length]!.action.id));
    }
    return s;
  };

  it('장면 5개: 검사기 통과, 여러 시드로 끝까지 진행되고 결과가 갈린다', () => {
    const defs = cheonhaWorld.scenes!;
    expect(defs.map((d) => d.id)).toEqual(['scene/beggar-deal', 'scene/plum-duel', 'scene/ledger-infiltration', 'scene/jiangnan-auction', 'scene/hermit-qi-healing']);
    expect(validateWorld(cheonhaWorld).filter((i) => i.path.startsWith('scenes'))).toEqual([]);
    const outcomes = new Set<string>();
    for (const def of defs) {
      expect(def.maxRounds, def.id).toBeGreaterThan(0);
      for (let seed = 1; seed <= 6; seed++) {
        const s = playOut(def, seed);
        expect(s.scene, `${def.name} seed ${seed}`).toBeUndefined();
        const r = s.sceneResults?.[def.id];
        expect(r, `${def.name} seed ${seed}`).toBeDefined();
        outcomes.add(r!.outcome);
      }
    }
    expect(outcomes.has('success') && outcomes.has('failure')).toBe(true);
  });

  it('잠입: 객잔 사건 뒤 총단에서 열리고, 성공하면 장부와 단서를 얻어 다시 열리지 않는다', () => {
    const w = cheonhaWorld;
    const def = w.scenes!.find((d) => d.id === 'scene/ledger-infiltration')!;
    let s = apply(begin(2), [{ type: 'moved', to: 'loc/luoyang' }, { type: 'moved', to: 'loc/alliance' }]);
    expect(availableScenes(w, s).map((d) => d.id)).not.toContain(def.id);
    s = apply(s, [{ type: 'quest_started', questId: 'quest/inn-murder', name: '취선객잔의 시체', objective: '' }, { type: 'quest_completed', questId: 'quest/inn-murder', name: '취선객잔의 시체', stages: 3 }]);
    expect(evalCondition(w, s, { questDone: 'quest/inn-murder' })).toBe(true);
    expect(availableScenes(w, s).map((d) => d.id)).toContain(def.id);
    const run = newRun(def);
    s = { ...s, scene: { ...run, phase: 'inner', gauges: { ...run.gauges, progress: 7 } } };
    s = apply(s, sceneActionEvents(w, s, 'wait'));
    expect(s.sceneResults?.[def.id]?.endId).toBe('found');
    expect(evalCondition(w, s, { hasItem: 'item/jongri-ledger' })).toBe(true);
    expect(evalCondition(w, s, { knows: 'claim/jongri-ledger', min: 'partial' })).toBe(true);
    expect(availableScenes(w, s).map((d) => d.id)).not.toContain(def.id);
  });
});

