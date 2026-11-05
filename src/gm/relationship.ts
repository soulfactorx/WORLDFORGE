import { type Axis, clampDelta, initialRelationship, relationsOf, relationshipOf, type Relationship, reputationOf, stageOf } from '../engine/relationship';
import type { Character, EntityId, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';

/** 제안된 관계 변화 → 검증된 이벤트 하나 (변화가 없으면 null). 파급은 relationshipEvents. */
export function relationshipEvent(
  world: WorldPackage, state: GameState, npc: Pick<Character, 'id' | 'name'>,
  proposed: Partial<Record<Axis, number>> | undefined, reason: string,
): GameEvent | null {
  const delta = clampDelta(proposed);
  if (!delta) return null;
  return {
    type: 'relationship_changed', npcId: npc.id, name: npc.name, delta, reason: reason.slice(0, 80),
    ...(state.relationships[npc.id] ? {} : { base: initialRelationship(world, npc.id) }),
  };
}

/** 세력 평판 이벤트 (-10~10으로 자름) */
export function reputationEvent(world: WorldPackage, state: GameState, factionId: EntityId, delta: number, reason: string): GameEvent | null {
  const f = world.factions?.find((x) => x.id === factionId);
  const d = Math.max(-10, Math.min(10, Math.round(delta)));
  if (!f || !d) return null;
  return {
    type: 'reputation_changed', factionId, name: f.name, delta: d, reason: reason.slice(0, 80),
    ...((state.reputation ?? {})[factionId] === undefined ? { base: reputationOf(world, {}, factionId) } : {}),
  };
}

/**
 * 관계 변화와 그 파급 (설계 v3 4.2~4.4):
 * 1) 그 인물과의 관계 변화 (+ 단계가 바뀌면 relation_stage)
 * 2) 그 인물이 속한 세력 평판: 호감 변화의 절반, 원한이 쌓이면 깎인다
 * 3) NPC ↔ NPC 관계: 누군가와 가까워지면 그의 라이벌·원수는 원한이 쌓이고, 가족·동지·연인·스승은 호감이 오른다.
 *    누군가를 해치면 반대로. (파급은 한 단계만 — 다시 퍼지지 않는다)
 * 4) 질투: 연인이 될 수 있는 인물과 친밀이 깊어지면, 그 인물을 사랑하는 사람(lover 관계)은 원한이 쌓인다
 */
export function relationshipEvents(
  world: WorldPackage, state: GameState, npc: Pick<Character, 'id' | 'name'>,
  proposed: Partial<Record<Axis, number>> | undefined, reason: string,
): GameEvent[] {
  const main = relationshipEvent(world, state, npc, proposed, reason);
  if (!main || main.type !== 'relationship_changed') return [];
  const out: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent | null) => {
    if (!e) return;
    const before = e.type === 'relationship_changed' ? stageAt(world, s, e.npcId) : null;
    out.push(e);
    s = applyEvent(s, e, state.turn);
    if (e.type === 'relationship_changed') {
      const after = stageAt(world, s, e.npcId);
      if (before && after !== before) {
        const ev: GameEvent = { type: 'relation_stage', npcId: e.npcId, name: e.name ?? e.npcId, from: before, to: after };
        out.push(ev);
        s = applyEvent(s, ev, state.turn);
      }
    }
  };
  push(main);
  const d = main.delta;
  const aff = d.affinity ?? 0;
  const grudge = d.grudge ?? 0;

  const faction = world.characters.find((c) => c.id === npc.id)?.faction;
  if (faction) {
    const rep = Math.round(aff / 2) - (grudge > 0 ? Math.ceil(grudge / 2) : 0);
    push(reputationEvent(world, s, faction, rep, `${npc.name}: ${reason}`));
  }

  // 질투
  const intimacy = d.intimacy ?? 0;
  const romanceable = !!world.characters.find((c) => c.id === npc.id)?.romanceable;
  const jealous = new Set<EntityId>();
  if (romanceable && intimacy >= 2) {
    for (const r of relationsOf(world, npc.id).filter((x) => x.kind === 'lover')) {
      const other = world.characters.find((c) => c.id === r.other);
      if (!other || state.deadNpcs.includes(other.id)) continue;
      jealous.add(other.id);
      push(relationshipEvent(world, s, other, { grudge: Math.ceil(intimacy / 2), affinity: -Math.ceil(intimacy / 2) }, `${npc.name}와(과) 가까워지는 것을 보았다 (질투)`));
    }
  }
  // 파급: 호감이 크게(3 이상) 움직였을 때만
  if (Math.abs(aff) >= 3 || grudge >= 3) {
    const closer = aff > 0 && grudge <= 0;
    const amount = Math.max(1, Math.ceil(Math.max(Math.abs(aff), grudge) / 3));
    for (const r of relationsOf(world, npc.id)) {
      const other = world.characters.find((c) => c.id === r.other);
      if (!other || state.deadNpcs.includes(other.id) || jealous.has(other.id)) continue;
      const hostile = r.kind === 'rival' || r.kind === 'enemy';
      const delta: Partial<Relationship> = hostile
        ? (closer ? { grudge: amount } : { affinity: amount })
        : (closer ? { affinity: amount } : { grudge: amount });
      const why = `${npc.name}${closer ? '와(과) 가까워졌다' : '와(과) 틀어졌다'} (${r.label})`;
      push(relationshipEvent(world, s, other, delta, why));
    }
  }
  return out;
}

function stageAt(world: WorldPackage, s: GameState, npcId: EntityId): string {
  return stageOf(relationshipOf(world, s.relationships, npcId), !!world.characters.find((c) => c.id === npcId)?.romanceable);
}
