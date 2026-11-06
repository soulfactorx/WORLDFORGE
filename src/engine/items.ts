/**
 * 아이템·소지품·상점 (설계 v3 6.4). 순수 함수.
 */
import { STD_ITEM_MAP, STD_ITEMS } from '../data/items';
import type { CardDef } from './combat/cards';
import { reputationOf } from './relationship';
import type { EntityId, ItemBonus, ItemDef, ItemRarity, Shop, WorldPackage } from './schema';
import { evalCondition } from './scenario';
import type { Rng } from './dice/rng';
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

/** 유물: 지금 몇 단계까지 깨어났나 (앞에서부터 조건이 맞는 만큼) */
export function awakenStage(world: WorldPackage, state: GameState, def: ItemDef): number {
  let n = 0;
  for (const a of def.awaken ?? []) { if (!evalCondition(world, state, a.condition)) break; n++; }
  return n;
}

/** 깨어난 단계까지 반영한 아이템 (이름·설명·보너스·카드가 쌓인다) */
export function effectiveItem(world: WorldPackage, state: GameState, def: ItemDef): ItemDef & { stage: number } {
  const stage = awakenStage(world, state, def);
  const steps = (def.awaken ?? []).slice(0, stage);
  const bonus: ItemBonus = { ...(def.bonus ?? {}) };
  for (const st of steps) for (const [k, v] of Object.entries(st.bonus ?? {})) bonus[k as keyof ItemBonus] = (bonus[k as keyof ItemBonus] ?? 0) + (v ?? 0);
  const last = steps.at(-1);
  return {
    ...def, stage,
    ...(last ? { name: last.name, description: last.text ?? def.description } : {}),
    ...(Object.keys(bonus).length ? { bonus } : {}),
    cards: [...new Set([...(def.cards ?? []), ...steps.flatMap((x) => x.cards ?? [])])],
  };
}

export const rarityOf = (def: ItemDef | undefined): ItemRarity => def?.rarity ?? (def?.awaken?.length ? 'legendary' : 'common');

/** 장비 보너스 합: 무기의 명중·피해는 무기 공격에만, AC·내성은 모든 장비에서 */
export function gearBonus(world: WorldPackage, state: GameState): Required<ItemBonus> & { cards: string[] } {
  const out = { attack: 0, damage: 0, ac: 0, save: 0, cards: [] as string[] };
  for (const [slot, id] of Object.entries(state.equipped ?? {})) {
    const raw = id ? itemDef(world, id) : undefined;
    if (!raw) continue;
    const it = effectiveItem(world, state, raw);
    if (slot === 'weapon') { out.attack += it.bonus?.attack ?? 0; out.damage += it.bonus?.damage ?? 0; }
    out.ac += it.bonus?.ac ?? 0;
    out.save += it.bonus?.save ?? 0;
    out.cards.push(...(it.cards ?? []));
  }
  return out;
}

/** 장비로 정해지는 AC. 갑옷이 없으면 직업 기본 장비 공식을 쓴다 (방패는 한 번만 센다) + 장비 보너스 */
export function equippedAc(world: WorldPackage, state: GameState, dexMod: number, kitAc: (d: number) => number, kitShield: boolean): number {
  const eq = state.equipped ?? {};
  const armor = eq.armor ? itemDef(world, eq.armor)?.armor : undefined;
  const base = armor ? armor.base + Math.min(dexMod, armor.dexMax ?? 99) : kitAc(dexMod);
  const shield = eq.shield ? itemDef(world, eq.shield)?.acBonus ?? 2 : 0;
  return base + (kitShield ? Math.max(2, shield) : shield) + gearBonus(world, state).ac;
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

/**
 * 전리품 굴림 (설계 v4 E3). 이긴 조우의 위협(적 경험치 합)이 클수록, 보스일수록 잘 나온다.
 * 레벨이 오르면 더 높은 등급이 섞인다. 유물(각성하는 물건)은 이야기 보상으로만 — 굴림에 나오지 않는다.
 * 일반 등급은 소모품만 (평범한 무기·갑옷은 상점에서).
 */
export function rollLoot(world: Pick<WorldPackage, 'items'>, rng: Rng, o: { level: number; threatXp: number; levelSpan: number; boss: boolean }): ItemDef | null {
  const chance = o.boss ? 1 : Math.min(0.6, 0.15 + o.threatXp / Math.max(1, o.levelSpan * 2));
  if (rng.next() >= chance) return null;
  const weights: [ItemRarity, number][] = [
    ['common', o.boss ? 0 : 45], ['uncommon', 35], ['rare', o.level >= 3 ? (o.boss ? 30 : 15) : 0], ['epic', o.level >= 5 ? (o.boss ? 12 : 4) : 0],
  ];
  const pool = (r: ItemRarity) => allItems(world).filter((i) => !i.awaken?.length && (i.price ?? 0) > 0 && rarityOf(i) === r
    && (r === 'common' ? i.kind === 'consumable' : ['weapon', 'armor', 'shield', 'trinket', 'scroll', 'consumable'].includes(i.kind)));
  const live = weights.filter(([r, w]) => w > 0 && pool(r).length);
  const total = live.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let x = rng.next() * total;
  const rarity = live.find(([, w]) => (x -= w) < 0)?.[0] ?? live.at(-1)![0];
  const items = pool(rarity);
  return items[Math.floor(rng.next() * items.length)] ?? null;
}
