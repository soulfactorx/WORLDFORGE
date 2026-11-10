/**
 * 조우가 지금 일어날 수 있는가 (v0.85) — 순수 함수.
 *  - 이긴 조우는 다시 일어나지 않는다
 *  - 지거나 달아난 조우는 retry 턴만큼 쉰다 (기본 3) / 'gone'이면 사라진다
 *  - when 조건. 비어 있으면 — 임무 단계에 걸린 조우는 그 단계가 진행 중일 때만
 */
import { jobEncounters } from './jobs';
import { evalCondition } from './scenario';
import { type Condition, type Encounter, ENCOUNTER_RETRY_TURNS, type EntityId, type QuestStage, type WorldPackage } from './schema';
import type { GameState } from './state/state';

/** 조건 안에서 "해야 하는 것"만 훑는다 (not 아래는 보지 않는다) */
function walkPositive(c: Condition | undefined, visit: (c: Condition) => void) {
  if (!c) return;
  if ('all' in c) c.all.forEach((x) => walkPositive(x, visit));
  else if ('any' in c) c.any.forEach((x) => walkPositive(x, visit));
  else if (!('not' in c)) visit(c);
}

/** 이 단계가 걸려 있는 조우·장면 (via + 완료 조건의 cleared·encounter·sceneEnd) */
export function stageGates(stage: QuestStage): { encounters: EntityId[]; scenes: EntityId[] } {
  const encounters = new Set<EntityId>();
  const scenes = new Set<EntityId>();
  if (stage.via?.encounter) encounters.add(stage.via.encounter);
  if (stage.via?.scene) scenes.add(stage.via.scene);
  walkPositive(stage.complete, (c) => {
    if ('cleared' in c) encounters.add(c.cleared);
    if ('encounter' in c) encounters.add(c.encounter);
    if ('sceneEnd' in c) scenes.add(c.sceneEnd);
  });
  return { encounters: [...encounters], scenes: [...scenes] };
}

/** 이 조우를 고비로 쓰는 임무 단계들 */
export function encounterStages(world: WorldPackage, encounterId: EntityId): { questId: EntityId; questName: string; stage: number }[] {
  return (world.quests ?? []).flatMap((q) => q.stages.flatMap((st, i) => (stageGates(st).encounters.includes(encounterId) ? [{ questId: q.id, questName: q.name, stage: i }] : [])));
}

/** 왜 지금 일어날 수 없는가 (일어날 수 있으면 null) — 편집기 시험·디버그에도 쓴다 */
export function encounterBlocked(world: WorldPackage, state: GameState, enc: Encounter): string | null {
  if (state.clearedEncounters.includes(enc.id)) return '이미 이겼다';
  const last = state.encounterResults?.[enc.id];
  if (last && last.outcome !== 'victory') {
    const retry = enc.retry ?? ENCOUNTER_RETRY_TURNS;
    if (retry === 'gone') return '지거나 달아난 뒤 사라졌다';
    if (state.turn - last.turn < retry) return `지거나 달아난 지 ${state.turn - last.turn}턴 — ${retry}턴 뒤에 다시 일어날 수 있다`;
  }
  if (enc.when) return evalCondition(world, state, enc.when) ? null : '조건(when)이 맞지 않는다';
  const stages = encounterStages(world, enc.id);
  if (!stages.length) return null;
  const open = stages.some((g) => { const p = state.quests[g.questId]; return !!p && !p.done && p.stage === g.stage; });
  return open ? null : `임무 단계에 걸려 있다 (${stages.map((g) => `${g.questName} ${g.stage + 1}단계`).join(', ')}) — 그 단계가 진행 중일 때만 일어난다`;
}

/** 세계의 조우 + 진행 중인 토벌 의뢰의 조우 */
export const allEncounters = (world: WorldPackage, state: GameState): Encounter[] => [...(world.encounters ?? []), ...jobEncounters(world, state)];

/** 이 장소에서 지금 일어날 수 있는 조우 */
export function openEncounters(world: WorldPackage, state: GameState): Encounter[] {
  return allEncounters(world, state).filter((e) => e.locationId === state.player.locationId && !encounterBlocked(world, state, e));
}

/** GM 판단 없이 지금 바로 시작해야 하는 조우 (force 조건) */
export function forcedEncounter(world: WorldPackage, state: GameState): Encounter | undefined {
  if (state.combat || state.scene || state.playerDead || state.ending) return undefined;
  return openEncounters(world, state).find((e) => !!e.force && evalCondition(world, state, e.force));
}
