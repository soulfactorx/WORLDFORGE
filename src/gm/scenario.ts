import { questTransitions, reachedEnding } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { progressEvents } from './progression';
import { relationshipEvent } from './relationship';

/**
 * 시나리오 평가 → 이벤트. 퀘스트 시작·갱신·완료, 보상(경험치·관계), 결말.
 * 매 턴과 전투가 끝난 뒤 호출한다.
 */
export function scenarioEvents(world: WorldPackage, state: GameState): { events: GameEvent[]; ending: string | null } {
  const events: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, state.turn); };
  for (const t of questTransitions(world, state)) {
    const q = t.quest;
    if (t.kind === 'started') push({ type: 'quest_started', questId: q.id, name: q.name, objective: q.stages[0]?.objective ?? '' });
    if (t.kind === 'advanced') push({ type: 'quest_advanced', questId: q.id, name: q.name, stage: t.stage, objective: q.stages[t.stage]!.objective });
    if (t.kind === 'completed') {
      push({ type: 'quest_completed', questId: q.id, name: q.name, stages: q.stages.length });
      if (q.rewards?.xp) progressEvents(s, [{ who: 'player', amount: q.rewards.xp }], `임무 완료: ${q.name}`).forEach(push);
      for (const r of q.rewards?.relationship ?? []) {
        const npc = world.characters.find((c) => c.id === r.npcId);
        const ev = npc && relationshipEvent(world, s, npc, r, `임무 완료: ${q.name}`);
        if (ev) push(ev);
      }
    }
  }
  const ending = reachedEnding(world, s);
  if (ending) push({ type: 'ending_reached', endingId: ending.id, name: ending.name });
  return { events, ending: ending?.epilogue ?? null };
}
