/**
 * 경제 (설계 v3 6.4): 상점 거래·소모품 사용·장비·줍기·받기 → 검증된 이벤트.
 * AI는 아이템을 지급하지 못한다. 줍기·받기는 세계에 선언된 것만, 한 번씩 엔진이 확정한다.
 */
import { genreOf } from '../data/genres';
import { createRng } from '../engine/dice/rng';
import { rollDamage } from '../engine/combat/combat';
import { buyPrice, currencyOf, itemCount, itemDef, moneyOf, priceFactor, sellPrice } from '../engine/items';
import { evalCondition } from '../engine/scenario';
import type { EntityId, ItemStack, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';
import { npcLocation } from './context';
import { boardHere, jobStatus } from '../engine/jobs';

export const currencyName = (world: WorldPackage) => currencyOf(world, genreOf(world.genre?.id).currency);

export function gainEvent(world: WorldPackage, stack: ItemStack, reason: string, key?: string): GameEvent | null {
  const def = itemDef(world, stack.itemId);
  const n = Math.max(1, Math.round(stack.n ?? 1));
  return def ? { type: 'item_gained', itemId: def.id, name: def.name, n, reason, ...(key ? { key } : {}) } : null;
}

export function loseEvent(world: WorldPackage, state: GameState, stack: ItemStack, reason: string): GameEvent | null {
  const def = itemDef(world, stack.itemId);
  const n = Math.min(itemCount(state, stack.itemId), Math.max(1, Math.round(stack.n ?? 1)));
  return def && n > 0 ? { type: 'item_lost', itemId: def.id, name: def.name, n, reason } : null;
}

export function moneyEvent(world: WorldPackage, state: GameState, delta: number, reason: string): GameEvent | null {
  const d = Math.round(delta) < 0 ? Math.max(-moneyOf(state), Math.round(delta)) : Math.round(delta);
  return d ? { type: 'money_changed', delta: d, reason, currency: currencyName(world) } : null;
}

/** 지금 장소의 상점 */
export function shopHere(world: WorldPackage, state: GameState) {
  return world.locations.find((l) => l.id === state.player.locationId)?.shop;
}

export function buyItem(world: WorldPackage, state: GameState, itemId: EntityId): GameEvent[] {
  const shop = shopHere(world, state);
  const def = itemDef(world, itemId);
  if (!shop || !def || !shop.items.includes(itemId)) throw new Error('이 상점에서 파는 물건이 아니다');
  const f = priceFactor(world, state, shop);
  if (f === null) throw new Error('상인이 거래를 거절한다 (평판이 너무 나쁘다)');
  const price = buyPrice(def, f);
  if (moneyOf(state) < price) throw new Error(`돈이 모자란다 (${price} ${currencyName(world)} 필요)`);
  return [{ type: 'money_changed', delta: -price, reason: `${shop.name}에서 ${def.name} 구입`, currency: currencyName(world) }, gainEvent(world, { itemId }, '구입')!];
}

export function sellItem(world: WorldPackage, state: GameState, itemId: EntityId): GameEvent[] {
  const shop = shopHere(world, state);
  const def = itemDef(world, itemId);
  if (!shop || shop.buys === false) throw new Error('여기서는 물건을 사 주지 않는다');
  if (!def || itemCount(state, itemId) <= 0) throw new Error('가진 물건이 아니다');
  if (def.kind === 'key') throw new Error('팔 수 없는 물건이다');
  if (priceFactor(world, state, shop) === null) throw new Error('상인이 거래를 거절한다 (평판이 너무 나쁘다)');
  const price = sellPrice(def);
  return [loseEvent(world, state, { itemId }, `${shop.name}에 팔았다`)!, ...(price ? [{ type: 'money_changed', delta: price, reason: `${def.name} 판매`, currency: currencyName(world) } as GameEvent] : [])];
}

/** 전투 밖에서 소모품 사용 (플레이어) */
export function useItem(world: WorldPackage, state: GameState, itemId: EntityId): GameEvent[] {
  const def = itemDef(world, itemId);
  if (state.combat) throw new Error('전투 중에는 카드로 쓴다');
  if (!def || def.kind !== 'consumable' || itemCount(state, itemId) <= 0) throw new Error('쓸 수 있는 물건이 아니다');
  const rng = createRng(state.rngState);
  const sheet = state.player.sheet;
  const heal = def.heal ? Math.min(sheet.maxHp - sheet.hp, rollDamage(rng, def.heal).total) : 0;
  return [
    { type: 'item_used', itemId: def.id, name: def.name, heal, ...(def.cures?.length ? { cures: def.cures } : {}), rngState: rng.state() },
    { type: 'item_lost', itemId: def.id, name: def.name, n: 1, reason: '' },
  ];
}

export function equipItem(world: WorldPackage, state: GameState, itemId: EntityId | null, slot?: 'weapon' | 'armor' | 'shield'): GameEvent[] {
  if (state.combat) throw new Error('전투 중에는 장비를 바꿀 수 없다');
  if (itemId === null) return slot ? [{ type: 'item_equipped', slot }] : [];
  const def = itemDef(world, itemId);
  if (!def || itemCount(state, itemId) <= 0) throw new Error('가진 물건이 아니다');
  const s = def.kind === 'weapon' ? 'weapon' : def.kind === 'armor' ? 'armor' : def.kind === 'shield' ? 'shield' : null;
  if (!s) throw new Error('장비할 수 없는 물건이다');
  return [{ type: 'item_equipped', slot: s, itemId: def.id, name: def.name }];
}

/** 이 장소에서 아직 줍지 않은 것 (Director 힌트용) */
export function pendingPickups(world: WorldPackage, state: GameState) {
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  return (loc?.pickups ?? []).map((p, i) => ({ ...p, key: `${loc!.id}#${i}` })).filter((p) => !(state.taken ?? []).includes(p.key) && itemDef(world, p.itemId));
}

/** 이 인물이 지금 줄 수 있는 것 */
export function pendingGifts(world: WorldPackage, state: GameState, npcId: EntityId) {
  const c = world.characters.find((x) => x.id === npcId);
  if (!c || npcLocation(state, c) !== state.player.locationId) return [];
  return (c.gives ?? []).map((g, i) => ({ ...g, key: `${c.id}#${i}` }))
    .filter((g) => !(state.taken ?? []).includes(g.key) && itemDef(world, g.itemId) && (!g.condition || evalCondition(world, state, g.condition)));
}

/** 플레이어 소지품 요약 (AI 맥락용) */
export function inventoryLine(world: WorldPackage, state: GameState): string {
  const items = Object.entries(state.inventory ?? {}).filter(([, n]) => n > 0).map(([id, n]) => `${itemDef(world, id)?.name ?? id}${n > 1 ? ` ×${n}` : ''}`);
  return `${currencyName(world)} ${moneyOf(state)}${items.length ? ` · ${items.join(', ')}` : ''}`;
}

/** 의뢰 받기 (의뢰판이 있는 장소에서) */
export function acceptJob(world: WorldPackage, state: GameState, jobId: EntityId): GameEvent[] {
  const board = boardHere(world, state);
  const job = board?.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('이 의뢰판의 의뢰가 아니다');
  const st = jobStatus(world, state, job);
  if (st !== 'available') throw new Error(st === 'active' ? '이미 맡은 의뢰다' : st === 'done' ? '이미 끝난 의뢰다' : '아직 이 의뢰를 맡을 수 없다');
  const j = state.jobs?.[job.id];
  return [{ type: 'job_accepted', jobId: job.id, name: job.name, instance: (j?.done ?? 0) + (j?.failed ?? 0) + 1 }];
}
