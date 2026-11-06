import { levelCapOf } from '../engine/genre';
import { rewardXp } from '../engine/character/progression';
import { newTitles } from '../engine/renown';
import { availableScenes, newRun } from '../engine/scene';
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
import { currentDay, factionActionsOn, npcLocationOf, rumorSpreadOn } from '../engine/world';
import { epithetOf, knowsName } from '../engine/names';
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
  if (r.xp) progressEvents(s, [{ who: 'player', amount: rewardXp(s.player.sheet, r.xp, levelCapOf(world)) }], reason, levelCapOf(world)).forEach(push);
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
      push({ type: 'chapter_completed', arcId: t.arc.id, index: t.index, name: t.arc.name, ...(next ? { next: next.name, ...(next.summary ? { preview: next.summary } : {}) } : {}) });
      effectEvents(world, s, ch.effects ?? [], `${t.arc.name}: ${ch.name}`).forEach(push);
      // 장 완료 이정표: 다음 레벨까지 채운다 (세계 상한 안에서, 장마다 한 번)
      progressEvents(s, [{ who: 'player', amount: rewardXp(s.player.sheet, 'chapter', levelCapOf(world)) }], `장 완료: ${t.arc.name} — ${ch.name}`, levelCapOf(world), `chapter:${t.arc.id}:${t.index}`).forEach(push);
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
      // 여러 결과 (설계 v4 E6): 위에서부터 처음 맞는 결과 하나 — 효과와 추가 보상
      const oc = (q.outcomes ?? []).find((o) => evalCondition(world, s, o.when));
      if (oc) {
        push({ type: 'quest_outcome', questId: q.id, questName: q.name, outcomeId: oc.id, name: oc.name, ...(oc.text ? { text: oc.text } : {}) });
        effectEvents(world, s, oc.effects ?? [], `${q.name}: ${oc.name}`).forEach(push);
        rewardEvents(world, s, oc.rewards, `${q.name}: ${oc.name}`).forEach(push);
      }
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
  // 먼저 다가오기 (설계 v4 E7): 열렸을 때 그 인물이 다른 곳에 있으면 찾아오거나 전갈을 보낸다 — 보지도 못한 채 닫히지 않게
  for (const b of world.relationBeats ?? []) {
    if (!s.beats?.[b.id]) {
      if (!s.deadNpcs.includes(b.npcId) && evalCondition(world, s, b.condition)) push({ type: 'beat_opened', beatId: b.id, npcId: b.npcId, name: b.name });
      else continue;
    }
    const st = s.beats[b.id]!;
    if (st.done) continue;
    const npc = world.characters.find((c) => c.id === b.npcId);
    const mode = b.approach ?? 'visit';
    if (npc && st.approached === undefined && mode !== 'none' && !s.combat && !s.deadNpcs.includes(npc.id) && !s.party[npc.id] && npcLocationOf(s, npc) !== s.player.locationId) {
      const nm = knowsName(s, npc.id) ? npc.name : epithetOf(npc);
      push(mode === 'visit'
        ? { type: 'npc_approached', beatId: b.id, npcId: npc.id, mode, to: s.player.locationId, stay: BEAT_TURNS + 1, text: `👤 ${nm}이(가) 당신을 찾아왔다.` }
        : { type: 'npc_approached', beatId: b.id, npcId: npc.id, mode, stay: 0, text: `✉ ${nm}에게서 전갈이 왔다: ${b.message ?? '만나서 할 이야기가 있다고 한다.'}` });
      continue;
    }
    const since = s.turn - (s.beats[b.id]!.approached ?? st.turn);
    const limit = mode === 'message' && st.approached !== undefined ? BEAT_TURNS * 3 : BEAT_TURNS;
    if ((b.resolveFlag && s.flags.includes(b.resolveFlag)) || (!b.resolveFlag && since >= limit) || s.deadNpcs.includes(b.npcId)) {
      push({ type: 'beat_closed', beatId: b.id });
    }
  }
  // NPC 목표 (설계 v4 E7): 시작 → 날 수가 지나면 이뤄진다 / 막는 조건·죽음이면 꺾인다
  for (const c of world.characters) {
    for (const g of c.goals ?? []) {
      const st = s.npcGoals?.[g.id];
      const dead = s.deadNpcs.includes(c.id);
      if (!st) {
        if (!dead && (!g.start || evalCondition(world, s, g.start))) push({ type: 'goal_started', goalId: g.id, npcId: c.id });
        continue;
      }
      if (st.done || st.stopped) continue;
      if (dead || (g.stop && evalCondition(world, s, g.stop))) {
        push({ type: 'goal_ended', goalId: g.id, npcId: c.id, outcome: 'stopped', ...(g.stopped && !dead ? { announce: g.stopped } : {}) });
      } else if ((s.worldMinutes - st.startedAt) / 1440 >= g.days) {
        push({ type: 'goal_ended', goalId: g.id, npcId: c.id, outcome: 'done', ...(g.announce ? { announce: g.announce } : {}) });
        effectEvents(world, s, g.effects ?? [], `${c.name}의 목표: ${g.text}`).forEach(push);
      }
    }
  }
  // 장면 (v0.47): 저절로 시작하는 장면
  if (!s.scene && !s.combat) {
    const auto = availableScenes(world, s, { auto: true })[0];
    if (auto) push({ type: 'scene_started', sceneId: auto.id, name: auto.name, run: newRun(auto) });
  }
  // 칭호 (설계 v4 E4): 기록에서 엔진이 준다
  for (const t of newTitles(world, s)) push({ type: 'title_earned', titleId: t.id, name: t.name, desc: t.desc });
  const ending = reachedEnding(world, s);
  if (ending) push({ type: 'ending_reached', endingId: ending.id, name: ending.name });
  return { events, ending: ending?.epilogue ?? null };
}
