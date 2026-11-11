/**
 * 장면 끝 진단 (v0.105) — 한 번도(또는 거의) 나오지 않는 끝이 왜 안 나오는지, 무엇을 고치면 나오는지 알려 준다.
 *
 * 비율 맞추기는 숫자만 움직이므로, 그 끝으로 가는 길 자체가 막혀 있으면 아무리 돌려도 나오지 않는다.
 * 여기서는 자동 시험을 돌리며 수치가 어디까지 갔는지·어떤 상태와 단계가 나왔는지·어느 끝이 먼저 났는지를 적어 두고,
 * 장면의 구조(범위 · 수치를 움직이는 행동 · 끝의 순서 · 차례 한도)와 맞춰 보아 까닭을 가린다.
 */
import type { CharacterSheet } from '../engine/character/sheet';
import { createRng } from '../engine/dice/rng';
import { sceneActions, sceneCond } from '../engine/scene';
import type { SceneCond, SceneDef, SceneDelta, WorldPackage } from '../engine/schema';
import { applyEvent } from '../engine/state/state';
import { sceneActionEvents } from './scene';
import { sandboxState, type SimPolicy } from './sceneTest';

export interface Finding { /** 왜 안 나오는가 */ why: string; /** 무엇을 고치면 되는가 */ fix: string }
export interface EndDiagnosis { endId: string; name: string; count: number; runs: number; findings: Finding[] }
export interface SceneTrace {
  runs: number;
  ends: Record<string, number>;
  avgRounds: number; maxRoundsSeen: number;
  gaugeMax: Record<string, number>; gaugeMin: Record<string, number>;
  states: Set<string>; phases: Set<string>;
  /** 끝 id → (먼저 맞아 이긴 끝 id → 횟수): 조건은 맞았지만 위의 끝에 가려진 판 */
  shadowed: Record<string, Record<string, number>>;
  usedActions: Set<string>;
}

const CAP = 200;

/** 자동 시험을 돌리며 진단에 필요한 것을 적는다 */
export function traceScene(world: WorldPackage, sceneId: string, sheet: CharacterSheet, runs = 400, seed = 7, policy: SimPolicy = 'random'): SceneTrace {
  const def = (world.scenes ?? []).find((s) => s.id === sceneId)!;
  const pick = createRng(seed);
  const t: SceneTrace = { runs, ends: {}, avgRounds: 0, maxRoundsSeen: 0, gaugeMax: {}, gaugeMin: {}, states: new Set(), phases: new Set(), shadowed: {}, usedActions: new Set() };
  let sum = 0, done = 0;
  const note = (run: NonNullable<ReturnType<typeof sandboxState>['scene']>) => {
    for (const [g, v] of Object.entries(run.gauges)) { t.gaugeMax[g] = Math.max(t.gaugeMax[g] ?? v, v); t.gaugeMin[g] = Math.min(t.gaugeMin[g] ?? v, v); }
    run.states.forEach((s) => t.states.add(s));
    if (run.phase) t.phases.add(run.phase);
  };
  for (let i = 0; i < runs; i++) {
    let s = sandboxState(world, sceneId, sheet, seed * 1000 + i);
    if (s.scene) note(s.scene);
    let rounds = 0;
    while (s.scene && rounds < CAP) {
      const ok = sceneActions(def, s.scene, s.player.sheet).filter((a) => a.ok);
      if (!ok.length) break;
      let a = ok[Math.floor(pick.next() * ok.length)]!.action;
      if (policy === 'careful' && pick.next() < 0.7) {
        const chance = (x: (typeof ok)[number]) => (x.spec ? Math.max(0.05, Math.min(0.95, (21 - (x.dc - (x.mod ?? 0))) / 20)) : 1);
        a = ok.reduce((best, x) => (chance(x) > chance(best) ? x : best)).action;
      }
      t.usedActions.add(a.id);
      const evs = sceneActionEvents(world, s, a.id);
      const last = evs.find((e) => e.type === 'scene_action');
      if (last && last.type === 'scene_action') {
        note(last.run);
        // 이 차례에 조건이 맞은 끝들: 위에서부터 처음 것이 이기고, 나머지는 가려진다
        const hit = def.ends.filter((e) => sceneCond(e.when, last.run));
        if (hit.length > 1) for (const e of hit.slice(1)) { const m = (t.shadowed[e.id] ??= {}); m[hit[0]!.id] = (m[hit[0]!.id] ?? 0) + 1; }
      }
      s = evs.reduce((x, e) => applyEvent(x, e, x.turn), s);
      rounds++;
    }
    if (s.scene) continue;
    const endId = s.sceneResults?.[def.id]?.endId ?? '?';
    t.ends[endId] = (t.ends[endId] ?? 0) + 1;
    sum += rounds; done++; t.maxRoundsSeen = Math.max(t.maxRoundsSeen, rounds);
  }
  t.avgRounds = done ? Math.round((sum / done) * 10) / 10 : 0;
  return t;
}

type Leaf = Exclude<SceneCond, { all: SceneCond[] } | { any: SceneCond[] } | { not: SceneCond }>;
function leaves(c: SceneCond | undefined, out: Leaf[] = [], negated = { v: false }): Leaf[] {
  if (!c) return out;
  if ('all' in c) c.all.forEach((x) => leaves(x, out, negated));
  else if ('any' in c) c.any.forEach((x) => leaves(x, out, negated));
  else if ('not' in c) negated.v = true;
  else out.push(c);
  return out;
}

/** 이 장면에서 수치·상태·단계를 움직이는 곳들 */
function sources(def: SceneDef) {
  const list: { where: string; actionId?: string; d: SceneDelta }[] = [];
  for (const a of def.actions) {
    if (a.success) list.push({ where: `행동 「${a.name}」의 성공`, actionId: a.id, d: a.success });
    if (a.great) list.push({ where: `행동 「${a.name}」의 대성공`, actionId: a.id, d: a.great });
    if (a.failure) list.push({ where: `행동 「${a.name}」의 실패`, actionId: a.id, d: a.failure });
  }
  (def.reactions ?? []).forEach((r, i) => list.push({ where: `반작용 ${i + 1}`, d: r.delta }));
  return list;
}

/** 끝 하나가 왜 안 나오는지 */
function diagnoseEnd(def: SceneDef, endIndex: number, t: SceneTrace): Finding[] {
  const e = def.ends[endIndex]!;
  const out: Finding[] = [];
  const src = sources(def);
  const gname = (id: string) => def.gauges.find((g) => g.id === id)?.name ?? id;
  const winner = Object.entries(t.ends).sort((a, b) => b[1] - a[1])[0];
  const winnerName = winner ? def.ends.find((x) => x.id === winner[0])?.name ?? winner[0] : '';
  const isTimeout = !!def.maxRounds && (def.timeoutEnd ? def.timeoutEnd === e.id : endIndex === def.ends.length - 1);
  const ls = leaves(e.when);

  // 1) 끝의 순서: 조건은 맞았는데 위의 끝이 먼저 이겼다
  const sh = t.shadowed[e.id];
  if (sh) {
    const [wid, n] = Object.entries(sh).sort((a, b) => b[1] - a[1])[0]!;
    const wn = def.ends.find((x) => x.id === wid)?.name ?? wid;
    out.push({ why: `조건은 ${n}판에서 맞았지만, 목록에서 더 위에 있는 끝 「${wn}」이 같은 순간에 먼저 맞아 그쪽으로 끝났습니다. 끝은 위에서부터 처음 맞는 것 하나만 일어납니다.`,
      fix: `「${e.name}」을 「${wn}」보다 위로 옮기세요 (더 좁고 특별한 조건을 위에). 또는 두 끝의 조건이 같은 때에 함께 맞지 않게 기준을 벌리세요.` });
  }
  // 같은 수치·같은 방향의 더 느슨한 기준이 위에 있으면 언제나 가려진다
  if (ls.length === 1 && 'gauge' in ls[0]!) {
    const me = ls[0]!;
    def.ends.slice(0, endIndex).forEach((w) => {
      const wl = leaves(w.when);
      if (wl.length !== 1 || !('gauge' in wl[0]!) || wl[0]!.gauge !== me.gauge) return;
      const o = wl[0]!;
      const covered = (me.gte !== undefined && o.gte !== undefined && o.gte <= me.gte) || (me.lte !== undefined && o.lte !== undefined && o.lte >= me.lte);
      if (covered && !sh?.[w.id]) out.push({ why: `위에 있는 끝 「${w.name}」이 같은 수치(${gname(me.gauge)})를 더 느슨한 기준으로 봅니다. 이 끝의 기준에 닿기 전에 언제나 「${w.name}」이 먼저 납니다.`,
        fix: `「${e.name}」을 「${w.name}」보다 위로 옮기거나, 「${w.name}」의 기준을 이 끝보다 엄격하게 바꾸세요.` });
    });
  }

  for (const c of ls) {
    if ('gauge' in c) {
      const g = def.gauges.find((x) => x.id === c.gauge);
      if (!g) { out.push({ why: `조건이 없는 수치 "${c.gauge}"를 봅니다.`, fix: '끝 조건의 수치를 이 장면에 있는 것으로 바꾸세요.' }); continue; }
      const up = c.gte !== undefined; const thr = (up ? c.gte : c.lte) ?? 0;
      const lo = g.min ?? 0, hi = g.max ?? 10;
      const word = up ? '이상' : '이하', wordTo = up ? '이상으로' : '이하로', dir = up ? '올리는' : '내리는';
      if (up ? thr > hi : thr < lo) {
        out.push({ why: `기준이 ${gname(g.id)} ${thr} ${word}인데, 이 수치는 ${lo}~${hi} 사이에서만 움직입니다. 절대 닿을 수 없습니다.`, fix: `기준을 ${up ? hi : lo} ${wordTo} 바꾸거나, 수치의 ${up ? '최대' : '최소'}를 ${thr}까지 넓히세요.` });
        continue;
      }
      const movers = src.filter((s) => { const v = s.d.gauges?.[g.id] ?? 0; return up ? v > 0 : v < 0; });
      if (!movers.length) {
        if (up ? g.start < thr : g.start > thr) out.push({ why: `${gname(g.id)}을(를) ${dir} 행동이나 반작용이 하나도 없습니다 (시작값 ${g.start}, 기준 ${thr} ${word}).`, fix: `어느 행동의 성공·실패 결과나 반작용에 ${gname(g.id)} ${up ? '+' : '−'} 변화를 넣으세요.` });
        continue;
      }
      const usable = movers.filter((s) => !s.actionId || t.usedActions.has(s.actionId));
      if (!usable.length) {
        out.push({ why: `${gname(g.id)}을(를) ${dir} 곳은 ${movers.map((m) => m.where).join(', ')}뿐인데, 그 행동이 시험에서 한 번도 쓰이지 못했습니다.`, fix: '그 행동의 단계·조건·"한 번만"을 확인해, 플레이어가 실제로 고를 수 있게 하세요.' });
        continue;
      }
      // 가장 잘 풀렸을 때 한 차례에 움직이는 양
      const perAction = Math.max(0, ...def.actions.map((a) => Math.max(...[a.success, a.great, a.failure].map((d) => Math.abs(Math.min(0, (up ? -1 : 1) * (d?.gauges?.[g.id] ?? 0)))))));
      const perReaction = (def.reactions ?? []).reduce((s, r) => s + Math.abs(Math.min(0, (up ? -1 : 1) * (r.delta.gauges?.[g.id] ?? 0))), 0);
      const best = perAction + perReaction;
      const need = best > 0 ? Math.ceil(Math.abs(thr - g.start) / best) : Infinity;
      const seen = up ? t.gaugeMax[g.id] ?? g.start : t.gaugeMin[g.id] ?? g.start;
      if (def.maxRounds && need > def.maxRounds) {
        out.push({ why: `${gname(g.id)}이(가) 시작값 ${g.start}에서 기준 ${thr}까지 가려면, 매번 가장 잘 풀려도 ${need}차례가 필요합니다 (한 차례에 최대 ${up ? '+' : '−'}${best}). 차례 한도는 ${def.maxRounds}입니다.`,
          fix: `차례 한도를 ${need} 이상으로 늘리거나, 기준을 ${up ? g.start + best * def.maxRounds : g.start - best * def.maxRounds} ${wordTo} 당기거나, 시작값을 기준 쪽으로 옮기거나, ${dir} 변화량을 키우세요.` });
      } else if (up ? seen < thr : seen > thr) {
        const against = src.filter((s) => { const v = s.d.gauges?.[g.id] ?? 0; return up ? v < 0 : v > 0; });
        out.push({ why: `시험 ${t.runs}판 동안 ${gname(g.id)}이(가) 가장 ${up ? '높이' : '낮게'} 간 값이 ${seen}입니다 (기준 ${thr} ${word}). 장면이 평균 ${t.avgRounds}차례에 끝나는데${winnerName && winner![0] !== e.id ? `, 대부분 「${winnerName}」(${Math.round((winner![1] / t.runs) * 100)}%)이 먼저 납니다` : ''}.${against.length ? ` 이 수치를 반대로 미는 곳도 있습니다: ${against.slice(0, 3).map((a) => a.where).join(', ')}.` : ''}`,
          fix: `기준을 ${seen} ${wordTo} 당기면 바로 나오기 시작합니다. 그대로 두려면 시작값을 기준 쪽으로 옮기거나, ${dir} 변화량을 키우거나, 먼저 나는 끝의 기준을 늦추세요. ("비율 맞추기"에서 끝 조건의 기준값·수치의 시작값 손잡이를 켜면 이 범위에서 대신 찾아 줍니다.)` });
      }
    } else if ('state' in c) {
      const name = def.states?.find((s) => s.id === c.state)?.name ?? c.state;
      const adders = src.filter((s) => s.d.addStates?.includes(c.state));
      if (!adders.length) out.push({ why: `상태 「${name}」이(가) 붙어야 하는데, 이 상태를 붙이는 행동이나 반작용이 없습니다.`, fix: `어느 행동의 결과나 반작용에 "상태 붙이기: ${name}"을 넣으세요.` });
      else if (!t.states.has(c.state)) out.push({ why: `상태 「${name}」을(를) 붙이는 곳은 ${adders.map((a) => a.where).join(', ')}인데, 시험 ${t.runs}판에서 한 번도 붙지 않았습니다.`, fix: '그 행동을 플레이어가 고를 수 있는지(단계·조건·"한 번만"), 판정 난이도가 너무 높지 않은지 확인하세요. 붙자마자 다른 결과가 떼어 내는지도 보세요.' });
    } else if ('phase' in c) {
      const name = def.phases?.find((p) => p.id === c.phase)?.name ?? c.phase;
      const movers = src.filter((s) => s.d.phase === c.phase);
      const first = def.phases?.[0]?.id === c.phase;
      if (!movers.length && !first) out.push({ why: `단계 「${name}」에 있어야 하는데, 이 단계로 넘어가게 하는 행동이나 반작용이 없습니다.`, fix: `어느 행동의 결과에 "단계 넘기기: ${name}"을 넣으세요.` });
      else if (!t.phases.has(c.phase)) out.push({ why: `단계 「${name}」(으)로 넘기는 곳은 ${movers.map((a) => a.where).join(', ')}인데, 시험에서 한 번도 그 단계에 가지 못했습니다.`, fix: '그 행동이 지금 단계에서 고를 수 있는지, 판정 난이도가 너무 높지 않은지 확인하세요.' });
    } else if ('round' in c && !isTimeout) {
      if (def.maxRounds && c.round > def.maxRounds) out.push({ why: `${c.round}차례가 지나야 하는데 차례 한도가 ${def.maxRounds}입니다.`, fix: `조건의 차례를 ${def.maxRounds} 이하로 내리거나, 이 끝을 "차례가 다하면 이 끝으로"에 지정하세요.` });
      else if (t.maxRoundsSeen < c.round) out.push({ why: `${c.round}차례가 지나야 하는데, 시험에서 가장 길게 간 판이 ${t.maxRoundsSeen}차례입니다 (평균 ${t.avgRounds}차례).`, fix: `조건의 차례를 ${Math.max(1, Math.round(t.avgRounds))} 안팎으로 내리거나, 다른 끝들이 늦게 나도록 기준을 늦추세요.` });
    }
  }
  // 차례가 다하면 가는 끝: 한도까지 간 판이 없다
  if (isTimeout && !out.length) {
    out.push({ why: `이 끝은 차례 한도(${def.maxRounds})가 다했을 때 납니다. 그런데 시험에서 가장 길게 간 판이 ${t.maxRoundsSeen}차례이고 평균 ${t.avgRounds}차례에 다른 끝으로 끝납니다.`,
      fix: `차례 한도를 ${Math.max(3, Math.round(t.avgRounds))} 안팎으로 줄이거나, 다른 끝들의 기준을 늦춰 장면이 더 오래 가게 하세요. ("비율 맞추기"에서 차례 한도 손잡이를 켜면 대신 찾아 줍니다.)` });
  }
  if (!out.length) out.push({ why: `구조에서 막힌 곳은 찾지 못했습니다. 조건이 여러 개 함께 맞아야 하거나(모두·아님 조건), 드물게만 맞는 조합일 수 있습니다. 시험 ${t.runs}판, 평균 ${t.avgRounds}차례.`,
    fix: '조건을 하나씩 따로 둔 끝으로 바꿔 시험해 보면 어느 조건이 막는지 알 수 있습니다. 시험 플레이어를 바꿔 다시 돌려 보는 것도 방법입니다.' });
  return out;
}

/** 드물게(기본 1% 미만) 나오는 끝마다 까닭과 고칠 곳 */
export function diagnoseScene(world: WorldPackage, sceneId: string, sheet: CharacterSheet, opts: { runs?: number; seed?: number; policy?: SimPolicy; below?: number } = {}): EndDiagnosis[] {
  const def = (world.scenes ?? []).find((s) => s.id === sceneId);
  if (!def) return [];
  const t = traceScene(world, sceneId, sheet, opts.runs ?? 400, opts.seed ?? 7, opts.policy ?? 'random');
  const below = opts.below ?? 0.01;
  return def.ends.flatMap((e, i) => {
    const count = t.ends[e.id] ?? 0;
    return count / t.runs < below ? [{ endId: e.id, name: e.name, count, runs: t.runs, findings: diagnoseEnd(def, i, t) }] : [];
  });
}
