/**
 * 스킬카드 = D&D 행동을 데이터로 정의한 것 (설계 리뷰 2.4·4.2절).
 * 랜덤 드로우 없음: 기본 행동은 항상 사용 가능하고, 직업·무기 카드는 캐릭터가 가진 만큼 손패에 있다.
 * 사용 가능 여부(행동 경제·자원·사거리)는 엔진이 판단한다.
 *
 * 규칙 수치는 SRD 5.2.1 (CC-BY-4.0) 기반.
 */
import type { Ability } from '../character/rules';

/** free = 행동 경제를 쓰지 않음 (예: 행동 연쇄) */
export type Cost = 'action' | 'bonus' | 'move' | 'free';

/** 존 사이 거리 = 존 인덱스 차이. 1존 ≈ 30피트. */
export interface AttackSpec {
  kind: 'melee' | 'ranged';
  /** finesse = 근력·민첩 중 높은 쪽, spell = 주문 시전 능력치 */
  ability: 'str' | 'dex' | 'finesse' | 'spell';
  damage: string;
  damageType: string;
  /** 원거리 사거리 (존 단위). 근접은 같은 존만. */
  range: number;
  /** 몬스터용 고정 명중 보너스 */
  toHit?: number;
  /** 몬스터용 고정 피해 보너스. 없으면 능력 수정치 (주문 공격은 0) */
  damageBonus?: number;
}

export type Effect =
  /** count: 여러 번 공격 (예: 불타는 광선). mark: 명중 시 대상에게 '표식' (다음 공격 이점) */
  | { type: 'attack'; attack: AttackSpec; count?: number; mark?: boolean }
  /** half: 내성 성공 시 절반 피해. bonus: 주문 능력 수정치를 피해에 더함 */
  | { type: 'save_damage'; save: Ability; damage: string; damageType: string; range: number; half?: boolean; bonus?: 'spell' }
  /** 범위 내성 피해: 대상 존의 모든 적 (range = 존 거리, 0이면 자기 존) */
  | { type: 'area_save'; save: Ability; damage: string; damageType: string; range: number; half: boolean }
  | { type: 'auto_damage'; count: number; damage: string; damageType: string; range: number }
  /** range: 아군 대상 존 거리 (기본 0 = 같은 존) */
  | { type: 'heal'; dice: string; add: 'spell' | 'level'; range?: number }
  | { type: 'move' }
  | { type: 'dodge' }
  | { type: 'hide' }
  | { type: 'aim' }
  | { type: 'extra_action' }
  | { type: 'flee' };

/** 슬롯을 올려 시전할 때 1레벨당 추가 효과 */
export interface Upcast {
  dice?: string;
  count?: number;
}

export interface CardDef {
  id: string;
  name: string;
  desc: string;
  kind: 'basic' | 'weapon' | 'class' | 'spell' | 'monster';
  cost: Cost;
  /** ally = 사거리 안 아군(자신 포함) 중 다친 대상, area = 적이 있는 존 */
  target: 'enemy' | 'self' | 'ally' | 'zone' | 'area';
  effect: Effect;
  /** 소모 자원 키 (예: second_wind, channel_divinity). 주문 슬롯은 spellLevel로 표현한다 */
  resource?: string;
  /** 레벨 주문: 이 레벨 이상의 주문 슬롯 중 가장 낮은 것을 쓴다 */
  spellLevel?: number;
  upcast?: Upcast;
}

const card = (c: CardDef) => c;

export const BASIC_CARDS: CardDef[] = [
  card({ id: 'basic/move', name: '이동', desc: '인접한 존으로 이동한다 (이동력 30피트).', kind: 'basic', cost: 'move', target: 'zone', effect: { type: 'move' } }),
  card({ id: 'basic/dash', name: '질주', desc: '행동을 써서 인접한 존으로 한 번 더 이동한다.', kind: 'basic', cost: 'action', target: 'zone', effect: { type: 'move' } }),
  card({ id: 'basic/dodge', name: '회피', desc: '다음 내 차례까지 나를 노리는 공격은 불리점을 받는다.', kind: 'basic', cost: 'action', target: 'self', effect: { type: 'dodge' } }),
  card({ id: 'basic/hide', name: '숨기', desc: '은신 판정(DC 15). 성공하면 다음 공격에 이점. 같은 존에 적이 있으면 불가.', kind: 'basic', cost: 'action', target: 'self', effect: { type: 'hide' } }),
  card({ id: 'basic/flee', name: '도주', desc: '아군 후열에서 전장을 벗어난다. 같은 존에 적이 있으면 불가.', kind: 'basic', cost: 'action', target: 'self', effect: { type: 'flee' } }),
];

export const WEAPON_CARDS: CardDef[] = [
  card({ id: 'weapon/longsword', name: '롱소드', desc: '근접 무기 공격 1d8 참격.', kind: 'weapon', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'melee', ability: 'str', damage: '1d8', damageType: '참격', range: 0 } } }),
  card({ id: 'weapon/javelin', name: '재블린 투척', desc: '원거리 무기 공격 1d6 관통 (2존).', kind: 'weapon', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'ranged', ability: 'str', damage: '1d6', damageType: '관통', range: 2 } } }),
  card({ id: 'weapon/shortsword', name: '숏소드', desc: '근접 기교 무기 공격 1d6 관통.', kind: 'weapon', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'melee', ability: 'finesse', damage: '1d6', damageType: '관통', range: 0 } } }),
  card({ id: 'weapon/shortbow', name: '숏보우', desc: '원거리 무기 공격 1d6 관통 (3존).', kind: 'weapon', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'ranged', ability: 'dex', damage: '1d6', damageType: '관통', range: 3 } } }),
  card({ id: 'weapon/mace', name: '메이스', desc: '근접 무기 공격 1d6 타격.', kind: 'weapon', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'melee', ability: 'str', damage: '1d6', damageType: '타격', range: 0 } } }),
  card({ id: 'weapon/dagger', name: '대거', desc: '근접 기교 무기 공격 1d4 관통.', kind: 'weapon', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'melee', ability: 'finesse', damage: '1d4', damageType: '관통', range: 0 } } }),
];

export const CLASS_CARDS: CardDef[] = [
  card({ id: 'fighter/second_wind', name: '재기의 바람', desc: '보너스 행동. HP를 1d10 + 파이터 레벨만큼 회복.', kind: 'class', cost: 'bonus', target: 'self', resource: 'second_wind', effect: { type: 'heal', dice: '1d10', add: 'level' } }),
  card({ id: 'spell/sacred_flame', name: '성스러운 불꽃', desc: '소마법. 대상은 민첩 내성, 실패 시 1d8 광휘 (2존).', kind: 'spell', cost: 'action', target: 'enemy', effect: { type: 'save_damage', save: 'dex', damage: '1d8', damageType: '광휘', range: 2 } }),
  card({ id: 'spell/cure_wounds', name: '상처 치료', desc: '1레벨 주문. 같은 존의 아군(자신 포함) HP를 2d8 + 주문 능력 수정치만큼 회복.', kind: 'spell', cost: 'action', target: 'ally', spellLevel: 1, upcast: { dice: '2d8' }, effect: { type: 'heal', dice: '2d8', add: 'spell' } }),
  card({ id: 'spell/fire_bolt', name: '화염 화살', desc: '소마법. 원거리 주문 공격 1d10 화염 (3존).', kind: 'spell', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'ranged', ability: 'spell', damage: '1d10', damageType: '화염', range: 3 } } }),
  card({ id: 'spell/magic_missile', name: '마법 화살', desc: '1레벨 주문. 반드시 명중하는 화살 3발, 각 1d4+1 역장 (3존).', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 1, upcast: { count: 1 }, effect: { type: 'auto_damage', count: 3, damage: '1d4+1', damageType: '역장', range: 3 } }),
  // ---- 2~3레벨 직업 능력 (SRD 5.2.1)
  card({ id: 'fighter/action_surge', name: '행동 연쇄', desc: '행동 없이 사용. 이번 차례에 행동을 한 번 더 얻는다. (짧은 휴식마다 1회)', kind: 'class', cost: 'free', target: 'self', resource: 'action_surge', effect: { type: 'extra_action' } }),
  card({ id: 'rogue/cunning_dash', name: '교활한 행동: 질주', desc: '보너스 행동으로 인접한 존으로 이동한다.', kind: 'class', cost: 'bonus', target: 'zone', effect: { type: 'move' } }),
  card({ id: 'rogue/cunning_hide', name: '교활한 행동: 숨기', desc: '보너스 행동으로 숨기(은신 DC 15).', kind: 'class', cost: 'bonus', target: 'self', effect: { type: 'hide' } }),
  card({ id: 'rogue/steady_aim', name: '정밀 조준', desc: '보너스 행동. 이번 차례에 이동하지 않았다면 다음 공격에 이점 (이동을 소모).', kind: 'class', cost: 'bonus', target: 'self', effect: { type: 'aim' } }),
  card({ id: 'cleric/divine_spark_heal', name: '신성 불꽃: 치유', desc: '신성 변환. 1존 안의 아군 HP를 1d8 + 지혜 수정치만큼 회복.', kind: 'class', cost: 'action', target: 'ally', resource: 'channel_divinity', effect: { type: 'heal', dice: '1d8', add: 'spell', range: 1 } }),
  card({ id: 'cleric/divine_spark_harm', name: '신성 불꽃: 심판', desc: '신성 변환. 1존 안의 적은 건강 내성, 실패 시 1d8 + 지혜 수정치 광휘 (성공 시 절반).', kind: 'class', cost: 'action', target: 'enemy', resource: 'channel_divinity', effect: { type: 'save_damage', save: 'con', damage: '1d8', damageType: '광휘', range: 1, half: true, bonus: 'spell' } }),
  card({ id: 'spell/healing_word', name: '치유의 말', desc: '1레벨 주문, 보너스 행동. 2존 안의 아군 HP를 2d4 + 주문 능력 수정치만큼 회복.', kind: 'spell', cost: 'bonus', target: 'ally', spellLevel: 1, upcast: { dice: '2d4' }, effect: { type: 'heal', dice: '2d4', add: 'spell', range: 2 } }),
  card({ id: 'spell/guiding_bolt', name: '인도의 화살', desc: '1레벨 주문. 원거리 주문 공격 4d6 광휘 (3존). 명중하면 다음 공격이 그 대상에게 이점.', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 1, upcast: { dice: '1d6' }, effect: { type: 'attack', attack: { kind: 'ranged', ability: 'spell', damage: '4d6', damageType: '광휘', range: 3 }, mark: true } }),
  card({ id: 'spell/burning_hands', name: '타오르는 손길', desc: '1레벨 주문. 내 존의 모든 적은 민첩 내성, 실패 시 3d6 화염 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 1, upcast: { dice: '1d6' }, effect: { type: 'area_save', save: 'dex', damage: '3d6', damageType: '화염', range: 0, half: true } }),
  card({ id: 'spell/scorching_ray', name: '작열 광선', desc: '2레벨 주문. 광선 3줄, 각각 원거리 주문 공격 2d6 화염 (3존).', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 2, upcast: { count: 1 }, effect: { type: 'attack', attack: { kind: 'ranged', ability: 'spell', damage: '2d6', damageType: '화염', range: 3 }, count: 3 } }),
];

/** 직업별 1레벨 시작 장비·카드 (갑옷은 AC 계산식으로 표현) */
export interface ClassKit {
  cards: string[];
  ac: (dexMod: number) => number;
  spellAbility?: Ability;
  sneakAttack?: string;
  /** 레벨별로 새로 얻는 카드 */
  progression?: Record<number, string[]>;
  /** 레벨별 새 능력 이름 (레벨업 안내용) */
  features?: Record<number, string[]>;
}

/** 이 레벨까지 가진 카드 */
export function kitCards(kit: ClassKit, level: number): string[] {
  const extra = Object.entries(kit.progression ?? {}).filter(([lv]) => Number(lv) <= level).flatMap(([, ids]) => ids);
  return [...kit.cards, ...extra];
}

export const CLASS_KITS: Record<string, ClassKit> = {
  fighter: {
    cards: ['weapon/longsword', 'weapon/javelin', 'fighter/second_wind'], ac: () => 16, // 체인 메일
    progression: { 2: ['fighter/action_surge'] },
    features: { 2: ['행동 연쇄'], 3: ['투사: 향상된 치명타 (19~20)'] },
  },
  rogue: {
    cards: ['weapon/shortsword', 'weapon/shortbow'], ac: (d) => 11 + d, sneakAttack: '1d6', // 가죽 갑옷
    progression: { 2: ['rogue/cunning_dash', 'rogue/cunning_hide'], 3: ['rogue/steady_aim'] },
    features: { 2: ['교활한 행동'], 3: ['암습 2d6', '정밀 조준'] },
  },
  cleric: {
    cards: ['weapon/mace', 'spell/sacred_flame', 'spell/cure_wounds'], ac: (d) => 13 + Math.min(d, 2) + 2, spellAbility: 'wis', // 체인 셔츠 + 방패
    progression: { 2: ['cleric/divine_spark_heal', 'cleric/divine_spark_harm', 'spell/healing_word'], 3: ['spell/guiding_bolt'] },
    features: { 2: ['신성 변환: 신성 불꽃', '치유의 말', '1레벨 슬롯 +1'], 3: ['인도의 화살', '1레벨 슬롯 +1', '2레벨 슬롯 2개'] },
  },
  wizard: {
    cards: ['weapon/dagger', 'spell/fire_bolt', 'spell/magic_missile'], ac: (d) => 10 + d, spellAbility: 'int',
    progression: { 2: ['spell/burning_hands'], 3: ['spell/scorching_ray'] },
    features: { 2: ['타오르는 손길', '1레벨 슬롯 +1'], 3: ['작열 광선', '1레벨 슬롯 +1', '2레벨 슬롯 2개'] },
  },
  none: { cards: ['weapon/dagger'], ac: (d) => 10 + d },
};
