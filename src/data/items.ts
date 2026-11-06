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
  // 마법 장비 (설계 v4 E3 — SRD 5.2.1 마법 물품을 이 게임에 맞게 줄였다)
  { id: 'std/longsword-1', name: '+1 롱소드', description: '희미하게 빛나는 칼날. 명중·피해 +1.', kind: 'weapon', rarity: 'uncommon', price: 500, card: 'weapon/longsword', bonus: { attack: 1, damage: 1 } },
  { id: 'std/shortsword-1', name: '+1 숏소드', description: '가볍고 날카롭다. 명중·피해 +1.', kind: 'weapon', rarity: 'uncommon', price: 500, card: 'weapon/shortsword', bonus: { attack: 1, damage: 1 } },
  { id: 'std/dagger-1', name: '+1 대거', description: '손에 착 붙는 단검. 명중·피해 +1.', kind: 'weapon', rarity: 'uncommon', price: 400, card: 'weapon/dagger', bonus: { attack: 1, damage: 1 } },
  { id: 'std/mace-1', name: '+1 메이스', description: '머리에 룬이 새겨진 철퇴. 명중·피해 +1.', kind: 'weapon', rarity: 'uncommon', price: 500, card: 'weapon/mace', bonus: { attack: 1, damage: 1 } },
  { id: 'std/shortbow-1', name: '+1 숏보우', description: '시위가 노래하듯 우는 활. 명중·피해 +1.', kind: 'weapon', rarity: 'uncommon', price: 500, card: 'weapon/shortbow', bonus: { attack: 1, damage: 1 } },
  { id: 'std/cloak-protection', name: '보호의 망토', description: '두르면 몸이 가벼워진다. AC +1, 모든 내성 +1.', kind: 'trinket', rarity: 'uncommon', price: 600, bonus: { ac: 1, save: 1 } },
  { id: 'std/shield-1', name: '+1 방패', description: '문장이 새겨진 방패. AC +3.', kind: 'shield', rarity: 'uncommon', price: 500, acBonus: 3 },
  { id: 'std/longsword-2', name: '+2 롱소드', description: '이름 모를 대장장이의 걸작. 명중·피해 +2.', kind: 'weapon', rarity: 'rare', price: 2000, card: 'weapon/longsword', bonus: { attack: 2, damage: 2 } },
  { id: 'std/flame-tongue', name: '화염의 검', description: '휘두르면 칼날을 따라 불길이 인다. 명중 +1, "불꽃 베기" 카드.', kind: 'weapon', rarity: 'rare', price: 2500, card: 'weapon/longsword', bonus: { attack: 1 }, cards: ['weapon/flame_tongue'] },
  { id: 'std/ring-protection', name: '보호의 반지', description: '은빛 반지. AC +1, 모든 내성 +1.', kind: 'trinket', rarity: 'rare', price: 2000, bonus: { ac: 1, save: 1 } },
  { id: 'std/chain-1', name: '+1 체인 메일', description: '가볍게 느껴지는 사슬 갑옷. AC 17.', kind: 'armor', rarity: 'rare', price: 1500, armor: { base: 17, dexMax: 0 } },
  { id: 'std/dragon-scale', name: '용린 갑옷', description: '용의 비늘로 엮었다. AC 17 + 민첩(최대 2), 모든 내성 +1.', kind: 'armor', rarity: 'epic', price: 8000, armor: { base: 17, dexMax: 2 }, bonus: { save: 1 } },
  { id: 'std/storm-blade', name: '폭풍의 검', description: '천둥이 잠든 칼. 명중·피해 +2, "벼락 일섬" 카드.', kind: 'weapon', rarity: 'epic', price: 9000, card: 'weapon/longsword', bonus: { attack: 2, damage: 2 }, cards: ['weapon/storm_strike'] },
  // 비급·주문서 (익히면 카드를 영구히 얻는다)
  { id: 'std/manual-heavy-blow', name: '비급: 붕산격', description: '산을 무너뜨린다는 일격의 요결. 익히면 "붕산격" 카드.', kind: 'scroll', rarity: 'uncommon', price: 300, teaches: 'tech/heavy_blow' },
  { id: 'std/manual-twin-strike', name: '비급: 쌍비연격', description: '두 번 연달아 베는 쾌검의 요결. 익히면 "쌍비연격" 카드.', kind: 'scroll', rarity: 'uncommon', price: 300, teaches: 'tech/twin_strike' },
  { id: 'std/manual-sure-shot', name: '비급: 관혈탄', description: '빈틈을 꿰뚫는 사격의 요결. 익히면 "관혈탄" 카드.', kind: 'scroll', rarity: 'rare', price: 800, teaches: 'tech/sure_shot' },
  // 보물
  { id: 'std/gem', name: '보석', description: '팔면 값이 꽤 나가는 작은 보석.', kind: 'treasure', price: 50 },
];

export const STD_ITEM_MAP: Record<string, ItemDef> = Object.fromEntries(STD_ITEMS.map((i) => [i.id, i]));
