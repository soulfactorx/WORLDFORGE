/**
 * 시험실 (v0.84) — 세계를 실제로 플레이하지 않고 엔진만으로 확인한다. AI를 쓰지 않는다.
 * - 상태 시험대: 원하는 상태(장소·날짜·플래그·수치·성향·관계·임무·소지품·지식)를 만들고
 *   그 상태에서 무엇이 열리는지(조건 ✓/✗와 이유), 규칙·선택·효과·전투를 해 보면 무엇이 이어지는지 본다.
 * - 항목 단위 시험: 규칙·임무·결말·결정·플래그·조우·장면을 하나씩 골라 확인한다.
 */
import type { CharacterSheet } from '../engine/character/sheet';
import { cardOf, currentActorId, type EncounterSpec, handOf, planCompanionAction, unusableReason, validTargets } from '../engine/combat/combat';
import { encounterDifficulty, monsterTable } from '../engine/combat/monsters';
import { AXIS_NAMES, relationshipOf } from '../engine/relationship';
import { itemDef } from '../engine/items';
import { availableScenes } from '../engine/scene';
import { evalCondition, flagAllowed, varLabel, varValue } from '../engine/scenario';
import type { Condition, RelationAxis, StoryEffect, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, replay, type GameState } from '../engine/state/state';
import { pendingChoice } from '../engine/story';
import { traitsFor, traitValue } from '../engine/traits';
import { availableEncounters, beginAdhocEncounter, playerCombatAction, playerEndTurn } from './combat';
import { actionRulesHit, fireRule, ruleReady, stateRuleEvents } from './rules';
import { scenarioEvents } from './scenario';
import { testSheet } from './sceneTest';
import { effectEvents } from './story';
import { startEvents } from './turn';

// ---------------------------------------------------------------- 시험 상태 만들기

export interface LabSetup {
  startId?: string;
  locationId?: string;
  classIndex?: number;
  level?: number;
  /** 시작 후 지난 날 */
  days?: number;
  flags?: string[];
  vars?: Record<string, number>;
  traits?: Record<string, number>;
  /** 인물별 관계 축 값 (절대값) */
  relations?: Record<string, Partial<Record<RelationAxis, number>>>;
  reputation?: Record<string, number>;
  questsDone?: string[];
  questsStarted?: string[];
  /** 결정적 선택: 고른 선택지 */
  choices?: Record<string, string>;
  knows?: string[];
  items?: Record<string, number>;
  money?: number;
  dead?: string[];
  seed?: number;
}

export function labSheet(world: WorldPackage, setup: LabSetup): CharacterSheet {
  const traits = setup.traits && Object.keys(setup.traits).length ? setup.traits : undefined;
  return testSheet(world, setup.classIndex ?? 0, setup.level ?? 1, traits);
}

/** 설정대로 만든 시험 상태 (엔진 단계는 돌리지 않는다 — "이 상태가 된 순간"을 보려면 labStep) */
export function labState(world: WorldPackage, setup: LabSetup): GameState {
  let s = replay(startEvents(world, labSheet(world, setup), setup.seed ?? 1, setup.startId).map((event, seq) => ({ saveId: 'lab', seq, turn: 0, event })));
  const push = (e: GameEvent) => { s = applyEvent(s, e, s.turn); };
  if (setup.locationId && setup.locationId !== s.player.locationId && world.locations.some((l) => l.id === setup.locationId)) push({ type: 'moved', to: setup.locationId });
  if (setup.days) push({ type: 'time_advanced', minutes: Math.max(0, setup.days) * 1440 });
  for (const f of setup.flags ?? []) if (!s.flags.includes(f)) push({ type: 'flag_set', flag: f });
  for (const [id, value] of Object.entries(setup.vars ?? {})) {
    const v = world.vars?.find((x) => x.id === id);
    if (v) push({ type: 'var_changed', varId: id, value, name: v.name, label: varLabel(v, value) });
  }
  for (const [npcId, axes] of Object.entries(setup.relations ?? {})) {
    const npc = world.characters.find((c) => c.id === npcId);
    if (!npc) continue;
    const cur = relationshipOf(world, s.relationships, npcId);
    const delta = Object.fromEntries(Object.entries(axes).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, (v as number) - cur[k as RelationAxis]]));
    if (Object.keys(delta).length) push({ type: 'relationship_changed', npcId, delta, reason: '시험 설정', name: npc.name, base: cur });
  }
  for (const [fid, value] of Object.entries(setup.reputation ?? {})) {
    const f = world.factions?.find((x) => x.id === fid);
    if (f) push({ type: 'reputation_changed', factionId: fid, name: f.name, delta: value - (s.reputation?.[fid] ?? f.reputation ?? 0), reason: '시험 설정' });
  }
  for (const qid of setup.questsStarted ?? []) {
    const q = world.quests?.find((x) => x.id === qid);
    if (q && !s.quests[qid]) push({ type: 'quest_started', questId: qid, name: q.name, objective: q.stages[0]?.objective ?? '' });
  }
  for (const qid of setup.questsDone ?? []) {
    const q = world.quests?.find((x) => x.id === qid);
    if (!q) continue;
    if (!s.quests[qid]) push({ type: 'quest_started', questId: qid, name: q.name, objective: q.stages[0]?.objective ?? '' });
    push({ type: 'quest_completed', questId: qid, name: q.name, stages: q.stages.length });
  }
  for (const [cid, oid] of Object.entries(setup.choices ?? {})) {
    const ch = world.choices?.find((x) => x.id === cid);
    const opt = ch?.options.find((o) => o.id === oid);
    if (ch && opt) push({ type: 'choice_made', choiceId: cid, optionId: oid, text: `${ch.name}: ${opt.text}` });
  }
  for (const cid of setup.knows ?? []) {
    const c = world.claims.find((x) => x.id === cid);
    if (c) push({ type: 'knowledge_revealed', belief: { holder: 'player', claim: cid, state: 'confirmed', source: 'lab' }, statement: c.statement });
  }
  for (const [itemId, n] of Object.entries(setup.items ?? {})) if (n > 0) push({ type: 'item_gained', itemId, name: itemDef(world, itemId)?.name ?? itemId, n, reason: '시험 설정' });
  if (setup.money !== undefined && setup.money !== (s.money ?? 0)) push({ type: 'money_changed', delta: setup.money - (s.money ?? 0), reason: '시험 설정' });
  for (const id of setup.dead ?? []) { const c = world.characters.find((x) => x.id === id); if (c) push({ type: 'npc_killed', npcId: id, name: c.name }); }
  return { ...s, log: [] };
}

// ---------------------------------------------------------------- 사건을 사람이 읽는 글로

export function describeEvent(world: WorldPackage, e: GameEvent): string | null {
  const name = (id: string) => world.characters.find((c) => c.id === id)?.name ?? id;
  const loc = (id: string) => world.locations.find((l) => l.id === id)?.name ?? id;
  switch (e.type) {
    case 'rule_fired': return `⚖ 규칙 발동: ${e.name}${e.by === 'state' ? ' (상태)' : ''}`;
    case 'flag_set': return `🚩 플래그 ${e.flag}`;
    case 'var_changed': return `📊 ${e.name} → ${e.value}${e.label ? ` (${e.label})` : ''}`;
    case 'trait_changed': return `◐ ${e.name} ${e.delta > 0 ? '+' : ''}${e.delta} → ${e.value}`;
    case 'relationship_changed': return `♡ ${e.name ?? name(e.npcId)}: ${Object.entries(e.delta).map(([k, v]) => `${AXIS_NAMES[k as RelationAxis] ?? k} ${(v as number) > 0 ? '+' : ''}${v}`).join(', ')}${e.reason ? ` — ${e.reason}` : ''}`;
    case 'relation_stage': return `♡ ${e.name}: ${e.from} → ${e.to}`;
    case 'reputation_changed': return `⚑ ${e.name} 평판 ${e.delta > 0 ? '+' : ''}${e.delta}`;
    case 'quest_started': return `📜 임무 시작: ${e.name}`;
    case 'quest_advanced': return `📜 임무 진행: ${e.name} ${e.stage + 1}단계`;
    case 'quest_completed': return `✅ 임무 완료: ${e.name}`;
    case 'quest_failed': return `❌ 임무 실패: ${e.name} (${e.reason})`;
    case 'quest_outcome': return `📜 임무 결과: ${e.questName} → ${e.name}`;
    case 'ending_reached': return `🏁 결말: ${e.name}`;
    case 'scene_started': return `🎭 장면 시작: ${e.name}`;
    case 'transition_queued': return `↪ 이어지는 전환 예약: ${e.kind === 'scene' ? `장면 ${world.scenes?.find((x) => x.id === e.id)?.name ?? e.id}` : `전투 ${world.encounters?.find((x) => x.id === e.id)?.name ?? e.id}`}`;
    case 'scene_ended': return `🎭 장면 끝: ${e.name} (${e.outcome})`;
    case 'npc_moved': return `🚶 ${name(e.npcId)} → ${loc(e.to)}`;
    case 'npc_killed': return `✝ ${e.name} 죽음`;
    case 'moved': return `🧭 이동 → ${loc(e.to)}`;
    case 'knowledge_revealed': return `💡 알게 됨: ${(e.statement ?? world.claims.find((c) => c.id === e.belief.claim)?.statement ?? e.belief.claim).slice(0, 50)}`;
    case 'item_gained': return `🎒 얻음: ${itemDef(world, e.itemId)?.name ?? e.name} ×${e.n}`;
    case 'item_lost': return `🎒 잃음: ${e.name} ×${e.n}`;
    case 'money_changed': return `💰 ${e.delta > 0 ? '+' : ''}${e.delta}`;
    case 'clock_changed': return `⏳ 시계 ${world.clocks?.find((c) => c.id === e.clockId)?.name ?? e.clockId}: ${e.value}칸`;
    case 'clock_reached': return `⏳ 시계 ${world.clocks?.find((c) => c.id === e.clockId)?.name ?? e.clockId} ${e.segment}칸 도달`;
    case 'world_event': return e.skipped ? `📅 사건 "${e.name}" — 막힘` : `📅 사건 "${e.name}"`;
    case 'faction_acted': return `⚑ 세력 행동: ${e.name}`;
    case 'choice_offered': return `◆ 결정의 순간: ${e.name}`;
    case 'choice_made': return `◆ 결정: ${e.text}`;
    case 'beat_opened': return `💞 관계 사건 열림: ${e.name}`;
    case 'arc_started': return `📖 줄기 시작: ${e.name}`;
    case 'chapter_completed': return `📖 장 완료: ${e.name}`;
    case 'arc_ended': return `📖 줄기 끝: ${e.name}${e.failed ? ' (실패)' : ''}`;
    case 'title_earned': return `🏅 칭호: ${e.name}`;
    case 'level_up': return `⬆ 레벨 ${e.sheet.level}`;
    case 'combat_started': return `⚔ 전투 시작`;
    case 'combat_ended': return `⚔ 전투 끝: ${e.playerDead ? '사망' : { victory: '승리', defeat: '쓰러짐', fled: '도주' }[e.outcome]}`;
    case 'companion_joined': return `🤝 ${name(e.npcId)} 합류`;
    case 'companion_left': return `🤝 ${name(e.npcId)} 떠남`;
    case 'npc_relation_changed': return `🔗 인물 관계 변화: ${e.key} → ${e.kind}`;
    case 'goal_started': return `🎯 ${name(e.npcId)}의 목표 시작`;
    case 'goal_ended': return `🎯 ${name(e.npcId)}의 목표 ${e.outcome === 'done' ? '이룸' : '꺾임'}`;
    case 'rumor_spread': return `🗣 소문 ${e.beliefs.length}건 퍼짐`;
    default: return null;
  }
}

// ---------------------------------------------------------------- 시험 행동 (모두 그 뒤의 엔진 연쇄까지)

export interface LabResult { state: GameState; events: GameEvent[]; lines: string[]; error?: string }

function run(world: WorldPackage, state: GameState, first: (s: GameState) => GameEvent[], chain = true): LabResult {
  let s = { ...state, turn: state.turn + 1 };
  const events: GameEvent[] = [];
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, s.turn); };
  try {
    first(s).forEach(push);
    if (chain) {
      stateRuleEvents(world, s).events.forEach(push);
      scenarioEvents(world, s).events.forEach(push);
    }
  } catch (e) { return { state, events: [], lines: [], error: (e as Error).message }; }
  return { state: s, events, lines: events.map((e) => describeEvent(world, e)).filter((x): x is string => !!x) };
}

/** 엔진 한 단계 (이 상태가 된 순간 무엇이 일어나나) */
export const labStep = (world: WorldPackage, state: GameState) => run(world, state, () => []);
export const labMove = (world: WorldPackage, state: GameState, to: string) => run(world, state, () => [{ type: 'moved', to }]);
export const labWait = (world: WorldPackage, state: GameState, minutes: number) => run(world, state, () => [{ type: 'time_advanced', minutes }]);
export const labEffects = (world: WorldPackage, state: GameState, effects: StoryEffect[]) => run(world, state, (s) => effectEvents(world, s, effects, '시험'));
export const labFlag = (world: WorldPackage, state: GameState, flag: string) => run(world, state, () => [{ type: 'flag_set', flag }]);

/** 행동 규칙 발동 (force: 반복·추가 조건을 무시) */
export function labFireRule(world: WorldPackage, state: GameState, ruleId: string, force = false): LabResult {
  const r = world.rules?.find((x) => x.id === ruleId);
  if (!r) return { state, events: [], lines: [], error: '없는 규칙' };
  if (!force && !ruleReady(world, state, r)) return { state, events: [], lines: [], error: '지금은 발동할 수 없다 (꺼짐·반복·추가 조건)' };
  let note = '';
  const res = run(world, state, (s) => { const f = fireRule(world, s, r, r.trigger.kind === 'state' ? 'state' : 'action'); note = [f.note.outcome ? `결과 지시: ${f.note.outcome}` : '', ...f.note.reactions.map((x) => `${x.name}의 반응: ${x.text}`)].filter(Boolean).join('\n'); return f.events; });
  return note ? { ...res, lines: [...res.lines, ...note.split('\n').map((x) => `  · ${x}`)] } : res;
}

/** 플레이어 입력 시험: 낱말로 걸리는 행동 규칙 + (GM이 고를) 규칙 ID */
export function labInput(world: WorldPackage, state: GameState, input: string, picked: string[] = []): LabResult & { hit: string[] } {
  const hits = actionRulesHit(world, state, input, picked);
  let s = state;
  const events: GameEvent[] = [];
  const lines: string[] = [];
  for (const r of hits) {
    const res = labFireRule(world, s, r.id);
    s = res.state; events.push(...res.events); lines.push(...res.lines);
  }
  if (!hits.length) lines.push('(걸리는 행동 규칙 없음)');
  return { state: s, events, lines, hit: hits.map((r) => r.id) };
}

export function labChoose(world: WorldPackage, state: GameState, choiceId: string, optionId: string): LabResult {
  const ch = world.choices?.find((c) => c.id === choiceId);
  const opt = ch?.options.find((o) => o.id === optionId);
  if (!ch || !opt) return { state, events: [], lines: [], error: '없는 선택' };
  return run(world, state, (s) => {
    const out: GameEvent[] = [{ type: 'choice_made', choiceId, optionId, text: `${ch.name}: ${opt.text}` }];
    const s2 = applyEvent(s, out[0]!, s.turn);
    return [...out, ...effectEvents(world, s2, opt.effects, ch.name)];
  });
}

export function labQuest(world: WorldPackage, state: GameState, questId: string, to: 'start' | 'done'): LabResult {
  const q = world.quests?.find((x) => x.id === questId);
  if (!q) return { state, events: [], lines: [], error: '없는 임무' };
  return run(world, state, (s) => [
    ...(s.quests[questId] ? [] : [{ type: 'quest_started', questId, name: q.name, objective: q.stages[0]?.objective ?? '' } as GameEvent]),
    ...(to === 'done' ? [{ type: 'quest_completed', questId, name: q.name, stages: q.stages.length } as GameEvent] : []),
  ]);
}

// ---------------------------------------------------------------- 자동 전투

/** 플레이어가 할 행동: 동료 AI(치료·위치·공격 판단)를 플레이어 자리에 빌려 쓰고, 없으면 쓸 수 있는 첫 공격 */
function playerPlan(cs: NonNullable<GameState['combat']>) {
  const me = cs.combatants.player!;
  const borrowed = planCompanionAction({ ...cs, combatants: { ...cs.combatants, player: { ...me, isPlayer: false } } });
  if (borrowed && !unusableReason(cs, 'player', cardOf(me, borrowed.cardId))) return borrowed;
  for (const c of handOf(me)) {
    if (unusableReason(cs, 'player', c)) continue;
    if (['attack', 'save_damage', 'auto_damage'].includes(c.effect.type) || (c.effect.type === 'move' && cs.economy.action)) {
      const t = validTargets(cs, 'player', c).at(-1);
      if (t !== undefined) return { cardId: c.id, target: t };
    }
  }
  return null;
}

/** 이미 시작된 전투를 플레이어 자동 조작으로 끝까지 */
export function autoFinishCombat(world: WorldPackage, state: GameState): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, s.turn); };
  for (let guard = 0; guard < 400 && s.combat && !s.playerDead; guard++) {
    const cs = s.combat;
    if (currentActorId(cs) !== 'player') { try { playerEndTurn(world, s).forEach(push); } catch { break; } continue; }
    const plan = playerPlan(cs);
    try { (plan ? playerCombatAction(world, s, plan.cardId, plan.target) : playerEndTurn(world, s)).forEach(push); } catch { try { playerEndTurn(world, s).forEach(push); } catch { break; } }
  }
  return { state: s, events };
}

/** 조우 하나를 자동으로 싸운다 (장소 무시) */
export function labFight(world: WorldPackage, state: GameState, spec: EncounterSpec): LabResult {
  return run(world, state, (s) => {
    const evs = beginAdhocEncounter(world, s, spec, s.turn, { adaptive: false });
    const s2 = evs.reduce((x, e) => applyEvent(x, e, x.turn), s);
    return [...evs, ...autoFinishCombat(world, s2).events];
  }, false);
}

export interface FightStats { n: number; victory: number; defeat: number; fled: number; dead: number; avgRounds: number; avgHpLeft: number; difficulty: string; xp: number }

/** 같은 조우를 n번 싸워 승률·남은 HP를 본다 (전투 균형 시험) */
export function fightStats(world: WorldPackage, state: GameState, spec: EncounterSpec, n = 50): FightStats {
  const out: FightStats = { n, victory: 0, defeat: 0, fled: 0, dead: 0, avgRounds: 0, avgHpLeft: 0, difficulty: '', xp: 0 };
  const levels = [state.player.sheet.level, ...Object.values(state.party).map((p) => p.level)];
  const d = encounterDifficulty(spec.enemies.map((e) => e.monsterId), levels, monsterTable(world));
  out.difficulty = d.difficulty; out.xp = d.xp;
  let rounds = 0, hp = 0;
  for (let i = 0; i < n; i++) {
    let s: GameState = { ...state, rngState: (state.rngState + Math.imul(i + 1, 2654435761)) >>> 0 };
    let maxRound = 0;
    const apply = (e: GameEvent) => { s = applyEvent(s, e, s.turn); maxRound = Math.max(maxRound, s.combat?.round ?? 0); };
    const evs = beginAdhocEncounter(world, s, spec, s.turn, { adaptive: false });
    evs.forEach(apply);
    const fin = autoFinishCombat(world, s);
    fin.events.forEach(apply);
    const end = [...evs, ...fin.events].find((e) => e.type === 'combat_ended');
    if (!end || end.type !== 'combat_ended') continue;
    if (end.playerDead) out.dead++;
    out[end.outcome]++;
    hp += end.hp / Math.max(1, state.player.sheet.maxHp);
    rounds += Math.max(1, maxRound);
  }
  out.avgRounds = Math.round((rounds / n) * 10) / 10;
  out.avgHpLeft = Math.round((hp / n) * 100);
  return out;
}

// ---------------------------------------------------------------- 지금 상태 한눈에

export interface Trace { ok: boolean; c: Condition; kids?: Trace[] }
/** 조건이 왜 참·거짓인지 (하위 조건마다) */
export function condTrace(world: WorldPackage, state: GameState, c: Condition): Trace {
  if ('all' in c) { const kids = c.all.map((x) => condTrace(world, state, x)); return { ok: kids.every((k) => k.ok), c, kids }; }
  if ('any' in c) { const kids = c.any.map((x) => condTrace(world, state, x)); return { ok: kids.some((k) => k.ok), c, kids }; }
  if ('not' in c) { const k = condTrace(world, state, c.not); return { ok: !k.ok, c, kids: [k] }; }
  return { ok: evalCondition(world, state, c), c };
}

export interface LabRow { kind: string; id: string; name: string; status: string; ok?: boolean; cond?: Condition }

/** 시험 상태에서 세계의 장치들이 어떤 상태인가 */
export function labStatus(world: WorldPackage, s: GameState): LabRow[] {
  const rows: LabRow[] = [];
  const ok = (c: Condition | undefined) => (c ? evalCondition(world, s, c) : true);
  for (const r of world.rules ?? []) {
    const st = s.rules?.[r.id];
    if (r.trigger.kind === 'state') {
      const now = ok(r.trigger.condition);
      rows.push({ kind: 'rule', id: r.id, name: r.name, ok: now, cond: r.trigger.condition, status: r.enabled === false ? '꺼짐' : st?.active ? '발동함 (참인 동안 대기)' : now ? (ruleReady(world, s, r) ? '다음 단계에 발동' : '참이지만 반복·추가 조건으로 막힘') : `조건 거짓${st?.count ? ` · ${st.count}번 발동했음` : ''}` });
    } else rows.push({ kind: 'rule', id: r.id, name: r.name, ok: ruleReady(world, s, r), ...(r.requires ? { cond: r.requires } : {}), status: r.enabled === false ? '꺼짐' : ruleReady(world, s, r) ? '행동하면 발동 가능' : st?.count ? `${st.count}번 발동함 (반복 대기)` : '추가 조건 거짓' });
  }
  for (const q of world.quests ?? []) {
    const p = s.quests[q.id];
    const stage = p && !p.done && !p.failed ? q.stages[p.stage] : undefined;
    rows.push({ kind: 'quest', id: q.id, name: q.name, ok: !!p?.done && !p.failed || (!p ? ok(q.start) : stage ? ok(stage.complete) : false),
      ...(!p ? { cond: q.start } : stage ? { cond: stage.complete } : {}),
      status: !p ? (ok(q.start) ? '시작 조건 참 — 다음 단계에 시작' : '시작 전 (시작 조건 거짓)') : p.failed ? '실패' : p.done ? '완료' : `${p.stage + 1}/${q.stages.length}단계 — ${stage?.objective ?? ''}${stage && ok(stage.complete) ? ' (완료 조건 참)' : ''}` });
  }
  for (const e of world.endings ?? []) rows.push({ kind: 'ending', id: e.id, name: e.name, ok: ok(e.condition), cond: e.condition, status: s.ending === e.id ? '도달함' : ok(e.condition) ? '조건 참' : '조건 거짓' });
  const pc = pendingChoice(world, s);
  for (const c of world.choices ?? []) rows.push({ kind: 'choice', id: c.id, name: c.name, ok: ok(c.when), cond: c.when, status: s.choices?.[c.id]?.chosen ? `고름: ${c.options.find((o) => o.id === s.choices![c.id]!.chosen)?.text ?? ''}` : pc?.id === c.id ? '지금 고를 차례' : ok(c.when) ? '조건 참' : '조건 거짓' });
  for (const f of world.flags ?? []) rows.push({ kind: 'flag', id: f.id, name: f.id, ok: s.flags.includes(f.id), ...(f.requires ? { cond: f.requires } : {}), status: s.flags.includes(f.id) ? '섰음' : flagAllowed(world, s, f.id) ? 'GM이 지금 세울 수 있음' : f.locationId && f.locationId !== s.player.locationId ? '다른 장소에서만' : '지금은 못 세움' });
  const scenes = new Set(availableScenes(world, s).map((d) => d.id));
  for (const d of world.scenes ?? []) rows.push({ kind: 'scene', id: d.id, name: d.name, ok: scenes.has(d.id), ...(d.start ? { cond: d.start } : {}), status: s.sceneResults?.[d.id] ? `끝남: ${s.sceneResults[d.id]!.endId}` : scenes.has(d.id) ? (d.auto ? '저절로 시작함' : '지금 시작할 수 있음') : '지금은 못 함 (장소·상대·조건)' });
  const here = new Set(availableEncounters(world, s).map((e) => e.id));
  for (const e of world.encounters ?? []) rows.push({ kind: 'encounter', id: e.id, name: e.name, ok: here.has(e.id), status: s.clearedEncounters.includes(e.id) ? '끝남' : here.has(e.id) ? '이 장소에서 일어날 수 있음' : `다른 장소 (${world.locations.find((l) => l.id === e.locationId)?.name ?? e.locationId})` });
  for (const t of world.titles ?? []) rows.push({ kind: 'title', id: t.id, name: t.name, ok: ok(t.condition), cond: t.condition, status: ok(t.condition) ? '조건 참' : '조건 거짓' });
  for (const b of world.relationBeats ?? []) rows.push({ kind: 'beat', id: b.id, name: b.name, ok: ok(b.condition), cond: b.condition, status: ok(b.condition) ? '조건 참' : '조건 거짓' });
  return rows;
}

/** 지금 상태 요약 (위치·시간·수치·성향) */
export function labSummary(world: WorldPackage, s: GameState): string[] {
  const day = Math.floor(s.worldMinutes / 1440);
  const hh = Math.floor((s.worldMinutes % 1440) / 60), mm = s.worldMinutes % 60;
  return [
    `📍 ${world.locations.find((l) => l.id === s.player.locationId)?.name ?? s.player.locationId} · ${day}일째 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · 레벨 ${s.player.sheet.level} (HP ${s.player.sheet.hp}/${s.player.sheet.maxHp})`,
    ...(world.vars?.length ? [`📊 ${world.vars.map((v) => `${v.name} ${varValue(world, s, v.id)}`).join(' · ')}`] : []),
    ...(traitsFor(world).length ? [`◐ ${traitsFor(world).map((t) => `${t.name} ${traitValue(world, s.player.sheet, t.id)}`).join(' · ')}`] : []),
    `🚩 ${s.flags.join(', ') || '플래그 없음'}${s.money ? ` · 💰 ${s.money}` : ''}${Object.keys(s.inventory ?? {}).length ? ` · 🎒 ${Object.entries(s.inventory ?? {}).map(([k, n]) => `${itemDef(world, k)?.name ?? k}×${n}`).join(', ')}` : ''}`,
    ...(s.deadNpcs.length ? [`✝ ${s.deadNpcs.map((id) => world.characters.find((c) => c.id === id)?.name ?? id).join(', ')}`] : []),
  ];
}
