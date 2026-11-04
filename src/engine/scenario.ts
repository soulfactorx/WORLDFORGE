import { relationshipOf } from './relationship';
import type { Condition, Ending, EntityId, KnowledgeState, Quest, WorldPackage } from './schema';
import type { GameState } from './state/state';

/**
 * 시나리오 엔진 (설계 리뷰 4.3절, 설계서 PART 13).
 * 조건은 선언형 데이터이고 엔진이 평가한다 — 패키지 안의 코드를 실행하지 않는다.
 * AI는 힌트를 받아 연출만 하고, 퀘스트 진행·완료·결말은 엔진이 결정한다.
 */

export interface QuestProgress {
  /** 현재 단계 인덱스 (done이면 stages.length) */
  stage: number;
  done: boolean;
}

const KNOWLEDGE_RANK: Record<KnowledgeState, number> = { mistaken: 0, rumor: 1, partial: 2, confirmed: 3, secret: 3 };

export function playerKnows(state: GameState, claim: EntityId, min: KnowledgeState = 'rumor'): boolean {
  const b = state.beliefs.find((x) => x.holder === 'player' && x.claim === claim);
  return !!b && KNOWLEDGE_RANK[b.state] >= KNOWLEDGE_RANK[min];
}

export function evalCondition(world: WorldPackage, state: GameState, c: Condition): boolean {
  if ('all' in c) return c.all.every((x) => evalCondition(world, state, x));
  if ('any' in c) return c.any.some((x) => evalCondition(world, state, x));
  if ('not' in c) return !evalCondition(world, state, c.not);
  if ('knows' in c) return playerKnows(state, c.knows, c.min);
  if ('at' in c) return state.player.locationId === c.at;
  if ('cleared' in c) return state.clearedEncounters.includes(c.cleared);
  if ('inParty' in c) return !!state.party[c.inParty];
  if ('relationship' in c) {
    const v = relationshipOf(world, state.relationships, c.relationship)[c.axis];
    return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte);
  }
  if ('flag' in c) return state.flags.includes(c.flag);
  if ('questDone' in c) return !!state.quests[c.questDone]?.done;
  if ('level' in c) return state.player.sheet.level >= c.level;
  return false;
}

export type QuestTransition =
  | { kind: 'started'; quest: Quest }
  | { kind: 'advanced'; quest: Quest; stage: number }
  | { kind: 'completed'; quest: Quest };

/**
 * 현재 상태에서 일어나야 할 퀘스트 변화. 한 단계 완료가 다음 단계 완료로 이어질 수 있으므로
 * 더 이상 바뀌지 않을 때까지 반복한다 (단계 수만큼으로 제한).
 */
export function questTransitions(world: WorldPackage, state: GameState): QuestTransition[] {
  const out: QuestTransition[] = [];
  const progress: Record<EntityId, QuestProgress> = structuredClone(state.quests);
  const view = (): GameState => ({ ...state, quests: progress });
  for (const q of world.quests ?? []) {
    if (!progress[q.id] && evalCondition(world, view(), q.start)) {
      progress[q.id] = { stage: 0, done: false };
      out.push({ kind: 'started', quest: q });
    }
    const p = progress[q.id];
    if (!p) continue;
    for (let guard = 0; !p.done && guard <= q.stages.length; guard++) {
      const stage = q.stages[p.stage];
      if (!stage || !evalCondition(world, view(), stage.complete)) break;
      p.stage++;
      if (p.stage >= q.stages.length) {
        p.done = true;
        out.push({ kind: 'completed', quest: q });
      } else {
        out.push({ kind: 'advanced', quest: q, stage: p.stage });
      }
    }
  }
  return out;
}

/** 새로 도달한 결말 (이미 결말에 도달했으면 null) */
export function reachedEnding(world: WorldPackage, state: GameState): Ending | null {
  if (state.ending) return null;
  return (world.endings ?? []).find((e) => evalCondition(world, state, e.condition)) ?? null;
}

/** Director가 세울 수 있는 플래그인가 */
export function flagAllowed(world: WorldPackage, state: GameState, flagId: string): boolean {
  const f = (world.flags ?? []).find((x) => x.id === flagId);
  if (!f || state.flags.includes(flagId)) return false;
  if (f.locationId && f.locationId !== state.player.locationId) return false;
  return !f.requires || evalCondition(world, state, f.requires);
}

/** 지금 장소에서 아직 발견하지 않은 것 */
export function pendingDiscoveries(world: WorldPackage, state: GameState) {
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  return (loc?.discoveries ?? []).filter((d) => !playerKnows(state, d.claim, d.state ?? 'confirmed'));
}

/** 현재 진행 중인 퀘스트와 단계 */
export function activeQuests(world: WorldPackage, state: GameState) {
  return (world.quests ?? []).flatMap((q) => {
    const p = state.quests[q.id];
    return p && !p.done ? [{ quest: q, stage: q.stages[p.stage]!, index: p.stage }] : [];
  });
}
