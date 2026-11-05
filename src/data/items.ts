/**
 * 표준 아이템 (설계 v3 6.4) — SRD 5.2.1 (CC-BY-4.0) 장비표를 이 게임에 맞게 줄였다.
 * 가격은 골드 기준 (장르마다 화폐 이름만 바뀐다). ID는 "std/…" — 세계 아이템("item/…")과 겹치지 않는다.
 */
import type { ItemDef } from '../engine/schema';

export const STD_ITEMS: ItemDef[] = [
  // 소모품
  { id: 'std/potion-healing', name: '치유 물약', description: '붉은 액체가 담긴 작은 병. 마시면 상처가 아문다 (HP 2d4+2).', kind: 'consumable', price: 50, heal: '2d4+2' },
  { id: 'std/potion-greater', name: '상급 치유 물약', description: '진한 홍색 물약. 깊은 상처도 아문다 (HP 4d4+4).', kind: 'consumable', price: 150, heal: '4d4+4' },
  { id: 'std/antitoxin', name: '해독제', description: '쓴 약초즙. 몸에 퍼진 독을 가라앉힌다 (HP 1d4, 중독 해소).', kind: 'consumable', price: 50, heal: '1d4', cures: ['poisoned'] },
  { id: 'std/rations', name: '휴대 식량', description: '말린 고기와 딱딱한 빵 하루치.', kind: 'misc', price: 1 },
  { id: 'std/torch', name: '횃불', description: '한 시간쯤 타는 횃불.', kind: 'misc', price: 1 },
  { id: 'std/rope', name: '밧줄 (15m)', description: '튼튼한 삼베 밧줄.', kind: 'misc', price: 1 },
  { id: 'std/thieves-tools', name: '도둑 도구', description: '자물쇠를 따는 작은 도구 꾸러미.', kind: 'misc', price: 25 },
  // 무기 (전투 카드를 준다)
  { id: 'std/longsword', name: '롱소드', description: '근접 1d8 참격.', kind: 'weapon', price: 15, card: 'weapon/longsword' },
  { id: 'std/shortsword', name: '숏소드', description: '근접 기교 1d6 관통.', kind: 'weapon', price: 10, card: 'weapon/shortsword' },
  { id: 'std/dagger', name: '대거', description: '근접 기교 1d4 관통.', kind: 'weapon', price: 2, card: 'weapon/dagger' },
  { id: 'std/mace', name: '메이스', description: '근접 1d6 타격.', kind: 'weapon', price: 5, card: 'weapon/mace' },
  { id: 'std/shortbow', name: '숏보우', description: '원거리 1d6 관통 (3존).', kind: 'weapon', price: 25, card: 'weapon/shortbow' },
  { id: 'std/javelin', name: '재블린', description: '던지는 창 1d6 관통 (2존).', kind: 'weapon', price: 1, card: 'weapon/javelin' },
  // 갑옷 (AC = 기본 + 민첩, 상한 있음)
  { id: 'std/leather', name: '가죽 갑옷', description: '가벼운 가죽 갑옷. AC 11 + 민첩.', kind: 'armor', price: 10, armor: { base: 11 } },
  { id: 'std/chain-shirt', name: '사슬 셔츠', description: '옷 아래 받쳐 입는 사슬. AC 13 + 민첩(최대 2).', kind: 'armor', price: 50, armor: { base: 13, dexMax: 2 } },
  { id: 'std/scale-mail', name: '비늘 갑옷', description: '금속 비늘을 엮은 갑옷. AC 14 + 민첩(최대 2).', kind: 'armor', price: 50, armor: { base: 14, dexMax: 2 } },
  { id: 'std/chain-mail', name: '체인 메일', description: '무거운 사슬 갑옷. AC 16.', kind: 'armor', price: 75, armor: { base: 16, dexMax: 0 } },
  { id: 'std/shield', name: '방패', description: 'AC +2.', kind: 'shield', price: 10, acBonus: 2 },
  // 보물
  { id: 'std/gem', name: '보석', description: '팔면 값이 꽤 나가는 작은 보석.', kind: 'treasure', price: 50 },
];

export const STD_ITEM_MAP: Record<string, ItemDef> = Object.fromEntries(STD_ITEMS.map((i) => [i.id, i]));
