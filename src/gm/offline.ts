/**
 * AI 없이 진행하는 턴 (v0.116, 설계 v6 M7): 갈래 카드 덱만으로 이야기를 굴린다.
 *  - 키 없이 해 보는 체험판: 카드의 글(text · successText · failText)을 서술로 쓴다.
 *  - 분기 다양성 점검: 성향이 다른 정책으로 같은 세계를 굴려 갈라지는 정도를 잰다.
 * 판정·효과·걸린 것·후폭풍·국면은 AI가 있을 때와 같은 엔진 규칙을 쓴다.
 */
import { TIME_STEPS } from '../engine/time';
import { activeStorylet, parseOptionKey, storyletOf } from '../engine/storylets';
import { currentPhase, phasesOf } from '../engine/phase';
import { parseStake, stakeValid } from '../engine/stakes';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { basicGuide } from './guide';
import { autoFightEvents, availableEncounters, beginEncounter, playerEndTurn } from './combat';
import { scenarioEvents } from './scenario';
import { phaseEvents } from './phase';
import { falloutEvents, stakeEvents } from './stakes';
import { chooseOptionEvents, openStoryletEvents } from './storylets';

const clean = (l: string) => l.replace(/\s*\(엔진 확정[^)]*\)/g, '').replace(/엔진 확정 — /g, '').replace(/^플레이어가 /, '당신이 ');

/** 선택지 하나로 한 턴 (option: "카드#갈림길" · move: 이동 선택지의 글) */
export function runOfflineTurn(world: WorldPackage, state: GameState, choice: { text: string; option?: string; move?: boolean }): { events: GameEvent[]; state: GameState } {
  if (state.combat || state.scene || state.playerDead) throw new Error('지금은 선택지로 진행할 수 없다');
  const turn = state.turn + 1;
  const events: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, turn); };
  push({ type: 'player_input', text: choice.text });
  const lines: string[] = [];
  const fo = falloutEvents(world, s);
  fo.events.forEach(push);
  for (const e of fo.events) if (e.type === 'fallout_fired') lines.push(`${e.text}.`);

  let moved = false;
  if (choice.option) {
    const hit = parseOptionKey(world, choice.option);
    const r = chooseOptionEvents(world, s, choice.option);
    if (!r || !hit) throw new Error('지금 고를 수 있는 갈림길이 아니다');
    r.events.forEach(push);
    const ok = r.tier !== 'fail';
    const text = ok ? hit.option.successText : hit.option.failText;
    if (text) lines.push(text);
    else lines.push(...r.lines.slice(1).map(clean));
    if (r.stake && stakeValid(world, s, r.stake)) {
      const sk = stakeEvents(world, s, r.stake, r.tier, hit.option.label);
      sk.events.forEach(push);
      if (!text && sk.line) lines.push(`${sk.line}.`);
    }
    moved = r.events.some((e) => e.type === 'moved');
    if (r.encounterId && availableEncounters(world, s).some((e) => e.id === r.encounterId)) beginEncounter(world, s, r.encounterId, turn).forEach(push);
  } else if (choice.move) {
    const here = world.locations.find((l) => l.id === s.player.locationId);
    const to = (here?.connections ?? []).map((id) => world.locations.find((l) => l.id === id)!).find((l) => l && choice.text.includes(l.name));
    if (!to) throw new Error('갈 수 없는 곳이다');
    push({ type: 'moved', to: to.id });
    moved = true;
    lines.push(`당신은 ${to.name}에 닿는다. ${to.description.split(/(?<=[.!?。])\s/)[0] ?? ''}`);
  }
  push({ type: 'time_advanced', minutes: TIME_STEPS.scene.minutes + (moved ? 30 : 0) });
  const sc = scenarioEvents(world, s);
  sc.events.forEach(push);
  const ph = phaseEvents(world, s, events);
  ph.forEach(push);
  for (const e of ph) if (e.type === 'phase_changed' && e.from) lines.push(`— ${e.name}. ${e.announce ?? ''}`.trim());
  if (!s.combat && !s.scene) openStoryletEvents(world, s, { quiet: true }).forEach(push);
  const card = activeStorylet(world, s);
  const opened = events.find((e) => e.type === 'storylet_opened');
  if (s.combat) lines.push('적이 나타났다 — 싸움이다.');
  else if (opened && card) lines.push(card.text ?? card.situation);
  else if (!lines.length) lines.push(world.locations.find((l) => l.id === s.player.locationId)?.description ?? '시간이 흐른다.');
  push({ type: 'narration', text: lines.filter(Boolean).join('\n\n') });
  if (!s.combat && !s.scene && !s.playerDead) push(basicGuide(world, s));
  return { events, state: s };
}

/** 전투·장면이 끝난 뒤 (AI 없이): 다음 카드를 펼치고 서술·선택지를 붙인다 */
export function afterFightOffline(world: WorldPackage, state: GameState, outcome?: string): GameEvent[] {
  if (state.combat || state.scene || state.playerDead) return [];
  const events: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { events.push(e); s = applyEvent(s, e, state.turn); };
  openStoryletEvents(world, s, { quiet: true }).forEach(push);
  const card = events.find((e) => e.type === 'storylet_opened') ? activeStorylet(world, s) : undefined;
  push({ type: 'narration', text: [outcome ?? '싸움이 끝났다. 숨을 고른다.', card ? card.text ?? card.situation : ''].filter(Boolean).join('\n\n') });
  push(basicGuide(world, s));
  return events;
}

// ---------------------------------------------------------------- 분기 다양성 점검

export type Policy = 'cautious' | 'social' | 'reckless';
export const POLICY_LABEL: Record<Policy, string> = { cautious: '신중 (가라앉힘·봉인 쪽)', social: '관계 (가까워짐·누구 편)', reckless: '파괴 (판을 키움·배신·폭로·힘 쪽)' };
const PREF: Record<Policy, string[]> = {
  cautious: ['defuse', 'theme-', 'bond', 'side', 'thread', 'escalate', 'theme+', 'expose', 'betray'],
  social: ['bond', 'side', 'defuse', 'thread', 'theme-', 'theme+', 'expose', 'escalate', 'betray'],
  reckless: ['escalate', 'betray', 'expose', 'theme+', 'side', 'thread', 'bond', 'theme-', 'defuse'],
};
const stakeClass = (id?: string) => { const st = parseStake(id); return !st ? 'none' : st.kind === 'theme' ? (st.dir === 1 ? 'theme+' : 'theme-') : st.kind; };

export interface RunTrace { policy: Policy; phases: string[]; cards: string[]; choices: string[]; ending?: string; turns: number; tension: number[]; /** 끝난 까닭 */ stop?: string }

/** 정책대로 n턴 굴린다 (AI 없음 · 전투는 자동으로 끝까지) */
export function simulatePolicy(world: WorldPackage, start: GameState, policy: Policy, n = 40): RunTrace {
  // 이야기를 재는 것이므로 전투는 "이야기" 난이도로 (1레벨 주인공이 첫 전투에서 죽어 시뮬레이션이 끝나지 않게)
  let s = applyEvent(start, { type: 'difficulty_set', dcMod: -8, label: '이야기' }, start.turn);
  const trace: RunTrace = { policy, phases: [s.phase ?? ''], cards: [], choices: [], turns: 0, tension: [] };
  for (let i = 0; i < n; i++) {
    if (s.playerDead) { trace.stop = '죽었다'; break; }
    if (s.combat) { s = finishCombat(world, s); s = afterFightOffline(world, s).reduce((x, e) => applyEvent(x, e, x.turn), s); continue; }
    // 다친 채로 다음 일에 뛰어들지 않는다 (사람이 하듯이 쉰다)
    if (s.player.sheet.hp < s.player.sheet.maxHp / 2) s = applyEvent(s, { type: 'rested', kind: 'long' }, s.turn);
    const guide = [...s.log].reverse().find((l) => l.kind === 'guide');
    const opts = (guide?.choiceOptions ?? []).map((o, k) => ({ o, k })).filter((x) => x.o);
    let choice: { text: string; option?: string; move?: boolean };
    if (opts.length) {
      const ranked = [...opts].sort((a, b) => rank(policy, guide!.choiceStakes?.[a.k]) - rank(policy, guide!.choiceStakes?.[b.k]));
      const pick = ranked[0]!;
      choice = { text: guide!.choices![pick.k]!, option: pick.o };
      trace.choices.push(pick.o);
    } else {
      const k = (guide?.choiceKinds ?? []).indexOf('move');
      if (k < 0) { trace.stop = '고를 것이 없다'; break; }
      choice = { text: guide!.choices![k]!, move: true };
    }
    try { s = runOfflineTurn(world, s, choice).state; } catch (e) { trace.stop = String((e as Error).message); break; }
    trace.turns++;
    const card = activeStorylet(world, s)?.id;
    if (card && trace.cards.at(-1) !== card) trace.cards.push(card);
    if (s.phase && trace.phases.at(-1) !== s.phase) trace.phases.push(s.phase);
    trace.tension.push(s.vars?.drama ?? 2);
    if (s.ending) { trace.ending = s.ending; break; }
  }
  return trace;
}
const rank = (p: Policy, stake?: string) => { const i = PREF[p].indexOf(stakeClass(stake)); return i < 0 ? 99 : i; };

function finishCombat(world: WorldPackage, s: GameState): GameState {
  let st = s;
  for (let g = 0; g < 50 && st.combat && !st.combat.outcome && !st.playerDead; g++) {
    const r = autoFightEvents(world, st);
    st = r.events.reduce((x, e) => applyEvent(x, e, x.turn), st);
    // 시뮬레이션은 위험해져도 멈추지 않고 끝까지 싸운다
    if (r.stopped && st.combat && !st.combat.outcome) st = playerEndTurn(world, st).reduce((x, e) => applyEvent(x, e, x.turn), st);
  }
  return st;
}

export interface Divergence { traces: RunTrace[]; cardOverlap: number; phaseDistinct: number; score: number; verdict: string }

/** 세 정책으로 굴려 서로 얼마나 다른가: 카드 겹침(자카드)의 반대 + 국면 경로가 다른 비율 */
export function divergence(world: WorldPackage, start: GameState, n = 40): Divergence {
  const traces = (Object.keys(POLICY_LABEL) as Policy[]).map((p) => simulatePolicy(world, start, p, n));
  const pairs: [RunTrace, RunTrace][] = [[traces[0]!, traces[1]!], [traces[0]!, traces[2]!], [traces[1]!, traces[2]!]];
  const jac = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const inter = [...A].filter((x) => B.has(x)).length; const uni = new Set([...A, ...B]).size; return uni ? inter / uni : 1; };
  const cardOverlap = pairs.reduce((x, [a, b]) => x + jac(a.cards, b.cards), 0) / pairs.length;
  const phaseDistinct = pairs.filter(([a, b]) => a.phases.join('>') !== b.phases.join('>')).length / pairs.length;
  const score = Math.round(((1 - cardOverlap) * 0.6 + phaseDistinct * 0.4) * 100);
  const verdict = !world.storylets?.length ? '갈래 카드가 없어 점검할 수 없습니다.' : score >= 60 ? '선택에 따라 이야기가 충분히 갈라집니다.' : score >= 35 ? '조금 갈라집니다 — 카드의 조건(국면·고른 길·관계)을 더 걸어 보세요.' : '거의 같은 길로 갑니다 — 카드 대부분이 조건 없이 늘 나옵니다.';
  return { traces, cardOverlap, phaseDistinct, score, verdict };
}

/** 국면 ID → 이름 (보고서용) */
export const phaseLabel = (world: WorldPackage, id: string) => phasesOf(world).find((p) => p.id === id)?.name ?? id;
export const cardLabel = (world: WorldPackage, id: string) => storyletOf(world, id)?.title ?? id;
export const nowPhase = currentPhase;
