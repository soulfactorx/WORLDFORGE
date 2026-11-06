import { varLabel, varValue } from '../engine/scenario';
import type { StoryEffect, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { relationshipEvents, reputationEvent } from './relationship';
import { gainEvent, loseEvent, moneyEvent } from './economy';

/**
 * 이야기 효과 → 이벤트 (설계 v3 5장). 참조가 깨진 효과는 조용히 건너뛴다 (검사기가 미리 알린다).
 * 시계 효과는 값만 바꾸고, 그 칸의 효과는 다음 평가 때 일어난다.
 */
export function effectEvents(world: WorldPackage, state: GameState, effects: StoryEffect[], reason: string): GameEvent[] {
  const out: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent | null) => { if (!e) return; out.push(e); s = applyEvent(s, e, state.turn); };
  for (const fx of effects) {
    if ('setFlag' in fx) { if (!s.flags.includes(fx.setFlag)) push({ type: 'flag_set', flag: fx.setFlag }); continue; }
    if ('moveNpc' in fx) {
      if (world.characters.some((c) => c.id === fx.moveNpc) && world.locations.some((l) => l.id === fx.to) && !s.deadNpcs.includes(fx.moveNpc)) push({ type: 'npc_moved', npcId: fx.moveNpc, to: fx.to });
      continue;
    }
    if ('killNpc' in fx) {
      const c = world.characters.find((x) => x.id === fx.killNpc);
      if (c && !s.deadNpcs.includes(c.id)) push({ type: 'npc_killed', npcId: c.id, name: c.name });
      continue;
    }
    if ('reveal' in fx) {
      const claim = world.claims.find((c) => c.id === fx.reveal);
      const state2 = fx.state ?? 'rumor';
      const rank = { rumor: 1, partial: 2, confirmed: 3 } as const;
      const had = s.beliefs.find((b) => b.holder === 'player' && b.claim === fx.reveal);
      const hadRank = had ? (had.state === 'confirmed' || had.state === 'secret' ? 3 : had.state === 'partial' ? 2 : had.state === 'rumor' ? 1 : 0) : -1;
      if (claim && hadRank < rank[state2]) push({ type: 'knowledge_revealed', belief: { holder: 'player', claim: claim.id, state: state2, source: 'world' }, statement: claim.statement });
      continue;
    }
    if ('relationship' in fx) {
      const npc = world.characters.find((c) => c.id === fx.relationship);
      if (npc && !s.deadNpcs.includes(npc.id)) relationshipEvents(world, s, npc, fx.delta, reason).forEach(push);
      continue;
    }
    if ('reputation' in fx) { push(reputationEvent(world, s, fx.reputation, fx.delta, reason)); continue; }
    if ('giveItem' in fx) { push(gainEvent(world, { itemId: fx.giveItem, n: fx.n }, reason)); continue; }
    if ('takeItem' in fx) { push(loseEvent(world, s, { itemId: fx.takeItem, n: fx.n }, reason)); continue; }
    if ('money' in fx) { push(moneyEvent(world, s, fx.money, reason)); continue; }
    if ('var' in fx) {
      const def = world.vars?.find((v) => v.id === fx.var);
      if (!def) continue;
      const cur = varValue(world, s, def.id);
      const raw = fx.set !== undefined ? fx.set : cur + (fx.add ?? 0);
      const value = Math.max(def.min ?? 0, Math.min(def.max ?? 100, raw));
      if (value === cur) continue;
      const label = def.visible && def.labels?.length && varLabel(def, value) !== varLabel(def, cur) ? varLabel(def, value) : undefined;
      push({ type: 'var_changed', varId: def.id, value, name: def.name, ...(label ? { label } : {}) });
      continue;
    }
    if ('clock' in fx) {
      const clock = world.clocks?.find((c) => c.id === fx.clock);
      if (!clock) continue;
      const cur = s.clocks?.[clock.id] ?? { value: clock.start ?? 0, minutes: s.worldMinutes, onFired: [], reached: [] };
      const value = Math.max(0, Math.min(Math.max(1, clock.segments), cur.value + fx.by));
      if (value !== cur.value) push({ type: 'clock_changed', clockId: clock.id, value, minutes: cur.minutes });
    }
  }
  return out;
}
