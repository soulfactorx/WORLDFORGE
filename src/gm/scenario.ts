import { levelCapOf } from '../engine/genre';
import { evalCondition, questTransitions, reachedEnding } from '../engine/scenario';
import type { Rewards, WorldPackage } from '../engine/schema';
import { jobRewards, jobTransitions } from '../engine/jobs';
import { monsterTable } from '../engine/combat/monsters';
import { ALL_CARDS } from '../engine/combat/combat';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { progressEvents } from './progression';
import { relationshipEvents, reputationEvent } from './relationship';
import { arcTransitions, choiceToOffer, clockUpdates, dueWorldEvents } from '../engine/story';
import { effectEvents } from './story';
import { currentDay, factionActionsOn, rumorSpreadOn } from '../engine/world';
import { gainEvent, moneyEvent } from './economy';

/** resolveFlag가 없는 관계 사건은 이 턴 수가 지나면 닫힌다 */
export const BEAT_TURNS = 4;

/**
 * 시나리오 평가 → 이벤트. 퀘스트 시작·갱신·완료, 보상(경험치·관계), 결말.
 * 매 턴과 전투가 끝난 뒤 호출한다.
 */
/** 보상 → 이벤트 (임무·의뢰 공용). 순서대로 적용하므로 상태를 이어 받는다 */
export function rewardEvents(world: WorldPackage, state: GameState, r: Rewards | undefined, reason: string): GameEvent[] {
  if (!r) return [];
  const out: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent | null) => { if (!e) return; out.push(e); s = applyEvent(s, e, state.turn); };
  if (r.xp) progressEvents(s, [{ who: 'player', amount: r.xp }], reason, levelCapOf(world)).forEach(push);
  if (r.money) push(moneyEvent(world, s, r.money, reason));
  for (const it of r.items ?? []) push(gainEvent(world, it, reason));
  for (const x of r.relationship ?? []) {
    const npc = world.characters.find((c) => c.id === x.npcId);
    if (npc) relationshipEvents(world, s, npc, x, reason).forEach(push);
  }
  for (const x of r.reputation ?? []) push(reputationEvent(world, s, x.factionId, x.delta, reason));
  for (const c of r.cards ?? []) {
    const card = ALL_CARDS[c.cardId];
    const whoName = c.who === 'player' ? '당신' : world.characters.find((x) => x.id === c.who)?.name;
    if (card && whoName && !(s.grantedCards?.[c.who] ?? []).includes(c.cardId)) push({ type: 'card_granted', who: c.who, whoName, cardId: c.cardId, name: card.name });
  }
  return out;
}

export function scenarioEvents(world: WorldPackage, state: GameState): { events: GameEvent[]; ending: string | null } {
  const events: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, state.turn); };
  // 지속되는 세계 (설계 v3 7장): 지난 날마다 세력 행동·소문 전파 (한 번에 최대 30일)
  const today = currentDay(s);
  if (s.simDay === undefined) push({ type: 'sim_day', day: today });
  else if (today > s.simDay) {
    for (let d = Math.max(s.simDay + 1, today - 29); d <= today; d++) {
      for (const fa of factionActionsOn(world, s, d)) {
        push({ type: 'faction_acted', factionId: fa.factionId, name: fa.action.name, ...(fa.action.news ? { news: fa.action.news } : {}) });
        effectEvents(world, s, fa.action.effects, `${fa.factionName}: ${fa.action.name}`).forEach(push);
      }
      const rumors = rumorSpreadOn(world, s, d);
      if (rumors.length) push({ type: 'rumor_spread', beliefs: rumors });
    }
    push({ type: 'sim_day', day: today });
  }
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
    if (t.kind === 'failed') push({ type: 'quest_failed', questId: q.id, name: q.name, reason: t.reason });
    if (t.kind === 'completed') {
      push({ type: 'quest_completed', questId: q.id, name: q.name, stages: q.stages.length });
      rewardEvents(world, s, q.rewards, `임무 완료: ${q.name}`).forEach(push);
    }
  }
  // 의뢰: 토벌 승리·완료 조건·기한
  for (const t of jobTransitions(world, s)) {
    if (t.kind === 'completed') {
      push({ type: 'job_completed', jobId: t.job.id, name: t.job.name });
      rewardEvents(world, s, jobRewards(t.job, monsterTable(world)), `의뢰 완료: ${t.job.name}`).forEach(push);
    } else push({ type: 'job_failed', jobId: t.job.id, name: t.job.name, reason: t.reason ?? '' });
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
