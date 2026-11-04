/**
 * 스킬카드 = D&D 행동을 데이터로 정의한 것 (설계 리뷰 2.4·4.2절).
 * 랜덤 드로우 없음: 기본 행동은 항상 사용 가능하고, 직업·무기 카드는 캐릭터가 가진 만큼 손패에 있다.
 * 사용 가능 여부(행동 경제·자원·사거리)는 엔진이 판단한다.
 *
 * 규칙 수치는 SRD 5.2.1 (CC-BY-4.0) 기반.
 */
import type { Ability } from '../character/rules';

export type Cost = 'action' | 'bonus' | 'move';

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
  | { type: 'attack'; attack: AttackSpec }
  | { type: 'save_damage'; save: Ability; damage: string; damageType: string; range: number }
  | { type: 'auto_damage'; count: number; damage: string; damageType: string; range: number }
  | { type: 'heal'; dice: string; add: 'spell' | 'level' }
  | { type: 'move' }
  | { type: 'dodge' }
  | { type: 'hide' }
  | { type: 'flee' };

export interface CardDef {
  id: string;
  name: string;
  desc: string;
  kind: 'basic' | 'weapon' | 'class' | 'spell' | 'monster';
  cost: Cost;
  /** ally = 같은 존의 아군(자신 포함) 중 다친 대상 */
  target: 'enemy' | 'self' | 'ally' | 'zone';
  effect: Effect;
  /** 소모 자원 키 (예: slot1, second_wind) */
  resource?: string;
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
  card({ id: 'spell/cure_wounds', name: '상처 치료', desc: '1레벨 주문. 같은 존의 아군(자신 포함) HP를 2d8 + 주문 능력 수정치만큼 회복.', kind: 'spell', cost: 'action', target: 'ally', resource: 'slot1', effect: { type: 'heal', dice: '2d8', add: 'spell' } }),
  card({ id: 'spell/fire_bolt', name: '화염 화살', desc: '소마법. 원거리 주문 공격 1d10 화염 (3존).', kind: 'spell', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'ranged', ability: 'spell', damage: '1d10', damageType: '화염', range: 3 } } }),
  card({ id: 'spell/magic_missile', name: '마법 화살', desc: '1레벨 주문. 반드시 명중하는 화살 3발, 각 1d4+1 역장 (3존).', kind: 'spell', cost: 'action', target: 'enemy', resource: 'slot1', effect: { type: 'auto_damage', count: 3, damage: '1d4+1', damageType: '역장', range: 3 } }),
];

/** 직업별 1레벨 시작 장비·카드 (갑옷은 AC 계산식으로 표현) */
export interface ClassKit {
  cards: string[];
  ac: (dexMod: number) => number;
  spellAbility?: Ability;
  sneakAttack?: string;
}

export const CLASS_KITS: Record<string, ClassKit> = {
  fighter: { cards: ['weapon/longsword', 'weapon/javelin', 'fighter/second_wind'], ac: () => 16 }, // 체인 메일
  rogue: { cards: ['weapon/shortsword', 'weapon/shortbow'], ac: (d) => 11 + d, sneakAttack: '1d6' }, // 가죽 갑옷
  cleric: { cards: ['weapon/mace', 'spell/sacred_flame', 'spell/cure_wounds'], ac: (d) => 13 + Math.min(d, 2) + 2, spellAbility: 'wis' }, // 체인 셔츠 + 방패
  wizard: { cards: ['weapon/dagger', 'spell/fire_bolt', 'spell/magic_missile'], ac: (d) => 10 + d, spellAbility: 'int' },
  none: { cards: ['weapon/dagger'], ac: (d) => 10 + d },
};
