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
 * TODO: 기회 공격, 반응, 사망 내성 굴림, 상태 이상.
 */
import type { Ability } from '../character/rules';
import { type Abilities, type CharacterSheet, resourcesOf } from '../character/sheet';
import { abilityModifier, d20Test, type RollMode } from '../dice/dice';
import { type Rng, rollDie } from '../dice/rng';
import { proficiencyBonus, SKILLS } from '../character/rules';
import { BASIC_CARDS, type CardDef, CLASS_CARDS, CLASS_KITS, type Cost, WEAPON_CARDS } from './cards';
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
  | { kind: 'hp'; target: string; delta: number }
  | { kind: 'zone'; target: string; zone: number }
  | { kind: 'flag'; target: string; dodging?: boolean; hidden?: boolean }
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
  const basics = c.side === 'party' ? BASIC_CARDS.map((b) => b.id) : ['basic/move', 'basic/dash'];
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
    spellAbility: kit.spellAbility, cards: [...kit.cards], resources: structuredClone(resourcesOf(sheet)),
    dodging: false, hidden: false, sneakAttack: kit.sneakAttack, initiative: 0,
  };
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

/** 카드의 유효 대상 목록 */
export function validTargets(cs: CombatState, actorId: string, card: CardDef): Target[] {
  const a = cs.combatants[actorId]!;
  if (card.target === 'self') return [actorId];
  if (card.target === 'zone') return [a.zone - 1, a.zone + 1].filter((z) => z >= 0 && z < ZONE_COUNT);
  if (card.target === 'ally') {
    return Object.values(cs.combatants).filter((o) => o.side === a.side && alive(o) && o.zone === a.zone && o.hp < o.maxHp).map((o) => o.id);
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
  if (!cs.economy[card.cost]) return { action: '행동을 이미 사용했다', bonus: '보너스 행동을 이미 사용했다', move: '이동을 이미 사용했다' }[card.cost];
  if (card.resource && (a.resources[card.resource]?.cur ?? 0) <= 0) return '남은 사용 횟수가 없다';
  if (card.effect.type === 'hide' && hostileInZone(cs, a)) return '같은 존에 적이 있어 숨을 수 없다';
  if (card.effect.type === 'flee') {
    if (a.zone !== 0) return '아군 후열에서만 도주할 수 있다';
    if (hostileInZone(cs, a)) return '같은 존에 적이 있어 도주할 수 없다';
  }
  if (card.effect.type === 'heal' && card.target === 'self' && a.hp >= a.maxHp) return 'HP가 가득 차 있다';
  if (card.effect.type === 'heal' && card.target === 'ally' && validTargets(cs, actorId, card).length === 0) return '같은 존에 다친 아군이 없다';
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
  const e = card.effect;

  switch (e.type) {
    case 'attack': {
      const t = cs.combatants[target as string]!;
      const at = e.attack;
      const abil = attackAbilityMod(a, at.ability);
      const toHit = at.toHit ?? abil + a.profBonus;
      const adv = a.hidden || (!!a.packTactics && Object.values(cs.combatants).some((o) => o.side === a.side && o.id !== a.id && alive(o) && o.zone === t.zone));
      const dis = t.dodging || (at.kind === 'ranged' && hostileInZone(cs, a));
      const mode = combineMode(adv, dis);
      const r = d20Test(rng, toHit, t.ac, mode);
      const hit = !r.natural1 && (r.natural20 || r.success);
      const why = [a.hidden && '숨음', adv && a.packTactics && '무리 전술', t.dodging && '대상 회피', at.kind === 'ranged' && hostileInZone(cs, a) && '근접한 적'].filter(Boolean).join(', ');
      const modeText = mode === 'normal' ? '' : ` ${mode === 'advantage' ? '이점' : '불리점'}${why ? `(${why})` : ''}`;
      if (a.hidden) effects.push({ kind: 'flag', target: a.id, hidden: false });
      if (!hit) {
        log.push(`${a.name}의 ${card.name} → ${t.name}: d20(${r.rolls.join(', ')})${modeText} ${toHit >= 0 ? '+' : ''}${toHit} = ${r.total} vs AC ${t.ac} → ${r.natural1 ? '대실패' : '빗나감'}`);
        break;
      }
      const dmgBonus = at.damageBonus ?? (at.ability === 'spell' ? 0 : abil);
      const dmg = rollDamage(rng, at.damage, r.natural20);
      let total = Math.max(0, dmg.total + dmgBonus);
      let extra = '';
      // 암습: 이점이 있거나, 불리점 없이 대상과 같은 존에 다른 아군이 있을 때 (SRD 5.2.1)
      const allyNearTarget = Object.values(cs.combatants).some((o) => o.side === a.side && o.id !== a.id && alive(o) && o.zone === t.zone);
      const sneakOk = a.sneakAttack && !cs.sneakUsed && (mode === 'advantage' || (mode === 'normal' && allyNearTarget)) && (at.kind === 'ranged' || at.ability === 'finesse');
      if (sneakOk) {
        const s = rollDamage(rng, a.sneakAttack!, r.natural20);
        total += s.total;
        extra = ` + 암습 ${s.total}`;
        effects.push({ kind: 'sneak_used' });
      }
      effects.push({ kind: 'hp', target: t.id, delta: -total });
      log.push(`${a.name}의 ${card.name} → ${t.name}: d20(${r.rolls.join(', ')})${modeText} ${toHit >= 0 ? '+' : ''}${toHit} = ${r.total} vs AC ${t.ac} → ${r.natural20 ? '치명타!' : '명중'} ${at.damageType} 피해 ${total} (${dmg.rolls.join('+')}${dmgBonus ? `${dmgBonus > 0 ? '+' : ''}${dmgBonus}` : ''}${extra})${t.hp - total <= 0 ? ` — ${t.name} 쓰러짐` : ''}`);
      break;
    }
    case 'save_damage': {
      const t = cs.combatants[target as string]!;
      const dc = spellSaveDc(a);
      const bonus = mod(t, e.save) + (t.saveProfs.includes(e.save) ? t.profBonus : 0);
      const r = d20Test(rng, bonus, dc);
      if (r.success) {
        log.push(`${a.name}의 ${card.name} → ${t.name}: 내성 d20(${r.kept}) ${bonus >= 0 ? '+' : ''}${bonus} = ${r.total} vs DC ${dc} → 성공, 피해 없음`);
      } else {
        const dmg = rollDamage(rng, e.damage);
        effects.push({ kind: 'hp', target: t.id, delta: -dmg.total });
        log.push(`${a.name}의 ${card.name} → ${t.name}: 내성 d20(${r.kept}) ${bonus >= 0 ? '+' : ''}${bonus} = ${r.total} vs DC ${dc} → 실패, ${e.damageType} 피해 ${dmg.total}${t.hp - dmg.total <= 0 ? ` — ${t.name} 쓰러짐` : ''}`);
      }
      break;
    }
    case 'auto_damage': {
      const t = cs.combatants[target as string]!;
      const parts = Array.from({ length: e.count }, () => rollDamage(rng, e.damage).total);
      const total = parts.reduce((s, x) => s + x, 0);
      effects.push({ kind: 'hp', target: t.id, delta: -total });
      log.push(`${a.name}의 ${card.name} → ${t.name}: ${e.damageType} 피해 ${total} (${parts.join('+')})${t.hp - total <= 0 ? ` — ${t.name} 쓰러짐` : ''}`);
      break;
    }
    case 'heal': {
      const t = cs.combatants[(target as string) ?? a.id]!;
      const h = rollDamage(rng, e.dice).total + (e.add === 'spell' ? spellMod(a) : a.level);
      const healed = Math.min(t.maxHp - t.hp, Math.max(0, h));
      effects.push({ kind: 'hp', target: t.id, delta: healed });
      log.push(`${a.name}의 ${card.name}${t.id === a.id ? '' : ` → ${t.name}`}: HP ${healed} 회복 (${t.hp} → ${t.hp + healed})`);
      break;
    }
    case 'move': {
      effects.push({ kind: 'zone', target: a.id, zone: target as number });
      log.push(`${a.name}: ${ZONE_NAMES[a.zone]} → ${ZONE_NAMES[target as number]} (${card.name})`);
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
      log.push(`${a.name}: 숨기 — 은신 d20(${r.kept}) ${a.stealthBonus >= 0 ? '+' : ''}${a.stealthBonus} = ${r.total} vs DC 15 → ${r.success ? '성공' : '실패'}`);
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
        c.hp = Math.max(0, Math.min(c.maxHp, c.hp + e.delta));
        break;
      }
      case 'zone': next.combatants[e.target]!.zone = e.zone; break;
      case 'flag': {
        const c = next.combatants[e.target]!;
        if (e.dodging !== undefined) c.dodging = e.dodging;
        if (e.hidden !== undefined) c.hidden = e.hidden;
        break;
      }
      case 'spend': next.economy[e.cost] = false; break;
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
    if (all.filter((c) => c.side === 'party').every((c) => !alive(c))) next.outcome = 'defeat';
    else if (all.filter((c) => c.side === 'enemy').every((c) => !alive(c))) next.outcome = 'victory';
  }
  return next;
}

/** 다음 살아 있는 전투원의 차례로 넘긴다. 회피 자세는 자기 차례가 시작될 때 풀린다. */
export function endTurn(cs: CombatState): CombatState {
  const next: CombatState = structuredClone(cs);
  for (let i = 0; i < next.order.length; i++) {
    next.turnIndex = (next.turnIndex + 1) % next.order.length;
    if (next.turnIndex === 0) next.round++;
    if (alive(next.combatants[currentActorId(next)]!)) break;
  }
  next.combatants[currentActorId(next)]!.dodging = false;
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
const isRangedCard = (c: CardDef) =>
  (c.effect.type === 'attack' && c.effect.attack.kind === 'ranged') || c.effect.type === 'save_damage' || c.effect.type === 'auto_damage';

export function planCompanionAction(cs: CombatState, order: PartyOrder = DEFAULT_ORDER): PlannedAction | null {
  const id = currentActorId(cs);
  const a = cs.combatants[id]!;
  if (a.side !== 'party' || a.isPlayer || cs.outcome) return null;
  const usable = handOf(a).filter((c) => !unusableReason(cs, id, c));
  const party = Object.values(cs.combatants).filter((o) => o.side === 'party' && alive(o));
  const critical = (c: Combatant) => c.hp <= c.maxHp / 3;

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
  if (order.conserve) attacks = attacks.filter((c) => !c.resource);
  if (order.mode === 'hold_back') attacks = attacks.filter(isRangedCard);
  const choose = (cards: CardDef[], filter: (t: Combatant) => boolean) => {
    let best: PlannedAction | null = null;
    let bestHp = Infinity;
    for (const c of cards) for (const t of validTargets(cs, id, c)) {
      const tc = cs.combatants[t as string]!;
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
      if (cs.economy.move) return { cardId: 'basic/move', target: step };
    }
  }
  // 할 일이 없으면, 적과 붙어 있을 때는 회피
  if (cs.economy.action && hostileInZone(cs, a) && !usable.some(isAttackCard)) return { cardId: 'basic/dodge', target: a.id };
  if (cs.economy.action && party.length && critical(a) && usable.some((c) => c.id === 'basic/dodge') && !usable.some(isAttackCard)) return { cardId: 'basic/dodge', target: a.id };
  return null;
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
    const plan = !alive(actor) ? null
      : actor.side === 'enemy' ? planEnemyAction(state)
      : actor.isPlayer ? null
      : planCompanionAction(state, orders[actor.id] ?? DEFAULT_ORDER);
    if (!plan) {
      state = endTurn(state);
      steps.push({ kind: 'end_turn' });
      continue;
    }
    const resolution = resolveCard(state, actor.id, plan.cardId, plan.target, rng);
    state = applyEffects(state, resolution.effects);
    steps.push({ kind: 'action', actorId: actor.id, cardId: plan.cardId, target: plan.target, resolution, rngState: rng.state() });
  }
  return { state, steps };
}


/** @deprecated runAutoTurns 사용 */
export const runEnemyTurns = (cs: CombatState, rng: Rng) => runAutoTurns(cs, rng);
