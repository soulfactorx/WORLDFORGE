/**
 * 장면 엔진 (v0.47) — 제작자가 정한 수치·상태·단계·행동으로 진행하는 비전투 상호작용.
 * 전투와 같은 원칙: 판정은 엔진(d20 + 기술), AI는 확정된 기록을 서술만 한다.
 */
import { checkModifier, type CheckSpec } from './character/sheet';
import { ABILITIES, type Ability, SKILLS, type SkillId } from './character/rules';
import type { RollMode } from './dice/dice';
import { evalCondition } from './scenario';
import type { SceneAction, SceneCond, SceneDef, SceneDelta, SceneEnd, WorldPackage } from './schema';
import type { GameState, SceneRun } from './state/state';
import { npcLocationOf } from './world';

export const sceneDef = (world: WorldPackage, id: string) => world.scenes?.find((s) => s.id === id);

export function gaugeRange(def: SceneDef, id: string): [number, number] {
  const g = def.gauges.find((x) => x.id === id);
  return [g?.min ?? 0, g?.max ?? 100];
}

export function sceneCond(c: SceneCond | undefined, run: SceneRun): boolean {
  if (!c) return true;
  if ('all' in c) return (c.all ?? []).every((x) => sceneCond(x, run));
  if ('any' in c) return (c.any ?? []).some((x) => sceneCond(x, run));
  if ('not' in c) return !sceneCond(c.not, run);
  if ('gauge' in c) { const v = run.gauges[c.gauge] ?? 0; return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte); }
  if ('state' in c) return run.states.includes(c.state);
  if ('phase' in c) return run.phase === c.phase;
  if ('round' in c) return run.round >= c.round;
  return false;
}

export function newRun(def: SceneDef): SceneRun {
  const gauges = Object.fromEntries(def.gauges.map((g) => { const [lo, hi] = gaugeRange(def, g.id); return [g.id, Math.max(lo, Math.min(hi, g.start))]; }));
  const image = def.image ?? def.phases?.[0]?.image;
  return { sceneId: def.id, gauges, states: [], ...(def.phases?.[0] ? { phase: def.phases[0].id } : {}), round: 0, used: [], log: [], ...(image ? { image } : {}) };
}

/** 지금 시작할 수 있는 장면 (진행 중인 장면·전투가 없을 때) */
export function availableScenes(world: WorldPackage, state: GameState, opts: { auto?: boolean } = {}): SceneDef[] {
  if (state.scene || state.combat || state.playerDead || state.ending) return [];
  return (world.scenes ?? []).filter((d) => {
    if (opts.auto !== undefined && !!d.auto !== opts.auto) return false;
    if (state.sceneResults?.[d.id] && !d.repeatable) return false;
    if (d.locationId && d.locationId !== state.player.locationId) return false;
    if (d.npcId) {
      const npc = world.characters.find((c) => c.id === d.npcId);
      if (!npc || state.deadNpcs.includes(npc.id) || npcLocationOf(state, npc) !== state.player.locationId) return false;
    }
    return !d.start || evalCondition(world, state, d.start);
  });
}

export function parseCheck(check?: string): CheckSpec | null {
  const [kind, id] = (check ?? '').split(':');
  if (kind === 'skill' && id && id in SKILLS) return { kind: 'skill', skill: id as SkillId };
  if (kind === 'ability' && (ABILITIES as readonly string[]).includes(id ?? '')) return { kind: 'ability', ability: id as Ability };
  return null;
}

/** 수치가 굴림에 더하는 값 (v0.48) */
export function gaugeMods(def: SceneDef, run: SceneRun, action: SceneAction): { label: string; value: number }[] {
  return (action.mods ?? []).flatMap((m) => {
    const v = run.gauges[m.gauge];
    if (v === undefined) return [];
    let value = Math.round(v * m.per);
    if (m.max !== undefined) value = Math.max(-Math.abs(m.max), Math.min(Math.abs(m.max), value));
    return value ? [{ label: def.gauges.find((g) => g.id === m.gauge)?.name ?? m.gauge, value }] : [];
  });
}

/** 반작용: 조건이 맞는 것 모두, 확률은 rng로 (rng가 없으면 확률 1인 것만) */
export function applyReactions(def: SceneDef, run: SceneRun, roll?: () => number): { run: SceneRun; texts: string[]; images: string[] } {
  let r = run;
  const texts: string[] = [];
  const images: string[] = [];
  for (const re of def.reactions ?? []) {
    if (re.when && !sceneCond(re.when, r)) continue;
    const p = re.chance ?? 1;
    if (p < 1 && (!roll || roll() >= p)) continue;
    // 패널의 그림은 행동 결과를 유지한다 (반작용 그림은 기록에만)
    const { image: _img, ...noImg } = re.delta;
    r = applyDelta(def, r, noImg);
    if (re.delta.text) texts.push(re.delta.text);
    if (re.delta.image) images.push(re.delta.image);
  }
  return { run: r, texts, images };
}

/** 행동마다 쓸 수 있는가와 판정 이점 */
export function sceneActions(def: SceneDef, run: SceneRun, sheet?: GameState['player']['sheet']) {
  return def.actions.map((action) => {
    const why = action.phases?.length && (!run.phase || !action.phases.includes(run.phase)) ? '지금 단계에서는 못 한다'
      : action.once && run.used.includes(action.id) ? '이미 했다'
      : action.requires && !sceneCond(action.requires, run) ? '아직 때가 아니다' : '';
    const spec = parseCheck(action.check);
    const gm = gaugeMods(def, run, action).reduce((a, m) => a + m.value, 0);
    return { action, ok: !why, why, spec, mode: edgeOf(def, run, action), mod: spec && sheet ? checkModifier(sheet, spec).total + gm : undefined, gaugeMod: gm };
  });
}

export function edgeOf(def: SceneDef, run: SceneRun, action: SceneAction): RollMode {
  let n = 0;
  if (action.tags?.some((t) => def.likes?.includes(t))) n++;
  if (action.tags?.some((t) => def.dislikes?.includes(t))) n--;
  for (const st of def.states ?? []) if (run.states.includes(st.id) && st.edge) n += st.edge;
  return n > 0 ? 'advantage' : n < 0 ? 'disadvantage' : 'normal';
}

export function applyDelta(def: SceneDef, run: SceneRun, d: SceneDelta | undefined): SceneRun {
  if (!d) return run;
  const gauges = { ...run.gauges };
  for (const [id, by] of Object.entries(d.gauges ?? {})) {
    if (!(id in gauges)) continue;
    const [lo, hi] = gaugeRange(def, id);
    gauges[id] = Math.max(lo, Math.min(hi, gauges[id]! + by));
  }
  const states = [...run.states.filter((s) => !(d.removeStates ?? []).includes(s)), ...(d.addStates ?? []).filter((s) => !run.states.includes(s))];
  const phase = d.phase && def.phases?.some((p) => p.id === d.phase) ? d.phase : run.phase;
  // 그림: 결과의 그림 > 새 단계의 그림 > 그대로 (v0.50)
  const phaseImg = phase !== run.phase ? def.phases?.find((p) => p.id === phase)?.image : undefined;
  const image = d.image ?? phaseImg ?? run.image;
  return { ...run, gauges, states, ...(phase ? { phase } : {}), ...(image ? { image } : {}) };
}

/** 끝났는가: 위에서부터 처음 맞는 끝, 아니면 차례 한도 */
export function sceneEndOf(def: SceneDef, run: SceneRun): SceneEnd | null {
  const hit = def.ends.find((e) => sceneCond(e.when, run));
  if (hit) return hit;
  if (def.maxRounds && run.round >= def.maxRounds) return def.ends.find((e) => e.id === def.timeoutEnd) ?? def.ends.at(-1) ?? null;
  return null;
}

/** 보이는 수치 변화 한 줄 (예: "인내심 −2 · 합의도 +15") */
export function deltaLine(def: SceneDef, before: SceneRun, after: SceneRun): string {
  const parts = def.gauges.filter((g) => g.visible !== false && after.gauges[g.id] !== before.gauges[g.id])
    .map((g) => { const d = after.gauges[g.id]! - before.gauges[g.id]!; return `${g.name} ${d > 0 ? '+' : '−'}${Math.abs(d)}`; });
  const added = after.states.filter((s) => !before.states.includes(s)).map((s) => def.states?.find((x) => x.id === s)?.name ?? s);
  const removed = before.states.filter((s) => !after.states.includes(s)).map((s) => def.states?.find((x) => x.id === s)?.name ?? s);
  const ph = after.phase !== before.phase ? def.phases?.find((p) => p.id === after.phase)?.name : undefined;
  return [...parts, ...added.map((n) => `[${n}]`), ...removed.map((n) => `[${n} 풀림]`), ...(ph ? [`→ ${ph}`] : [])].join(' · ');
}
