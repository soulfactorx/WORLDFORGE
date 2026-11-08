/**
 * 존(Zone) 기반 턴제 카드 전투 엔진 (설계 리뷰 2.4·2.5절).
 *
 * 전장은 일렬의 4개 존: 0 아군 후열 · 1 아군 전열 · 2 적 전열 · 3 적 후열 (1존 ≈ 30피트).
 *  - 근접 공격: 같은 존의 대상만.
 *  - 원거리 공격/주문: 존 거리 ≤ 사거리. 내 존에 적이 있으면 원거리 공격은 불리점.
 *  - 이동: 이동력으로 인접 존 1칸, 질주(행동)로 1칸 더.
 *  - 행동 경제: 차례마다 행동 1 · 보너스 행동 1 · 이동 1.
 *
 * 모든 함수는 순수 함수다. 주사위는 시드 RNG만 사용하고, 결과는 effects로 반환해 이벤트에 저장한다.
 * 아군 NPC 동료는 규칙 기반 전술 AI가 플레이어의 명령(PartyOrder)에 따라 움직인다.
 * 기회 공격: 적이 있는 존을 떠나면 그 존의 적이 반응으로 근접 공격 1회 (후퇴하면 면제).
 * 죽음 내성: 아군은 HP 0이 되면 빈사 상태로 차례마다 d20 (10 이상 성공, 3성공 안정, 3실패 사망, 20은 HP 1 회복).
 * 상태 이상: 넘어짐 (근접 공격은 이점·원거리는 불리점으로 당하고, 자신의 공격은 불리점, 이동하려면 일어서야 함),
 *   중독·공포·포박·기절·실명 (cards.ts CONDITION_DESC). 걸린 대상의 차례가 끝날 때마다 남은 라운드가 줄어든다.
 */
import type { Ability } from '../character/rules';
import { type Abilities, type CharacterSheet, resourcesOf } from '../character/sheet';
import { npcXp } from '../npcStats';
import { abilityModifier, d20Test, type RollMode } from '../dice/dice';
import { type Rng, rollDie } from '../dice/rng';
import { proficiencyBonus, SKILLS } from '../character/rules';
import { subclassCards } from '../character/build';
import { BASIC_CARDS, type CardDef, CLASS_CARDS, CLASS_KITS, type Condition, CONDITION_LABEL, type Cost, type Inflict, kitCards, WEAPON_CARDS } from './cards';
import { ALL_MONSTER_CARDS, type MonsterDef, type MonsterPhase, MONSTERS } from './monsters';

export const ZONE_NAMES = ['아군 후열', '아군 전열', '적 전열', '적 후열'] as const;
export const ZONE_COUNT = ZONE_NAMES.length;

export type Side = 'party' | 'enemy';
export type Outcome = 'victory' | 'defeat' | 'fled';

export interface Combatant {
  id: string;
  name: string;
  side: Side;
  isPlayer: boolean;
  zone: number;
  hp: number;
  maxHp: number;
  ac: number;
  level: number;
  abilities: Abilities;
  profBonus: number;
  saveProfs: Ability[];
  stealthBonus: number;
  spellAbility?: Ability;
  cards: string[];
  resources: Record<string, { cur: number; max: number }>;
  dodging: boolean;
  hidden: boolean;
  /** 정밀 조준: 다음 공격 이점 */
  aimed?: boolean;
  /** 인도의 화살 표식: 이 대상에 대한 다음 공격 이점 */
  marked?: boolean;
  /** 이 값 이상의 d20이면 치명타 (기본 20, 투사 3레벨 19) */
  critRange?: number;
  /** 이번 라운드에 반응(기회 공격)을 썼다 */
  reactionUsed?: boolean;
  /** 후퇴: 이번 차례에 기회 공격을 받지 않는다 */
  disengaged?: boolean;
  /** 넘어짐 */
  prone?: boolean;
  /** 죽음 내성 (아군만) */
  deathSaves?: { success: number; fail: number };
  stable?: boolean;
  dead?: boolean;
  sneakAttack?: string;
  packTactics?: boolean;
  preferRanged?: boolean;
  initiative: number;
  /** 적: 몬스터 데이터 ID, 지난 보스 단계 수, 도망치는 HP 비율, 도망쳤는가 */
  monsterId?: string;
  phase?: number;
  fleeAt?: number;
  escaped?: boolean;
  /** 상태 이상 → 남은 라운드 */
  conditions?: Partial<Record<Condition, number>>;
  /** 상태 이상 면역 (언데드의 중독 등) */
  immune?: Condition[];
  /** 추가 공격: 무기 공격 카드가 한 번 더 공격 (파이터 5레벨) */
  extraAttack?: boolean;
  /** 초감각 회피: 반응으로 명중한 공격의 피해 절반 (로그 5레벨) */
  uncannyDodge?: boolean;
  /** 소마법 강화: 소마법 피해 주사위 배수 (5레벨부터 2) */
  cantripTier?: number;
  /** 회피 (로그 7레벨): 민첩 내성 절반 피해 — 성공 0, 실패 절반 */
  evasion?: boolean;
  /** 보호의 오라 (팔라딘 6레벨): 같은 존 아군의 내성에 더하는 값 */
  aura?: number;
  /** 하위 직업·특성 효과 (v0.37) */
  traits?: Trait[];
  /** 마법 장비: 무기(주문이 아닌) 공격 명중·피해, 모든 내성 (설계 v4 E3) */
  gearAttack?: number;
  gearDamage?: number;
  gearSave?: number;
  /** 우선권 보너스 (경계 특성·추적자) */
  initBonus?: number;
  /** 이 전투원만 가진 카드 정의 (소지품 물약·세계만의 적 기술 등, 설계 v3 6.4) */
  extraCards?: CardDef[];
  /** 적: 처치 경험치·역할·외형·보스 단계 (세계만의 적도 전투 안에서 스스로 완결되도록 담아 둔다) */
  xp?: number;
  role?: string;
  look?: string;
  phases?: MonsterPhase[];
}

/**
 * stealth_adv: 숨기 판정 이점 (도둑) · duelist: 홀로 선 적에게 근접 암습 (결투가) · life: 회복 주문 +2+슬롯 (생명 영역)
 * evoker: 주문 피해 + 주문 능력 수정치 (방출술사) · colossus: 다친 적 +1d8 (사냥꾼)
 * sharpshooter: 근접한 적이 있어도 원거리 불리점 없음 · war_caster: 건강 내성 이점
 */
export type Trait = 'stealth_adv' | 'duelist' | 'life' | 'evoker' | 'colossus' | 'sharpshooter' | 'war_caster';
const hasTrait = (c: Combatant, t: Trait) => !!c.traits?.includes(t);

export interface Economy {
  action: boolean;
  bonus: boolean;
  move: boolean;
}

export interface CombatState {
  /** 파티가 압도적으로 강한 조우 (설계 v4 E4) — 적이 일찍 달아나고, 서술이 주인공의 기세를 그린다 */
  overmatched?: boolean;
  /** 적응 난이도로 조정된 조우 (설계 v4 E5) */
  adaptive?: 'easier' | 'harder';
  encounterId: string;
  round: number;
  order: string[];
  turnIndex: number;
  combatants: Record<string, Combatant>;
  economy: Economy;
  sneakUsed: boolean;
  outcome?: Outcome;
}

export interface EncounterSpec {
  id: string;
  enemies: { monsterId: string; zone: number }[];
}

export type Target = string | number | null;

export type CombatEffect =
  /** crit: 빈사 상태에서 치명타를 맞으면 죽음 내성 실패 2회 */
  | { kind: 'hp'; target: string; delta: number; crit?: boolean }
  | { kind: 'zone'; target: string; zone: number }
  | { kind: 'flag'; target: string; dodging?: boolean; hidden?: boolean; aimed?: boolean; marked?: boolean; reactionUsed?: boolean; disengaged?: boolean; prone?: boolean }
  /** 죽음 내성 결과 */
  | { kind: 'death_save'; target: string; success: number; fail: number }
  | { kind: 'gain_action' }
  | { kind: 'spend'; cost: Cost }
  | { kind: 'resource'; target: string; key: string; delta: number }
  | { kind: 'sneak_used' }
  | { kind: 'fled' }
  /** 적이 달아났다 */
  | { kind: 'escaped'; target: string }
  /** 보스 단계 진입 (index = 지금까지 진입한 단계 수) */
  | { kind: 'phase'; target: string; index: number }
  /** 상태 이상 부여 (rounds 0 = 해제) */
  | { kind: 'condition'; target: string; condition: Condition; rounds: number };

export interface Resolution {
  effects: CombatEffect[];
  log: string[];
}

// ---------------------------------------------------------------- 카드 조회

/** 적의 도망 (HP가 일정 비율 아래로 떨어진 적만) */
export const ESCAPE_CARD: CardDef = { id: 'monster/escape', name: '도망', desc: '', kind: 'monster', cost: 'action', target: 'self', effect: { type: 'escape' } };
export const ALL_CARDS: Record<string, CardDef> = Object.fromEntries(
  [...BASIC_CARDS, ...WEAPON_CARDS, ...CLASS_CARDS, ...ALL_MONSTER_CARDS, ESCAPE_CARD].map((c) => [c.id, c]),
);

/** 보상으로 줄 수 있는 카드 ID (몬스터 카드 제외) */
export const CARD_LIST = [...WEAPON_CARDS, ...CLASS_CARDS].map((c) => c.id);

export function cardById(id: string): CardDef {
  const c = ALL_CARDS[id];
  if (!c) throw new Error(`unknown card: ${id}`);
  return c;
}

/** 이 전투원이 쓰는 카드 정의 (전투원 전용 카드 → 공용 카드) */
export function cardOf(c: Combatant | undefined, id: string): CardDef {
  return c?.extraCards?.find((x) => x.id === id) ?? cardById(id);
}

/** 손패: 기본 행동 + 캐릭터 카드 (+ 소모품). 몬스터는 기본 행동 중 이동·질주만 쓴다. 다 쓴 소모품은 빠진다. */
export function handOf(c: Combatant): CardDef[] {
  const basics = c.side === 'party' ? BASIC_CARDS.map((b) => b.id) : ['basic/move', 'basic/dash', 'basic/stand', ...(c.fleeAt ? [ESCAPE_CARD.id] : [])];
  // 전투원 전용 정의는 두 가지: 손패에 붙는 소모품(item) · 카드 ID로 찾는 세계만의 적 기술 (단계 카드는 c.cards에 들어올 때만)
  const extra = (c.extraCards ?? []).filter((x) => x.kind === 'item' && (!x.resource || (c.resources[x.resource]?.cur ?? 0) > 0));
  return [...[...c.cards, ...basics].map((id) => cardOf(c, id)), ...extra];
}

// ---------------------------------------------------------------- 시작

export function playerCombatant(sheet: CharacterSheet, gear: Gear = {}): Combatant {
  return sheetCombatant(sheet, 'player', sheet.name || '당신', true, 1, gear);
}

/** 캐릭터 시트(플레이어·동료)로 전투원 생성 */
/** 장비·소지품 (플레이어): AC를 정하고, 무기 카드·소모품 카드를 더한다 */
export interface Gear {
  ac?: number;
  cards?: string[];
  /** 마법 장비 보너스 (설계 v4 E3): 무기 공격 명중·피해, 모든 내성 */
  attackBonus?: number;
  damageBonus?: number;
  saveBonus?: number;
  items?: { card: CardDef; n: number }[];
}

export function sheetCombatant(sheet: CharacterSheet, id: string, name: string, isPlayer: boolean, zone: number, gear: Gear = {}): Combatant {
  const kit = CLASS_KITS[sheet.classId] ?? CLASS_KITS.none!;
  const dex = abilityModifier(sheet.abilities.dex);
  const pb = proficiencyBonus(sheet.level);
  const resources = structuredClone(resourcesOf(sheet));
  for (const it of gear.items ?? []) resources[it.card.resource!] = { cur: it.n, max: it.n };
  const cards = [...new Set([...kitCards(kit, sheet.level), ...subclassCards(sheet.subclass, sheet.level), ...(gear.cards ?? []).filter((c) => ALL_CARDS[c])])];
  const sc = sheet.subclass;
  const feats = sheet.feats ?? [];
  const traits: Trait[] = [];
  const t = (on: boolean, x: Trait) => { if (on) traits.push(x); };
  t(sc === 'thief', 'stealth_adv'); t(sc === 'duelist', 'duelist'); t(sc === 'life', 'life'); t(sc === 'evoker', 'evoker'); t(sc === 'hunter', 'colossus');
  t(feats.includes('sharpshooter'), 'sharpshooter'); t(feats.includes('war_caster'), 'war_caster');
  const acBonus = (feats.includes('defense') ? 1 : 0) + (sc === 'valor' ? 1 : 0) + (sc === 'guardian' && sheet.level >= 7 ? 1 : 0);
  const initBonus = (feats.includes('alert') ? pb : 0) + (sc === 'tracker' ? abilityModifier(sheet.abilities.wis) : 0);
  return {
    ...(traits.length ? { traits } : {}), ...(initBonus ? { initBonus } : {}),
    ...(gear.attackBonus ? { gearAttack: gear.attackBonus } : {}), ...(gear.damageBonus ? { gearDamage: gear.damageBonus } : {}), ...(gear.saveBonus ? { gearSave: gear.saveBonus } : {}),
    id, name, side: 'party', isPlayer, zone,
    hp: sheet.hp, maxHp: sheet.maxHp, ac: (gear.ac ?? (kit.ac(dex) + (kit.shield ? 2 : 0))) + acBonus, level: sheet.level, abilities: { ...sheet.abilities },
    profBonus: pb, saveProfs: [...sheet.saveProficiencies],
    stealthBonus: abilityModifier(sheet.abilities[SKILLS.stealth.ability]) + (sheet.skillProficiencies.includes('stealth') ? pb : 0),
    spellAbility: kit.spellAbility, cards, resources, ...(gear.items?.length ? { extraCards: gear.items.map((x) => x.card) } : {}),
    dodging: false, hidden: false, initiative: 0,
    sneakAttack: kit.sneakAttack ? `${Math.ceil(sheet.level / 2)}d6` : undefined, // 암습 1d6(1~2레벨), 2d6(3~4레벨)
    // 챔피언: 향상된 치명타 (하위 직업을 아직 고르지 않은 파이터도 — 이전 세이브 호환)
    critRange: sheet.classId === 'fighter' && sheet.level >= 3 && sc !== 'guardian' ? 19 : 20,
    ...((['fighter', 'ranger', 'paladin'].includes(sheet.classId) && sheet.level >= 5) || (sc === 'valor' && sheet.level >= 6) ? { extraAttack: true } : {}),
    ...(sheet.classId === 'rogue' && sheet.level >= 5 ? { uncannyDodge: true } : {}),
    ...(sheet.classId === 'rogue' && sheet.level >= 7 ? { evasion: true } : {}),
    ...(sheet.classId === 'paladin' && sheet.level >= 6 ? { aura: Math.max(1, abilityModifier(sheet.abilities.cha)) } : {}),
    ...(sheet.level >= 5 ? { cantripTier: 2 } : {}),
  };
}

/** 이 레벨 이상의 사용 가능한 가장 낮은 주문 슬롯 레벨 */
export function slotFor(c: Combatant, minLevel: number): number | null {
  for (let lv = minLevel; lv <= 9; lv++) if ((c.resources[`slot${lv}`]?.cur ?? 0) > 0) return lv;
  return null;
}

/** 도전 지수별 숙련 보너스 (SRD: CR 0~4 = +2, 5~8 = +3) */
const monsterProf = (cr: string) => (Number(cr.includes('/') ? 0 : cr) >= 5 ? 3 : 2);

export function monsterCombatant(monsterId: string, index: number, zone: number, table: Record<string, MonsterDef> = MONSTERS): Combatant {
  const m = table[monsterId];
  if (!m) throw new Error(`unknown monster: ${monsterId}`);
  // 기본 적이 아니면 카드 정의를 전투원이 직접 들고 다닌다
  const custom = MONSTERS[monsterId] !== m;
  return {
    xp: m.xp, role: m.role, look: m.look, ...(m.phases?.length ? { phases: m.phases } : {}),
    ...(custom ? { extraCards: [...m.cards, ...(m.phases ?? []).flatMap((p) => p.addCards ?? [])] } : {}),
    id: `${monsterId}#${index}`, name: `${m.name} ${index}`, side: 'enemy', isPlayer: false, zone,
    hp: m.hp, maxHp: m.hp, ac: m.ac, level: 1, abilities: { ...m.abilities }, profBonus: monsterProf(m.cr), saveProfs: [...(m.saves ?? [])],
    stealthBonus: abilityModifier(m.abilities.dex), cards: m.cards.map((c) => c.id),
    resources: Object.fromEntries(Object.entries(m.resources ?? {}).map(([k, n]) => [k, { cur: n, max: n }])),
    dodging: false, hidden: false, packTactics: m.packTactics, preferRanged: m.preferRanged, initiative: 0,
    monsterId, phase: 0, ...(m.fleeAt ? { fleeAt: m.fleeAt } : {}), ...(m.immune ? { immune: [...m.immune] } : {}),
  };
}

const FRESH: Economy = { action: true, bonus: true, move: true };

/** 전투 시작: 우선권 굴림(d20 + 민첩 수정치) 후 순서 결정 */
export interface CompanionEntry {
  id: string;
  name: string;
  sheet: CharacterSheet;
  order?: PartyOrder;
  /** 보상으로 얻은 전용 카드 */
  cards?: string[];
}

/** 동료의 시작 존: 후방 유지 명령이거나 위저드면 후열, 아니면 전열 */
function companionStartZone(c: CompanionEntry): number {
  return c.order?.mode === 'hold_back' || c.sheet.classId === 'wizard' ? 0 : 1;
}

export function startCombat(enc: EncounterSpec, sheet: CharacterSheet, rng: Rng, companions: CompanionEntry[] = [], gear: Gear = {}, table: Record<string, MonsterDef> = MONSTERS,
  npcs: Record<string, { name: string; sheet: CharacterSheet; look?: string }> = {}): CombatState {
  const list: Combatant[] = [playerCombatant(sheet, gear)];
  for (const c of companions) {
    if (c.sheet.hp > 0) list.push(sheetCombatant(c.sheet, c.id, c.name, false, companionStartZone(c), c.cards?.length ? { cards: c.cards } : {}));
  }
  const counts: Record<string, number> = {};
  for (const e of enc.enemies) {
    counts[e.monsterId] = (counts[e.monsterId] ?? 0) + 1;
    // 인물 적 (v0.79): 그 인물의 캐릭터 시트로 싸운다. 크게 다치면 물러난다 (이야기 속 인물이 함부로 죽지 않게)
    if (e.monsterId.startsWith('npc:')) {
      const n = npcs[e.monsterId];
      if (!n) continue;
      const c = sheetCombatant(n.sheet, `${e.monsterId}#${counts[e.monsterId]}`, n.name, false, Math.min(ZONE_COUNT - 1, Math.max(2, e.zone)));
      list.push({ ...c, side: 'enemy', xp: npcXp(n.sheet.level), fleeAt: 0.25, ...(n.look ? { look: n.look } : {}) });
      continue;
    }
    list.push(monsterCombatant(e.monsterId, counts[e.monsterId]!, Math.min(ZONE_COUNT - 1, Math.max(2, e.zone)), table));
  }
  for (const c of list) c.initiative = rollDie(rng, 20) + abilityModifier(c.abilities.dex) + (c.initBonus ?? 0);
  const order = [...list].sort((a, b) => b.initiative - a.initiative || b.abilities.dex - a.abilities.dex || a.id.localeCompare(b.id)).map((c) => c.id);
  return {
    encounterId: enc.id, round: 1, order, turnIndex: 0,
    combatants: Object.fromEntries(list.map((c) => [c.id, c])), economy: { ...FRESH }, sneakUsed: false,
  };
}

// ---------------------------------------------------------------- 조회 도우미

export const currentActorId = (cs: CombatState) => cs.order[cs.turnIndex]!;
export const alive = (c: Combatant) => c.hp > 0;
/** 빈사: 아군이 HP 0이고 아직 안정·사망이 아님 → 차례마다 죽음 내성 */
export const dying = (c: Combatant) => c.side === 'party' && c.hp <= 0 && !c.stable && !c.dead;
const opponents = (cs: CombatState, c: Combatant) => Object.values(cs.combatants).filter((o) => o.side !== c.side && alive(o));
const hostileInZone = (cs: CombatState, c: Combatant, zone = c.zone) => opponents(cs, c).some((o) => o.zone === zone);
const mod = (c: Combatant, a: Ability) => abilityModifier(c.abilities[a]);
const spellMod = (c: Combatant) => (c.spellAbility ? mod(c, c.spellAbility) : 0);
export const spellSaveDc = (c: Combatant) => 8 + c.profBonus + spellMod(c);
export const hasCondition = (c: Combatant, k: Condition) => (c.conditions?.[k] ?? 0) > 0;
/** 지금 걸려 있는 상태 이상 */
export const conditionsOf = (c: Combatant) => Object.entries(c.conditions ?? {}).filter(([, n]) => (n ?? 0) > 0).map(([k, n]) => ({ condition: k as Condition, rounds: n! }));

/** 내성 굴림 (상태 이상 반영): 기절은 근력·민첩 자동 실패, 포박은 민첩 불리점 */
function saveTest(rng: Rng, t: Combatant, save: Ability, dc: number, cs?: CombatState): { kept: number; mod: number; total: number; success: number | boolean; note: string } {
  // 보호의 오라: 같은 존에 서 있는 (쓰러지지 않은) 팔라딘
  const aura = cs ? Math.max(0, ...Object.values(cs.combatants).filter((o) => o.side === t.side && o.aura && o.hp > 0 && o.zone === t.zone).map((o) => o.aura!)) : 0;
  const sb = mod(t, save) + (t.saveProfs.includes(save) ? t.profBonus : 0) + aura + (t.gearSave ?? 0);
  if (hasCondition(t, 'stunned') && (save === 'str' || save === 'dex')) return { kept: 0, mod: sb, total: 0, success: false, note: '기절 — 자동 실패' };
  const mode = combineMode(hasTrait(t, 'war_caster') && save === 'con', hasCondition(t, 'restrained') && save === 'dex');
  const r = d20Test(rng, sb, dc, mode);
  return { kept: r.kept, mod: sb, total: r.total, success: r.success, note: mode === 'disadvantage' ? `불리점(포박) ${r.rolls.join(', ')}` : mode === 'advantage' ? `이점(전쟁 시전자) ${r.rolls.join(', ')} → ${r.total}` : '' };
}

/** 상태 이상 부여. saved: 이미 굴린 내성 결과 (내성 피해 카드). 없으면 inflict.save로 새로 굴린다. */
function tryInflict(rng: Rng, a: Combatant, t: Combatant, inf: Inflict, saved?: boolean, cs?: CombatState): { effects: CombatEffect[]; text: string } {
  const label = CONDITION_LABEL[inf.condition];
  if (t.immune?.includes(inf.condition)) return { effects: [], text: `, ${label} 면역` };
  let failed: boolean;
  let roll = '';
  if (saved === undefined) {
    const dc = inf.dc || spellSaveDc(a);
    const r = saveTest(rng, t, inf.save, dc, cs);
    failed = !r.success;
    roll = ` 내성 ${r.note || r.total} vs DC ${dc}`;
  } else failed = !saved;
  if (!failed) return { effects: [], text: `,${roll} ${label} 버팀` };
  const rounds = Math.max(inf.rounds, t.conditions?.[inf.condition] ?? 0);
  return { effects: [{ kind: 'condition', target: t.id, condition: inf.condition, rounds }], text: `,${roll} → ${label}(${inf.rounds}라운드)` };
}

/** 내성 피해 보너스: 카드의 주문 능력 보너스, 방출술사는 주문이면 항상 (두 번 더하지 않는다) */
const evokeBonus = (card: CardDef, a: Combatant, bonus?: 'spell') => (bonus === 'spell' || (hasTrait(a, 'evoker') && card.kind === 'spell') ? spellMod(a) : 0);

/** 소마법 강화: 5레벨부터 소마법 피해 주사위 2배 */
function cantripDamage(card: CardDef, a: Combatant, damage: string): string {
  if (card.kind !== 'spell' || card.spellLevel || (a.cantripTier ?? 1) < 2) return damage;
  const dice = /^(\d*d\d+)/.exec(damage)?.[1];
  return dice ? scaleDice(damage, dice, (a.cantripTier ?? 1) - 1) : damage;
}

function attackAbilityMod(c: Combatant, a: 'str' | 'dex' | 'finesse' | 'spell'): number {
  if (a === 'finesse') return Math.max(mod(c, 'str'), mod(c, 'dex'));
  if (a === 'spell') return spellMod(c);
  return mod(c, a);
}

function inRange(card: CardDef, actor: Combatant, target: Combatant): boolean {
  const e = card.effect;
  const dist = Math.abs(actor.zone - target.zone);
  if (e.type === 'attack') return e.attack.kind === 'melee' ? dist === 0 : dist <= e.attack.range;
  if (e.type === 'save_damage' || e.type === 'auto_damage' || e.type === 'mark') return dist <= e.range;
  return false;
}

const healRange = (card: CardDef) => (card.effect.type === 'heal' ? card.effect.range ?? 0 : 0);

/** 카드의 유효 대상 목록 */
export function validTargets(cs: CombatState, actorId: string, card: CardDef): Target[] {
  const a = cs.combatants[actorId]!;
  if (card.target === 'self') return [actorId];
  if (card.target === 'zone') {
    const zones = [a.zone - 1, a.zone + 1].filter((z) => z >= 0 && z < ZONE_COUNT);
    if (!hasCondition(a, 'frightened')) return zones;
    // 공포: 가장 가까운 적에게 다가가는 방향으로는 움직일 수 없다
    const dist = (z: number) => Math.min(...opponents(cs, a).map((o) => Math.abs(o.zone - z)));
    return zones.filter((z) => !opponents(cs, a).length || dist(z) >= dist(a.zone));
  }
  if (card.target === 'ally' && card.effect.type === 'protect') {
    const range = card.effect.range;
    return Object.values(cs.combatants).filter((o) => o.side === a.side && o.id !== a.id && alive(o) && Math.abs(o.zone - a.zone) <= range && !o.dodging).map((o) => o.id);
  }
  if (card.target === 'ally' && card.effect.type === 'inspire') {
    const range = card.effect.range;
    return Object.values(cs.combatants).filter((o) => o.side === a.side && o.id !== a.id && alive(o) && Math.abs(o.zone - a.zone) <= range && !o.aimed).map((o) => o.id);
  }
  if (card.target === 'ally') {
    const range = healRange(card);
    // 빈사(HP 0)인 아군도 치료 대상 — 치료받으면 정신을 차린다
    return Object.values(cs.combatants).filter((o) => o.side === a.side && !o.dead && Math.abs(o.zone - a.zone) <= range && o.hp < o.maxHp).map((o) => o.id);
  }
  if (card.target === 'area' && card.effect.type === 'area_save') {
    const range = card.effect.range;
    const zones = [...new Set(opponents(cs, a).map((o) => o.zone))].filter((z) => Math.abs(z - a.zone) <= range);
    return zones.sort((x, y) => x - y);
  }
  return opponents(cs, a).filter((o) => inRange(card, a, o)).map((o) => o.id);
}

/** 카드를 지금 쓸 수 없는 이유. 쓸 수 있으면 null. */
export function unusableReason(cs: CombatState, actorId: string, card: CardDef): string | null {
  const a = cs.combatants[actorId];
  if (!a) return '알 수 없는 전투원';
  if (cs.outcome) return '전투가 끝났다';
  if (currentActorId(cs) !== actorId) return '내 차례가 아니다';
  if (!alive(a)) return '쓰러진 상태';
  if (hasCondition(a, 'stunned')) return '기절해 행동할 수 없다';
  if (hasCondition(a, 'restrained') && (card.effect.type === 'move' || card.effect.type === 'flee' || card.effect.type === 'escape')) return '포박되어 움직일 수 없다';
  if (card.cost !== 'free' && !cs.economy[card.cost]) return { action: '행동을 이미 사용했다', bonus: '보너스 행동을 이미 사용했다', move: '이동을 이미 사용했다' }[card.cost];
  if (card.resource && (a.resources[card.resource]?.cur ?? 0) <= 0) return '남은 사용 횟수가 없다';
  if (card.spellLevel && slotFor(a, card.spellLevel) === null) return `${card.spellLevel}레벨 이상 주문 슬롯이 없다`;
  if (card.effect.type === 'aim' && !cs.economy.move) return '이번 차례에 이미 움직였다';
  if (card.effect.type === 'stand' && !a.prone) return '넘어져 있지 않다';
  if (card.effect.type === 'move' && a.prone) return '넘어져 있다 — 먼저 일어서야 한다';
  if (card.effect.type === 'disengage' && a.disengaged) return '이미 후퇴 중이다';
  if (card.effect.type === 'extra_action' && cs.economy.action) return '아직 행동이 남아 있다';
  if (card.effect.type === 'hide' && hostileInZone(cs, a)) return '같은 존에 적이 있어 숨을 수 없다';
  if (card.effect.type === 'flee') {
    if (a.zone !== 0) return '아군 후열에서만 도주할 수 있다';
    if (hostileInZone(cs, a)) return '같은 존에 적이 있어 도주할 수 없다';
  }
  if (card.effect.type === 'heal' && card.target === 'self' && a.hp >= a.maxHp) return 'HP가 가득 차 있다';
  if (card.effect.type === 'heal' && card.target === 'ally' && validTargets(cs, actorId, card).length === 0) return '사거리 안에 다친 아군이 없다';
  if (validTargets(cs, actorId, card).length === 0) return '사거리 안에 대상이 없다';
  return null;
}

// ---------------------------------------------------------------- 해결

/** "2d6+3" 피해 굴림. 치명타면 주사위 개수를 두 배로 굴린다. */
export function rollDamage(rng: Rng, notation: string, crit = false): { total: number; rolls: number[] } {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(notation.replace(/\s/g, ''));
  if (!m) throw new Error(`invalid damage: ${notation}`);
  const count = (m[1] ? Number(m[1]) : 1) * (crit ? 2 : 1);
  const rolls = Array.from({ length: count }, () => rollDie(rng, Number(m[2])));
  return { total: Math.max(0, rolls.reduce((s, r) => s + r, 0) + (m[3] ? Number(m[3]) : 0)), rolls };
}

function combineMode(adv: boolean, dis: boolean): RollMode {
  return adv && !dis ? 'advantage' : dis && !adv ? 'disadvantage' : 'normal';
}

/** "2d6" + "1d6" × n → "(2+n)d6" (같은 주사위만 합친다. 다르면 뒤에 붙인다) */
export function scaleDice(base: string, add: string | undefined, times: number): string {
  if (!add || times <= 0) return base;
  const b = /^(\d*)d(\d+)([+-]\d+)?$/.exec(base.replace(/\s/g, ''));
  const x = /^(\d*)d(\d+)$/.exec(add.replace(/\s/g, ''));
  if (b && x && b[2] === x[2]) return `${(b[1] ? Number(b[1]) : 1) + (x[1] ? Number(x[1]) : 1) * times}d${b[2]}${b[3] ?? ''}`;
  return base;
}

interface AttackResult {
  effects: CombatEffect[];
  line: string;
  damage: number;
  /** 거인 사냥꾼을 이번 굴림에 썼다 */
  colossus?: boolean;
}

/** 한 번의 공격 굴림 (여러 줄 공격은 이 함수를 반복 호출) */
function rollAttack(cs: CombatState, a: Combatant, t: Combatant, cardName: string, at: CardDef['effect'] & { type: 'attack' }, damage: string, rng: Rng, sneakAvailable: boolean, hpBefore: number): AttackResult {
  const spec = at.attack;
  const effects: CombatEffect[] = [];
  const abil = attackAbilityMod(a, spec.ability);
  const magic = spec.toHit === undefined && spec.ability !== 'spell';
  const toHit = spec.toHit ?? abil + a.profBonus + (magic ? a.gearAttack ?? 0 : 0);
  const pack = !!a.packTactics && Object.values(cs.combatants).some((o) => o.side === a.side && o.id !== a.id && alive(o) && o.zone === t.zone);
  const proneMelee = !!t.prone && spec.kind === 'melee';
  const proneRanged = !!t.prone && spec.kind === 'ranged';
  const tHelpless = (['stunned', 'restrained', 'blinded'] as const).find((k) => hasCondition(t, k));
  const aHindered = (['poisoned', 'frightened', 'restrained', 'blinded'] as const).find((k) => hasCondition(a, k));
  const adv = a.hidden || a.aimed || t.marked || pack || proneMelee || !!tHelpless;
  const engaged = spec.kind === 'ranged' && hostileInZone(cs, a) && !hasTrait(a, 'sharpshooter');
  const dis = t.dodging || engaged || !!a.prone || proneRanged || !!aHindered;
  const mode = combineMode(adv, dis);
  const r = d20Test(rng, toHit, t.ac, mode);
  const crit = !r.natural1 && r.kept >= (a.critRange ?? 20);
  const hit = !r.natural1 && (crit || r.success);
  const why = [a.hidden && '숨음', a.aimed && '조준', t.marked && '표식', pack && '무리 전술', proneMelee && '넘어진 대상', tHelpless && `대상 ${CONDITION_LABEL[tHelpless]}`, t.dodging && '대상 회피', engaged && '근접한 적', a.prone && '넘어짐', aHindered && CONDITION_LABEL[aHindered], proneRanged && '넘어진 대상'].filter(Boolean).join(', ');
  const modeText = mode === 'normal' ? '' : ` ${mode === 'advantage' ? '이점' : '불리점'}${why ? `(${why})` : ''}`;
  const head = `${a.name}의 ${cardName} → ${t.name}: d20(${r.rolls.join(', ')})${modeText} ${toHit >= 0 ? '+' : ''}${toHit} = ${r.total} vs AC ${t.ac}`;
  if (t.marked) effects.push({ kind: 'flag', target: t.id, marked: false });
  if (!hit) return { effects, line: `${head} → ${r.natural1 ? '대실패' : '빗나감'}`, damage: 0 };
  const dmgBonus = spec.damageBonus ?? (spec.ability === 'spell' ? (hasTrait(a, 'evoker') ? spellMod(a) : 0) : abil + (magic ? a.gearDamage ?? 0 : 0));
  const dmg = rollDamage(rng, damage, crit);
  let total = Math.max(0, dmg.total + dmgBonus);
  let extra = '';
  // 암습: 이점이 있거나, 불리점 없이 대상과 같은 존에 다른 아군이 있을 때 (SRD 5.2.1)
  const allyNearTarget = Object.values(cs.combatants).some((o) => o.side === a.side && o.id !== a.id && alive(o) && o.zone === t.zone);
  // 결투가: 대상이 그 존에 혼자 있으면 근접 암습
  const alone = spec.kind === 'melee' && hasTrait(a, 'duelist') && !Object.values(cs.combatants).some((o) => o.side === t.side && o.id !== t.id && alive(o) && o.zone === t.zone);
  if (sneakAvailable && a.sneakAttack && (mode === 'advantage' || (mode === 'normal' && (allyNearTarget || alone))) && (spec.kind === 'ranged' || spec.ability === 'finesse')) {
    const s = rollDamage(rng, a.sneakAttack, crit);
    total += s.total;
    extra = ` + 암습 ${s.total}`;
    effects.push({ kind: 'sneak_used' });
  }
  let colossus = false;
  // 거인 사냥꾼: 다친 적을 무기로 맞히면 1d8 (카드 한 장당 한 번)
  if (hasTrait(a, 'colossus') && spec.ability !== 'spell' && hpBefore < t.maxHp) {
    const c = rollDamage(rng, '1d8', crit);
    total += c.total;
    extra += ` + 거인 사냥꾼 ${c.total}`;
    colossus = true;
  }
  // 초감각 회피: 반응으로 피해 절반
  if (t.uncannyDodge && !t.reactionUsed && hpBefore > 0 && total > 0 && !hasCondition(t, 'stunned')) {
    total = Math.floor(total / 2);
    extra += ' → 초감각 회피로 절반';
    effects.push({ kind: 'flag', target: t.id, reactionUsed: true });
  }
  effects.push({ kind: 'hp', target: t.id, delta: -total, crit });
  if (at.mark) effects.push({ kind: 'flag', target: t.id, marked: true });
  // 넘어뜨리기: 살아남은 대상은 내성 굴림
  let proneText = '';
  if (at.knockProne && hpBefore - total > 0 && !t.prone) {
    const sr = saveTest(rng, t, at.knockProne.save, at.knockProne.dc, cs);
    if (!sr.success) effects.push({ kind: 'flag', target: t.id, prone: true });
    proneText = `, 넘어뜨리기 내성 ${sr.note || sr.total} vs DC ${at.knockProne.dc} → ${sr.success ? '버팀' : '넘어짐'}`;
  }
  if (at.inflict && hpBefore - total > 0) {
    const inf = tryInflict(rng, a, t, at.inflict, undefined, cs);
    effects.push(...inf.effects);
    proneText += inf.text;
  }
  return {
    effects, damage: total, colossus,
    line: `${head} → ${crit ? '치명타!' : '명중'} ${spec.damageType} 피해 ${total} (${dmg.rolls.join('+')}${dmgBonus ? `${dmgBonus > 0 ? '+' : ''}${dmgBonus}` : ''}${extra})${at.mark ? ', 표식' : ''}${hpBefore - total <= 0 ? ` — ${t.name} 쓰러짐` : ''}${proneText}`,
  };
}

/** 내성 피해 한 명분 */
function rollSave(a: Combatant, t: Combatant, cardName: string, save: Ability, damage: string, damageType: string, half: boolean, bonus: number, rng: Rng, fixedDc?: number, inflict?: Inflict, cs?: CombatState): { effects: CombatEffect[]; line: string } {
  const dc = fixedDc ?? spellSaveDc(a);
  const r = saveTest(rng, t, save, dc, cs);
  const head = `${a.name}의 ${cardName} → ${t.name}: 내성 ${r.note ? r.note : `d20(${r.kept}) ${r.mod >= 0 ? '+' : ''}${r.mod} = ${r.total}`} vs DC ${dc}`;
  // 피해 없는 순수 상태 이상 주문 (예: 인간 속박)
  if (!damageType) {
    const inf = inflict ? tryInflict(rng, a, t, inflict, !!r.success, cs) : { effects: [], text: '' };
    return { effects: inf.effects, line: `${head} → ${r.success ? '성공' : '실패'}${inf.text}` };
  }
  if (r.success && !half) return { effects: [], line: `${head} → 성공, 피해 없음` };
  // 회피 (로그 7레벨): 민첩 절반 피해는 성공 0, 실패 절반
  const evade = !!t.evasion && save === 'dex' && half && !hasCondition(t, 'stunned');
  if (evade && r.success) return { effects: [], line: `${head} → 성공, 회피로 피해 없음` };
  const full = rollDamage(rng, damage).total + bonus;
  const dealt = r.success || evade ? Math.floor(full / 2) : full;
  const survives = t.hp - dealt > 0;
  const inf = inflict && survives ? tryInflict(rng, a, t, inflict, !!r.success, cs) : { effects: [], text: '' };
  return {
    effects: [...(dealt > 0 ? [{ kind: 'hp', target: t.id, delta: -dealt } as CombatEffect] : []), ...inf.effects],
    line: `${head} → ${r.success ? '성공, 절반' : '실패,'} ${damageType} 피해 ${dealt}${survives ? '' : ` — ${t.name} 쓰러짐`}${r.success ? '' : inf.text}`,
  };
}

/** 카드 사용을 해결한다. 규칙 위반이면 예외. 상태는 바꾸지 않고 effects만 반환한다. */
export function resolveCard(cs: CombatState, actorId: string, cardId: string, target: Target, rng: Rng): Resolution {
  const card = cardOf(cs.combatants[actorId], cardId);
  if (!handOf(cs.combatants[actorId]!).some((c) => c.id === cardId)) throw new Error('손패에 없는 카드');
  const reason = unusableReason(cs, actorId, card);
  if (reason) throw new Error(reason);
  if (!validTargets(cs, actorId, card).includes(target)) throw new Error('유효하지 않은 대상');

  const a = cs.combatants[actorId]!;
  const effects: CombatEffect[] = [{ kind: 'spend', cost: card.cost }];
  const log: string[] = [];
  if (card.resource) effects.push({ kind: 'resource', target: a.id, key: card.resource, delta: -1 });
  // 주문 슬롯: 가능한 가장 낮은 슬롯. 높은 슬롯이면 올려 시전
  let up = 0;
  let slotNote = '';
  if (card.spellLevel) {
    const slot = slotFor(a, card.spellLevel)!;
    up = slot - card.spellLevel;
    effects.push({ kind: 'resource', target: a.id, key: `slot${slot}`, delta: -1 });
    slotNote = ` [${slot}레벨 슬롯${up ? `, ${up}단계 상승` : ''}]`;
  }
  const name = card.name + slotNote;
  const e = card.effect;
  // 이점 부여 상태(숨음·조준)는 공격 한 번에 소모된다
  const consumeSelf = () => {
    if (a.hidden || a.aimed) effects.push({ kind: 'flag', target: a.id, hidden: false, aimed: false });
  };

  switch (e.type) {
    case 'attack': {
      const t = cs.combatants[target as string]!;
      // 추가 공격: 무기 공격은 한 번 더
      const count = (e.count ?? 1) + (card.upcast?.count ?? 0) * up + (a.extraAttack && card.kind === 'weapon' ? 1 : 0);
      const damage = cantripDamage(card, a, scaleDice(e.attack.damage, card.upcast?.dice, up));
      let hp = t.hp;
      let sneak = !cs.sneakUsed;
      let reacted = !!t.reactionUsed;
      let conds = t.conditions;
      let actor = a;
      for (let i = 0; i < count; i++) {
        if (hp <= 0) break;
        const tNow = { ...t, hp, reactionUsed: reacted, conditions: conds };
        if (i > 0) actor = { ...actor, hidden: false, aimed: false };
        const r = rollAttack(i === 0 ? cs : { ...cs, combatants: { ...cs.combatants, [a.id]: actor, [t.id]: { ...tNow, marked: false } } }, actor, i === 0 ? tNow : { ...tNow, marked: false }, name, e, damage, rng, sneak, hp);
        if (r.colossus) actor = { ...actor, traits: actor.traits?.filter((x) => x !== 'colossus') };
        effects.push(...r.effects);
        if (r.effects.some((x) => x.kind === 'sneak_used')) sneak = false;
        if (r.effects.some((x) => x.kind === 'flag' && x.target === t.id && x.reactionUsed)) reacted = true;
        for (const x of r.effects) if (x.kind === 'condition' && x.target === t.id) conds = { ...conds, [x.condition]: x.rounds };
        hp -= r.damage;
        log.push(r.line);
      }
      consumeSelf();
      break;
    }
    case 'save_damage': {
      const t = cs.combatants[target as string]!;
      const r = rollSave(a, t, name, e.save, cantripDamage(card, a, scaleDice(e.damage, card.upcast?.dice, up)), e.damageType, !!e.half, evokeBonus(card, a, e.bonus), rng, e.dc, e.inflict, cs);
      effects.push(...r.effects);
      log.push(r.line);
      break;
    }
    case 'area_save': {
      const zone = target as number;
      const foes = opponents(cs, a).filter((o) => o.zone === zone);
      log.push(`${a.name}의 ${name}: ${ZONE_NAMES[zone]}의 적 ${foes.length}명`);
      for (const t of foes) {
        const r = rollSave(a, t, name, e.save, scaleDice(e.damage, card.upcast?.dice, up), e.damageType, e.half, evokeBonus(card, a, e.bonus), rng, e.dc, e.inflict, cs);
        effects.push(...r.effects);
        log.push(`  ${r.line}`);
      }
      break;
    }
    case 'auto_damage': {
      const t = cs.combatants[target as string]!;
      const count = e.count + (card.upcast?.count ?? 0) * up;
      const parts = Array.from({ length: count }, () => rollDamage(rng, e.damage).total);
      const total = parts.reduce((s, x) => s + x, 0);
      effects.push({ kind: 'hp', target: t.id, delta: -total });
      log.push(`${a.name}의 ${name} → ${t.name}: ${e.damageType} 피해 ${total} (${parts.join('+')})${t.hp - total <= 0 ? ` — ${t.name} 쓰러짐` : ''}`);
      break;
    }
    case 'heal': {
      const t = cs.combatants[(target as string) ?? a.id]!;
      const h = rollDamage(rng, scaleDice(e.dice, card.upcast?.dice, up)).total + (e.add === 'spell' ? spellMod(a) : e.add === 'level' ? a.level : 0)
        + (hasTrait(a, 'life') && card.spellLevel ? 2 + card.spellLevel + up : 0); // 생명의 제자
      const healed = Math.min(t.maxHp - t.hp, Math.max(0, h));
      effects.push({ kind: 'hp', target: t.id, delta: healed });
      const cured = (e.cures ?? []).filter((k) => hasCondition(t, k));
      for (const k of cured) effects.push({ kind: 'condition', target: t.id, condition: k, rounds: 0 });
      log.push(`${a.name}의 ${name}${t.id === a.id ? '' : ` → ${t.name}`}: HP ${healed} 회복 (${t.hp} → ${t.hp + healed})${cured.length ? `, ${cured.map((k) => CONDITION_LABEL[k]).join('·')} 풀림` : ''}`);
      break;
    }
    case 'move': {
      // 기회 공격: 떠나는 존의 적이 반응으로 근접 공격 1회씩 (후퇴 중이면 면제)
      let hp = a.hp;
      let knocked = false;
      let aReacted = !!a.reactionUsed;
      if (!a.disengaged) {
        for (const foe of opponents(cs, a).filter((o) => o.zone === a.zone && !o.reactionUsed)) {
          const melee = handOf(foe).find((c) => c.effect.type === 'attack' && c.effect.attack.kind === 'melee');
          if (!melee || melee.effect.type !== 'attack' || hp <= 0) continue;
          effects.push({ kind: 'flag', target: foe.id, reactionUsed: true });
          const r = rollAttack(cs, foe, { ...a, hp, reactionUsed: aReacted }, `기회 공격(${melee.name})`, melee.effect, melee.effect.attack.damage, rng, false, hp);
          effects.push(...r.effects.filter((x) => x.kind !== 'sneak_used'));
          if (r.effects.some((x) => x.kind === 'flag' && x.target === a.id && x.reactionUsed)) aReacted = true;
          if (r.effects.some((x) => x.kind === 'flag' && x.prone)) knocked = true;
          hp -= r.damage;
          log.push(r.line);
        }
      }
      if (hp <= 0 || knocked) {
        log.push(`${a.name}: 이동하지 못했다`);
        break;
      }
      effects.push({ kind: 'zone', target: a.id, zone: target as number });
      log.push(`${a.name}: ${ZONE_NAMES[a.zone]} → ${ZONE_NAMES[target as number]} (${name})`);
      break;
    }
    case 'disengage': {
      effects.push({ kind: 'flag', target: a.id, disengaged: true });
      log.push(`${a.name}: ${name} — 이번 차례에는 기회 공격을 받지 않는다`);
      break;
    }
    case 'stand': {
      effects.push({ kind: 'flag', target: a.id, prone: false });
      log.push(`${a.name}: 일어섰다`);
      break;
    }
    case 'mark': {
      const t = cs.combatants[target as string]!;
      effects.push({ kind: 'flag', target: t.id, marked: true });
      log.push(`${a.name}: ${name} → ${t.name} — 다음 공격이 이점`);
      break;
    }
    case 'protect': {
      const t = cs.combatants[target as string]!;
      effects.push({ kind: 'flag', target: t.id, dodging: true });
      log.push(`${a.name}: ${name} → ${t.name} — 다음 차례까지 그를 노리는 공격에 불리점`);
      break;
    }
    case 'inspire': {
      const t = cs.combatants[target as string]!;
      effects.push({ kind: 'flag', target: t.id, aimed: true });
      log.push(`${a.name}: ${name} → ${t.name} — 다음 공격이 이점`);
      break;
    }
    case 'dodge': {
      effects.push({ kind: 'flag', target: a.id, dodging: true });
      log.push(`${a.name}: 회피 자세`);
      break;
    }
    case 'hide': {
      const r = d20Test(rng, a.stealthBonus, 15, hasTrait(a, 'stealth_adv') ? 'advantage' : 'normal');
      if (r.success) effects.push({ kind: 'flag', target: a.id, hidden: true });
      log.push(`${a.name}: ${name} — 은신 d20(${r.kept}) ${a.stealthBonus >= 0 ? '+' : ''}${a.stealthBonus} = ${r.total} vs DC 15 → ${r.success ? '성공' : '실패'}`);
      break;
    }
    case 'aim': {
      effects.push({ kind: 'spend', cost: 'move' }, { kind: 'flag', target: a.id, aimed: true });
      log.push(`${a.name}: ${name} — 다음 공격에 이점`);
      break;
    }
    case 'extra_action': {
      effects.push({ kind: 'gain_action' });
      log.push(`${a.name}: ${name} — 행동을 한 번 더 얻었다`);
      break;
    }
    case 'flee': {
      effects.push({ kind: 'fled' });
      log.push(`${a.name}: 전장에서 벗어났다`);
      break;
    }
    case 'escape': {
      effects.push({ kind: 'escaped', target: a.id });
      log.push(`${a.name}: 꽁무니를 빼고 달아났다`);
      break;
    }
  }
  phaseCheck(cs, effects, log);
  return { effects, log };
}

/** 보스 단계: 이번 행동으로 적의 HP가 단계 기준선을 넘어 떨어졌으면 다음 단계로 (쓰러진 경우는 제외) */
function phaseCheck(cs: CombatState, effects: CombatEffect[], log: string[]) {
  const delta: Record<string, number> = {};
  for (const e of effects) if (e.kind === 'hp') delta[e.target] = (delta[e.target] ?? 0) + e.delta;
  for (const [id, d] of Object.entries(delta)) {
    const c = cs.combatants[id];
    const phases = c?.phases ?? (c?.monsterId ? MONSTERS[c.monsterId]?.phases : undefined);
    if (!c || !phases?.length || d >= 0) continue;
    const after = Math.max(0, c.hp + d);
    let index = c.phase ?? 0;
    while (index < phases.length && after > 0 && after <= phases[index]!.below * c.maxHp && c.hp > phases[index]!.below * c.maxHp - 0) {
      effects.push({ kind: 'phase', target: id, index: index + 1 });
      log.push(`⚡ ${phases[index]!.line}`);
      index++;
    }
  }
}

/** effects 적용 후 승패 판정 */
export function applyEffects(cs: CombatState, effects: CombatEffect[]): CombatState {
  const next: CombatState = structuredClone(cs);
  for (const e of effects) {
    switch (e.kind) {
      case 'hp': {
        const c = next.combatants[e.target]!;
        const before = c.hp;
        if (c.side === 'party' && !c.dead) {
          if (before <= 0 && e.delta < 0) {
            // 빈사 중 피해: 죽음 내성 실패 (치명타는 2회)
            c.deathSaves = { success: c.deathSaves?.success ?? 0, fail: (c.deathSaves?.fail ?? 0) + (e.crit ? 2 : 1) };
            c.stable = false;
            if (c.deathSaves.fail >= 3) c.dead = true;
          } else if (before > 0 && before + e.delta <= -c.maxHp) {
            c.dead = true; // 즉사: 남은 피해가 최대 HP 이상
          }
          if (before <= 0 && e.delta > 0) { c.deathSaves = undefined; c.stable = false; }
        }
        if (c.dead) { c.hp = 0; break; }
        c.hp = Math.max(0, Math.min(c.maxHp, c.hp + e.delta));
        if (c.hp <= 0 && before > 0) { c.prone = true; c.deathSaves = c.side === 'party' ? { success: 0, fail: 0 } : undefined; }
        break;
      }
      case 'death_save': {
        const c = next.combatants[e.target]!;
        const ds = { success: (c.deathSaves?.success ?? 0) + e.success, fail: (c.deathSaves?.fail ?? 0) + e.fail };
        c.deathSaves = ds;
        if (ds.fail >= 3) c.dead = true;
        else if (ds.success >= 3) c.stable = true;
        break;
      }
      case 'zone': next.combatants[e.target]!.zone = e.zone; break;
      case 'flag': {
        const c = next.combatants[e.target]!;
        if (e.dodging !== undefined) c.dodging = e.dodging;
        if (e.hidden !== undefined) c.hidden = e.hidden;
        if (e.aimed !== undefined) c.aimed = e.aimed;
        if (e.marked !== undefined) c.marked = e.marked;
        if (e.reactionUsed !== undefined) c.reactionUsed = e.reactionUsed;
        if (e.disengaged !== undefined) c.disengaged = e.disengaged;
        if (e.prone !== undefined) c.prone = e.prone;
        break;
      }
      case 'spend': if (e.cost !== 'free') next.economy[e.cost] = false; break;
      case 'gain_action': next.economy.action = true; break;
      case 'resource': {
        const r = next.combatants[e.target]!.resources[e.key];
        if (r) r.cur = Math.max(0, Math.min(r.max, r.cur + e.delta));
        break;
      }
      case 'sneak_used': next.sneakUsed = true; break;
      case 'fled': next.outcome = 'fled'; break;
      case 'escaped': { const c = next.combatants[e.target]!; c.escaped = true; c.hp = 0; break; }
      case 'condition': {
        const c = next.combatants[e.target]!;
        const conds = { ...(c.conditions ?? {}) };
        if (e.rounds > 0) conds[e.condition] = e.rounds; else delete conds[e.condition];
        c.conditions = conds;
        break;
      }
      case 'phase': {
        const c = next.combatants[e.target]!;
        const ph = (c.phases ?? (c.monsterId ? MONSTERS[c.monsterId]?.phases : undefined))?.[e.index - 1];
        c.phase = e.index;
        if (ph) {
          c.cards = [...c.cards, ...(ph.addCards ?? []).map((x) => x.id)];
          if (ph.ac) c.ac += ph.ac;
        }
        break;
      }
    }
  }
  if (!next.outcome) {
    const all = Object.values(next.combatants);
    // 패배: 아군 전원이 쓰러졌고, 빈사 중인 사람도 없을 때 (안정 또는 사망). 빈사 중이면 죽음 내성을 계속 굴린다.
    if (all.filter((c) => c.side === 'party').every((c) => !alive(c) && !dying(c))) next.outcome = 'defeat';
    else if (all.filter((c) => c.side === 'enemy').every((c) => !alive(c))) next.outcome = 'victory';
  }
  return next;
}

/** 다음 살아 있는 전투원의 차례로 넘긴다. 회피 자세는 자기 차례가 시작될 때 풀린다. */
export function endTurn(cs: CombatState): CombatState {
  const next: CombatState = structuredClone(cs);
  const ending = next.combatants[currentActorId(next)]!;
  ending.disengaged = false;
  // 상태 이상: 걸린 대상의 차례가 끝날 때 1라운드씩 줄어든다
  if (ending.conditions) {
    const left: Partial<Record<Condition, number>> = {};
    for (const [k, n] of Object.entries(ending.conditions)) if ((n ?? 0) > 1) left[k as Condition] = n! - 1;
    ending.conditions = left;
  }
  for (let i = 0; i < next.order.length; i++) {
    next.turnIndex = (next.turnIndex + 1) % next.order.length;
    if (next.turnIndex === 0) next.round++;
    const c = next.combatants[currentActorId(next)]!;
    if (alive(c) || dying(c)) break; // 빈사 상태의 아군도 차례를 받는다 (죽음 내성)
  }
  const cur = next.combatants[currentActorId(next)]!;
  cur.dodging = false;
  cur.reactionUsed = false;
  next.economy = { ...FRESH };
  next.sneakUsed = false;
  return next;
}

// ---------------------------------------------------------------- 적 AI (규칙 기반, LLM 미사용)

export interface PlannedAction {
  cardId: string;
  target: Target;
}

/**
 * 적의 다음 행동을 결정한다. 더 할 것이 없으면 null (턴 종료).
 * 우선순위: 공격 가능하면 HP가 가장 낮은 대상 공격 → 아니면 가장 가까운 대상 쪽으로 이동 → 질주.
 * 원거리 선호 몬스터는 사거리 안에 대상이 있으면 이동하지 않고 쏜다.
 */
export function planEnemyAction(cs: CombatState): PlannedAction | null {
  const id = currentActorId(cs);
  const a = cs.combatants[id]!;
  if (a.side !== 'enemy' || cs.outcome || hasCondition(a, 'stunned')) return null;
  const hand = handOf(a);
  const attacks = hand.filter((c) => c.effect.type === 'attack' && !unusableReason(cs, id, c));
  const pick = (cards: CardDef[]) => {
    let best: PlannedAction | null = null;
    let bestHp = Infinity;
    for (const c of cards) for (const t of validTargets(cs, id, c)) {
      const hp = cs.combatants[t as string]!.hp;
      if (hp < bestHp) { bestHp = hp; best = { cardId: c.id, target: t }; }
    }
    return best;
  };
  const isRanged = (c: CardDef) => c.effect.type === 'attack' && c.effect.attack.kind === 'ranged';
  // 넘어졌으면 먼저 일어선다
  if (a.prone && cs.economy.move && !hasCondition(a, 'restrained')) return { cardId: 'basic/stand', target: a.id };
  // 크게 다치면 달아난다 (도망치는 적만)
  if (a.fleeAt && a.hp <= a.fleeAt * a.maxHp && cs.economy.action && !unusableReason(cs, id, ESCAPE_CARD)) return { cardId: ESCAPE_CARD.id, target: id };
  // 특수 기술 (내성 피해·범위): 쓸 수 있으면 먼저 — 범위는 상대가 가장 많은 존, 단일은 HP가 가장 낮은 대상
  for (const c of hand.filter((x) => (x.effect.type === 'save_damage' || x.effect.type === 'area_save') && !unusableReason(cs, id, x))) {
    const ts = validTargets(cs, id, c);
    if (!ts.length) continue;
    if (c.effect.type === 'area_save') {
      const count = (z: Target) => opponents(cs, a).filter((o) => o.zone === z && alive(o)).length;
      const best = [...ts].sort((x, y) => count(y) - count(x))[0]!;
      if (count(best) > 0) return { cardId: c.id, target: best };
    } else {
      const best = [...ts].sort((x, y) => cs.combatants[x as string]!.hp - cs.combatants[y as string]!.hp)[0]!;
      return { cardId: c.id, target: best };
    }
  }
  // 원거리형이 붙잡히면: 보너스 행동 후퇴 → 뒤로 빠진 뒤 쏜다 (고블린의 재빠른 도주)
  if (a.preferRanged && hostileInZone(cs, a) && a.zone < ZONE_COUNT - 1) {
    const escape = hand.find((c) => c.effect.type === 'disengage' && c.cost === 'bonus' && !unusableReason(cs, id, c));
    if (escape) return { cardId: escape.id, target: id };
    if (a.disengaged && cs.economy.move) return { cardId: 'basic/move', target: a.zone + 1 };
  }
  // 원거리형은 이미 쏘았으면 다가가지 않는다
  if (a.preferRanged && !cs.economy.action) return null;
  const melee = pick(attacks.filter((c) => !isRanged(c)));
  const ranged = pick(attacks.filter(isRanged));
  if (a.preferRanged && ranged && !hostileInZone(cs, a)) return ranged;
  if (melee) return melee;
  if (ranged && (a.preferRanged || !cs.economy.move)) return ranged;

  // 이동: 가장 가까운 상대 쪽으로
  const foes = opponents(cs, a);
  if (!foes.length) return null;
  const nearest = foes.reduce((n, f) => (Math.abs(f.zone - a.zone) < Math.abs(n.zone - a.zone) ? f : n));
  if (nearest.zone === a.zone) return ranged;
  const step = a.zone + Math.sign(nearest.zone - a.zone);
  for (const cardId of ['basic/move', 'basic/dash']) {
    const c = cardById(cardId);
    if (!unusableReason(cs, id, c) && validTargets(cs, id, c).includes(step)) {
      // 이동을 먼저 쓰고, 그래도 닿지 않으면 행동으로 질주한다
      return { cardId, target: step };
    }
  }
  return ranged;
}

// ---------------------------------------------------------------- 동료 AI (규칙 기반 + 플레이어 명령)

/**
 * 동료 전술 명령 (설계 리뷰 11.6절)
 * - free:      자율. 가장 약한 적을 노린다
 * - focus:     지정한 적을 집중 공격
 * - guard:     플레이어 곁을 지키며 플레이어와 같은 존의 적부터 공격
 * - hold_back: 후열에 머물며 원거리로만 싸운다
 * conserve:    주문 슬롯 등 자원을 아낀다 (위급한 치료는 예외)
 */
export interface PartyOrder {
  mode: 'free' | 'focus' | 'guard' | 'hold_back';
  focus?: string;
  conserve: boolean;
}

export const DEFAULT_ORDER: PartyOrder = { mode: 'free', conserve: false };

const isAttackCard = (c: CardDef) => c.effect.type === 'attack' || c.effect.type === 'save_damage' || c.effect.type === 'auto_damage';
const usesResource = (c: CardDef) => !!c.resource || !!c.spellLevel;
const isRangedCard = (c: CardDef) =>
  (c.effect.type === 'attack' && c.effect.attack.kind === 'ranged') || c.effect.type === 'save_damage' || c.effect.type === 'auto_damage';

export function planCompanionAction(cs: CombatState, order: PartyOrder = DEFAULT_ORDER): PlannedAction | null {
  const id = currentActorId(cs);
  const a = cs.combatants[id]!;
  if (a.side !== 'party' || a.isPlayer || cs.outcome || hasCondition(a, 'stunned')) return null;
  const usable = handOf(a).filter((c) => !unusableReason(cs, id, c));
  const party = Object.values(cs.combatants).filter((o) => o.side === 'party' && alive(o));
  const critical = (c: Combatant) => c.hp <= c.maxHp / 3;
  if (a.prone && cs.economy.move) return { cardId: 'basic/stand', target: a.id };

  // 0) 빈사 아군 살리기: 치료 카드로 쓰러진 아군을 일으킨다 (무엇보다 우선)
  for (const card of usable.filter((c) => c.effect.type === 'heal' && c.target === 'ally')) {
    const down = validTargets(cs, id, card).map((t) => cs.combatants[t as string]!).find((o) => o.hp <= 0 && !o.dead);
    if (down) return { cardId: card.id, target: down.id };
  }

  // 1) 치료: 위급한 아군(자원 아끼기여도 예외)
  for (const card of usable.filter((c) => c.effect.type === 'heal')) {
    const ts = validTargets(cs, id, card).map((t) => cs.combatants[t as string]!).filter(critical);
    if (ts.length) {
      const t = ts.reduce((m, x) => (x.hp / x.maxHp < m.hp / m.maxHp ? x : m));
      return { cardId: card.id, target: t.id };
    }
  }

  // 2) 공격
  const player = cs.combatants.player!;
  let attacks = usable.filter(isAttackCard);
  if (order.conserve) attacks = attacks.filter((c) => !usesResource(c));
  if (order.mode === 'hold_back') attacks = attacks.filter(isRangedCard);
  const choose = (cards: CardDef[], filter: (t: Combatant) => boolean) => {
    let best: PlannedAction | null = null;
    let bestHp = Infinity;
    for (const c of cards) for (const t of validTargets(cs, id, c)) {
      if (typeof t !== 'string') continue; // 범위 주문은 동료 AI가 쓰지 않는다
      const tc = cs.combatants[t]!;
      if (filter(tc) && tc.hp < bestHp) { bestHp = tc.hp; best = { cardId: c.id, target: t }; }
    }
    return best;
  };
  // 근접 무기를 쓸 수 있으면 원거리 주문보다 우선 (소마법·무기는 자원 무료)
  const ordered = [...attacks.filter((c) => !isRangedCard(c)), ...attacks.filter(isRangedCard)];
  const focusAlive = order.mode === 'focus' && order.focus && cs.combatants[order.focus] && alive(cs.combatants[order.focus]!);
  if (focusAlive) {
    const f = choose(ordered, (t) => t.id === order.focus);
    if (f) return f;
  } else if (order.mode === 'guard') {
    const g = choose(ordered, (t) => t.zone === player.zone);
    if (g) return g;
  }
  if (!focusAlive || !cs.economy.move) {
    const any = choose(ordered, () => true);
    if (any && (order.mode !== 'guard' || !opponents(cs, a).some((o) => o.zone === player.zone))) return any;
  }

  // 행동 연쇄: 행동을 다 썼고 근접한 적이 있으면
  const surge = usable.find((c) => c.effect.type === 'extra_action');
  if (surge && !cs.economy.action && hostileInZone(cs, a) && !order.conserve) return { cardId: surge.id, target: a.id };

  // 3) 이동
  if (cs.economy.move || cs.economy.action) {
    let dest: number | null = null;
    if (order.mode === 'hold_back') dest = 0;
    else if (order.mode === 'guard') dest = player.zone;
    else {
      const goal = focusAlive ? cs.combatants[order.focus!]! : opponents(cs, a).reduce<Combatant | null>((n, f) => (!n || Math.abs(f.zone - a.zone) < Math.abs(n.zone - a.zone) ? f : n), null);
      if (goal && !ordered.some((c) => validTargets(cs, id, c).includes(goal.id))) dest = goal.zone;
    }
    if (dest !== null && dest !== a.zone) {
      const step = a.zone + Math.sign(dest - a.zone);
      // 적에게 붙잡힌 채 물러나야 하면 먼저 후퇴 (보너스 → 행동 순)
      if (cs.economy.move && hostileInZone(cs, a) && !a.disengaged) {
        const bonusEscape = usable.find((c) => c.effect.type === 'disengage' && c.cost === 'bonus');
        if (bonusEscape) return { cardId: bonusEscape.id, target: a.id };
        if (order.mode === 'hold_back' && usable.some((c) => c.id === 'basic/disengage')) return { cardId: 'basic/disengage', target: a.id };
      }
      if (cs.economy.move && validTargets(cs, id, cardById('basic/move')).includes(step) && !unusableReason(cs, id, cardById('basic/move'))) return { cardId: 'basic/move', target: step };
    }
  }
  // 할 일이 없으면, 적과 붙어 있을 때는 회피
  if (cs.economy.action && hostileInZone(cs, a) && !usable.some(isAttackCard)) return { cardId: 'basic/dodge', target: a.id };
  if (cs.economy.action && party.length && critical(a) && usable.some((c) => c.id === 'basic/dodge') && !usable.some(isAttackCard)) return { cardId: 'basic/dodge', target: a.id };
  return null;
}

/** 빈사 아군의 죽음 내성 굴림 (SRD 5.2.1) */
export function rollDeathSave(c: Combatant, rng: Rng): Resolution {
  const roll = rollDie(rng, 20);
  const ds = c.deathSaves ?? { success: 0, fail: 0 };
  if (roll === 20) {
    return { effects: [{ kind: 'hp', target: c.id, delta: 1 }], log: [`${c.name}: 죽음 내성 d20(20) → 기적처럼 정신을 차렸다 (HP 1)`] };
  }
  const success = roll >= 10 ? 1 : 0;
  const fail = roll === 1 ? 2 : roll < 10 ? 1 : 0;
  const s2 = ds.success + success, f2 = ds.fail + fail;
  const tail = f2 >= 3 ? ' — 숨이 멎었다' : s2 >= 3 ? ' — 안정되었다' : '';
  return {
    effects: [{ kind: 'death_save', target: c.id, success, fail }],
    log: [`${c.name}: 죽음 내성 d20(${roll}) → ${success ? '성공' : roll === 1 ? '실패 2회' : '실패'} (성공 ${Math.min(3, s2)} · 실패 ${Math.min(3, f2)})${tail}`],
  };
}

export type CombatStep =
  | { kind: 'action'; actorId: string; cardId: string; target: Target; resolution: Resolution; rngState: number }
  | { kind: 'end_turn' };

/**
 * 플레이어가 아닌 전투원(적·동료)의 차례를 플레이어 차례가 오거나 전투가 끝날 때까지 자동 진행한다.
 * 플레이어가 쓰러져 있으면 플레이어 차례도 건너뛴다.
 */
export function runAutoTurns(cs: CombatState, rng: Rng, orders: Record<string, PartyOrder> = {}): { state: CombatState; steps: CombatStep[] } {
  let state = cs;
  const steps: CombatStep[] = [];
  for (let guard = 0; guard < 400 && !state.outcome; guard++) {
    const actor = state.combatants[currentActorId(state)]!;
    if (actor.isPlayer && alive(actor)) break;
    if (dying(actor)) {
      const resolution = rollDeathSave(actor, rng);
      state = applyEffects(state, resolution.effects);
      steps.push({ kind: 'action', actorId: actor.id, cardId: 'system/death_save', target: actor.id, resolution, rngState: rng.state() });
      if (!state.outcome) { state = endTurn(state); steps.push({ kind: 'end_turn' }); }
      continue;
    }
    const plan = !alive(actor) ? null
      : actor.side === 'enemy' ? planEnemyAction(state)
      : actor.isPlayer ? null
      : planCompanionAction(state, orders[actor.id] ?? DEFAULT_ORDER);
    if (!plan) {
      state = endTurn(state);
      steps.push({ kind: 'end_turn' });
      continue;
    }
    let resolution: Resolution;
    try {
      resolution = resolveCard(state, actor.id, plan.cardId, plan.target, rng);
    } catch {
      // 안전장치: AI가 잘못된 행동을 계획하면 그 차례를 끝낸다 (전투가 멈추지 않도록)
      state = endTurn(state);
      steps.push({ kind: 'end_turn' });
      continue;
    }
    state = applyEffects(state, resolution.effects);
    steps.push({ kind: 'action', actorId: actor.id, cardId: plan.cardId, target: plan.target, resolution, rngState: rng.state() });
  }
  return { state, steps };
}


/** @deprecated runAutoTurns 사용 */
export const runEnemyTurns = (cs: CombatState, rng: Rng) => runAutoTurns(cs, rng);
