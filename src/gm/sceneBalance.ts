/**
 * 장면 결과 비율 맞추기 (v0.104) — 제작자가 "어느 끝이 몇 %로 나오면 좋겠다"를 정하면,
 * 자동 시뮬레이션을 되풀이하며 장면의 숫자(판정 난이도 · 끝 조건의 기준값 · 수치 시작값 · 차례 한도)를 조금씩 움직여 맞춘다.
 *
 * 방법: 한 번에 숫자 하나를 한두 칸 움직여 보고, 목표와의 차이가 가장 줄어드는 쪽을 받아들이기를 되풀이한다 (좌표 하강).
 * 비교는 늘 같은 주사위 흐름으로 하므로, 차이는 운이 아니라 숫자를 바꾼 결과다. 원래 값에서 멀어질수록 조금 불리하게 쳐서 꼭 필요한 만큼만 바꾼다.
 * 글·그림·행동의 종류·효과는 건드리지 않는다.
 */
import type { CharacterSheet } from '../engine/character/sheet';
import type { SceneCond, SceneDef, WorldPackage } from '../engine/schema';
import { type SimPolicy, type SimResult, simulateScene } from './sceneTest';

export type BalanceKnob = 'dc' | 'ends' | 'start' | 'rounds';
export const BALANCE_KNOBS: Record<BalanceKnob, { name: string; detail: string }> = {
  dc: { name: '판정 난이도 (DC)', detail: '행동마다의 DC를 5~20 사이에서 움직입니다. 성공이 너무 많으면 올리고, 적으면 내립니다. 가장 자연스럽게 먹히는 손잡이입니다.' },
  ends: { name: '끝 조건의 기준값', detail: '"합의도 10 이상이면 성사" 같은 끝 조건의 숫자를 그 수치의 범위 안에서 움직입니다. 특정 끝이 너무 일찍·늦게 나올 때 잘 듣습니다.' },
  start: { name: '수치의 시작값', detail: '수치가 처음에 몇에서 출발하는지를 범위 안에서 움직입니다. 한쪽 끝에 처음부터 너무 가까울 때 잘 듣습니다.' },
  rounds: { name: '차례 한도', detail: '장면이 몇 차례 뒤에 끝나는지를 3~20 사이에서 움직입니다. "시간이 다 됐다" 끝의 비율을 바꿉니다.' },
};

export interface BalanceOptions {
  /** 끝 id → 목표 비율 (합이 100이 아니어도 된다 — 합에 맞춰 나눈다) */
  targets: Record<string, number>;
  knobs: BalanceKnob[];
  policy?: SimPolicy;
  /** 시험 한 번에 돌리는 횟수 (기본 400 — 적으면 그 주사위에만 맞는 설정을 고른다) */
  runs?: number;
  seed?: number;
  /** 시험 횟수 한도 (기본 260) */
  maxEvals?: number;
  /** 이 차이(%p 합) 아래면 그만 (기본 6) */
  tolerance?: number;
  /** 시험 사이에 화면에 양보 · 진행 알림. false를 돌려주면 멈춘다 */
  onStep?: (info: { evals: number; maxEvals: number; gap: number }) => Promise<boolean | void> | boolean | void;
}
export interface BalanceResult {
  scene: SceneDef;
  before: SimResult;
  after: SimResult;
  /** 목표와의 차이: 끝마다 |실제% − 목표%|의 합 (작을수록 좋다) */
  gapBefore: number;
  gapAfter: number;
  /** 사람이 읽는 바뀐 것 목록 */
  changes: string[];
  evals: number;
  /** 맞추지 못한 까닭 (차이가 크게 남았을 때) */
  note?: string;
}

interface Param { label: string; get: (d: SceneDef) => number; set: (d: SceneDef, v: number) => void; lo: number; hi: number }

/** 끝 조건 안의 수치 기준들 (all/any/not 안쪽까지) */
function gaugeConds(c: SceneCond | undefined, out: Extract<SceneCond, { gauge: string }>[] = []) {
  if (!c) return out;
  if ('gauge' in c) out.push(c);
  else if ('all' in c) c.all.forEach((x) => gaugeConds(x, out));
  else if ('any' in c) c.any.forEach((x) => gaugeConds(x, out));
  else if ('not' in c) gaugeConds(c.not, out);
  return out;
}

/** 움직일 수 있는 숫자들 */
export function balanceParams(def: SceneDef, knobs: BalanceKnob[]): Param[] {
  const ps: Param[] = [];
  const range = (id: string): [number, number] => { const g = def.gauges.find((x) => x.id === id); return [g?.min ?? 0, g?.max ?? 10]; };
  const gname = (id: string) => def.gauges.find((x) => x.id === id)?.name ?? id;
  if (knobs.includes('dc')) def.actions.forEach((a, i) => { if (a.check) ps.push({ label: `행동 「${a.name}」의 DC`, get: (d) => d.actions[i]!.dc ?? 12, set: (d, v) => { d.actions[i]!.dc = v; }, lo: 5, hi: 20 }); });
  if (knobs.includes('ends')) def.ends.forEach((e, i) => gaugeConds(e.when).forEach((c, j) => {
    const [lo, hi] = range(c.gauge); const key = c.gte !== undefined ? 'gte' : 'lte';
    ps.push({ label: `끝 「${e.name}」의 기준 — ${gname(c.gauge)} ${key === 'gte' ? '이상' : '이하'}`, get: (d) => gaugeConds(d.ends[i]!.when)[j]![key] ?? 0, set: (d, v) => { gaugeConds(d.ends[i]!.when)[j]![key] = v; }, lo, hi });
  }));
  if (knobs.includes('start')) def.gauges.forEach((g, i) => ps.push({ label: `수치 「${g.name}」의 시작값`, get: (d) => d.gauges[i]!.start, set: (d, v) => { d.gauges[i]!.start = v; }, lo: g.min ?? 0, hi: g.max ?? 10 }));
  if (knobs.includes('rounds') && def.maxRounds) ps.push({ label: '차례 한도', get: (d) => d.maxRounds ?? 8, set: (d, v) => { d.maxRounds = v; }, lo: 3, hi: 20 });
  return ps.filter((p) => p.hi > p.lo);
}

/** 목표를 합 100으로 */
export function normalizeTargets(def: SceneDef, targets: Record<string, number>): Record<string, number> {
  const raw = def.ends.map((e) => Math.max(0, Number(targets[e.id]) || 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(def.ends.map((e, i) => [e.id, sum > 0 ? (raw[i]! / sum) * 100 : 100 / def.ends.length]));
}

/** 목표와의 차이 (%p 합). 멈추거나 안 끝나는 판은 두 배로 친다 */
export function balanceGap(def: SceneDef, sim: SimResult, target: Record<string, number>): number {
  const pct = (n: number) => (n / sim.runs) * 100;
  return def.ends.reduce((s, e) => s + Math.abs(pct(sim.ends[e.id] ?? 0) - (target[e.id] ?? 0)), 0) + 2 * pct(sim.stuck + sim.endless);
}

export async function balanceScene(world: WorldPackage, sceneId: string, sheet: CharacterSheet, o: BalanceOptions): Promise<BalanceResult> {
  const orig = (world.scenes ?? []).find((s) => s.id === sceneId);
  if (!orig) throw new Error('없는 장면이다');
  const runs = o.runs ?? 400, seed = o.seed ?? 7, maxEvals = o.maxEvals ?? 260, tol = o.tolerance ?? 6, policy = o.policy ?? 'random';
  const target = normalizeTargets(orig, o.targets);
  const sim = (d: SceneDef, n = runs, sd = seed) => simulateScene({ ...world, scenes: (world.scenes ?? []).map((s) => (s.id === sceneId ? d : s)) }, sceneId, sheet, n, sd, policy);
  const params = balanceParams(orig, o.knobs);
  const base = params.map((p) => p.get(orig));
  let cur = structuredClone(orig);
  let evals = 0;
  // 원래 값에서 한 칸 멀어질 때마다 0.25%p만큼 불리하게 — 비슷하게 맞는다면 덜 바꾼 쪽을 고른다
  const score = (d: SceneDef, s: SimResult) => balanceGap(d, s, target) + 0.25 * params.reduce((a, p, i) => a + Math.abs(p.get(d) - base[i]!), 0);
  const before = sim(cur); evals++;
  let best = score(cur, before), bestSim = before;
  let stopped = false;
  outer: for (let pass = 0; pass < 8 && balanceGap(cur, bestSim, target) > tol; pass++) {
    let improved = false;
    for (const p of params) {
      const v0 = p.get(cur);
      let pick: { v: number; sc: number; sim: SimResult } | null = null;
      for (const step of [1, -1, 2, -2, 4, -4]) {
        const v = v0 + step;
        if (v < p.lo || v > p.hi) continue;
        if (evals >= maxEvals) break;
        const cand = structuredClone(cur); p.set(cand, v);
        const s = sim(cand); evals++;
        const sc = score(cand, s);
        if (sc < best - 0.01 && (!pick || sc < pick.sc)) pick = { v, sc, sim: s };
        if (o.onStep && (await o.onStep({ evals, maxEvals, gap: Math.round(balanceGap(cur, bestSim, target)) })) === false) { stopped = true; break; }
      }
      if (pick) { p.set(cur, pick.v); best = pick.sc; bestSim = pick.sim; improved = true; }
      if (stopped || evals >= maxEvals) break outer;
      if (balanceGap(cur, bestSim, target) <= tol) break outer;
    }
    if (!improved) break;
  }
  // 다른 주사위로 다시 재서 보여 준다 (맞춘 주사위에만 맞은 것이 아닌지)
  const check = (d: SceneDef) => sim(d, 600, seed + 1013);
  const b2 = check(orig);
  let a2 = check(cur);
  // 다른 주사위로 재 보니 나아지지 않았으면 원래대로 둔다
  let worse = false;
  if (balanceGap(cur, a2, target) >= balanceGap(orig, b2, target) - 1) { worse = params.some((p, i) => p.get(cur) !== base[i]); cur = structuredClone(orig); a2 = b2; }
  const changes = params.flatMap((p, i) => (p.get(cur) !== base[i] ? [`${p.label}: ${base[i]} → ${p.get(cur)}`] : []));
  const gapAfter = Math.round(balanceGap(cur, a2, target)), gapBefore = Math.round(balanceGap(orig, b2, target));
  const note = !params.length ? '움직일 수 있는 숫자가 없습니다. 손잡이를 더 고르거나, 판정이 있는 행동·수치 기준의 끝 조건이 있는지 확인하세요.'
    : worse ? '더 나은 설정을 찾지 못해 원래대로 두었습니다. 다른 손잡이를 켜거나 목표를 조금 바꿔 보세요.'
    : stopped ? '중간에 멈췄습니다. 여기까지 찾은 설정입니다.'
    : gapAfter > Math.max(tol * 2, 15) ? `고른 손잡이만으로는 목표에 다 닿지 못했습니다 (차이 ${gapAfter}%p). 다른 손잡이도 켜거나, 목표를 조금 바꾸거나, 그 끝으로 가는 행동·반작용을 손봐야 할 수 있습니다.` : undefined;
  return { scene: cur, before: b2, after: a2, gapBefore, gapAfter, changes, evals, ...(note ? { note } : {}) };
}
