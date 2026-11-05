/**
 * 지속되는 세계 (설계 v3 7장) — 순수 함수.
 * 시간이 흐를 때만 계산한다(지연 시뮬레이션): 지난 날마다 세력 행동과 소문 전파를 한 번에 적용한다.
 * 인물 위치는 일정(시각)에 따라 바뀌고, 이야기가 옮긴 인물·동료는 일정보다 우선한다.
 */
import { relationsOf } from './relationship';
import type { Belief, Character, EntityId, FactionAction, WorldPackage } from './schema';
import type { GameState } from './state/state';
import { evalCondition } from './scenario';

/** 이 시각(0~23시)에 일정이 가리키는 장소 */
export function scheduledLocation(c: Pick<Character, 'schedule'>, hour: number): EntityId | undefined {
  return c.schedule?.find((s) => (s.from <= s.to ? hour >= s.from && hour < s.to : hour >= s.from || hour < s.to))?.locationId;
}

/** 인물의 지금 위치: 동료면 플레이어 곁 → 이야기·이탈로 옮긴 곳 → 일정 → 기본 위치 */
export function npcLocationOf(state: GameState, c: Character): EntityId {
  if (state.party[c.id]) return state.player.locationId;
  const moved = state.npcLocations[c.id];
  if (moved) return moved;
  return scheduledLocation(c, Math.floor(state.worldMinutes / 60) % 24) ?? c.locationId;
}

export const currentDay = (state: GameState) => Math.floor(state.worldMinutes / 1440);

/** 이 날 일어나는 세력 행동 */
export function factionActionsOn(world: WorldPackage, state: GameState, day: number): { factionId: EntityId; factionName: string; action: FactionAction }[] {
  if (day <= 0) return [];
  return (world.factions ?? []).flatMap((f) => (f.actions ?? [])
    .filter((a) => a.every >= 1 && day % Math.round(a.every) === 0 && (!a.condition || evalCondition(world, state, a.condition)))
    .map((action) => ({ factionId: f.id, factionName: f.name, action })));
}

const SPREAD_KINDS = new Set(['family', 'ally', 'lover', 'master']);
const RUMORS_PER_DAY = 3;

/**
 * 소문 전파: 인물이 아는 것(비밀 제외) 중, 가까운 사이(가족·동지·연인·스승)나 같은 세력 사람이 모르는 것이 하루에 몇 개씩 퍼진다.
 * 비밀(secret)과 극비 사실(비밀도 3 이상)에 이어진 명제는 퍼지지 않는다. 퍼진 것은 "소문"으로 안다 (잘못 안 것은 잘못 안 채로).
 * 어떤 것이 퍼질지는 날짜로 정해진다 (같은 세이브는 같은 결과).
 */
export function rumorSpreadOn(world: WorldPackage, state: GameState, day: number): Belief[] {
  if (world.simulation?.rumors === false) return [];
  const alive = world.characters.filter((c) => !state.deadNpcs.includes(c.id));
  const known = new Map<string, Belief>();
  for (const b of [...world.beliefs, ...state.beliefs]) if (b.holder !== 'player') known.set(`${b.holder}|${b.claim}`, b);
  const secretFact = (claimId: EntityId) => {
    const cl = world.claims.find((c) => c.id === claimId);
    const f = cl?.relatesTo ? world.facts.find((x) => x.id === cl.relatesTo) : undefined;
    return !!f && f.secrecy >= 3;
  };
  const candidates: Belief[] = [];
  for (const a of alive) {
    const near = new Set([
      ...relationsOf(world, a.id).filter((r) => SPREAD_KINDS.has(r.kind)).map((r) => r.other),
      ...(a.faction ? alive.filter((o) => o.faction === a.faction && o.id !== a.id).map((o) => o.id) : []),
    ]);
    for (const b of [...known.values()].filter((x) => x.holder === a.id && x.state !== 'secret' && !secretFact(x.claim))) {
      for (const other of [...near].sort()) {
        if (!alive.some((c) => c.id === other) || known.has(`${other}|${b.claim}`)) continue;
        candidates.push({ holder: other, claim: b.claim, state: b.state === 'mistaken' ? 'mistaken' : 'rumor', source: a.id });
      }
    }
  }
  const uniq = [...new Map(candidates.map((c) => [`${c.holder}|${c.claim}`, c])).values()].sort((x, y) => `${x.holder}|${x.claim}`.localeCompare(`${y.holder}|${y.claim}`));
  const out: Belief[] = [];
  for (let i = 0; i < Math.min(RUMORS_PER_DAY, uniq.length); i++) {
    const pick = uniq[(day * 7 + i * 13) % uniq.length]!;
    if (!out.some((o) => o.holder === pick.holder && o.claim === pick.claim)) out.push(pick);
  }
  return out;
}
