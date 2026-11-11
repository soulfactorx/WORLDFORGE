/**
 * 장면 시험 플레이 (v0.71) — 편집 중인 장면을 저장 없이 바로 돌려 본다.
 * 시험용 주인공 · 열리는 조건 무시 · AI 없음 · 자동 시뮬레이션(무작위 행동 N회).
 */
import { CLASSES } from '../engine/character/rules';
import { createCharacter, suggestedStandardArray, type CharacterSheet } from '../engine/character/sheet';
import { levelUp } from '../engine/character/progression';
import { classesFor, recommendedSkills, skillOptionsOf } from '../engine/classes';
import { createRng } from '../engine/dice/rng';
import { newRun, sceneActions, sceneDef } from '../engine/scene';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, replay, type GameState } from '../engine/state/state';
import { traitsFor } from '../engine/traits';
import { sceneActionEvents } from './scene';
import { startEvents } from './turn';

/** 시험용 주인공: 세계 직업 하나, 표준 배열, 원하는 레벨까지 자동 성장 */
export function testSheet(world: WorldPackage, classIndex = 0, level = 1, traits?: Record<string, number>): CharacterSheet {
  const list = classesFor(world);
  const wc = list[Math.max(0, Math.min(list.length - 1, classIndex))]!;
  const base = CLASSES[wc.base]!;
  const rec = recommendedSkills(wc);
  const skills = [...rec, ...skillOptionsOf(wc).filter((s) => !rec.includes(s))].slice(0, base.skillChoices);
  let sheet = createCharacter({ name: '시험 주인공', classId: wc.base, method: 'standard', abilities: suggestedStandardArray(wc.base), skills,
    role: { id: wc.id, name: wc.name, skillOptions: skillOptionsOf(wc) },
    ...(traits && traitsFor(world).length ? { traits } : {}) });
  for (let l = 1; l < Math.min(10, Math.max(1, level)); l++) sheet = levelUp(sheet).sheet;
  return sheet;
}

/** 장면이 바로 시작된 시험 상태 (열리는 조건·장소·상대 위치는 무시) */
export function sandboxState(world: WorldPackage, sceneId: string, sheet: CharacterSheet, seed = 1): GameState {
  const def = sceneDef(world, sceneId);
  if (!def) throw new Error('없는 장면이다');
  const s0 = replay(startEvents(world, sheet, seed).map((event, seq) => ({ saveId: 'scene-test', seq, turn: 0, event })));
  const ev: GameEvent = { type: 'scene_started', sceneId: def.id, name: def.name, run: newRun(def), ...(def.intro ? { intro: def.intro } : {}) };
  return applyEvent({ ...s0, log: [] }, ev, s0.turn);
}

/** 한 행동을 시험 상태에 적용 */
export function sandboxAct(world: WorldPackage, state: GameState, actionId: string): GameState {
  return sceneActionEvents(world, state, actionId).reduce((s, e) => applyEvent(s, e, s.turn), state);
}

export interface SimResult {
  runs: number;
  ends: Record<string, number>;
  /** 할 수 있는 행동이 없어 멈춘 횟수 */
  stuck: number;
  /** 안전 한도(200차례)까지 끝나지 않은 횟수 */
  endless: number;
  avgRounds: number;
  minRounds: number;
  maxRounds: number;
  /** 한 번도 나오지 않은 끝 */
  unreached: string[];
  /** 한 번도 쓰이지 않은 행동 (조건이 안 맞아서) */
  unusedActions: string[];
}

const CAP = 200;

/**
 * 시험 플레이어가 행동을 고르는 방식 (v0.104).
 *  - random: 할 수 있는 행동 중 아무거나
 *  - careful: 열에 일곱은 성공 확률이 가장 높은 행동, 나머지는 아무거나 (판정을 따져 보고 고르는 플레이어)
 */
export type SimPolicy = 'random' | 'careful';

/** 자동 시뮬레이션: 할 수 있는 행동 중에서 골라 끝까지 */
export function simulateScene(world: WorldPackage, sceneId: string, sheet: CharacterSheet, runs = 200, seed = 7, policy: SimPolicy = 'random'): SimResult {
  const def = sceneDef(world, sceneId)!;
  const pick = createRng(seed);
  const ends: Record<string, number> = {};
  const used = new Set<string>();
  let stuck = 0; let endless = 0; let sum = 0; let min = Infinity; let max = 0; let done = 0;
  for (let i = 0; i < runs; i++) {
    let s = sandboxState(world, sceneId, sheet, seed * 1000 + i);
    let rounds = 0;
    while (s.scene && rounds < CAP) {
      const ok = sceneActions(def, s.scene, s.player.sheet).filter((a) => a.ok);
      if (!ok.length) break;
      let a = ok[Math.floor(pick.next() * ok.length)]!.action;
      if (policy === 'careful' && pick.next() < 0.7) {
        // 성공 확률: 판정이 없으면 반드시 성공, 있으면 d20 + 보정 ≥ DC
        const chance = (x: (typeof ok)[number]) => (x.spec ? Math.max(0.05, Math.min(0.95, (21 - (x.dc - (x.mod ?? 0))) / 20)) : 1);
        a = ok.reduce((best, x) => (chance(x) > chance(best) ? x : best)).action;
      }
      used.add(a.id);
      s = sandboxAct(world, s, a.id);
      rounds++;
    }
    if (s.scene) { if (rounds >= CAP) endless++; else stuck++; continue; }
    const endId = s.sceneResults?.[def.id]?.endId ?? '?';
    ends[endId] = (ends[endId] ?? 0) + 1;
    sum += rounds; done++; min = Math.min(min, rounds); max = Math.max(max, rounds);
  }
  return {
    runs, ends, stuck, endless,
    avgRounds: done ? Math.round((sum / done) * 10) / 10 : 0, minRounds: done ? min : 0, maxRounds: max,
    unreached: def.ends.filter((e) => !ends[e.id]).map((e) => e.id),
    unusedActions: def.actions.filter((a) => !used.has(a.id)).map((a) => a.id),
  };
}
