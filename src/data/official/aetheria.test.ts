import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../engine/package/validate';
import { flowWarnings } from '../../engine/package/flow';
import { simulateWorld } from '../../gm/simulate';
import { sceneActionEvents } from '../../gm/scene';
import { scenarioEvents } from '../../gm/scenario';
import { startEvents } from '../../gm/turn';
import { createCharacter, suggestedStandardArray } from '../../engine/character/sheet';
import { availableScenes, newRun, sceneActions } from '../../engine/scene';
import { evalCondition } from '../../engine/scenario';
import type { SceneDef } from '../../engine/schema';
import type { GameEvent } from '../../engine/state/events';
import { applyEvent, type GameState, replay } from '../../engine/state/state';
import { stockDataUrl } from '../stockart';
import { aetheriaWorld } from './aetheria';

/** 의도한 경고: 최종 보스 조우는 1레벨 2인 일행 기준으로 치명적이다 (마지막 장에서만 일어난다) */
const INTENDED = (msg: string) => msg.includes('"월주 세레스"');

describe('공식 세계: 에테리아', () => {
  it('검사기 오류가 없고, 의도한 것 말고는 경고도 없다', () => {
    const issues = validateWorld(aetheriaWorld);
    const warnings = issues.filter((i) => i.level === 'warning');
    if (warnings.length) console.log(warnings.map((w) => `${w.path}: ${w.message}`).join('\n'));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(warnings.filter((w) => !INTENDED(w.message))).toEqual([]);
  });

  it('플래그는 세우는 곳과 읽는 곳이 모두 있다', () => {
    expect(flowWarnings(aetheriaWorld)).toEqual([]);
  });

  it('이미지가 모두 그려지고, 모든 인물·장소에 이미지가 있다', () => {
    for (const a of aetheriaWorld.assets!) expect(stockDataUrl(a.id), a.id).toBeTruthy();
    for (const c of aetheriaWorld.characters) expect(aetheriaWorld.assets!.some((a) => a.characterId === c.id), c.id).toBe(true);
    for (const l of aetheriaWorld.locations) expect(aetheriaWorld.assets!.some((a) => a.locationId === l.id), l.id).toBe(true);
  });

  it('규모: 장소·인물·임무·명제·조우', () => {
    expect(aetheriaWorld.locations.length).toBeGreaterThanOrEqual(14);
    expect(aetheriaWorld.characters.length).toBeGreaterThanOrEqual(12);
    expect(aetheriaWorld.quests!.length).toBeGreaterThanOrEqual(9);
    expect(aetheriaWorld.claims.length).toBeGreaterThanOrEqual(25);
    expect(aetheriaWorld.encounters!.length).toBeGreaterThanOrEqual(6);
    expect(aetheriaWorld.characters.filter((c) => c.companion).length).toBeGreaterThanOrEqual(3);
    expect(aetheriaWorld.arcs!.find((a) => a.kind === 'main')!.chapters).toHaveLength(5);
  });

  it('시뮬레이터: 12일 동안 세계가 스스로 움직인다', () => {
    const r = simulateWorld(aetheriaWorld, 12);
    expect(r.days).toHaveLength(13);
    // 첫 임무와 줄기가 시작된다
    expect(r.state.quests['quest/strange-world']).toBeDefined();
    // 3일째부터 국경 분쟁 임무가 열리고, 8일째에는 이상 현상 임무가 열린다
    expect(r.state.quests['quest/border-dispute']).toBeDefined();
    expect(r.state.quests['quest/omens']).toBeDefined();
    // 봉인의 균열 시계가 차오르고, 세계 수치가 바뀐다
    expect(r.state.clocks['clock/seal-crack']!.value).toBe(12);
    expect(r.state.flags).toContain('god_stirring');
    expect(r.state.vars?.seal ?? 60).toBeLessThan(60);
    expect(r.state.vars?.tension ?? 40).toBeGreaterThan(40);
    const all = r.days.flatMap((d) => d.lines);
    expect(all.some((l) => l.includes('검은 월식'))).toBe(true);
    expect(all.some((l) => l.includes('회색 관문의 첫 피'))).toBe(true);
    // 플레이어가 막지 않으면 세레스가 협회를 장악한다 (9일)
    expect(r.state.npcGoals?.['goal/seres-coup']?.done).toBe(true);
  });

  it('시작 방식마다 시뮬레이션이 돈다', () => {
    for (const st of aetheriaWorld.starts!) expect(() => simulateWorld(aetheriaWorld, 3, { startId: st.id })).not.toThrow();
    const rookie = simulateWorld(aetheriaWorld, 1, { startId: 'start/rookie' });
    expect(rookie.state.quests['quest/lost-children']).toBeDefined();
  });

  // ---- 장면 (v0.48)
  const ch = () => createCharacter({ name: '나', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: ['persuasion', 'performance', 'insight'] });
  const begin = (seed: number) => replay(startEvents(aetheriaWorld, ch(), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
  const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);
  /** 매 차례 쓸 수 있는 행동 하나를 골라 끝까지 진행한다 */
  const playOut = (def: SceneDef, seed: number) => {
    let s: GameState = { ...begin(seed), scene: newRun(def) };
    for (let i = 0; i <= (def.maxRounds ?? 20) && s.scene; i++) {
      const opts = sceneActions(def, s.scene, s.player.sheet).filter((a) => a.ok);
      expect(opts.length, `${def.name} ${i}차례`).toBeGreaterThan(0);
      s = apply(s, sceneActionEvents(aetheriaWorld, s, opts[(i * 7 + seed) % opts.length]!.action.id));
    }
    return s;
  };

  it('장면 5개: 검사기 통과, 여러 시드로 끝까지 진행되고 결과가 갈린다', () => {
    const defs = aetheriaWorld.scenes!;
    expect(defs.map((d) => d.id)).toEqual(['scene/seal-ritual', 'scene/cultist-interrogation', 'scene/raven-chase', 'scene/brom-rune-forge', 'scene/gate-parley']);
    expect(validateWorld(aetheriaWorld).filter((i) => i.path.startsWith('scenes'))).toEqual([]);
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

  it('장면 연결: 심문 자백 → 까마귀의 이름 → 골목 추격 → 후속 임무', () => {
    const w = aetheriaWorld;
    const interro = w.scenes!.find((d) => d.id === 'scene/cultist-interrogation')!;
    let s = begin(3);
    expect(availableScenes(w, s).map((d) => d.id)).not.toContain('scene/raven-chase');
    // 털어놓은 것이 가득 찬 채로 한 차례 → 자백으로 끝난다
    const run = newRun(interro);
    s = { ...s, scene: { ...run, gauges: { ...run.gauges, truth: 5 } } };
    s = apply(s, sceneActionEvents(w, s, 'calm'));
    expect(s.sceneResults?.['scene/cultist-interrogation']?.endId).toBe('confess');
    expect(evalCondition(w, s, { knows: 'claim/raven-cult', min: 'partial' })).toBe(true);
    // 라벤이 있는 골목으로 가면 추격이 열린다
    s = apply(s, [{ type: 'moved', to: 'loc/vellos-alley' }]);
    expect(availableScenes(w, s).map((d) => d.id)).toContain('scene/raven-chase');
    // 추격에 성공하면 아르켄 봉랍 임무가 열린다
    s = apply(s, [{ type: 'scene_ended', sceneId: 'scene/raven-chase', endId: 'cornered', name: '까마귀 추격', outcome: 'success', text: '' }]);
    s = apply(s, scenarioEvents(w, s).events);
    expect(s.quests['quest/raven-note']).toBeDefined();
  });

  it('담판: 약점을 쥐고 합의하면 휴전 플래그와 세레스와의 원한이 남는다', () => {
    const w = aetheriaWorld;
    const def = w.scenes!.find((d) => d.id === 'scene/gate-parley')!;
    const run = newRun(def);
    let s: GameState = { ...begin(5), scene: { ...run, phase: 'bargain', states: ['leverage'], gauges: { ...run.gauges, accord: 10 } } };
    s = apply(s, sceneActionEvents(w, s, 'concede'));
    expect(s.sceneResults?.['scene/gate-parley']?.endId).toBe('truce-exposed');
    expect(s.flags).toContain('border_truce');
  });
});

