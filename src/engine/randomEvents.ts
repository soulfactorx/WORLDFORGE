/**
 * 돌발 사건 · 템포 · 적응 난이도 (설계 v4 E5) — "지루해지지 않는다".
 * - 돌발 사건 표: 이동·휴식 때 엔진이 굴린다. 세계가 표를 정하지 않으면(randomEvents 없음) 기본 표를 쓴다 ([]면 끔).
 * - 단조로움: 한동안 아무 일도 없으면 돌발 사건 확률이 오른다.
 * - 적응 난이도: 연달아 지면 다음 전투가 조금 쉬워지고, 연달아 압승하면 정예가 나온다 (설정에서 끔).
 * 모든 굴림은 상태에서 씨앗을 얻는다 — 같은 상태면 같은 결과.
 */
import { encounterDifficulty, monstersOfWorld, monsterTable } from './combat/monsters';
import type { Rng } from './dice/rng';
import { evalCondition } from './scenario';
import type { EntityId, RandomEvent, WorldPackage } from './schema';
import type { GameState } from './state/state';
import { currentDay } from './world';

/** 기본 돌발 사건 (세계가 표를 정하지 않았을 때) */
export const BUILTIN_EVENTS: RandomEvent[] = [
  { id: 'rand/ambush', name: '기습', kind: 'ambush', weight: 3, cooldownDays: 1, text: '길목에서 적의 기척 — 기습이다!', dangerous: true },
  { id: 'rand/find', name: '뜻밖의 발견', kind: 'opportunity', weight: 2, cooldownDays: 2, text: '길가 풀숲에서 누군가 떨어뜨린 물건이 눈에 띈다.' },
  { id: 'rand/traveler', name: '길손', kind: 'meeting', weight: 2, cooldownDays: 1, text: '지나가던 길손이 말을 걸어온다 — 이 근처에서 들은 이야기 하나를 전한다.' },
  { id: 'rand/rumor', name: '수군거림', kind: 'news', weight: 2, cooldownDays: 1, text: '근처에서 사람들이 수군거리는 소리가 들린다.' },
];

export const eventTable = (world: WorldPackage) => world.randomEvents ?? BUILTIN_EVENTS;

/** 이 장소가 위험한 곳인가 (조우가 정해진 곳 — 기본 기습은 여기서만) */
const dangerousHere = (world: WorldPackage, state: GameState) => (world.encounters ?? []).some((e) => e.locationId === state.player.locationId);

/** 한동안 아무 일도 없었나 (전투·임무·발견·징조·보상 없이 n턴) */
export function monotonous(state: GameState, turns = 5): boolean {
  if (state.turn < turns) return false;
  return !state.log.some((l) => l.turn > state.turn - turns && ['combat', 'quest', 'knowledge', 'omen', 'progress', 'relation'].includes(l.kind));
}

/** 지금 일어날 수 있는 돌발 사건 */
export function eligibleEvents(world: WorldPackage, state: GameState): RandomEvent[] {
  const day = currentDay(state);
  const loc = state.player.locationId;
  return eventTable(world).filter((e) => {
    if (e.where?.length && !e.where.includes(loc)) return false;
    if (e.dangerous && !e.where?.length && !dangerousHere(world, state)) return false;
    const last = state.randomEvents?.[e.id];
    if (last !== undefined && day - last < (e.cooldownDays ?? 1)) return false;
    return !e.condition || evalCondition(world, state, e.condition);
  });
}

/** 이동·휴식 때 굴린다. 직전 3턴 안에 돌발 사건이 있었으면 쉰다 */
export function rollRandomEvent(world: WorldPackage, state: GameState, rng: Rng, trigger: 'move' | 'rest'): RandomEvent | null {
  if (state.combat || state.lastRandomTurn !== undefined && state.turn - state.lastRandomTurn < 3) return null;
  const base = trigger === 'rest' ? 0.25 : 0.2;
  const chance = Math.min(0.6, base * (monotonous(state) ? 2 : 1));
  if (rng.next() >= chance) return null;
  const list = eligibleEvents(world, state);
  const total = list.reduce((s, e) => s + (e.weight ?? 1), 0);
  if (!total) return null;
  let x = rng.next() * total;
  return list.find((e) => (x -= e.weight ?? 1) < 0) ?? list.at(-1)!;
}

/** 기본 기습의 적: 이 세계 장르의 적 중 파티 레벨에 맞는 "쉬움~보통" 조합 */
export function ambushEnemies(world: WorldPackage, state: GameState, rng: Rng): { monsterId: string; zone: number }[] {
  const levels = [state.player.sheet.level, ...Object.values(state.party).map((p) => p.level)];
  const pool = monstersOfWorld(world).filter((m) => m.role !== 'boss');
  const table = monsterTable(world);
  for (let attempt = 0; attempt < 12 && pool.length; attempt++) {
    const m = pool[Math.floor(rng.next() * pool.length)]!;
    for (const n of [3, 2, 1]) {
      const ids = Array.from({ length: n }, () => m.id);
      const d = encounterDifficulty(ids, levels, table).difficulty;
      if (d === 'easy' || d === 'moderate') return ids.map((id, i) => ({ monsterId: id, zone: 2 + (i % 2) }));
    }
  }
  return [];
}

export type Adaptive = 'easier' | 'harder' | null;

/** 적응 난이도: 최근 전투 결과 (연달아 2번 지거나 도망 → 쉽게, 연달아 3번 이기면 정예) */
export function adaptiveMode(state: GameState): Adaptive {
  const ends = state.log.filter((l) => l.kind === 'combat' && l.text.startsWith('⚔ 전투 종료')).slice(-3).map((l) => l.text.replace('⚔ 전투 종료 — ', ''));
  if (ends.length >= 2 && ends.slice(-2).every((x) => x !== '승리')) return 'easier';
  if (ends.length >= 3 && ends.every((x) => x === '승리')) return 'harder';
  return null;
}

export const isRandomEncounter = (id: EntityId) => id.startsWith('rand/');
