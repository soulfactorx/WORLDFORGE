import { levelCapOf } from '../engine/genre';
import { evalCondition, questTransitions, reachedEnding } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { progressEvents } from './progression';
import { relationshipEvents, reputationEvent } from './relationship';
import { arcTransitions, choiceToOffer, clockUpdates, dueWorldEvents } from '../engine/story';
import { effectEvents } from './story';

/** resolveFlag가 없는 관계 사건은 이 턴 수가 지나면 닫힌다 */
export const BEAT_TURNS = 4;

/**
 * 시나리오 평가 → 이벤트. 퀘스트 시작·갱신·완료, 보상(경험치·관계), 결말.
 * 매 턴과 전투가 끝난 뒤 호출한다.
 */
export function scenarioEvents(world: WorldPackage, state: GameState): { events: GameEvent[]; ending: string | null } {
  const events: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, state.turn); };
  // 이야기 엔진: 시계 → 연표 사건 → 줄기·장 → 결정적 선택 (이 결과로 임무가 진행될 수 있으므로 먼저)
  for (const u of clockUpdates(world, s)) {
    push({ type: 'clock_changed', clockId: u.clock.id, value: u.value, minutes: u.minutes, ...(u.onFired.length ? { onFired: u.onFired } : {}) });
    for (const seg of u.reached) {
      const at = u.clock.at.find((x) => x.segment === seg)!;
      push({ type: 'clock_reached', clockId: u.clock.id, segment: seg, ...(at.omen ? { omen: at.omen } : {}) });
      effectEvents(world, s, at.effects ?? [], u.clock.name).forEach(push);
    }
  }
  for (const { event, skipped } of dueWorldEvents(world, s)) {
    push({ type: 'world_event', eventId: event.id, name: event.name, skipped, ...(event.announce ? { announce: event.announce } : {}) });
    if (!skipped) effectEvents(world, s, event.effects, event.name).forEach(push);
  }
  for (const t of arcTransitions(world, s)) {
    if (t.kind === 'started') push({ type: 'arc_started', arcId: t.arc.id, name: t.arc.name, chapter: t.arc.chapters[0]!.name });
    if (t.kind === 'chapter') {
      const ch = t.arc.chapters[t.index]!;
      const next = t.arc.chapters[t.index + 1];
      push({ type: 'chapter_completed', arcId: t.arc.id, index: t.index, name: t.arc.name, ...(next ? { next: next.name } : {}) });
      effectEvents(world, s, ch.effects ?? [], `${t.arc.name}: ${ch.name}`).forEach(push);
    }
    if (t.kind === 'ended') push({ type: 'arc_ended', arcId: t.arc.id, name: t.arc.name, failed: t.failed });
  }
  const offer = choiceToOffer(world, s);
  if (offer) push({ type: 'choice_offered', choiceId: offer.id, name: offer.name });
  for (const t of questTransitions(world, s)) {
    const q = t.quest;
    if (t.kind === 'started') push({ type: 'quest_started', questId: q.id, name: q.name, objective: q.stages[0]?.objective ?? '' });
    if (t.kind === 'advanced') push({ type: 'quest_advanced', questId: q.id, name: q.name, stage: t.stage, objective: q.stages[t.stage]!.objective });
    if (t.kind === 'completed') {
      push({ type: 'quest_completed', questId: q.id, name: q.name, stages: q.stages.length });
      if (q.rewards?.xp) progressEvents(s, [{ who: 'player', amount: q.rewards.xp }], `임무 완료: ${q.name}`, levelCapOf(world)).forEach(push);
      for (const r of q.rewards?.relationship ?? []) {
        const npc = world.characters.find((c) => c.id === r.npcId);
        if (npc) relationshipEvents(world, s, npc, r, `임무 완료: ${q.name}`).forEach(push);
      }
      for (const r of q.rewards?.reputation ?? []) {
        const ev = reputationEvent(world, s, r.factionId, r.delta, `임무 완료: ${q.name}`);
        if (ev) push(ev);
      }
    }
  }
  // 관계 사건: 조건이 맞으면 열리고, 해결 플래그가 서거나 시간이 지나면 닫힌다
  for (const b of world.relationBeats ?? []) {
    const st = s.beats?.[b.id];
    if (!st) {
      if (!s.deadNpcs.includes(b.npcId) && evalCondition(world, s, b.condition)) push({ type: 'beat_opened', beatId: b.id, npcId: b.npcId, name: b.name });
    } else if (!st.done && ((b.resolveFlag && s.flags.includes(b.resolveFlag)) || (!b.resolveFlag && s.turn - st.turn >= BEAT_TURNS) || s.deadNpcs.includes(b.npcId))) {
      push({ type: 'beat_closed', beatId: b.id });
    }
  }
  const ending = reachedEnding(world, s);
  if (ending) push({ type: 'ending_reached', endingId: ending.id, name: ending.name });
  return { events, ending: ending?.epilogue ?? null };
}
