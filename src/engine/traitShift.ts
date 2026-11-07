import type { CharacterSheet } from './character/sheet';
import type { WorldPackage } from './schema';
import type { GameEvent } from './state/events';
import { clampTrait, traitLabel, traitsFor, traitValue } from './traits';

/** 성향을 움직이는 이벤트 (없는 축·변화 없음이면 빈 배열) */
export function traitShift(world: Pick<WorldPackage, 'traits' | 'genre'>, sheet: Pick<CharacterSheet, 'traits'>, id: string, delta: number, reason?: string): GameEvent[] {
  const t = traitsFor(world).find((x) => x.id === id);
  if (!t || !Number.isFinite(delta) || !delta) return [];
  const cur = traitValue(world, sheet, id);
  const value = clampTrait(cur + delta);
  if (value === cur) return [];
  return [{ type: 'trait_changed', trait: id, value, delta: value - cur, name: t.name, label: traitLabel(t, value), ...(reason ? { reason } : {}) }];
}
