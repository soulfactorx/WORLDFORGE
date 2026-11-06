import { loyaltyOf, OBEY_LOYALTY, relationshipOf } from '../engine/relationship';
import { genreGuide, levelCapOf, reskinner } from '../engine/genre';
import { RATING_GUIDE } from '../engine/rating';
import { createRng, type Rng } from '../engine/dice/rng';
import {
  type CombatState, currentActorId, resolveCard, runAutoTurns, startCombat, type Target, type PartyOrder, type CompanionEntry,
} from '../engine/combat/combat';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { relationshipEvents } from './relationship';
import { progressEvents } from './progression';
import { scenarioEvents } from './scenario';
import { encounterDifficulty, MONSTERS, monsterTable } from '../engine/combat/monsters';
import { CLASS_KITS } from '../engine/combat/cards';
import type { EncounterSpec, Gear } from '../engine/combat/combat';
import { adaptiveMode } from '../engine/randomEvents';
import { abilityModifier } from '../engine/dice/dice';
import { equippedAc, gearBonus, itemCards, itemDef, rollLoot } from '../engine/items';
import { levelSpan } from '../engine/character/progression';
import { currencyName } from './economy';
import { jobEncounters } from '../engine/jobs';

/**
 * 전투 진행 — 엔진 결과를 이벤트로 만든다. 전투 중에는 LLM을 호출하지 않는다 (비용·속도·결정성).
 * 전투가 끝나면 narrateCombat으로 한 번만 서술한다.
 */

/** 이 장소에서 아직 끝나지 않은 조우 */
export function availableEncounters(world: WorldPackage, state: GameState) {
  return [...(world.encounters ?? []), ...jobEncounters(world, state)].filter((e) => e.locationId === state.player.locationId && !state.clearedEncounters.includes(e.id));
}

class Builder {
  events: GameEvent[] = [];
  constructor(public world: WorldPackage, public state: GameState, private turn: number) {}
  push(e: GameEvent) { this.events.push(e); this.state = applyEvent(this.state, e, this.turn); }
}

function finishIfOver(b: Builder) {
  const cs = b.state.combat;
  if (!cs?.outcome) return;
  const p = cs.combatants.player!;
  // 빈사·안정 상태였던 사람은 전투가 끝나면 HP 1로 정신을 차린다. 죽은 사람은 돌아오지 않는다.
  const after = (hp: number) => Math.max(1, hp);
  const party: Record<string, { hp: number; resources: Record<string, { cur: number; max: number }> }> = {};
  const fallen: string[] = [];
  for (const id of Object.keys(b.state.party)) {
    const c = cs.combatants[id];
    if (!c) continue;
    if (c.dead) fallen.push(id);
    else party[id] = { hp: after(c.hp), resources: c.resources };
  }
  // 전투 중 쓴 소모품: 자원("item:…")에서 빼서 소지품에서 줄인다
  const resources = Object.fromEntries(Object.entries(p.resources).filter(([k]) => !k.startsWith('item:')));
  const used = Object.entries(p.resources).filter(([k, r]) => k.startsWith('item:') && r.max > r.cur).map(([k, r]) => ({ itemId: k.slice(5), n: r.max - r.cur }));
  b.push({ type: 'combat_ended', outcome: p.dead ? 'defeat' : cs.outcome, playerDead: !!p.dead, hp: p.dead ? 0 : after(p.hp), resources, party });
  for (const u of used) b.push({ type: 'item_lost', itemId: u.itemId, name: itemDef(b.world, u.itemId)?.name ?? u.itemId, n: u.n, reason: '전투 중 사용' });
  for (const id of fallen) b.push({ type: 'companion_died', npcId: id, name: cs.combatants[id]!.name });
  // 쓰러뜨린 적 기록 (도망친 적은 빼고) — 토벌 조건(defeated)에 쓰인다
  const counts: Record<string, number> = {};
  for (const c of Object.values(cs.combatants)) if (c.side === 'enemy' && c.hp <= 0 && !c.escaped && c.monsterId) counts[c.monsterId] = (counts[c.monsterId] ?? 0) + 1;
  if (Object.keys(counts).length) b.push({ type: 'enemies_defeated', counts });
  if (p.dead) return;
  // 경험치: 승리하면 쓰러뜨린 적의 경험치를 아군 참가자에게 똑같이 나눈다 (SRD 5.2.1)
  if (cs.outcome === 'victory') {
    const total = Object.values(cs.combatants)
      .filter((c) => c.side === 'enemy' && c.hp <= 0)
      .reduce((sum, c) => sum + (c.xp ?? MONSTERS[c.id.split('#')[0]!]?.xp ?? 0), 0);
    const members = Object.values(cs.combatants).filter((c) => c.side === 'party').map((c) => c.id);
    const share = Math.floor(total / Math.max(1, members.length));
    progressEvents(b.state, members.map((who) => ({ who, amount: share })), `전투 승리 · 총 ${total} XP를 ${members.length}명이 나눔`, levelCapOf(b.world)).forEach((e) => b.push(e));
    // 전리품: 조우에 정해진 것, 없으면 적 경험치에 비례한 돈 (도망친 적은 빼고)
    const enc = b.world.encounters?.find((x) => x.id === cs.encounterId);
    const beaten = Object.values(cs.combatants).filter((c) => c.side === 'enemy' && c.hp <= 0 && !c.escaped).reduce((sum, c) => sum + (c.xp ?? MONSTERS[c.monsterId ?? '']?.xp ?? 0), 0);
    // 의뢰 토벌은 의뢰 보상으로 받으므로 기본 전리품 돈이 없다
    const money = enc?.loot ? enc.loot.money ?? 0 : cs.encounterId.startsWith('job/') ? 0 : Math.round(beaten / 10);
    if (money > 0) b.push({ type: 'money_changed', delta: money, reason: '전리품', currency: currencyName(b.world) });
    for (const it of enc?.loot?.items ?? []) {
      const def = itemDef(b.world, it.itemId);
      if (def) b.push({ type: 'item_gained', itemId: def.id, name: def.name, n: it.n ?? 1, reason: '전리품' });
    }
    // 제작자가 정한 전리품 아이템이 없으면 굴린다 (설계 v4 E3) — 같은 상태에서는 늘 같은 결과
    if (!enc?.loot?.items?.length && beaten > 0) {
      const boss = Object.values(cs.combatants).some((c) => c.side === 'enemy' && c.hp <= 0 && !c.escaped && c.role === 'boss');
      const level = b.state.player.sheet.level;
      const rng = createRng(((b.state.rngState ^ Math.imul(b.state.turn + 1, 7919)) + beaten) >>> 0);
      const drop = rollLoot(b.world, rng, { level, threatXp: beaten, levelSpan: levelSpan(level), boss });
      if (drop) b.push({ type: 'item_gained', itemId: drop.id, name: drop.name, n: 1, reason: boss ? '보스 전리품' : '전리품' });
    }
  }
  // 함께 싸워 이긴 동료는 신뢰와 존경이 오르고, 버려두고 도망치면 실망한다
  for (const id of Object.keys(party)) {
    const npc = b.world.characters.find((c) => c.id === id);
    if (!npc) continue;
    const evs = cs.outcome === 'victory' ? relationshipEvents(b.world, b.state, npc, { trust: 5, respect: 3, intimacy: 2 }, '함께 싸워 이겼다')
      : cs.outcome === 'fled' && cs.combatants[id] && cs.combatants[id]!.hp > 0 ? relationshipEvents(b.world, b.state, npc, { respect: -3 }, '함께 물러났다')
      : [];
    evs.forEach((e) => b.push(e));
  }
  // 조우 결과로 퀘스트가 진행될 수 있다
  scenarioEvents(b.world, b.state).events.forEach((e) => b.push(e));
  if (cs.outcome === 'defeat') b.push({ type: 'time_advanced', minutes: 60 });
}

/** 충성도가 낮은 동료는 명령을 따르지 않고 제멋대로 싸운다 (설계 v3 4.2) */
export function obeyedOrders(world: WorldPackage, state: GameState): GameState['partyOrders'] {
  return Object.fromEntries(Object.entries(state.partyOrders).filter(([id]) => loyaltyOf(relationshipOf(world, state.relationships, id)) >= OBEY_LOYALTY));
}

function runEnemies(b: Builder, rng: Rng) {
  const cs = b.state.combat;
  if (!cs || cs.outcome) return;
  const { steps } = runAutoTurns(cs, rng, obeyedOrders(b.world, b.state));
  for (const st of steps) {
    if (st.kind === 'end_turn') b.push({ type: 'combat_turn_ended' });
    else b.push({ type: 'combat_action', actorId: st.actorId, cardId: st.cardId, target: st.target, effects: st.resolution.effects, log: st.resolution.log, rngState: st.rngState });
  }
  finishIfOver(b);
}

/** 플레이어의 장비·소지품 → 전투 (AC·무기 카드·물약 카드) */
export function playerGear(world: WorldPackage, state: GameState): Gear {
  const sheet = state.player.sheet;
  const kit = CLASS_KITS[sheet.classId] ?? CLASS_KITS.none!;
  const weapon = state.equipped?.weapon ? itemDef(world, state.equipped.weapon)?.card : undefined;
  const gb = gearBonus(world, state);
  return {
    ac: equippedAc(world, state, abilityModifier(sheet.abilities.dex), kit.ac, !!kit.shield),
    cards: [...(weapon ? [weapon] : []), ...gb.cards, ...(state.grantedCards?.player ?? [])],
    ...(gb.attack ? { attackBonus: gb.attack } : {}), ...(gb.damage ? { damageBonus: gb.damage } : {}), ...(gb.save ? { saveBonus: gb.save } : {}),
    items: itemCards(world, state),
  };
}

/** 조우 시작 + (적이 우선권이 빠르면) 플레이어 차례까지 적 행동 진행 */
export interface EncounterOptions {
  /** 적응 난이도 (설계 v4 E5, 기본 켬): 연달아 지면 적이 약해지고, 연달아 압승하면 정예가 나온다 */
  adaptive?: boolean;
}

export function beginEncounter(world: WorldPackage, state: GameState, encounterId: string, turn: number, opts: EncounterOptions = {}): GameEvent[] {
  const enc = availableEncounters(world, state).find((e) => e.id === encounterId);
  if (!enc) throw new Error('이 장소에서 시작할 수 없는 조우');
  return startEncounterSpec(world, state, enc, turn, opts);
}

/** 정해진 조우가 아닌 즉석 조우 (돌발 사건 기습) */
export function beginAdhocEncounter(world: WorldPackage, state: GameState, spec: EncounterSpec, turn: number, opts: EncounterOptions = {}): GameEvent[] {
  return startEncounterSpec(world, state, spec, turn, opts);
}

function startEncounterSpec(world: WorldPackage, state: GameState, enc: EncounterSpec, turn: number, opts: EncounterOptions): GameEvent[] {
  const rng = createRng(state.rngState);
  const companions: CompanionEntry[] = Object.entries(state.party).map(([id, sheet]) => ({ id, name: sheet.name, sheet, order: state.partyOrders[id], cards: state.grantedCards?.[id] }));
  const combat = startCombat(enc, state.player.sheet, rng, companions, playerGear(world, state), monsterTable(world));
  // 예전에 힘들던 적 (설계 v4 E4): 파티에게 아주 쉬운 조우면 적이 기세에 눌려 일찍 달아난다
  const levels = [state.player.sheet.level, ...companions.map((c) => c.sheet.level)];
  const diff = encounterDifficulty(enc.enemies.map((e) => e.monsterId), levels, monsterTable(world));
  if (diff.xp <= diff.budget[0] / 2) {
    for (const c of Object.values(combat.combatants)) if (c.side === 'enemy' && c.role !== 'boss') c.fleeAt = Math.max(c.fleeAt ?? 0, 0.6);
    combat.overmatched = true;
  } else if (opts.adaptive !== false) {
    // 적응 난이도 (설계 v4 E5)
    const mode = adaptiveMode(state);
    for (const c of Object.values(combat.combatants)) {
      if (c.side !== 'enemy') continue;
      if (mode === 'easier') { c.maxHp = Math.max(1, Math.round(c.maxHp * 0.75)); c.hp = c.maxHp; }
      if (mode === 'harder' && c.role !== 'boss') { c.maxHp = Math.round(c.maxHp * 1.25); c.hp = c.maxHp; c.ac += 1; c.xp = Math.round((c.xp ?? 0) * 1.25); c.name = `${c.name} (정예)`; }
    }
    if (mode) combat.adaptive = mode;
  }
  const b = new Builder(world, state, turn);
  b.push({ type: 'combat_started', combat, rngState: rng.state() });
  runEnemies(b, rng);
  return b.events;
}

export function playerCombatAction(world: WorldPackage, state: GameState, cardId: string, target: Target): GameEvent[] {
  const cs = state.combat;
  if (!cs || currentActorId(cs) !== 'player') throw new Error('지금은 행동할 수 없다');
  const rng = createRng(state.rngState);
  const r = resolveCard(cs, 'player', cardId, target, rng);
  const b = new Builder(world, state, state.turn);
  b.push({ type: 'combat_action', actorId: 'player', cardId, target, effects: r.effects, log: r.log, rngState: rng.state() });
  finishIfOver(b);
  return b.events;
}

export function playerEndTurn(world: WorldPackage, state: GameState): GameEvent[] {
  const cs = state.combat;
  if (!cs || currentActorId(cs) !== 'player') throw new Error('내 차례가 아니다');
  const rng = createRng(state.rngState);
  const b = new Builder(world, state, state.turn);
  b.push({ type: 'combat_turn_ended' });
  runEnemies(b, rng);
  return b.events;
}

/** 동료에게 전술 명령 (말로 지시하는 것이므로 행동 경제를 쓰지 않는다) */
export function setPartyOrder(state: GameState, npcId: string, order: PartyOrder): GameEvent[] {
  if (!state.party[npcId]) throw new Error('동료가 아니다');
  return [{ type: 'party_order', npcId, order }];
}

/** 전투 결과 서술 — 확정된 전투 기록만 넘긴다 */
export async function narrateCombat(
  llm: LlmClient, world: WorldPackage, before: CombatState, after: GameState, combatLog: string[],
  onText: (d: string) => void, signal?: AbortSignal,
): Promise<string> {
  const loc = world.locations.find((l) => l.id === after.player.locationId);
  const outcome = after.log.at(-1)?.text ?? '';
  const rs = reskinner(world);
  return llm.stream({
    system: `너는 1인칭 TRPG의 서술자다. 한국어 2인칭("당신은 …")으로, 방금 끝난 전투를 3~5문단으로 생생하게 요약한다.
- 전투 기록의 결과(명중·빗나감·피해·쓰러짐·승패)를 그대로 따른다. 결과를 바꾸거나 새 사건을 만들지 않는다.
- 수치(주사위, AC, 피해 숫자)는 서술에 쓰지 않는다.
- 패배(쓰러짐)했다면 정신을 잃었다가 한참 뒤 깨어나는 것으로 마무리한다. 누가 구해 줬는지는 지어내지 않는다.
- 기록에 "숨을 거두었다"가 있는 동료는 정말로 죽었다. 그 죽음을 무게 있게 다룬다.
- 결과가 "사망"이면 플레이어가 죽은 것이다. 되살리지 말고, 이야기가 여기서 끝나는 장면으로 조용히 마무리한다.
- 마지막에 플레이어의 다음 행동을 대신 정하지 않는다.
- ${genreGuide(world)}
- ${RATING_GUIDE[world.manifest.contentRating] ?? RATING_GUIDE.teen}`,
    user: `## 장소\n${loc?.name}: ${loc?.description}\n\n## 참가자\n${Object.values(before.combatants).map((c) => `- ${rs(c.name)} (${c.side === 'party' ? '아군' : '적'}${c.look ? ` — ${c.look}` : c.monsterId && MONSTERS[c.monsterId] ? ` — ${MONSTERS[c.monsterId]!.look}` : ''})`).join('\n')}\n\n## 전투 기록\n${combatLog.map(rs).join('\n')}\n\n## 결과\n${outcome}\n플레이어 HP: ${after.player.sheet.hp}/${after.player.sheet.maxHp}`,
    maxTokens: 3000,
  }, onText, signal);
}

