/**
 * 세계 규칙 엔진 (v0.83)
 * - 행동 규칙: 플레이어 입력에 낱말이 있거나 GM 판단 AI가 "이 규칙에 해당한다"고 고르면 발동
 * - 상태 규칙: 조건이 거짓 → 참이 되는 순간 발동 (다시 거짓이 되면 재무장). 효과로 다른 규칙이 연쇄된다 (한 번에 최대 4단계)
 * - 결과: 효과(엔진 확정) + 인물 반응(관계 변화는 엔진, 글은 NPC 연기·서술에) + 결과 지시(서술에)
 * 판정·결과는 엔진이 확정하고, AI는 그 결과를 연기·서술만 한다.
 */
import { evalCondition } from '../engine/scenario';
import type { WorldPackage, WorldRule } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { presentCharacters } from './context';
import { displayName } from '../engine/names';
import { effectEvents } from './story';

export interface RuleNote { ruleId: string; name: string; outcome?: string; reactions: { npcId: string; name: string; text: string }[] }

/** 지금 발동할 수 있는가 (켜짐 · 반복 규칙 · 추가 조건) */
export function ruleReady(world: WorldPackage, s: GameState, r: WorldRule): boolean {
  if (r.enabled === false) return false;
  const st = s.rules?.[r.id];
  const rep = r.repeat ?? 'once';
  if (st && rep === 'once') return false;
  if (st && typeof rep === 'number' && s.turn - st.lastTurn < rep) return false;
  return !r.requires || evalCondition(world, s, r.requires);
}

/** 행동 규칙: 이 입력에 해당하는 것 (낱말 + AI가 고른 ID) */
export function actionRulesHit(world: WorldPackage, s: GameState, input: string, aiPicked: string[] = []): WorldRule[] {
  const text = input.toLowerCase();
  return (world.rules ?? []).filter((r) => r.trigger.kind === 'action' && ruleReady(world, s, r)
    && (aiPicked.includes(r.id) || (r.trigger.keywords ?? []).some((k) => k.trim() && text.includes(k.trim().toLowerCase()))));
}

/** 규칙 하나를 발동: 이벤트들 + 서술·NPC용 메모 */
export function fireRule(world: WorldPackage, state: GameState, r: WorldRule, by: 'action' | 'state'): { events: GameEvent[]; note: RuleNote } {
  const events: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, s.turn); };
  push({ type: 'rule_fired', ruleId: r.id, name: r.name, by, ...(r.announce?.trim() ? { announce: r.announce.trim() } : {}) });
  effectEvents(world, s, r.effects ?? [], `규칙: ${r.name}`).forEach(push);
  const here = presentCharacters(world, s);
  const reactions: RuleNote['reactions'] = [];
  for (const re of r.reactions ?? []) {
    const who = re.npcId === 'present' ? here : here.filter((c) => c.id === re.npcId);
    for (const c of who) {
      reactions.push({ npcId: c.id, name: displayName(s, c), text: re.text });
      if (re.relationship && Object.keys(re.relationship).length) effectEvents(world, s, [{ relationship: c.id, delta: re.relationship }], `규칙: ${r.name}`).forEach(push);
    }
  }
  return { events, note: { ruleId: r.id, name: r.name, ...(r.outcome?.trim() ? { outcome: r.outcome.trim() } : {}), reactions } };
}

/** 상태 규칙: 조건이 막 참이 된 것을 발동하고, 거짓이 된 것은 재무장. 연쇄는 최대 4단계 */
export function stateRuleEvents(world: WorldPackage, state: GameState): { events: GameEvent[]; notes: RuleNote[] } {
  const events: GameEvent[] = [];
  const notes: RuleNote[] = [];
  let s = state;
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, s.turn); };
  const rules = (world.rules ?? []).filter((r) => r.trigger.kind === 'state' && r.enabled !== false);
  for (let pass = 0; pass < 4; pass++) {
    let fired = false;
    for (const r of rules) {
      const cond = (r.trigger as { condition: import('../engine/schema').Condition }).condition;
      const now = evalCondition(world, s, cond);
      const active = !!s.rules?.[r.id]?.active;
      if (!now && active) { push({ type: 'rule_state', ruleId: r.id, active: false }); continue; }
      if (now && !active && ruleReady(world, s, r)) {
        const f = fireRule(world, s, r, 'state');
        f.events.forEach(push);
        notes.push(f.note);
        fired = true;
      } else if (now && !active && s.rules?.[r.id]?.count && (r.repeat ?? 'once') !== 'always') {
        // 참이 되었지만 반복 규칙 때문에 발동하지 않음 → 참인 동안은 다시 보지 않게 표시만 (추가 조건이 거짓이면 기다린다)
        push({ type: 'rule_state', ruleId: r.id, active: true });
      }
    }
    if (!fired) break;
  }
  return { events, notes };
}

/** 서술·NPC에게 주는 글 */
export function ruleNotesText(notes: RuleNote[]): string {
  return notes.map((n) => [`- ${n.name}${n.outcome ? `: ${n.outcome}` : ''}`, ...n.reactions.map((r) => `  · ${r.name}의 반응: ${r.text}`)].join('\n')).join('\n');
}

/** GM 판단 AI에게 보여 주는 행동 규칙 목록 */
export function actionRuleList(world: WorldPackage, s: GameState): string {
  const list = (world.rules ?? []).filter((r) => r.trigger.kind === 'action' && ruleReady(world, s, r));
  return list.map((r) => `- ${r.id}: ${(r.trigger as { describe: string }).describe}`).join('\n');
}
