/**
 * 아이템·소지품·상점 (설계 v3 6.4). 순수 함수.
 */
import { STD_ITEM_MAP, STD_ITEMS } from '../data/items';
import type { CardDef } from './combat/cards';
import { reputationOf } from './relationship';
import type { EntityId, ItemDef, Shop, WorldPackage } from './schema';
import type { GameState } from './state/state';

export function itemDef(world: Pick<WorldPackage, 'items'>, id: EntityId): ItemDef | undefined {
  return world.items?.find((i) => i.id === id) ?? STD_ITEM_MAP[id];
}

/** 이 세계에서 쓸 수 있는 모든 아이템 (세계 아이템 먼저) */
export function allItems(world: Pick<WorldPackage, 'items'>): ItemDef[] {
  const own = world.items ?? [];
  return [...own, ...STD_ITEMS.filter((s) => !own.some((o) => o.id === s.id))];
}

export const itemCount = (state: GameState, id: EntityId) => state.inventory?.[id] ?? 0;
export const moneyOf = (state: GameState) => state.money ?? 0;

export function currencyOf(world: WorldPackage, profileCurrency: string): string {
  return world.genre?.currency ?? profileCurrency;
}

/** 상점 가격 배율: 세력 평판이 좋으면 싸고, 나쁘면 비싸다. null = 거래 거절 */
export function priceFactor(world: WorldPackage, state: GameState, shop: Shop): number | null {
  if (!shop.factionId) return 1;
  const rep = reputationOf(world, state.reputation ?? {}, shop.factionId);
  if (rep <= -60) return null;
  return rep >= 60 ? 0.8 : rep >= 30 ? 0.9 : rep <= -30 ? 1.25 : 1;
}

export const buyPrice = (item: ItemDef, factor: number) => Math.max(1, Math.round((item.price ?? 1) * factor));
export const sellPrice = (item: ItemDef) => Math.floor((item.price ?? 0) / 2);

/** 장비로 정해지는 AC. 갑옷이 없으면 직업 기본 장비 공식을 쓴다 (방패는 한 번만 센다) */
export function equippedAc(world: WorldPackage, state: GameState, dexMod: number, kitAc: (d: number) => number, kitShield: boolean): number {
  const eq = state.equipped ?? {};
  const armor = eq.armor ? itemDef(world, eq.armor)?.armor : undefined;
  const base = armor ? armor.base + Math.min(dexMod, armor.dexMax ?? 99) : kitAc(dexMod);
  const shield = eq.shield ? itemDef(world, eq.shield)?.acBonus ?? 2 : 0;
  return base + (kitShield ? Math.max(2, shield) : shield);
}

/** 전투에서 쓸 수 있는 소모품 카드 (보너스 행동, 같은 존의 아군 — 쓰러진 동료에게 먹일 수도 있다) */
export function itemCards(world: WorldPackage, state: GameState): { card: CardDef; n: number }[] {
  return Object.entries(state.inventory ?? {}).flatMap(([id, n]) => {
    const it = itemDef(world, id);
    if (!it || it.kind !== 'consumable' || !it.heal || n <= 0) return [];
    const card: CardDef = {
      id: `item/${id}`, name: it.name, desc: `보너스 행동. 같은 존의 아군(자신 포함)에게 쓴다: HP ${it.heal} 회복${it.cures?.length ? ', 상태 이상 해소' : ''}`,
      kind: 'item', cost: 'bonus', target: 'ally', resource: `item:${id}`, effect: { type: 'heal', dice: it.heal, add: 'none', cures: it.cures },
    };
    return [{ card, n }];
  });
}
