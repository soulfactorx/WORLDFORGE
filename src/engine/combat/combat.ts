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
 * 상태 이상: 넘어짐 (근접 공격은 이점·원거리는 불리점으로 당하고, 자신의 공격은 불리점, 이동하려면 일어서야 함).
 */
import type { Ability } from '../character/rules';
import { type Abilities, type CharacterSheet, resourcesOf } from '../character/sheet';
import { abilityModifier, d20Test, type RollMode } from '../dice/dice';
import { type Rng, rollDie } from '../dice/rng';
import { proficiencyBonus, SKILLS } from '../character/rules';
import { BASIC_CARDS, type CardDef, CLASS_CARDS, CLASS_KITS, type Cost, kitCards, WEAPON_CARDS } from './cards';
import { MONSTERS } from './monsters';

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
}

export interface Economy {
  action: boolean;
  bonus: boolean;
  move: boolean;
}

export interface CombatState {
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
  | { kind: 'fled' };

export interface Resolution {
  effects: CombatEffect[];
  log: string[];
}

// ---------------------------------------------------------------- 카드 조회

const MONSTER_CARDS = Object.values(MONSTERS).flatMap((m) => m.cards);
export const ALL_CARDS: Record<string, CardDef> = Object.fromEntries(
  [...BASIC_CARDS, ...WEAPON_CARDS, ...CLASS_CARDS, ...MONSTER_CARDS].map((c) => [c.id, c]),
);

export function cardById(id: string): CardDef {
  const c = ALL_CARDS[id];
  if (!c) throw new Error(`unknown card: ${id}`);
  return c;
}

/** 손패: 기본 행동 + 캐릭터 카드. 몬스터는 기본 행동 중 이동·질주만 쓴다. */
export function handOf(c: Combatant): CardDef[] {
  const basics = c.side === 'party' ? BASIC_CARDS.map((b) => b.id) : ['basic/move', 'basic/dash', 'basic/stand'];
  return [...c.cards, ...basics].map(cardById);
}

// ---------------------------------------------------------------- 시작

export function playerCombatant(sheet: CharacterSheet): Combatant {
  return sheetCombatant(sheet, 'player', sheet.name || '당신', true, 1);
}

/** 캐릭터 시트(플레이어·동료)로 전투원 생성 */
export function sheetCombatant(sheet: CharacterSheet, id: string, name: string, isPlayer: boolean, zone: number): Combatant {
  const kit = CLASS_KITS[sheet.classId] ?? CLASS_KITS.none!;
  const dex = abilityModifier(sheet.abilities.dex);
  const pb = proficiencyBonus(sheet.level);
  return {
    id, name, side: 'party', isPlayer, zone,
    hp: sheet.hp, maxHp: sheet.maxHp, ac: kit.ac(dex), level: sheet.level, abilities: { ...sheet.abilities },
    profBonus: pb, saveProfs: [...sheet.saveProficiencies],
    stealthBonus: abilityModifier(sheet.abilities[SKILLS.stealth.ability]) + (sheet.skillProficiencies.includes('stealth') ? pb : 0),
    spellAbility: kit.spellAbility, cards: kitCards(kit, sheet.level), resources: structuredClone(resourcesOf(sheet)),
    dodging: false, hidden: false, initiative: 0,
    sneakAttack: kit.sneakAttack ? `${Math.ceil(sheet.level / 2)}d6` : undefined, // 암습 1d6(1~2레벨), 2d6(3~4레벨)
    critRange: sheet.classId === 'fighter' && sheet.level >= 3 ? 19 : 20, // 투사: 향상된 치명타
  };
}

/** 이 레벨 이상의 사용 가능한 가장 낮은 주문 슬롯 레벨 */
export function slotFor(c: Combatant, minLevel: number): number | null {
  for (let lv = minLevel; lv <= 9; lv++) if ((c.resources[`slot${lv}`]?.cur ?? 0) > 0) return lv;
  return null;
}

export function monsterCombatant(monsterId: string, index: number, zone: number): Combatant {
  const m = MONSTERS[monsterId];
  if (!m) throw new Error(`unknown monster: ${monsterId}`);
  return {
    id: `${monsterId}#${index}`, name: `${m.name} ${index}`, side: 'enemy', isPlayer: false, zone,
    hp: m.hp, maxHp: m.hp, ac: m.ac, level: 1, abilities: { ...m.abilities }, profBonus: 2, saveProfs: [],
    stealthBonus: abilityModifier(m.abilities.dex), cards: m.cards.map((c) => c.id), resources: {},
    dodging: false, hidden: false, packTactics: m.packTactics, preferRanged: m.preferRanged, initiative: 0,
  };
}

const FRESH: Economy = { action: true, bonus: true, move: true };

/** 전투 시작: 우선권 굴림(d20 + 민첩 수정치) 후 순서 결정 */
export interface CompanionEntry {
  id: string;
  name: string;
  sheet: CharacterSheet;
  order?: PartyOrder;
}

/** 동료의 시작 존: 후방 유지 명령이거나 위저드면 후열, 아니면 전열 */
function companionStartZone(c: CompanionEntry): number {
  return c.order?.mode === 'hold_back' || c.sheet.classId === 'wizard' ? 0 : 1;
}

export function startCombat(enc: EncounterSpec, sheet: CharacterSheet, rng: Rng, companions: CompanionEntry[] = []): CombatState {
  const list: Combatant[] = [playerCombatant(sheet)];
  for (const c of companions) {
    if (c.sheet.hp > 0) list.push(sheetCombatant(c.sheet, c.id, c.name, false, companionStartZone(c)));
  }
  const counts: Record<string, number> = {};
  for (const e of enc.enemies) {
    counts[e.monsterId] = (counts[e.monsterId] ?? 0) + 1;
    list.push(monsterCombatant(e.monsterId, counts[e.monsterId]!, Math.min(ZONE_COUNT - 1, Math.max(2, e.zone))));
  }
  for (const c of list) c.initiative = rollDie(rng, 20) + abilityModifier(c.abilities.dex);
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

function attackAbilityMod(c: Combatant, a: 'str' | 'dex' | 'finesse' | 'spell'): number {
  if (a === 'finesse') return Math.max(mod(c, 'str'), mod(c, 'dex'));
  if (a === 'spell') return spellMod(c);
  return mod(c, a);
}

function inRange(card: CardDef, actor: Combatant, target: Combatant): boolean {
  const e = card.effect;
  const dist = Math.abs(actor.zone - target.zone);
  if (e.type === 'attack') return e.attack.kind === 'melee' ? dist === 0 : dist <= e.attack.range;
  if (e.type === 'save_damage' || e.type === 'auto_damage') return dist <= e.range;
  return false;
}

const healRange = (card: CardDef) => (card.effect.type === 'heal' ? card.effect.range ?? 0 : 0);

/** 카드의 유효 대상 목록 */
export function validTargets(cs: CombatState, actorId: string, card: CardDef): Target[] {
  const a = cs.combatants[actorId]!;
  if (card.target === 'self') return [actorId];
  if (card.target === 'zone') return [a.zone - 1, a.zone + 1].filter((z) => z >= 0 && z < ZONE_COUNT);
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
}

/** 한 번의 공격 굴림 (여러 줄 공격은 이 함수를 반복 호출) */
function rollAttack(cs: CombatState, a: Combatant, t: Combatant, cardName: string, at: CardDef['effect'] & { type: 'attack' }, damage: string, rng: Rng, sneakAvailable: boolean, hpBefore: number): AttackResult {
  const spec = at.attack;
  const effects: CombatEffect[] = [];
  const abil = attackAbilityMod(a, spec.ability);
  const toHit = spec.toHit ?? abil + a.profBonus;
  const pack = !!a.packTactics && Object.values(cs.combatants).some((o) => o.side === a.side && o.id !== a.id && alive(o) && o.zone === t.zone);
  const proneMelee = !!t.prone && spec.kind === 'melee';
  const proneRanged = !!t.prone && spec.kind === 'ranged';
  const adv = a.hidden || a.aimed || t.marked || pack || proneMelee;
  const engaged = spec.kind === 'ranged' && hostileInZone(cs, a);
  const dis = t.dodging || engaged || !!a.prone || proneRanged;
  const mode = combineMode(adv, dis);
  const r = d20Test(rng, toHit, t.ac, mode);
  const crit = !r.natural1 && r.kept >= (a.critRange ?? 20);
  const hit = !r.natural1 && (crit || r.success);
  const why = [a.hidden && '숨음', a.aimed && '조준', t.marked && '표식', pack && '무리 전술', proneMelee && '넘어진 대상', t.dodging && '대상 회피', engaged && '근접한 적', a.prone && '넘어짐', proneRanged && '넘어진 대상'].filter(Boolean).join(', ');
  const modeText = mode === 'normal' ? '' : ` ${mode === 'advantage' ? '이점' : '불리점'}${why ? `(${why})` : ''}`;
  const head = `${a.name}의 ${cardName} → ${t.name}: d20(${r.rolls.join(', ')})${modeText} ${toHit >= 0 ? '+' : ''}${toHit} = ${r.total} vs AC ${t.ac}`;
  if (t.marked) effects.push({ kind: 'flag', target: t.id, marked: false });
  if (!hit) return { effects, line: `${head} → ${r.natural1 ? '대실패' : '빗나감'}`, damage: 0 };
  const dmgBonus = spec.damageBonus ?? (spec.ability === 'spell' ? 0 : abil);
  const dmg = rollDamage(rng, damage, crit);
  let total = Math.max(0, dmg.total + dmgBonus);
  let extra = '';
  // 암습: 이점이 있거나, 불리점 없이 대상과 같은 존에 다른 아군이 있을 때 (SRD 5.2.1)
  const allyNearTarget = Object.values(cs.combatants).some((o) => o.side === a.side && o.id !== a.id && alive(o) && o.zone === t.zone);
  if (sneakAvailable && a.sneakAttack && (mode === 'advantage' || (mode === 'normal' && allyNearTarget)) && (spec.kind === 'ranged' || spec.ability === 'finesse')) {
    const s = rollDamage(rng, a.sneakAttack, crit);
    total += s.total;
    extra = ` + 암습 ${s.total}`;
    effects.push({ kind: 'sneak_used' });
  }
  effects.push({ kind: 'hp', target: t.id, delta: -total, crit });
  if (at.mark) effects.push({ kind: 'flag', target: t.id, marked: true });
  // 넘어뜨리기: 살아남은 대상은 내성 굴림
  let proneText = '';
  if (at.knockProne && hpBefore - total > 0 && !t.prone) {
    const sb = mod(t, at.knockProne.save) + (t.saveProfs.includes(at.knockProne.save) ? t.profBonus : 0);
    const sr = d20Test(rng, sb, at.knockProne.dc);
    if (!sr.success) effects.push({ kind: 'flag', target: t.id, prone: true });
    proneText = `, 넘어뜨리기 내성 ${sr.total} vs DC ${at.knockProne.dc} → ${sr.success ? '버팀' : '넘어짐'}`;
  }
  return {
    effects, damage: total,
    line: `${head} → ${crit ? '치명타!' : '명중'} ${spec.damageType} 피해 ${total} (${dmg.rolls.join('+')}${dmgBonus ? `${dmgBonus > 0 ? '+' : ''}${dmgBonus}` : ''}${extra})${at.mark ? ', 표식' : ''}${hpBefore - total <= 0 ? ` — ${t.name} 쓰러짐` : ''}${proneText}`,
  };
}

/** 내성 피해 한 명분 */
function rollSave(a: Combatant, t: Combatant, cardName: string, save: Ability, damage: string, damageType: string, half: boolean, bonus: number, rng: Rng): { effects: CombatEffect[]; line: string } {
  const dc = spellSaveDc(a);
  const sb = mod(t, save) + (t.saveProfs.includes(save) ? t.profBonus : 0);
  const r = d20Test(rng, sb, dc);
  const head = `${a.name}의 ${cardName} → ${t.name}: 내성 d20(${r.kept}) ${sb >= 0 ? '+' : ''}${sb} = ${r.total} vs DC ${dc}`;
  if (r.success && !half) return { effects: [], line: `${head} → 성공, 피해 없음` };
  const full = rollDamage(rng, damage).total + bonus;
  const dealt = r.success ? Math.floor(full / 2) : full;
  return {
    effects: dealt > 0 ? [{ kind: 'hp', target: t.id, delta: -dealt }] : [],
    line: `${head} → ${r.success ? '성공, 절반' : '실패,'} ${damageType} 피해 ${dealt}${t.hp - dealt <= 0 ? ` — ${t.name} 쓰러짐` : ''}`,
  };
}

/** 카드 사용을 해결한다. 규칙 위반이면 예외. 상태는 바꾸지 않고 effects만 반환한다. */
export function resolveCard(cs: CombatState, actorId: string, cardId: string, target: Target, rng: Rng): Resolution {
  const card = cardById(cardId);
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
      const count = (e.count ?? 1) + (card.upcast?.count ?? 0) * up;
      const damage = scaleDice(e.attack.damage, card.upcast?.dice, up);
      let hp = t.hp;
      let sneak = !cs.sneakUsed;
      for (let i = 0; i < count; i++) {
        if (hp <= 0) break;
        const r = rollAttack(i === 0 ? cs : { ...cs, combatants: { ...cs.combatants, [a.id]: { ...a, hidden: false, aimed: false }, [t.id]: { ...t, hp, marked: false } } }, a, { ...t, hp }, name, e, damage, rng, sneak, hp);
        effects.push(...r.effects);
        if (r.effects.some((x) => x.kind === 'sneak_used')) sneak = false;
        hp -= r.damage;
        log.push(r.line);
      }
      consumeSelf();
      break;
    }
    case 'save_damage': {
      const t = cs.combatants[target as string]!;
      const r = rollSave(a, t, name, e.save, scaleDice(e.damage, card.upcast?.dice, up), e.damageType, !!e.half, e.bonus === 'spell' ? spellMod(a) : 0, rng);
      effects.push(...r.effects);
      log.push(r.line);
      break;
    }
    case 'area_save': {
      const zone = target as number;
      const foes = opponents(cs, a).filter((o) => o.zone === zone);
      log.push(`${a.name}의 ${name}: ${ZONE_NAMES[zone]}의 적 ${foes.length}명`);
      for (const t of foes) {
        const r = rollSave(a, t, name, e.save, scaleDice(e.damage, card.upcast?.dice, up), e.damageType, e.half, 0, rng);
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
      const h = rollDamage(rng, scaleDice(e.dice, card.upcast?.dice, up)).total + (e.add === 'spell' ? spellMod(a) : a.level);
      const healed = Math.min(t.maxHp - t.hp, Math.max(0, h));
      effects.push({ kind: 'hp', target: t.id, delta: healed });
      log.push(`${a.name}의 ${name}${t.id === a.id ? '' : ` → ${t.name}`}: HP ${healed} 회복 (${t.hp} → ${t.hp + healed})`);
      break;
    }
    case 'move': {
      // 기회 공격: 떠나는 존의 적이 반응으로 근접 공격 1회씩 (후퇴 중이면 면제)
      let hp = a.hp;
      let knocked = false;
      if (!a.disengaged) {
        for (const foe of opponents(cs, a).filter((o) => o.zone === a.zone && !o.reactionUsed)) {
          const melee = handOf(foe).find((c) => c.effect.type === 'attack' && c.effect.attack.kind === 'melee');
          if (!melee || melee.effect.type !== 'attack' || hp <= 0) continue;
          effects.push({ kind: 'flag', target: foe.id, reactionUsed: true });
          const r = rollAttack(cs, foe, { ...a, hp }, `기회 공격(${melee.name})`, melee.effect, melee.effect.attack.damage, rng, false, hp);
          effects.push(...r.effects.filter((x) => x.kind !== 'sneak_used'));
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
    case 'dodge': {
      effects.push({ kind: 'flag', target: a.id, dodging: true });
      log.push(`${a.name}: 회피 자세`);
      break;
    }
    case 'hide': {
      const r = d20Test(rng, a.stealthBonus, 15);
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
  }
  return { effects, log };
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
  next.combatants[currentActorId(next)]!.disengaged = false;
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
  if (a.side !== 'enemy' || cs.outcome) return null;
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
  if (a.prone && cs.economy.move) return { cardId: 'basic/stand', target: a.id };
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
  if (a.side !== 'party' || a.isPlayer || cs.outcome) return null;
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
      if (cs.economy.move) return { cardId: 'basic/move', target: step };
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
