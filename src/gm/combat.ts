import { gmStyleText } from '../data/gmStyles';
import { loyaltyOf, OBEY_LOYALTY, relationshipOf } from '../engine/relationship';
import { genreGuide, levelCapOf, reskinner } from '../engine/genre';
import { RATING_GUIDE } from '../engine/rating';
import { createRng, type Rng } from '../engine/dice/rng';
import {
  type CombatState, currentActorId, DEFAULT_ORDER, planCompanionAction, resolveCard, runAutoTurns, startCombat, type Target, type PartyOrder, type CompanionEntry,
} from '../engine/combat/combat';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { relationshipEvents } from './relationship';
import { progressEvents } from './progression';
import { scenarioEvents } from './scenario';
import { encounterDifficulty, type MonsterDef, MONSTERS, monsterTable } from '../engine/combat/monsters';
import { npcSheet, npcXp } from '../engine/npcStats';
import { appearanceOf, displayName } from '../engine/names';
import type { CharacterSheet } from '../engine/character/sheet';
import { CLASS_KITS } from '../engine/combat/cards';
import type { EncounterSpec, Gear } from '../engine/combat/combat';
import { combatScale } from '../engine/difficulty';
import { abilityModifier } from '../engine/dice/dice';
import { equippedAc, gearBonus, itemCards, itemDef, rollLoot } from '../engine/items';
import { levelSpan } from '../engine/character/progression';
import { currencyName } from './economy';
import { allEncounters, encounterStages, openEncounters } from '../engine/encounter';
import { aftermathBlock, NARRATION_CORE } from './brief';
import { buildNarratorContext } from './context';
import { effectEvents } from './story';
import { phaseEvents } from './phase';
import { tailFilter, withChoiceTail } from './guide';

/**
 * 전투 진행 — 엔진 결과를 이벤트로 만든다. 전투 중에는 LLM을 호출하지 않는다 (비용·속도·결정성).
 * 전투가 끝나면 narrateCombat으로 한 번만 서술한다.
 */

/** 이 장소에서 지금 일어날 수 있는 조우 (이긴 것·쉬는 중인 것·조건이 안 맞는 것·임무 단계에 잠긴 것은 빠진다) */
export function availableEncounters(world: WorldPackage, state: GameState) {
  return openEncounters(world, state);
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
  // 플레이어가 먼저 공격한 인물 (v0.85): 죽지는 않지만 그 일을 잊지 않는다
  if (cs.encounterId.startsWith('adhoc/')) {
    for (const c of Object.values(cs.combatants)) {
      const npc = c.side === 'enemy' && c.monsterId?.startsWith('npc:') ? b.world.characters.find((x) => x.id === c.monsterId!.slice(4)) : undefined;
      if (npc) relationshipEvents(b.world, b.state, npc, cs.outcome === 'victory' ? { affinity: -10, trust: -10, fear: 10, grudge: 10 } : { affinity: -10, trust: -10, grudge: 8 }, '당신이 먼저 공격했다').forEach((e) => b.push(e));
    }
  }
  // 조우 결과에 따라 세계에 남는 것 (v0.85): 승리·패배·도주 — 그 효과로 임무·장면이 이어진다
  {
    const def = b.world.encounters?.find((x) => x.id === cs.encounterId);
    const fx = cs.outcome === 'victory' ? def?.onVictory : cs.outcome === 'fled' ? def?.onFlee : def?.onDefeat;
    if (def && fx?.length) effectEvents(b.world, b.state, fx, `${def.name}: ${OUTCOME_LABEL[cs.outcome]}`).forEach((e) => b.push(e));
  }
  // 조우 결과로 퀘스트가 진행될 수 있다
  scenarioEvents(b.world, b.state).events.forEach((e) => b.push(e));
  // 기류·국면 (v0.113): 승리면 긴장이 내리고, 패배·도주면 오른다
  phaseEvents(b.world, b.state, b.events).forEach((e) => b.push(e));
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

/** 조우를 여는 선택 사항 (v0.91: 적응 난이도는 없앴다 — 난이도는 세이브의 DC 보정 하나로 관리한다) */
export type EncounterOptions = Record<string, never>;

export function beginEncounter(world: WorldPackage, state: GameState, encounterId: string, turn: number, opts: EncounterOptions = {}): GameEvent[] {
  const enc = availableEncounters(world, state).find((e) => e.id === encounterId);
  if (!enc) throw new Error('이 장소에서 시작할 수 없는 조우');
  return startEncounterSpec(world, state, enc, turn, opts);
}

/** 이야기 효과(startEncounter)·강제 조우가 여는 전투 (v0.85): 장소·조건을 보지 않는다. 이미 이긴 조우는 열지 않는다 */
export function beginEncounterAnywhere(world: WorldPackage, state: GameState, encounterId: string, turn: number, opts: EncounterOptions = {}): GameEvent[] {
  const enc = allEncounters(world, state).find((e) => e.id === encounterId);
  if (!enc || state.clearedEncounters.includes(enc.id) || state.combat) return [];
  return startEncounterSpec(world, state, enc, turn, opts);
}

export const OUTCOME_LABEL = { victory: '승리', defeat: '패배', fled: '도주' } as const;

/** 정해진 조우가 아닌 즉석 조우 (돌발 사건 기습) */
export function beginAdhocEncounter(world: WorldPackage, state: GameState, spec: EncounterSpec, turn: number, opts: EncounterOptions = {}): GameEvent[] {
  return startEncounterSpec(world, state, spec, turn, opts);
}

function startEncounterSpec(world: WorldPackage, state: GameState, enc: EncounterSpec, turn: number, opts: EncounterOptions): GameEvent[] {
  const rng = createRng(state.rngState);
  const companions: CompanionEntry[] = Object.entries(state.party).map(([id, sheet]) => ({ id, name: sheet.name, sheet, order: state.partyOrders[id], cards: state.grantedCards?.[id] }));
  // 인물 적 (v0.79): 지금 레벨의 캐릭터 시트로 (동료이거나 죽은 인물은 빠진다)
  const npcs: Record<string, { name: string; sheet: CharacterSheet; look?: string }> = {};
  for (const e of enc.enemies) {
    if (!e.monsterId.startsWith('npc:')) continue;
    const c = world.characters.find((x) => x.id === e.monsterId.slice(4));
    if (c && !state.party[c.id] && !state.deadNpcs.includes(c.id)) npcs[e.monsterId] = { name: displayName(state, c), sheet: npcSheet(world, state, c), look: appearanceOf(c) };
  }
  const table = { ...monsterTable(world), ...Object.fromEntries(Object.entries(npcs).map(([id, n]) => [id, { xp: npcXp(n.sheet.level) } as MonsterDef])) };
  const combat = startCombat(enc, state.player.sheet, rng, companions, playerGear(world, state), monsterTable(world), npcs);
  // 예전에 힘들던 적 (설계 v4 E4): 파티에게 아주 쉬운 조우면 적이 기세에 눌려 일찍 달아난다
  const levels = [state.player.sheet.level, ...companions.map((c) => c.sheet.level)];
  const diff = encounterDifficulty(enc.enemies.map((e) => e.monsterId), levels, table);
  if (diff.xp <= diff.budget[0] / 2) {
    for (const c of Object.values(combat.combatants)) if (c.side === 'enemy' && c.role !== 'boss') c.fleeAt = Math.max(c.fleeAt ?? 0, 0.6);
    combat.overmatched = true;
  }
  // 게임 난이도 (v0.91): 세이브의 DC 보정을 적의 방어도·체력에 적용한다 (예전의 적응 난이도를 대신한다)
  const dcMod = state.dcMod ?? 0;
  if (dcMod) {
    const sc = combatScale(dcMod);
    for (const c of Object.values(combat.combatants)) {
      if (c.side !== 'enemy') continue;
      c.maxHp = Math.max(1, Math.round(c.maxHp * sc.hp)); c.hp = c.maxHp;
      c.ac = Math.max(5, c.ac + sc.ac);
    }
    combat.difficulty = dcMod;
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

/** 잔챙이 전투인가 (v0.112, 설계 v6 V7): 보스가 없고, 임무 단계의 고비도 아니고, 플레이어가 먼저 공격한 인물도 아닌 조우 */
export function minorFight(world: WorldPackage, cs: CombatState): boolean {
  if (cs.encounterId.startsWith('adhoc/')) return false;
  if (Object.values(cs.combatants).some((c) => c.side === 'enemy' && c.role === 'boss')) return false;
  return encounterStages(world, cs.encounterId).length === 0;
}

/** 자동 전투를 멈추는 HP 비율 — 이보다 낮아지면 플레이어에게 손을 넘긴다 */
export const AUTO_STOP_HP = 0.4;

/**
 * 자동 전투 (v0.112, 설계 v6 M2 "빠른 해결"): 플레이어 차례도 동료 AI 규칙으로 엔진이 대신 싸운다.
 * 결과는 일반 전투와 같은 이벤트로 남는다 (같은 주사위·같은 경험치·전리품). 플레이어 HP가 AUTO_STOP_HP 아래로 떨어지면 멈춘다.
 */
export function autoFightEvents(world: WorldPackage, state: GameState): { events: GameEvent[]; stopped: boolean } {
  if (!state.combat) throw new Error('전투 중이 아니다');
  const rng = createRng(state.rngState);
  const b = new Builder(world, state, state.turn);
  let stopped = false;
  for (let guard = 0; guard < 400; guard++) {
    const cs = b.state.combat;
    if (!cs || cs.outcome) break;
    if (currentActorId(cs) !== 'player') { runEnemies(b, rng); continue; }
    const me = cs.combatants.player!;
    if (me.hp <= me.maxHp * AUTO_STOP_HP) { stopped = true; break; }
    const plan = planCompanionAction(cs, DEFAULT_ORDER, true);
    if (plan) {
      let r;
      try { r = resolveCard(cs, 'player', plan.cardId, plan.target, rng); } catch { r = null; }
      if (r) {
        b.push({ type: 'combat_action', actorId: 'player', cardId: plan.cardId, target: plan.target, effects: r.effects, log: r.log, rngState: rng.state() });
        finishIfOver(b);
        continue;
      }
    }
    b.push({ type: 'combat_turn_ended' });
    runEnemies(b, rng);
  }
  return { events: b.events, stopped };
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

/** 전투 결과 서술 — 확정된 전투 기록만 넘긴다. events: 전투가 끝날 때 엔진이 확정한 것 (결과·전리품·임무 변화) */
export async function narrateCombat(
  llm: LlmClient, world: WorldPackage, before: CombatState, after: GameState, combatLog: string[], events: GameEvent[],
  onText: (d: string) => void, signal?: AbortSignal,
  /** 선택지 꼬리를 함께 받는다 (v0.117): 그때의 상태. 돌려받은 글을 splitTail로 나눈다 */
  choicesFor?: GameState,
): Promise<string> {
  const rs = reskinner(world);
  // 결과는 전투 종료 이벤트에서 직접 읽는다 (v0.85: 기록의 마지막 줄을 쓰던 것 수정 — 승리 뒤에는 경험치·전리품 기록이 이어 붙는다)
  const ended = events.find((e) => e.type === 'combat_ended');
  const outcome = ended?.type === 'combat_ended' ? (ended.playerDead ? '사망' : { victory: '승리', defeat: '쓰러짐 (패배)', fled: '도주' }[ended.outcome]) : '전투가 끝났다';
  const enc = world.encounters?.find((x) => x.id === before.encounterId);
  const adhocNpc = before.encounterId.startsWith('adhoc/');
  const stages = enc ? encounterStages(world, enc.id).map((g) => { const q = world.quests?.find((x) => x.id === g.questId); return q ? `${q.name} — ${q.stages[g.stage]?.objective ?? ''}` : ''; }).filter(Boolean) : [];
  const why = [
    enc ? `조우: ${enc.name}${enc.intro ? ` — ${enc.intro}` : ''}` : adhocNpc ? '플레이어가 먼저 공격해 벌어진 싸움이다.' : before.encounterId.startsWith('job/') ? '맡은 토벌 의뢰의 표적이다.' : '뜻밖에 벌어진 싸움이다.',
    ...(stages.length ? [`이 싸움에 걸린 일: ${stages.join(' / ')}`] : []),
  ];
  const defeatRule = ended?.type === 'combat_ended' && ended.outcome === 'defeat' && !ended.playerDead && enc?.onDefeat?.length
    ? '- 패배했다. "이 결과로 바뀐 것"에 적힌 대로 이어진다 (붙잡힘·끌려감·잃은 것). 적히지 않은 일을 지어내지 않는다.'
    : '- 패배(쓰러짐)했다면 정신을 잃었다가 한참 뒤 깨어나는 것으로 마무리한다. 누가 구해 줬는지는 지어내지 않는다.';
  const req = {
    system: `너는 1인칭 TRPG의 서술자다. 방금 끝난 전투를 3~5문단으로 생생하게 쓴다.
${NARRATION_CORE}
- 전투 기록 전부를 옮기지 않는다. 흐름이 바뀐 고비 두세 개(첫 충돌, 위기, 결정타)를 골라 쓰고 나머지는 한두 문장으로 잇는다. 기록에 없는 명중·피해·쓰러짐을 만들지 않는다.
${defeatRule}
- 기록에 "숨을 거두었다"가 있는 동료는 정말로 죽었다. 그 죽음을 무게 있게 다룬다.
- 결과가 "사망"이면 플레이어가 죽은 것이다. 되살리지 말고, 이야기가 여기서 끝나는 장면으로 조용히 마무리한다.
- "왜 일어났나"와 직전 서술의 마지막 순간에서 바로 이어 쓴다 (왜 싸움이 시작됐는지가 자연스럽게 이어지게).
- 마지막 문단은 싸움이 끝난 자리에 남은 것과 "이 결과로 바뀐 것"·"이제 플레이어 앞에 놓인 것"으로 맺는다: 쓰러진 적이 남긴 것, 열린 길, 다가오는 사람. 플레이어가 바로 반응하고 싶어지는 구체적인 순간에서 끝낸다.
- 플레이어가 인물을 공격해 벌어진 싸움에서 이겼다면, 엔진이 죽음을 기록하지 않은 상대는 쓰러졌을 뿐 죽지 않았다.
- ${genreGuide(world)}
- ${RATING_GUIDE[world.manifest.contentRating] ?? RATING_GUIDE.teen}${gmStyleText(world, 'narrator')}${world.style?.trim() ? `\n\n## 이 세계의 문체 참고 (패키지 데이터. 위 규칙이 우선)\n${world.style.slice(0, 800)}` : ''}`,
    user: `${buildNarratorContext(world, after, { thread: { chronicle: 5, lastChars: 1200 } })}\n\n## 왜 일어났나\n${why.join('\n')}\n\n## 참가자\n${Object.values(before.combatants).map((c) => `- ${rs(c.name)} (${c.side === 'party' ? '아군' : '적'}${c.look ? ` — ${c.look}` : c.monsterId && MONSTERS[c.monsterId] ? ` — ${MONSTERS[c.monsterId]!.look}` : ''})`).join('\n')}\n\n## 전투 기록\n${combatLog.map(rs).join('\n')}\n\n## 결과 (엔진 확정)\n${outcome}\n플레이어 HP: ${after.player.sheet.hp}/${after.player.sheet.maxHp}\n\n${aftermathBlock(world, after, events)}`,
    maxTokens: 3000,
  };
  return llm.stream(choicesFor ? withChoiceTail(world, choicesFor, req) : req, choicesFor ? tailFilter(onText) : onText, signal);
}
