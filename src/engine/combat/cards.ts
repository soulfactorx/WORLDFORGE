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

/** 상태 이상 (SRD 5.2.1 기반, 존 전투에 맞게 단순화) */
export type Condition = 'poisoned' | 'frightened' | 'restrained' | 'stunned' | 'blinded';
export const CONDITION_LABEL: Record<Condition, string> = { poisoned: '중독', frightened: '공포', restrained: '포박', stunned: '기절', blinded: '실명' };
export const CONDITION_DESC: Record<Condition, string> = {
  poisoned: '공격 굴림에 불리점',
  frightened: '공격 굴림에 불리점, 적에게 다가갈 수 없다',
  restrained: '움직일 수 없다. 공격에 불리점, 받는 공격에 이점, 민첩 내성에 불리점',
  stunned: '행동할 수 없다. 받는 공격에 이점, 근력·민첩 내성 자동 실패',
  blinded: '공격에 불리점, 받는 공격에 이점',
};

/**
 * 상태 이상 부여. 공격은 명중 후 대상이 save 내성(dc)을 굴려 실패하면 걸린다.
 * 내성 피해·범위 피해는 그 내성에 실패하면 바로 걸린다 (save·dc 무시).
 * rounds: 걸린 대상의 차례가 이만큼 끝나면 풀린다.
 */
export interface Inflict {
  condition: Condition;
  save: Ability;
  dc: number;
  rounds: number;
}

export type Effect =
  /** count: 여러 번 공격 (예: 불타는 광선). mark: 명중 시 대상에게 '표식' (다음 공격 이점) */
  | { type: 'attack'; attack: AttackSpec; count?: number; mark?: boolean; knockProne?: { save: Ability; dc: number }; inflict?: Inflict }
  /** half: 내성 성공 시 절반 피해. bonus: 주문 능력 수정치를 피해에 더함 */
  | { type: 'save_damage'; save: Ability; damage: string; damageType: string; range: number; half?: boolean; bonus?: 'spell'; dc?: number; inflict?: Inflict }
  /** 범위 내성 피해: 대상 존의 모든 적 (range = 존 거리, 0이면 자기 존) */
  | { type: 'area_save'; save: Ability; damage: string; damageType: string; range: number; half: boolean; dc?: number; inflict?: Inflict; bonus?: 'spell' }
  /** 적이 전장에서 달아난다 */
  | { type: 'escape' }
  | { type: 'auto_damage'; count: number; damage: string; damageType: string; range: number }
  /** range: 아군 대상 존 거리 (기본 0 = 같은 존) */
  | { type: 'heal'; dice: string; add: 'spell' | 'level' | 'none'; range?: number; cures?: Condition[] }
  | { type: 'move' }
  | { type: 'dodge' }
  | { type: 'hide' }
  | { type: 'aim' }
  | { type: 'extra_action' }
  /** 표식: 대상에 대한 다음 공격이 이점 (사냥꾼의 표식·저주) */
  | { type: 'mark'; range: number }
  /** 영감: 다른 아군의 다음 공격이 이점 (음유 영감) */
  | { type: 'inspire'; range: number }
  /** 감싸기: 다른 아군 하나를 노리는 공격에 불리점 (그 아군의 다음 차례까지) */
  | { type: 'protect'; range: number }
  /** 이번 차례 동안 이동해도 기회 공격을 받지 않는다 */
  | { type: 'disengage' }
  /** 넘어짐에서 일어선다 (이동력 소모) */
  | { type: 'stand' }
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
  kind: 'basic' | 'weapon' | 'class' | 'spell' | 'monster' | 'item';
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
  card({ id: 'basic/disengage', name: '후퇴', desc: '이번 차례에 이동해도 기회 공격을 받지 않는다.', kind: 'basic', cost: 'action', target: 'self', effect: { type: 'disengage' } }),
  card({ id: 'basic/stand', name: '일어서기', desc: '넘어진 상태에서 일어난다. 이동력을 소모한다.', kind: 'basic', cost: 'move', target: 'self', effect: { type: 'stand' } }),
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
  card({ id: 'rogue/cunning_disengage', name: '교활한 행동: 후퇴', desc: '보너스 행동으로 후퇴 — 이번 차례에 기회 공격을 받지 않는다.', kind: 'class', cost: 'bonus', target: 'self', effect: { type: 'disengage' } }),
  card({ id: 'rogue/cunning_hide', name: '교활한 행동: 숨기', desc: '보너스 행동으로 숨기(은신 DC 15).', kind: 'class', cost: 'bonus', target: 'self', effect: { type: 'hide' } }),
  card({ id: 'rogue/steady_aim', name: '정밀 조준', desc: '보너스 행동. 이번 차례에 이동하지 않았다면 다음 공격에 이점 (이동을 소모).', kind: 'class', cost: 'bonus', target: 'self', effect: { type: 'aim' } }),
  card({ id: 'cleric/divine_spark_heal', name: '신성 불꽃: 치유', desc: '신성 변환. 1존 안의 아군 HP를 1d8 + 지혜 수정치만큼 회복.', kind: 'class', cost: 'action', target: 'ally', resource: 'channel_divinity', effect: { type: 'heal', dice: '1d8', add: 'spell', range: 1 } }),
  card({ id: 'cleric/divine_spark_harm', name: '신성 불꽃: 심판', desc: '신성 변환. 1존 안의 적은 건강 내성, 실패 시 1d8 + 지혜 수정치 광휘 (성공 시 절반).', kind: 'class', cost: 'action', target: 'enemy', resource: 'channel_divinity', effect: { type: 'save_damage', save: 'con', damage: '1d8', damageType: '광휘', range: 1, half: true, bonus: 'spell' } }),
  card({ id: 'spell/healing_word', name: '치유의 말', desc: '1레벨 주문, 보너스 행동. 2존 안의 아군 HP를 2d4 + 주문 능력 수정치만큼 회복.', kind: 'spell', cost: 'bonus', target: 'ally', spellLevel: 1, upcast: { dice: '2d4' }, effect: { type: 'heal', dice: '2d4', add: 'spell', range: 2 } }),
  card({ id: 'spell/guiding_bolt', name: '인도의 화살', desc: '1레벨 주문. 원거리 주문 공격 4d6 광휘 (3존). 명중하면 다음 공격이 그 대상에게 이점.', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 1, upcast: { dice: '1d6' }, effect: { type: 'attack', attack: { kind: 'ranged', ability: 'spell', damage: '4d6', damageType: '광휘', range: 3 }, mark: true } }),
  card({ id: 'spell/burning_hands', name: '타오르는 손길', desc: '1레벨 주문. 내 존의 모든 적은 민첩 내성, 실패 시 3d6 화염 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 1, upcast: { dice: '1d6' }, effect: { type: 'area_save', save: 'dex', damage: '3d6', damageType: '화염', range: 0, half: true } }),
  // ---- 4~5레벨 (SRD 5.2.1)
  card({ id: 'spell/fireball', name: '화염구', desc: '3레벨 주문. 3존 안의 한 존을 골라, 그 존의 모든 적은 민첩 내성, 실패 시 8d6 화염 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 3, upcast: { dice: '1d6' }, effect: { type: 'area_save', save: 'dex', damage: '8d6', damageType: '화염', range: 3, half: true } }),
  card({ id: 'spell/spirit_guardians', name: '수호 영령', desc: '3레벨 주문. 영령들이 내 존을 휩쓸어, 그 존의 모든 적은 지혜 내성, 실패 시 3d8 광휘 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 3, upcast: { dice: '1d8' }, effect: { type: 'area_save', save: 'wis', damage: '3d8', damageType: '광휘', range: 0, half: true } }),
  card({ id: 'spell/hold_person', name: '인간 속박', desc: '2레벨 주문. 2존 안의 적은 지혜 내성, 실패 시 1라운드 동안 기절(행동 불가, 받는 공격에 이점).', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 2, effect: { type: 'save_damage', save: 'wis', damage: '0d4', damageType: '', range: 2, inflict: { condition: 'stunned', save: 'wis', dc: 0, rounds: 1 } } }),
  card({ id: 'spell/ray_of_sickness', name: '병마의 광선', desc: '1레벨 주문. 원거리 주문 공격 2d8 독 (3존). 명중하면 대상은 건강 내성, 실패 시 2라운드 중독.', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 1, upcast: { dice: '1d8' }, effect: { type: 'attack', attack: { kind: 'ranged', ability: 'spell', damage: '2d8', damageType: '독', range: 3 }, inflict: { condition: 'poisoned', save: 'con', dc: 0, rounds: 2 } } }),
  // ---- 바드·레인저·팔라딘·워락 (SRD 5.2.1을 존 전투에 맞게)
  card({ id: 'spell/vicious_mockery', name: '신랄한 조롱', desc: '소마법. 2존 안의 적은 지혜 내성, 실패 시 1d6 정신 피해.', kind: 'spell', cost: 'action', target: 'enemy', effect: { type: 'save_damage', save: 'wis', damage: '1d6', damageType: '정신', range: 2 } }),
  card({ id: 'spell/dissonant_whispers', name: '불협화음의 속삭임', desc: '1레벨 주문. 2존 안의 적은 지혜 내성, 실패 시 3d6 정신 피해와 1라운드 공포 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 1, upcast: { dice: '1d6' }, effect: { type: 'save_damage', save: 'wis', damage: '3d6', damageType: '정신', range: 2, half: true, inflict: { condition: 'frightened', save: 'wis', dc: 0, rounds: 1 } } }),
  card({ id: 'bard/inspiration', name: '음유 영감', desc: '보너스 행동. 2존 안의 다른 아군 하나의 다음 공격이 이점.', kind: 'class', cost: 'bonus', target: 'ally', resource: 'bardic_inspiration', effect: { type: 'inspire', range: 2 } }),
  card({ id: 'spell/shatter', name: '파쇄', desc: '2레벨 주문. 2존 안 한 존의 모든 적은 건강 내성, 실패 시 3d8 천둥 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 2, upcast: { dice: '1d8' }, effect: { type: 'area_save', save: 'con', damage: '3d8', damageType: '천둥', range: 2, half: true } }),
  card({ id: 'spell/hypnotic_pattern', name: '최면 문양', desc: '3레벨 주문. 2존 안 한 존의 모든 적은 지혜 내성, 실패 시 1라운드 기절.', kind: 'spell', cost: 'action', target: 'area', spellLevel: 3, effect: { type: 'area_save', save: 'wis', damage: '0d4', damageType: '', range: 2, half: false, inflict: { condition: 'stunned', save: 'wis', dc: 0, rounds: 1 } } }),
  card({ id: 'ranger/hunters_mark', name: '사냥꾼의 표식', desc: '1레벨 주문, 보너스 행동. 3존 안의 적에게 표식 — 그 적에 대한 다음 공격이 이점.', kind: 'spell', cost: 'bonus', target: 'enemy', spellLevel: 1, effect: { type: 'mark', range: 3 } }),
  card({ id: 'spell/conjure_barrage', name: '화살 세례', desc: '3레벨 주문. 2존 안 한 존의 모든 적은 민첩 내성, 실패 시 3d8 관통 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 3, upcast: { dice: '1d8' }, effect: { type: 'area_save', save: 'dex', damage: '3d8', damageType: '관통', range: 2, half: true } }),
  card({ id: 'paladin/lay_on_hands', name: '안수', desc: '보너스 행동. 같은 존의 아군(자신 포함) HP를 2d4 + 팔라딘 레벨만큼 회복.', kind: 'class', cost: 'bonus', target: 'ally', resource: 'lay_on_hands', effect: { type: 'heal', dice: '2d4', add: 'level' } }),
  card({ id: 'paladin/divine_smite', name: '신성 강타', desc: '1레벨 주문. 근접 무기 공격 3d8 광휘 (무기 1d8 + 강타 2d8). 슬롯을 올리면 1d8씩 더.', kind: 'spell', cost: 'action', target: 'enemy', spellLevel: 1, upcast: { dice: '1d8' }, effect: { type: 'attack', attack: { kind: 'melee', ability: 'str', damage: '3d8', damageType: '광휘', range: 0 } } }),
  card({ id: 'spell/eldritch_blast', name: '섬뜩한 화살', desc: '소마법. 원거리 주문 공격 1d10 역장 (3존).', kind: 'spell', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'ranged', ability: 'spell', damage: '1d10', damageType: '역장', range: 3 } } }),
  card({ id: 'warlock/hex', name: '저주', desc: '1레벨 주문, 보너스 행동. 3존 안의 적에게 저주의 표식 — 그 적에 대한 다음 공격이 이점.', kind: 'spell', cost: 'bonus', target: 'enemy', spellLevel: 1, effect: { type: 'mark', range: 3 } }),
  card({ id: 'spell/hunger_of_hadar', name: '하다르의 굶주림', desc: '3레벨 주문. 2존 안 한 존의 모든 적은 건강 내성, 실패 시 2d6 냉기와 1라운드 실명 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 3, upcast: { dice: '1d6' }, effect: { type: 'area_save', save: 'con', damage: '2d6', damageType: '냉기', range: 2, half: true, inflict: { condition: 'blinded', save: 'con', dc: 0, rounds: 1 } } }),
  // ---- 하위 직업 (v0.37)
  card({ id: 'fighter/guard', name: '감싸기', desc: '보너스 행동. 같은 존의 다른 아군 하나를 감싼다 — 그 아군을 노리는 공격에 불리점 (그 아군의 다음 차례까지).', kind: 'class', cost: 'bonus', target: 'ally', effect: { type: 'protect', range: 0 } }),
  card({ id: 'cleric/war_strike', name: '전쟁 사제의 일격', desc: '보너스 행동. 근접 무기 공격 1d6 타격.', kind: 'class', cost: 'bonus', target: 'enemy', resource: 'war_priest', effect: { type: 'attack', attack: { kind: 'melee', ability: 'str', damage: '1d6', damageType: '타격', range: 0 } } }),
  card({ id: 'wizard/portent', name: '예견', desc: '보너스 행동. 3존 안의 적 하나의 빈틈을 내다본다 — 그 적에 대한 다음 공격이 이점.', kind: 'class', cost: 'bonus', target: 'enemy', resource: 'portent', effect: { type: 'mark', range: 3 } }),
  card({ id: 'bard/cutting_words', name: '날카로운 말', desc: '보너스 행동, 음유 영감 소모. 2존 안의 적 하나의 방어를 흔든다 — 그 적에 대한 다음 공격이 이점.', kind: 'class', cost: 'bonus', target: 'enemy', resource: 'bardic_inspiration', effect: { type: 'mark', range: 2 } }),
  card({ id: 'paladin/sacred_weapon', name: '성스러운 무기', desc: '신성 변환, 보너스 행동. 무기에 빛을 깃들인다 — 내 다음 공격이 이점.', kind: 'class', cost: 'bonus', target: 'self', resource: 'channel_divinity', effect: { type: 'inspire', range: 0 } }),
  card({ id: 'paladin/vow', name: '적의 맹세', desc: '신성 변환, 보너스 행동. 3존 안의 적 하나에게 맹세 — 그 적에 대한 다음 공격이 이점.', kind: 'class', cost: 'bonus', target: 'enemy', resource: 'channel_divinity', effect: { type: 'mark', range: 3 } }),
  card({ id: 'warlock/fey_presence', name: '요정의 위압', desc: '행동. 내 존의 모든 적은 지혜 내성, 실패 시 1라운드 공포 (짧은 휴식당 1회).', kind: 'class', cost: 'action', target: 'area', resource: 'fey_presence', effect: { type: 'area_save', save: 'wis', damage: '1d4', damageType: '', range: 0, half: false, inflict: { condition: 'frightened', save: 'wis', dc: 0, rounds: 1 } } }),
  // ---- 6~10레벨 주문
  card({ id: 'spell/ice_storm', name: '얼음 폭풍', desc: '4레벨 주문. 3존 안 한 존의 모든 적은 민첩 내성, 실패 시 6d8 냉기 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 4, upcast: { dice: '1d8' }, effect: { type: 'area_save', save: 'dex', damage: '6d8', damageType: '냉기', range: 3, half: true } }),
  card({ id: 'spell/cone_of_cold', name: '냉기 원뿔', desc: '5레벨 주문. 1존 안 한 존의 모든 적은 건강 내성, 실패 시 8d8 냉기 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 5, upcast: { dice: '1d8' }, effect: { type: 'area_save', save: 'con', damage: '8d8', damageType: '냉기', range: 1, half: true } }),
  card({ id: 'spell/flame_strike', name: '화염 일격', desc: '5레벨 주문. 2존 안 한 존의 모든 적은 민첩 내성, 실패 시 8d6 화염·광휘 (성공 시 절반).', kind: 'spell', cost: 'action', target: 'area', spellLevel: 5, upcast: { dice: '1d6' }, effect: { type: 'area_save', save: 'dex', damage: '8d6', damageType: '광휘', range: 2, half: true } }),
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
  /** 기본 장비에 방패가 있다 (방패 아이템과 겹쳐 세지 않는다) */
  shield?: boolean;
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
    features: { 2: ['행동 연쇄'], 3: ['투사: 향상된 치명타 (19~20)'], 4: ['능력치 향상', '재기의 바람 3회'], 5: ['추가 공격 (무기 공격 2회)', '숙련 보너스 +3'], 6: ['능력치 향상'], 8: ['능력치 향상'], 9: ['숙련 보너스 +4'], 10: ['재기의 바람 4회'] },
  },
  rogue: {
    cards: ['weapon/shortsword', 'weapon/shortbow'], ac: (d) => 11 + d, sneakAttack: '1d6', // 가죽 갑옷
    progression: { 2: ['rogue/cunning_dash', 'rogue/cunning_disengage', 'rogue/cunning_hide'], 3: ['rogue/steady_aim'] },
    features: { 2: ['교활한 행동 (질주·후퇴·숨기)'], 3: ['암습 2d6', '정밀 조준'], 4: ['능력치 향상'], 5: ['암습 3d6', '초감각 회피 (반응으로 받은 공격 피해 절반)', '숙련 보너스 +3'], 7: ['암습 4d6', '회피 (민첩 내성 범위 피해: 성공 0, 실패 절반)'], 8: ['능력치 향상'], 9: ['암습 5d6', '숙련 보너스 +4'], 10: ['능력치 향상'] },
  },
  cleric: {
    cards: ['weapon/mace', 'spell/sacred_flame', 'spell/cure_wounds'], ac: (d) => 13 + Math.min(d, 2), shield: true, spellAbility: 'wis', // 체인 셔츠 + 방패
    progression: { 2: ['cleric/divine_spark_heal', 'cleric/divine_spark_harm', 'spell/healing_word'], 3: ['spell/guiding_bolt', 'spell/hold_person'], 5: ['spell/spirit_guardians'], 9: ['spell/flame_strike'] },
    features: { 2: ['신성 변환: 신성 불꽃', '치유의 말', '1레벨 슬롯 +1'], 3: ['인도의 화살', '인간 속박', '1레벨 슬롯 +1', '2레벨 슬롯 2개'], 4: ['능력치 향상', '2레벨 슬롯 +1'], 5: ['수호 영령', '3레벨 슬롯 2개', '소마법 강화', '숙련 보너스 +3'], 6: ['신성 변환 3회', '3레벨 슬롯 +1'], 7: ['4레벨 슬롯 1개'], 8: ['능력치 향상', '4레벨 슬롯 +1'], 9: ['화염 일격', '5레벨 슬롯 1개', '숙련 보너스 +4'], 10: ['4레벨 슬롯 +1', '5레벨 슬롯 +1'] },
  },
  wizard: {
    cards: ['weapon/dagger', 'spell/fire_bolt', 'spell/magic_missile'], ac: (d) => 10 + d, spellAbility: 'int',
    progression: { 2: ['spell/burning_hands'], 3: ['spell/scorching_ray'], 4: ['spell/ray_of_sickness'], 5: ['spell/fireball'], 7: ['spell/ice_storm'], 9: ['spell/cone_of_cold'] },
    features: { 2: ['타오르는 손길', '1레벨 슬롯 +1'], 3: ['작열 광선', '1레벨 슬롯 +1', '2레벨 슬롯 2개'], 4: ['능력치 향상', '병마의 광선', '2레벨 슬롯 +1'], 5: ['화염구', '3레벨 슬롯 2개', '소마법 강화', '숙련 보너스 +3'], 6: ['3레벨 슬롯 +1'], 7: ['얼음 폭풍', '4레벨 슬롯 1개'], 8: ['능력치 향상', '4레벨 슬롯 +1'], 9: ['냉기 원뿔', '5레벨 슬롯 1개', '숙련 보너스 +4'], 10: ['4레벨 슬롯 +1', '5레벨 슬롯 +1'] },
  },
  bard: {
    cards: ['weapon/dagger', 'spell/vicious_mockery', 'spell/healing_word', 'spell/dissonant_whispers', 'bard/inspiration'], ac: (d) => 11 + d, spellAbility: 'cha', // 가죽 갑옷
    progression: { 3: ['spell/shatter'], 5: ['spell/hypnotic_pattern'] },
    features: { 2: ['1레벨 슬롯 +1'], 3: ['파쇄', '2레벨 슬롯 2개'], 4: ['능력치 향상'], 5: ['최면 문양', '3레벨 슬롯 2개', '영감의 샘 (짧은 휴식에 음유 영감 회복)', '음유 영감 4회', '소마법 강화', '숙련 보너스 +3'], 7: ['4레벨 슬롯'], 8: ['능력치 향상'], 9: ['5레벨 슬롯', '숙련 보너스 +4'], 10: ['음유 영감 5회'] },
  },
  ranger: {
    cards: ['weapon/shortsword', 'weapon/shortbow', 'ranger/hunters_mark'], ac: (d) => 12 + d, spellAbility: 'wis', // 징 박은 가죽 갑옷
    progression: { 2: ['spell/cure_wounds'], 9: ['spell/conjure_barrage'] },
    features: { 2: ['상처 치료'], 3: ['1레벨 슬롯 +1'], 4: ['능력치 향상'], 5: ['추가 공격 (무기 공격 2회)', '2레벨 슬롯 2개', '숙련 보너스 +3'], 8: ['능력치 향상'], 9: ['화살 세례', '3레벨 슬롯 2개', '숙련 보너스 +4'] },
  },
  paladin: {
    cards: ['weapon/longsword', 'weapon/javelin', 'paladin/lay_on_hands'], ac: () => 16, shield: true, spellAbility: 'cha', // 체인 메일 + 방패
    progression: { 2: ['paladin/divine_smite', 'spell/cure_wounds'] },
    features: { 2: ['신성 강타', '상처 치료'], 3: ['1레벨 슬롯 +1'], 4: ['능력치 향상'], 5: ['추가 공격 (무기 공격 2회)', '2레벨 슬롯 2개', '숙련 보너스 +3'], 6: ['보호의 오라 (같은 존 아군의 내성에 매력 보너스)'], 8: ['능력치 향상'], 9: ['3레벨 슬롯 2개', '숙련 보너스 +4'] },
  },
  warlock: {
    cards: ['weapon/dagger', 'spell/eldritch_blast', 'warlock/hex'], ac: (d) => 11 + d, spellAbility: 'cha', // 가죽 갑옷
    progression: { 3: ['spell/shatter'], 5: ['spell/hunger_of_hadar'] },
    features: { 2: ['계약 슬롯 2개 (짧은 휴식에 회복)'], 3: ['파쇄', '계약 슬롯이 2레벨로'], 4: ['능력치 향상'], 5: ['하다르의 굶주림', '계약 슬롯이 3레벨로', '소마법 강화', '숙련 보너스 +3'], 7: ['계약 슬롯이 4레벨로'], 8: ['능력치 향상'], 9: ['계약 슬롯이 5레벨로', '숙련 보너스 +4'] },
  },
  none: { cards: ['weapon/dagger'], ac: (d) => 10 + d },
};
