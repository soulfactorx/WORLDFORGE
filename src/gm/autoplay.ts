/**
 * 자동 플레이 (v0.84) — AI 없이 "아무렇게나 하는 플레이어"를 여러 번 돌려 세계 전체를 시험한다.
 * 매 걸음 지금 할 수 있는 행동(이동·대화·도발·기다리기·쉬기·조사·줍기·플래그 결정·행동 규칙·전투·장면·결정적 선택) 중
 * 성향(골고루·탐험·사교·호전)에 따라 무작위로 고르고, 엔진이 그 결과와 연쇄(규칙·임무·시계·결말)를 확정한다.
 * 결과: 결말 분포·도달하지 못한 결말·임무 완료율·규칙 발동률·한 번도 세워지지 않은 플래그·장면·조우 승률·사망.
 */
import { createRng, type Rng } from '../engine/dice/rng';
import { availableScenes, sceneActions, sceneDef } from '../engine/scene';
import { evalCondition, flagAllowed, pendingDiscoveries } from '../engine/scenario';
import type { Condition, WorldPackage } from '../engine/schema';
import { npcLocationOf } from '../engine/world';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { pendingChoice } from '../engine/story';
import { turnMinutes } from '../engine/time';
import { availableEncounters, beginEncounter } from './combat';
import { presentCharacters } from './context';
import { gainEvent, pendingGifts, pendingPickups } from './economy';
import { canShareSecret, relationshipOf } from '../engine/relationship';
import { playerStateFromNpc, shareableBelief } from '../engine/canon';
import { autoFinishCombat, describeEvent, type LabSetup, labState } from './lab';
import { relationshipEvents } from './relationship';
import { actionRulesHit, fireRule } from './rules';
import { abandonSceneEvents, sceneActionEvents, startSceneEvents } from './scene';
import { scenarioEvents } from './scenario';
import { effectEvents } from './story';

export type AutoStyle = 'balanced' | 'explore' | 'social' | 'aggressive';
export const AUTO_STYLE_LABEL: Record<AutoStyle, string> = { balanced: '골고루', explore: '탐험가', social: '사교가', aggressive: '호전적' };

type Kind = 'move' | 'wait' | 'rest' | 'talk' | 'provoke' | 'discover' | 'pickup' | 'flag' | 'rule' | 'fight' | 'scene' | 'choice';
const WEIGHTS: Record<AutoStyle, Record<Kind, number>> = {
  balanced: { move: 3, wait: 0.6, rest: 0.4, talk: 2.5, provoke: 0.6, discover: 2, pickup: 1.5, flag: 3, rule: 2, fight: 2, scene: 2, choice: 8 },
  explore: { move: 6, wait: 0.4, rest: 0.3, talk: 1.5, provoke: 0.3, discover: 4, pickup: 3, flag: 2.5, rule: 1.5, fight: 1.5, scene: 1.5, choice: 8 },
  social: { move: 2, wait: 0.6, rest: 0.4, talk: 6, provoke: 0.3, discover: 2, pickup: 1, flag: 3, rule: 2, fight: 0.6, scene: 3, choice: 8 },
  aggressive: { move: 3, wait: 0.4, rest: 0.4, talk: 1, provoke: 2.5, discover: 1.5, pickup: 1.5, flag: 3, rule: 3, fight: 6, scene: 1.5, choice: 8 },
};
const KIND_LABEL: Record<Kind, string> = { move: '이동', wait: '기다림', rest: '휴식', talk: '대화', provoke: '도발', discover: '조사', pickup: '줍기', flag: '결정', rule: '규칙 행동', fight: '전투', scene: '장면', choice: '결정적 선택' };

interface Cand { kind: Kind; label: string; run: (s: GameState) => GameEvent[]; /** 같은 종류 안에서 더 끌리는 정도 (기본 1) */ pull?: number }

/** 조건 안에서 장소를 가리키는 것 (at·npcAt·인물이 있는 곳) */
function placesIn(world: WorldPackage, s: GameState, c: Condition | undefined, out: Set<string>) {
  if (!c) return;
  if ('all' in c) c.all.forEach((x) => placesIn(world, s, x, out));
  else if ('any' in c) c.any.forEach((x) => placesIn(world, s, x, out));
  else if ('at' in c && !('npcAt' in c)) out.add(c.at);
  // 고비가 있는 곳 (v0.85): 조우의 장소, 장면의 장소·상대가 있는 곳
  else if ('cleared' in c || 'encounter' in c) { const e = world.encounters?.find((x) => x.id === ('cleared' in c ? c.cleared : c.encounter)); if (e) out.add(e.locationId); }
  else if ('sceneEnd' in c) {
    const d = world.scenes?.find((x) => x.id === c.sceneEnd);
    const npc = d?.npcId ? world.characters.find((x) => x.id === d.npcId) : undefined;
    if (d?.locationId) out.add(d.locationId); else if (npc) out.add(npcLocationOf(s, npc));
  }
  else if ('npcAt' in c) out.add(c.at);
  else if ('relationship' in c || 'stage' in c || 'inParty' in c) {
    const id = 'relationship' in c ? c.relationship : 'stage' in c ? c.stage : c.inParty;
    const npc = world.characters.find((x) => x.id === id);
    if (npc) out.add(npcLocationOf(s, npc));
  }
}

/** 이 장소에 가 볼 이유 (안 가 본 곳 · 찾을 것 · 진행 중인 임무가 가리키는 곳) */
function interest(world: WorldPackage, s: GameState, locId: string, targets: Set<string>): number {
  const l = world.locations.find((x) => x.id === locId);
  if (!l) return 0;
  const known = new Set(s.beliefs.filter((b) => b.holder === 'player').map((b) => b.claim));
  let n = 0;
  if (!(s.visited ?? []).includes(locId)) n += 2;
  if ((l.discoveries ?? []).some((d) => !known.has(d.claim))) n += 1.5;
  if (targets.has(locId)) n += 3;
  if ((world.flags ?? []).some((f) => f.locationId === locId && !s.flags.includes(f.id))) n += 1;
  return n;
}

/** 엔진 전용 플래그 ({ not: { all: [] } })는 GM이 세우지 않는다 */
const engineOnly = (world: WorldPackage, id: string) => { const r = world.flags?.find((f) => f.id === id)?.requires; return !!r && 'not' in r && 'all' in r.not && r.not.all.length === 0; };

function candidates(world: WorldPackage, s: GameState, rng: Rng): Cand[] {
  const out: Cand[] = [];
  const here = world.locations.find((l) => l.id === s.player.locationId);
  const targets = new Set<string>();
  for (const q of world.quests ?? []) { const p = s.quests[q.id]; if (p && !p.done && !p.failed) placesIn(world, s, q.stages[p.stage]?.complete, targets); }
  for (const f of world.flags ?? []) if (!s.flags.includes(f.id) && f.locationId && (!f.requires || evalCondition(world, s, f.requires))) targets.add(f.locationId);
  for (const to of here?.connections ?? []) {
    const name = world.locations.find((l) => l.id === to)?.name ?? to;
    // 한 걸음 너머의 목표도 조금 끌린다
    const via = Math.max(0, ...((world.locations.find((l) => l.id === to)?.connections ?? []).map((x) => interest(world, s, x, targets)))) * 0.4;
    out.push({ kind: 'move', label: `${name}(으)로 이동`, run: () => [{ type: 'moved', to }], pull: 1 + interest(world, s, to, targets) + via });
  }
  out.push({ kind: 'wait', label: '두어 시간 기다림', run: () => [{ type: 'time_advanced', minutes: 120 }] });
  out.push({ kind: 'rest', label: '긴 휴식', run: () => [{ type: 'rested', kind: 'long' }] });
  const knownNow = new Map(s.beliefs.filter((b) => b.holder === 'player').map((b) => [b.claim, b.state]));
  for (const npc of presentCharacters(world, s)) {
    const news = [...world.beliefs, ...s.beliefs].some((b) => b.holder === npc.id && knownNow.get(b.claim) !== 'confirmed' && !knownNow.has(b.claim));
    out.push({ kind: 'talk', label: `${npc.name}와(과) 대화`, pull: news ? 2.5 : 1, run: (st) => {
      const evs = relationshipEvents(world, st, npc, { affinity: 3, trust: 2, intimacy: 1 }, '자동 플레이: 대화');
      // 실제 플레이에서 NPC 연기 AI가 하듯: 아는 것을 하나 전하고(비밀은 신뢰가 있을 때만), 건넬 것을 건넨다
      const rel = relationshipOf(world, st.relationships, npc.id);
      const known = new Map(st.beliefs.filter((b) => b.holder === 'player').map((b) => [b.claim, b.state]));
      const tell = [...new Set([...world.beliefs, ...st.beliefs].filter((b) => b.holder === npc.id).map((b) => b.claim))]
        .map((cid) => shareableBelief(world, st.beliefs, npc.id, cid)!)
        .filter((b) => b && (b.state !== 'secret' || canShareSecret(world, npc.id, rel)) && known.get(b.claim) !== 'confirmed' && known.get(b.claim) !== playerStateFromNpc(b.state));
      if (tell.length && rng.next() < 0.6) {
        const b = tell[Math.floor(rng.next() * tell.length)]!;
        const claim = world.claims.find((c) => c.id === b.claim);
        if (claim) evs.push({ type: 'knowledge_revealed', belief: { holder: 'player', claim: claim.id, state: playerStateFromNpc(b.state), source: npc.id }, statement: claim.statement });
      }
      const gift = pendingGifts(world, st, npc.id)[0];
      if (gift && rng.next() < 0.4) { const g = gainEvent(world, gift, `${npc.name}에게 받았다`, gift.key); if (g) evs.push(g); }
      return evs;
    } });
    out.push({ kind: 'provoke', label: `${npc.name}를(을) 도발`, run: (st) => relationshipEvents(world, st, npc, { affinity: -4, grudge: 4, fear: 2 }, '자동 플레이: 도발') });
  }
  for (const d of pendingDiscoveries(world, s)) {
    const claim = world.claims.find((c) => c.id === d.claim);
    if (!claim) continue;
    out.push({ kind: 'discover', label: `조사: ${claim.statement.slice(0, 24)}`, run: () => (d.check && rng.next() < 0.4 ? [] : [{ type: 'knowledge_revealed', belief: { holder: 'player', claim: claim.id, state: d.state ?? 'confirmed', source: s.player.locationId }, statement: claim.statement }]) });
  }
  for (const p of pendingPickups(world, s)) {
    out.push({ kind: 'pickup', label: `줍기: ${p.key}`, run: () => { const e = gainEvent(world, p, '주웠다', p.key); return e ? [e] : []; } });
  }
  for (const f of world.flags ?? []) {
    if (s.flags.includes(f.id) || engineOnly(world, f.id) || !flagAllowed(world, s, f.id)) continue;
    out.push({ kind: 'flag', label: `결정: ${f.id}`, run: () => [{ type: 'flag_set', flag: f.id }] });
  }
  for (const r of actionRulesHit(world, s, '', (world.rules ?? []).map((x) => x.id))) {
    out.push({ kind: 'rule', label: `규칙 행동: ${r.name}`, run: (st) => fireRule(world, st, r, 'action').events });
  }
  for (const e of availableEncounters(world, s)) {
    out.push({ kind: 'fight', label: `전투: ${e.name}`, run: (st) => {
      const evs = beginEncounter(world, st, e.id, st.turn);
      const s2 = evs.reduce((x, ev) => applyEvent(x, ev, x.turn), st);
      return [...evs, ...autoFinishCombat(world, s2).events];
    } });
  }
  for (const d of availableScenes(world, s, { auto: false })) {
    out.push({ kind: 'scene', label: `장면: ${d.name}`, run: (st) => playScene(world, st, d.id, rng) });
  }
  const ch = pendingChoice(world, s);
  if (ch) {
    for (const o of ch.options) {
      out.push({ kind: 'choice', label: `결정적 선택: ${ch.name} → ${o.text}`, run: (st) => {
        const made: GameEvent = { type: 'choice_made', choiceId: ch.id, optionId: o.id, text: `${ch.name}: ${o.text}` };
        return [made, ...effectEvents(world, applyEvent(st, made, st.turn), o.effects, ch.name)];
      } });
    }
  }
  return out;
}

/** 장면을 무작위 행동으로 끝까지 (이미 시작된 장면도) */
function playScene(world: WorldPackage, st: GameState, sceneId: string | null, rng: Rng): GameEvent[] {
  let s = st;
  const events: GameEvent[] = [];
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, s.turn); };
  if (sceneId) startSceneEvents(world, s, sceneId).forEach(push);
  for (let i = 0; i < 80 && s.scene; i++) {
    const def = sceneDef(world, s.scene.sceneId);
    const ok = def ? sceneActions(def, s.scene, s.player.sheet).filter((a) => a.ok) : [];
    if (!ok.length) { abandonSceneEvents(world, s).forEach(push); break; }
    sceneActionEvents(world, s, ok[Math.floor(rng.next() * ok.length)]!.action.id).forEach(push);
  }
  if (s.scene) abandonSceneEvents(world, s).forEach(push);
  return events;
}

export interface AutoOptions { runs: number; steps: number; seed?: number; style?: AutoStyle; setup?: LabSetup; /** 죽어도 HP 1로 일어나 계속 (이야기 도달을 보려고, 기본 예) */ keepGoing?: boolean }

export interface AutoRun {
  seed: number; steps: number;
  ending?: { id: string; name: string; step: number };
  dead: boolean; stuck: boolean;
  /** 죽었다가 계속한 횟수 */
  deaths: number;
  trace: string[];
  fights: { id: string; outcome: 'victory' | 'defeat' | 'fled' }[];
  state: GameState;
}

export interface AutoReport {
  runs: number; steps: number; style: AutoStyle;
  endings: Record<string, { n: number; avgStep: number }>;
  noEnding: number; dead: number; stuck: number;
  /** 죽었다가 계속한 횟수 (모든 실행 합) */
  deaths: number;
  quests: Record<string, { started: number; done: number; failed: number }>;
  rules: Record<string, number>;
  flags: Record<string, number>;
  scenes: Record<string, { started: number; ends: Record<string, number> }>;
  encounters: Record<string, { fought: number; victory: number; defeat: number; fled: number }>;
  choices: Record<string, Record<string, number>>;
  actions: Record<string, number>;
  avgLevel: number;
  /** 첫 번째 실행의 기록 */
  sample: AutoRun;
  /** 실행마다 마지막 상태 (도달하지 못한 결말의 조건을 볼 때) */
  finals: GameState[];
}

/** 한 번의 자동 플레이 */
export function autoRun(world: WorldPackage, seed: number, steps: number, style: AutoStyle = 'balanced', setup: LabSetup = {}, onAction?: (k: string) => void, keepGoing = true): AutoRun {
  const rng = createRng(seed);
  let s = labState(world, { ...setup, seed });
  const trace: string[] = [];
  const fights: AutoRun['fights'] = [];
  const push = (e: GameEvent) => { if (e.type === 'combat_ended' && s.combat) fights.push({ id: s.combat.encounterId, outcome: e.outcome }); s = applyEvent(s, e, s.turn); const t = describeEvent(world, e); if (t && e.type !== 'combat_started') trace.push(`   ${t}`); };
  // 시작 직후의 엔진 단계 (시작 임무 등)
  scenarioEvents(world, s).events.forEach(push);
  let stuck = false;
  let deaths = 0;
  let ending: AutoRun['ending'];
  let i = 0;
  for (; i < steps && !s.ending && !s.playerDead; i++) {
    s = { ...s, turn: s.turn + 1 };
    // 강제 조우·전환 효과로 시작된 전투는 먼저 끝까지 (v0.85)
    if (s.combat) { trace.push(`${i + 1}. 전투 진행 (저절로 시작됨)`); autoFinishCombat(world, s).events.forEach(push); scenarioEvents(world, s).events.forEach(push); continue; }
    // 저절로 시작한 장면은 먼저 끝까지
    if (s.scene) { trace.push(`${i + 1}. 장면 진행: ${sceneDef(world, s.scene.sceneId)?.name ?? s.scene.sceneId}`); playScene(world, s, null, rng).forEach(push); continue; }
    const list = candidates(world, s, rng);
    if (!list.length) { stuck = true; break; }
    // 다쳤으면 쉬고 싸움을 피한다
    const hurt = s.player.sheet.hp < s.player.sheet.maxHp * 0.5;
    const w = hurt ? { ...WEIGHTS[style], rest: WEIGHTS[style].rest * 8, fight: WEIGHTS[style].fight * 0.15 } : WEIGHTS[style];
    // 종류마다 무게를 그 종류 후보 수로 나눠(이동할 곳이 많다고 이동만 하지 않게) 끌림만큼 곱한다
    const per: Partial<Record<Kind, number>> = {};
    for (const c of list) per[c.kind] = (per[c.kind] ?? 0) + (c.pull ?? 1);
    const weight = (c: Cand) => (w[c.kind] * (c.pull ?? 1)) / per[c.kind]!;
    const total = list.reduce((n, c) => n + weight(c), 0);
    let r = rng.next() * total;
    const pick = list.find((c) => (r -= weight(c)) < 0) ?? list[list.length - 1]!;
    onAction?.(pick.kind);
    trace.push(`${i + 1}. ${pick.label}`);
    const before = s;
    try { pick.run(s).forEach(push); } catch (e) { trace.push(`   ⚠ ${(e as Error).message}`); s = before; }
    // 걸린 시간 (전투·장면·휴식은 각자 시간이 흐른다)
    if (!['fight', 'scene', 'rest', 'wait'].includes(pick.kind)) {
      const t = turnMinutes(world, pick.kind === 'talk' || pick.kind === 'provoke' ? 'exchange' : 'scene', pick.kind === 'move');
      if (t.minutes > 0) push({ type: 'time_advanced', minutes: t.minutes });
    }
    scenarioEvents(world, s).events.forEach(push);
    if (s.playerDead && keepGoing && !s.ending) {
      deaths++;
      trace.push('   ✝ 사망 — 시험을 위해 HP 1로 일어나 계속');
      s = { ...s, playerDead: false, player: { ...s.player, sheet: { ...s.player.sheet, hp: 1 } } };
    }
  }
  if (s.ending) ending = { id: s.ending, name: world.endings?.find((e) => e.id === s.ending)?.name ?? s.ending, step: i };
  return { seed, steps: i, ...(ending ? { ending } : {}), dead: !!s.playerDead, stuck, deaths, trace, fights, state: s };
}

/** 여러 번 돌려 보고서. onProgress로 진행률 (UI가 멈추지 않게 실행 사이에 쉼) */
export async function autoPlay(world: WorldPackage, o: AutoOptions, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<AutoReport> {
  const style = o.style ?? 'balanced';
  const rep: AutoReport = {
    runs: 0, steps: o.steps, style, endings: {}, noEnding: 0, dead: 0, stuck: 0, deaths: 0, quests: {}, rules: {}, flags: {}, scenes: {}, encounters: {}, choices: {}, actions: {}, avgLevel: 0,
    sample: undefined as unknown as AutoRun, finals: [],
  };
  let levels = 0;
  for (let k = 0; k < o.runs; k++) {
    if (signal?.aborted) break;
    const r = autoRun(world, (o.seed ?? 1) * 7919 + k, o.steps, style, o.setup, (a) => { rep.actions[a] = (rep.actions[a] ?? 0) + 1; }, o.keepGoing !== false);
    if (k === 0) rep.sample = r;
    rep.runs++;
    const s = r.state;
    rep.finals.push(s);
    levels += s.player.sheet.level;
    if (r.ending) { const e = (rep.endings[r.ending.id] ??= { n: 0, avgStep: 0 }); e.avgStep = (e.avgStep * e.n + r.ending.step) / (e.n + 1); e.n++; } else rep.noEnding++;
    if (r.dead) rep.dead++;
    rep.deaths += r.deaths;
    if (r.stuck) rep.stuck++;
    for (const [id, p] of Object.entries(s.quests)) { const q = (rep.quests[id] ??= { started: 0, done: 0, failed: 0 }); q.started++; if (p.failed) q.failed++; else if (p.done) q.done++; }
    for (const [id, st] of Object.entries(s.rules ?? {})) if (st.count) rep.rules[id] = (rep.rules[id] ?? 0) + 1;
    for (const f of s.flags) rep.flags[f] = (rep.flags[f] ?? 0) + 1;
    for (const [id, res] of Object.entries(s.sceneResults ?? {})) { const x = (rep.scenes[id] ??= { started: 0, ends: {} }); x.started++; x.ends[res.endId] = (x.ends[res.endId] ?? 0) + 1; }
    for (const [id, c] of Object.entries(s.choices ?? {})) if (c.chosen) { const x = (rep.choices[id] ??= {}); x[c.chosen] = (x[c.chosen] ?? 0) + 1; }
    for (const f of r.fights) { const x = (rep.encounters[f.id] ??= { fought: 0, victory: 0, defeat: 0, fled: 0 }); x.fought++; x[f.outcome]++; }
    onProgress?.(k + 1);
    if (k % 2 === 1) await new Promise((res) => setTimeout(res, 0));
  }
  rep.avgLevel = rep.runs ? Math.round((levels / rep.runs) * 10) / 10 : 0;
  for (const e of Object.values(rep.endings)) e.avgStep = Math.round(e.avgStep);
  return rep;
}

/** 보고서의 "한 번도" 목록 */
export function neverSeen(world: WorldPackage, rep: AutoReport) {
  return {
    endings: (world.endings ?? []).filter((e) => !rep.endings[e.id]),
    quests: (world.quests ?? []).filter((q) => !rep.quests[q.id]),
    questsNeverDone: (world.quests ?? []).filter((q) => rep.quests[q.id] && !rep.quests[q.id]!.done),
    rules: (world.rules ?? []).filter((r) => r.enabled !== false && !rep.rules[r.id]),
    flags: (world.flags ?? []).filter((f) => !rep.flags[f.id]),
    scenes: (world.scenes ?? []).filter((d) => !rep.scenes[d.id]),
    encounters: (world.encounters ?? []).filter((e) => !rep.encounters[e.id]),
    choices: (world.choices ?? []).filter((c) => !rep.choices[c.id]),
  };
}

export { KIND_LABEL as AUTO_ACTION_LABEL };

/** 막힌 조건 분석: 실행들의 마지막 상태에서 하위 조건마다 몇 %가 참이었나 (가장 덜 채워진 것부터) */
export function blockers(world: WorldPackage, finals: GameState[], c: Condition): { c: Condition; pct: number }[] {
  const leaves: Condition[] = [];
  const walk = (x: Condition) => { if ('all' in x) x.all.forEach(walk); else if ('any' in x) x.any.forEach(walk); else leaves.push(x); };
  walk(c);
  if (!finals.length) return [];
  return leaves.map((leaf) => ({ c: leaf, pct: Math.round((finals.filter((s) => evalCondition(world, s, leaf)).length / finals.length) * 100) }))
    .sort((a, b) => a.pct - b.pct);
}
