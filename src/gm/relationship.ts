import { clampDelta, initialRelationship } from '../engine/relationship';
import type { Character, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';

/** 제안된 관계 변화 → 검증된 이벤트 (변화가 없으면 null) */
export function relationshipEvent(
  world: WorldPackage, state: GameState, npc: Pick<Character, 'id' | 'name'>,
  proposed: Partial<Record<'affinity' | 'trust' | 'respect' | 'fear', number>> | undefined, reason: string,
): GameEvent | null {
  const delta = clampDelta(proposed);
  if (!delta) return null;
  return {
    type: 'relationship_changed', npcId: npc.id, name: npc.name, delta, reason: reason.slice(0, 80),
    ...(state.relationships[npc.id] ? {} : { base: initialRelationship(world, npc.id) }),
  };
}
