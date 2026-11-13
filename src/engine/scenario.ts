import { worldVars } from './vars';
import { relationshipOf, reputationOf, stageFor } from './relationship';
import { npcLocationOf } from './world';
import type { Condition, Ending, EntityId, KnowledgeState, Quest, QuestType, WorldPackage } from './schema';

export const QUEST_TYPE_LABEL: Record<QuestType, string> = {
  hunt: '토벌', escort: '호위', deliver: '전달', gather: '수집', investigate: '조사', infiltrate: '잠입',
  rescue: '구출', defend: '방어', negotiate: '협상', survive: '생존', duel: '결투', bond: '관계',
};
import type { GameState } from './state/state';
import { traitValue } from './traits';

/**
 * 시나리오 엔진 (설계 리뷰 4.3절, 설계서 PART 13).
 * 조건은 선언형 데이터이고 엔진이 평가한다 — 패키지 안의 코드를 실행하지 않는다.
 * AI는 힌트를 받아 연출만 하고, 퀘스트 진행·완료·결말은 엔진이 결정한다.
 */

export interface QuestProgress {
  /** 현재 단계 인덱스 (done이면 stages.length) */
  stage: number;
  done: boolean;
  failed?: boolean;
  startedAt?: number;
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
  if ('npcAt' in c) {
    if (state.deadNpcs.includes(c.npcAt)) return false;
    const ch = world.characters.find((x) => x.id === c.npcAt);
    return !!ch && npcLocationOf(state, ch) === c.at;
  }
  if ('at' in c) return state.player.locationId === c.at;
  if ('cleared' in c) return state.clearedEncounters.includes(c.cleared);
  if ('inParty' in c) return !!state.party[c.inParty];
  if ('relationship' in c) {
    const v = relationshipOf(world, state.relationships, c.relationship)[c.axis];
    return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte);
  }
  if ('stage' in c) return c.in.includes(stageFor(world, state.relationships, c.stage));
  if ('reputation' in c) {
    const v = reputationOf(world, state.reputation ?? {}, c.reputation);
    return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte);
  }
  if ('chapter' in c) { const a = state.arcs?.[c.chapter]; return !!a && (a.done && !a.failed ? Infinity : a.chapter) >= c.gte; }
  if ('arcDone' in c) { const a = state.arcs?.[c.arcDone]; return !!a?.done && (c.failed === undefined || !!a.failed === c.failed); }
  if ('clock' in c) {
    const v = state.clocks?.[c.clock]?.value ?? world.clocks?.find((x) => x.id === c.clock)?.start ?? 0;
    return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte);
  }
  if ('choice' in c) { const ch = state.choices?.[c.choice]?.chosen; return c.is === undefined ? !!ch : ch === c.is; }
  if ('day' in c) return Math.floor(state.worldMinutes / 1440) >= c.day;
  if ('defeated' in c) return (state.kills?.[c.defeated] ?? 0) >= (c.n ?? 1);
  if ('npcAlive' in c) return !state.deadNpcs.includes(c.npcAlive);
  if ('questFailed' in c) return !!state.quests[c.questFailed]?.failed;
  if ('hasItem' in c) return (state.inventory?.[c.hasItem] ?? 0) >= (c.n ?? 1);
  if ('money' in c) return (state.money ?? 0) >= c.money;
  if ('flag' in c) return state.flags.includes(c.flag);
  if ('questDone' in c) return !!state.quests[c.questDone]?.done && !state.quests[c.questDone]?.failed;
  if ('level' in c) return state.player.sheet.level >= c.level;
  if ('trait' in c) { const v = traitValue(world as WorldPackage, state.player.sheet, c.trait); return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte); }
  if ('phase' in c) return state.phase === c.phase;
  if ('storylet' in c) { const r = state.storylets?.[c.storylet]; return !!r?.chosen && (c.is === undefined || r.chosen === c.is); }
  if ('var' in c) { const v = varValue(world, state, c.var); return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte); }
  if ('encounter' in c) {
    const r = state.encounterResults?.[c.encounter];
    // 예전 세이브: 결과 기록이 없어도 이긴 조우는 승리로 본다
    const outcome = r?.outcome ?? (state.clearedEncounters.includes(c.encounter) ? 'victory' : undefined);
    return !!outcome && (c.is === undefined || outcome === c.is);
  }
  if ('sceneEnd' in c) {
    const r = state.sceneResults?.[c.sceneEnd];
    return !!r && r.outcome !== 'abandoned' && (c.is === undefined || r.endId === c.is) && (c.outcome === undefined || r.outcome === c.outcome);
  }
  if ('npcGoal' in c) {
    const g = state.npcGoals?.[c.npcGoal];
    if (!g) return false;
    const now = g.done ? 'done' : g.stopped ? 'stopped' : 'active';
    return c.is === undefined ? now === 'done' : now === c.is;
  }
  if ('questOutcome' in c) { const q = state.quests[c.questOutcome]; return !!q?.done && !q.failed && !!q.outcome && (c.is === undefined || q.outcome === c.is); }
  return false;
}

export type QuestTransition =
  | { kind: 'started'; quest: Quest }
  | { kind: 'advanced'; quest: Quest; stage: number }
  | { kind: 'completed'; quest: Quest }
  | { kind: 'failed'; quest: Quest; reason: string };

/** 임무가 지금 실패했는가 (대상 사망 · 기한 초과 · 실패 조건) */
export function questFailure(world: WorldPackage, state: GameState, q: Quest, p: QuestProgress): string | null {
  if (q.target && state.deadNpcs.includes(q.target)) return `${world.characters.find((c) => c.id === q.target)?.name ?? '대상'}이(가) 죽었다`;
  if (q.timeLimit && p.startedAt !== undefined && state.worldMinutes - p.startedAt > q.timeLimit.days * 1440) return '기한이 지났다';
  if (q.fail && evalCondition(world, state, q.fail)) return '돌이킬 수 없는 일이 일어났다';
  const st = q.stages[p.stage];
  if (st?.fail && evalCondition(world, state, st.fail)) return '돌이킬 수 없는 일이 일어났다';
  return null;
}

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
      progress[q.id] = { stage: 0, done: false, startedAt: state.worldMinutes };
      out.push({ kind: 'started', quest: q });
    }
    const p = progress[q.id];
    if (!p) continue;
    for (let guard = 0; !p.done && guard <= q.stages.length; guard++) {
      const why = questFailure(world, view(), q, p);
      if (why) { p.done = true; p.failed = true; out.push({ kind: 'failed', quest: q, reason: why }); break; }
      const stage = q.stages[p.stage];
      // 갈래 카드의 갈림길이 이 단계를 끝냈으면 (v0.115) 조건과 상관없이 넘어간다
      if (!stage || !(state.questPush?.[q.id] === p.stage || evalCondition(world, view(), stage.complete))) break;
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

/** 지금 열려 있는 관계 사건 (설계 v3 4.2) */
export function activeBeats(world: WorldPackage, state: GameState) {
  return (world.relationBeats ?? []).filter((b) => state.beats?.[b.id] && !state.beats[b.id]!.done);
}

/** 세계 수치 (설계 v4 E6) */
export function varValue(world: Pick<WorldPackage, 'vars'>, state: GameState, id: string): number {
  return state.vars?.[id] ?? worldVars(world).find((v) => v.id === id)?.initial ?? 0;
}
export function varLabel(def: NonNullable<WorldPackage['vars']>[number], value: number): string {
  const l = [...(def.labels ?? [])].sort((a, b) => a[0] - b[0]).filter(([n]) => value >= n).at(-1);
  return l ? l[1] : String(value);
}

/** 조건이 비어 항상 참인가 ({ all: [] } — 시작하자마자 성립) (v0.57.3) */
export function isAlwaysTrue(c: Condition | undefined): boolean {
  if (!c || typeof c !== 'object') return false;
  if ('all' in c && Array.isArray(c.all)) return c.all.every((x) => isAlwaysTrue(x));
  return false;
}
/** 조건을 아직 정하지 않았는가 ({ any: [] } — 절대 성립하지 않음) */
export function isUnset(c: Condition | undefined): boolean {
  return !!c && typeof c === 'object' && 'any' in c && Array.isArray(c.any) && c.any.length === 0;
}
/** 새 장·단계의 완료 조건 기본값: 정하기 전에는 끝나지 않는다 */
export const UNSET_CONDITION: Condition = { any: [] };
