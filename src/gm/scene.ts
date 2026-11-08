/**
 * 장면 엔진 이벤트 (v0.47): 시작 · 행동(판정) · 끝(효과·보상) · 서술.
 */
import { genreGuide, reskinner } from '../engine/genre';
import { RATING_GUIDE } from '../engine/rating';
import { createRng } from '../engine/dice/rng';
import { d20Test } from '../engine/dice/dice';
import { checkModifier } from '../engine/character/sheet';
import { applyDelta, applyReactions, availableScenes, deltaLine, gaugeMods, sceneActions, sceneDef, sceneEndOf, newRun } from '../engine/scene';
import type { SceneDef, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { rewardEvents, scenarioEvents } from './scenario';
import { npcSheet } from '../engine/npcStats';
import { effectEvents } from './story';
import { buildNarratorContext } from './context';

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** 장면의 상대 시트 (v0.79): 상대 인물이 있고 맞서기를 끄지 않았으면 */
export function sceneOpponent(world: WorldPackage, state: GameState, def: SceneDef) {
  if (!def.npcId || def.oppose === false) return undefined;
  const c = world.characters.find((x) => x.id === def.npcId);
  return c ? npcSheet(world, state, c) : undefined;
}

export function startSceneEvents(world: WorldPackage, state: GameState, sceneId: string): GameEvent[] {
  const def = availableScenes(world, state).find((d) => d.id === sceneId);
  if (!def) throw new Error('지금은 이 장면을 시작할 수 없다');
  return [{ type: 'scene_started', sceneId: def.id, name: def.name, run: newRun(def), ...(def.intro ? { intro: def.intro } : {}) }];
}

/** 끝 처리: 결과 + 효과 + 보상 (상태를 이어 받으며) */
function endEvents(world: WorldPackage, s0: GameState, def: SceneDef, endId: string): GameEvent[] {
  const end = def.ends.find((e) => e.id === endId);
  if (!end) return [];
  const out: GameEvent[] = [];
  let s = s0;
  const push = (e: GameEvent) => { out.push(e); s = applyEvent(s, e, s.turn); };
  push({ type: 'scene_ended', sceneId: def.id, endId: end.id, name: def.name, outcome: end.outcome, text: end.text ?? end.name, ...(end.image ? { image: end.image } : {}) });
  effectEvents(world, s, end.effects ?? [], `${def.name}: ${end.name}`).forEach(push);
  rewardEvents(world, s, end.rewards, `${def.name}: ${end.name}`).forEach(push);
  scenarioEvents(world, s).events.forEach(push);
  return out;
}

export function sceneActionEvents(world: WorldPackage, state: GameState, actionId: string): GameEvent[] {
  const run = state.scene;
  const def = run && sceneDef(world, run.sceneId);
  if (!run || !def) throw new Error('진행 중인 장면이 없다');
  const opt = sceneActions(def, run, state.player.sheet, sceneOpponent(world, state, def)).find((a) => a.action.id === actionId);
  if (!opt) throw new Error('없는 행동이다');
  if (!opt.ok) throw new Error(opt.why);
  const a = opt.action;
  const rng = createRng(state.rngState);
  let success = true;
  let rollText = '';
  let great = false;
  if (opt.spec) {
    const m = checkModifier(state.player.sheet, opt.spec);
    const gm = gaugeMods(def, run, a);
    const total = m.total + gm.reduce((x, g) => x + g.value, 0);
    const t = d20Test(rng, total, opt.dc, opt.mode);
    success = t.success || t.natural20;
    great = success && (t.natural20 || t.total >= t.dc + 5);
    const gmText = gm.map((g) => ` ${g.label}${fmt(g.value)}`).join('');
    rollText = ` — ${m.label} d20(${t.rolls.join('/')}) ${fmt(m.total)}${gmText} = ${t.total} vs ${t.dc}${opt.oppose ? ` (상대 ${opt.oppose.label} ${fmt(opt.oppose.value)})` : ''}${opt.mode === 'advantage' ? ' (이점)' : opt.mode === 'disadvantage' ? ' (불리)' : ''} → ${great && a.great ? '대성공' : success ? '성공' : '실패'}`;
  }
  const delta = success ? (great && a.great ? a.great : a.success) : a.failure;
  const acted = applyDelta(def, run, delta);
  // 상대·상황의 반작용 (v0.48)
  const re = applyReactions(def, acted, () => rng.next());
  const next0 = re.run;
  const line = `🎭 ${a.name}${rollText}${deltaLine(def, run, next0) ? ` · ${deltaLine(def, run, next0)}` : ''}${delta?.text ? ` — ${delta.text}` : ''}${re.texts.length ? ` / ${re.texts.join(' / ')}` : ''}`;
  const next = { ...next0, round: run.round + 1, used: run.used.includes(a.id) ? run.used : [...run.used, a.id], log: [...run.log, line] };
  // 이번 차례의 그림: 행동 결과의 그림, 반작용의 그림 (v0.50)
  const images = [...new Set([delta?.image, ...re.images].filter((x): x is string => !!x))];
  const ev: GameEvent = { type: 'scene_action', run: next, line, rngState: rng.state(), ...(images.length ? { images } : {}) };
  const s1 = applyEvent(state, ev, state.turn);
  const end = sceneEndOf(def, next);
  return [ev, ...(end ? endEvents(world, s1, def, end.id) : [])];
}

/** 그만두기: 효과 없이 끝난다 (다시 할 수 있는 장면이 아니면 다시 열리지 않는다) */
export function abandonSceneEvents(world: WorldPackage, state: GameState): GameEvent[] {
  const def = state.scene && sceneDef(world, state.scene.sceneId);
  if (!state.scene || !def) return [];
  return [{ type: 'scene_ended', sceneId: def.id, endId: 'abandoned', name: def.name, outcome: 'abandoned', text: '그만두었다' }];
}

/** 끝난 장면 서술 — 확정된 기록만 넘긴다. 수위는 세계의 콘텐츠 등급을 따른다 */
export async function narrateScene(
  llm: LlmClient, world: WorldPackage, after: GameState, def: SceneDef, log: string[], onText: (d: string) => void, signal?: AbortSignal,
): Promise<string> {
  const rs = reskinner(world);
  const npc = def.npcId ? world.characters.find((c) => c.id === def.npcId) : undefined;
  const res = after.sceneResults?.[def.id];
  const end = def.ends.find((e) => e.id === res?.endId);
  return llm.stream({
    system: `너는 1인칭 TRPG의 서술자다. 한국어 2인칭("당신은 …")으로, 방금 끝난 장면을 2~4문단으로 생생하게 요약한다.
- 장면 기록의 판정 결과와 끝(결과)을 그대로 따른다. 결과를 바꾸거나 새 사건을 만들지 않는다.
- 수치(주사위, 게이지 숫자)는 서술에 쓰지 않는다. 게이지 이름은 분위기로 녹인다.
- 마지막에 플레이어의 다음 행동을 대신 정하지 않는다.
- ${genreGuide(world)}
- ${RATING_GUIDE[world.manifest.contentRating] ?? RATING_GUIDE.teen}`,
    user: `${buildNarratorContext(world, after)}\n\n## 장면\n${def.name} — ${def.description}${npc ? `\n상대: ${npc.name} (${npc.appearance})` : ''}\n\n## 장면 기록\n${log.map(rs).join('\n')}\n\n## 끝\n${res?.outcome === 'abandoned' ? '플레이어가 도중에 그만두었다.' : `${end?.name ?? ''}${end?.text ? ` — ${end.text}` : ''}`}`,
    maxTokens: 2500,
  }, onText, signal);
}

/** 장면 서술 방식: 플레이 설정이 우선, 아니면 장면 설정 (기본 end) (v0.50) */
export function narrationMode(def: SceneDef, pref: 'scene' | 'fixed' | 'end' | 'ai'): 'fixed' | 'end' | 'ai' {
  return pref === 'scene' ? def.narration ?? 'end' : pref;
}

/** 매 차례 장면 서술 (v0.50) — 방금 확정된 한 차례(행동·판정·반작용)만 짧게 */
export async function narrateSceneTurn(
  llm: LlmClient, world: WorldPackage, after: GameState, def: SceneDef, line: string, onText: (d: string) => void, signal?: AbortSignal,
): Promise<string> {
  const rs = reskinner(world);
  const npc = def.npcId ? world.characters.find((c) => c.id === def.npcId) : undefined;
  const run = after.scene;
  const gauges = run ? def.gauges.filter((g) => g.visible !== false).map((g) => { const v = run.gauges[g.id] ?? 0; const hi = g.max ?? 100; const lo = g.min ?? 0; const f = (v - lo) / Math.max(1, hi - lo); return `${g.name}: ${f >= 0.75 ? '높음' : f >= 0.4 ? '중간' : f > 0 ? '낮음' : '바닥'}`; }) : [];
  const states = run?.states.map((id) => def.states?.find((s) => s.id === id)?.name ?? id) ?? [];
  const phase = run?.phase ? def.phases?.find((p) => p.id === run.phase)?.name : undefined;
  return llm.stream({
    system: `너는 1인칭 TRPG의 서술자다. 장면이 진행 중이다. 한국어 2인칭("당신은 …")으로, 방금 확정된 한 차례를 2~4문장으로 생생하게 서술한다.
- 기록의 판정 결과(성공·실패·대성공)와 상대의 반작용을 그대로 따른다. 결과를 바꾸거나 새 사건·결말을 만들지 않는다.
- 숫자(주사위, 수치)는 쓰지 않는다. 수치의 높고 낮음은 분위기와 몸짓으로 보여 준다.
- 장면은 아직 끝나지 않았다. 마무리하지 말고, 다음 행동을 대신 정하지 않는다.
- ${genreGuide(world)}
- ${RATING_GUIDE[world.manifest.contentRating] ?? RATING_GUIDE.teen}`,
    user: `## 장면\n${def.name} — ${def.description}${npc ? `\n상대: ${npc.name} (${npc.appearance})` : ''}${phase ? `\n지금 단계: ${phase}` : ''}\n\n## 지금 형세\n${[...gauges, ...(states.length ? [`상태: ${states.join(', ')}`] : [])].join('\n') || '(없음)'}\n\n## 방금 차례 (확정)\n${rs(line)}`,
    maxTokens: 600,
  }, onText, signal);
}
