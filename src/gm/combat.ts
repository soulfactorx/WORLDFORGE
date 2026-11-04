import { createRng, type Rng } from '../engine/dice/rng';
import {
  type CombatState, currentActorId, resolveCard, runAutoTurns, startCombat, type Target, type PartyOrder, type CompanionEntry,
} from '../engine/combat/combat';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { relationshipEvent } from './relationship';

/**
 * 전투 진행 — 엔진 결과를 이벤트로 만든다. 전투 중에는 LLM을 호출하지 않는다 (비용·속도·결정성).
 * 전투가 끝나면 narrateCombat으로 한 번만 서술한다.
 */

/** 이 장소에서 아직 끝나지 않은 조우 */
export function availableEncounters(world: WorldPackage, state: GameState) {
  return (world.encounters ?? []).filter((e) => e.locationId === state.player.locationId && !state.clearedEncounters.includes(e.id));
}

class Builder {
  events: GameEvent[] = [];
  constructor(public world: WorldPackage, public state: GameState, private turn: number) {}
  push(e: GameEvent) { this.events.push(e); this.state = applyEvent(this.state, e, this.turn); }
}

function finishIfOver(b: Builder) {
  const cs = b.state.combat;
  if (!cs?.outcome) return;
  const p = cs.combatants.player!;
  // 쓰러진 사람은 전투가 끝나면 HP 1로 깨어난다 (사망 규칙은 아직 없음)
  const after = (hp: number) => Math.max(1, hp);
  const party: Record<string, { hp: number; resources: Record<string, { cur: number; max: number }> }> = {};
  for (const id of Object.keys(b.state.party)) {
    const c = cs.combatants[id];
    if (c) party[id] = { hp: after(c.hp), resources: c.resources };
  }
  b.push({ type: 'combat_ended', outcome: cs.outcome, hp: after(p.hp), resources: p.resources, party });
  // 함께 싸워 이긴 동료는 신뢰와 존경이 오르고, 버려두고 도망치면 실망한다
  for (const id of Object.keys(party)) {
    const npc = b.world.characters.find((c) => c.id === id);
    if (!npc) continue;
    const ev = cs.outcome === 'victory' ? relationshipEvent(b.world, b.state, npc, { trust: 5, respect: 3 }, '함께 싸워 이겼다')
      : cs.outcome === 'fled' && cs.combatants[id] && cs.combatants[id]!.hp > 0 ? relationshipEvent(b.world, b.state, npc, { respect: -3 }, '함께 물러났다')
      : null;
    if (ev) b.push(ev);
  }
  if (cs.outcome === 'defeat') b.push({ type: 'time_advanced', minutes: 60 });
}

function runEnemies(b: Builder, rng: Rng) {
  const cs = b.state.combat;
  if (!cs || cs.outcome) return;
  const { steps } = runAutoTurns(cs, rng, b.state.partyOrders);
  for (const st of steps) {
    if (st.kind === 'end_turn') b.push({ type: 'combat_turn_ended' });
    else b.push({ type: 'combat_action', actorId: st.actorId, cardId: st.cardId, target: st.target, effects: st.resolution.effects, log: st.resolution.log, rngState: st.rngState });
  }
  finishIfOver(b);
}

/** 조우 시작 + (적이 우선권이 빠르면) 플레이어 차례까지 적 행동 진행 */
export function beginEncounter(world: WorldPackage, state: GameState, encounterId: string, turn: number): GameEvent[] {
  const enc = availableEncounters(world, state).find((e) => e.id === encounterId);
  if (!enc) throw new Error('이 장소에서 시작할 수 없는 조우');
  const rng = createRng(state.rngState);
  const companions: CompanionEntry[] = Object.entries(state.party).map(([id, sheet]) => ({ id, name: sheet.name, sheet, order: state.partyOrders[id] }));
  const combat = startCombat(enc, state.player.sheet, rng, companions);
  const b = new Builder(world, state, turn);
  b.push({ type: 'combat_started', combat, rngState: rng.state() });
  runEnemies(b, rng);
  return b.events;
}

export function playerCombatAction(world: WorldPackage, state: GameState, cardId: string, target: Target): GameEvent[] {
  const cs = state.combat;
  if (!cs || currentActorId(cs) !== 'player') throw new Error('지금은 행동할 수 없다');
  const rng = createRng(state.rngState);
  const r = resolveCard(cs, 'player', cardId, target, rng);
  const b = new Builder(world, state, state.turn);
  b.push({ type: 'combat_action', actorId: 'player', cardId, target, effects: r.effects, log: r.log, rngState: rng.state() });
  finishIfOver(b);
  return b.events;
}

export function playerEndTurn(world: WorldPackage, state: GameState): GameEvent[] {
  const cs = state.combat;
  if (!cs || currentActorId(cs) !== 'player') throw new Error('내 차례가 아니다');
  const rng = createRng(state.rngState);
  const b = new Builder(world, state, state.turn);
  b.push({ type: 'combat_turn_ended' });
  runEnemies(b, rng);
  return b.events;
}

/** 동료에게 전술 명령 (말로 지시하는 것이므로 행동 경제를 쓰지 않는다) */
export function setPartyOrder(state: GameState, npcId: string, order: PartyOrder): GameEvent[] {
  if (!state.party[npcId]) throw new Error('동료가 아니다');
  return [{ type: 'party_order', npcId, order }];
}

/** 전투 결과 서술 — 확정된 전투 기록만 넘긴다 */
export async function narrateCombat(
  llm: LlmClient, world: WorldPackage, before: CombatState, after: GameState, combatLog: string[],
  onText: (d: string) => void, signal?: AbortSignal,
): Promise<string> {
  const loc = world.locations.find((l) => l.id === after.player.locationId);
  const outcome = after.log.at(-1)?.text ?? '';
  return llm.stream({
    system: `너는 1인칭 TRPG의 서술자다. 한국어 2인칭("당신은 …")으로, 방금 끝난 전투를 3~5문단으로 생생하게 요약한다.
- 전투 기록의 결과(명중·빗나감·피해·쓰러짐·승패)를 그대로 따른다. 결과를 바꾸거나 새 사건을 만들지 않는다.
- 수치(주사위, AC, 피해 숫자)는 서술에 쓰지 않는다.
- 패배(쓰러짐)했다면 정신을 잃었다가 한참 뒤 깨어나는 것으로 마무리한다. 누가 구해 줬는지는 지어내지 않는다.
- 마지막에 플레이어의 다음 행동을 대신 정하지 않는다.`,
    user: `## 장소\n${loc?.name}: ${loc?.description}\n\n## 참가자\n${Object.values(before.combatants).map((c) => `- ${c.name} (${c.side === 'party' ? '아군' : '적'})`).join('\n')}\n\n## 전투 기록\n${combatLog.join('\n')}\n\n## 결과\n${outcome}\n플레이어 HP: ${after.player.sheet.hp}/${after.player.sheet.maxHp}`,
    maxTokens: 3000,
  }, onText, signal);
}

