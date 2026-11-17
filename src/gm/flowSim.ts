/**
 * 흐름도 시뮬레이션 (v0.145): 흐름도 위에서 이야기를 "종이로" 플레이해 본다. AI를 쓰지 않고 실제 엔진 규칙(조건·효과·임무 전환·결말)을 쓴다.
 *  - 상자마다 지금 상태: 🔒 잠김 · 🟢 열림 · ▶ 진행 중 · ✔ 끝남 · ✗ 실패 · 🏁 결말 도달
 *  - 열린 상자를 눌러 "어떻게 되었다"를 고르면(임무 완료·선택지·장면의 끝·전투 승패…) 사건과 효과를 넣고 엔진 한 단계를 돌린다
 *  - 자동 탐색: 무작위로 여러 번 끝까지 해 보고 — 어느 결말에 몇 번 이르는지, 한 번도 열리지 않는 상자, 결말 없이 막히는 길을 찾는다
 */
import { evalCondition, varLabel, varValue } from '../engine/scenario';
import { relationshipOf, reputationOf } from '../engine/relationship';
import { traitsFor, traitValue } from '../engine/traits';
import type { Condition, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';
import { labRun, labState, labStep, type LabResult } from './lab';
import { type GNode, openCondition, type StoryGraph } from './storyGraph';
import { effectEvents } from './story';

export type SimStatus = 'locked' | 'open' | 'active' | 'done' | 'failed' | 'reached' | 'off' | 'on' | 'none';
export interface NodeSim { st: SimStatus; text: string }
export interface SimAct {
  /** 상자 안에서 고유 (경로 다시 보기에 쓴다) */
  id: string;
  label: string;
  /** 자동 탐색에서 고를 무게 (0이면 자동 탐색은 고르지 않는다 — 억지로 하는 것) */
  weight: number;
  run: (w: WorldPackage, s: GameState) => LabResult;
}

const ICON: Record<SimStatus, string> = { locked: '🔒', open: '🟢', active: '▶', done: '✔', failed: '✗', reached: '🏁', off: '○', on: '●', none: '' };
export const simIcon = (st: SimStatus) => ICON[st];

/** 처음 상태: 시작 사건 + 엔진 한 단계 (처음부터 열리는 임무가 시작된다) */
export function simStart(w: WorldPackage): LabResult {
  const s = labState(w, {});
  const r = labStep(w, s);
  return r.error ? { state: s, events: [], lines: [], error: r.error } : r;
}

const ok = (w: WorldPackage, s: GameState, c: Parameters<typeof evalCondition>[2] | undefined) => (c ? evalCondition(w, s, c) : true);

export function nodeSim(w: WorldPackage, s: GameState, n: GNode): NodeSim {
  switch (n.kind) {
    case 'start': return { st: 'done', text: `${s.turn}번 진행함` };
    case 'quest': {
      const q = w.quests?.find((x) => x.id === n.id); if (!q) return { st: 'none', text: '' };
      const p = s.quests[q.id];
      if (p?.failed) return { st: 'failed', text: '실패' };
      if (p?.done) return { st: 'done', text: `완료${p.outcome ? ` · ${q.outcomes?.find((o) => o.id === p.outcome)?.name ?? p.outcome}` : ''}` };
      if (p) return { st: 'active', text: `${p.stage + 1}/${q.stages.length}단계` };
      return ok(w, s, q.start) ? { st: 'open', text: '시작 가능' } : { st: 'locked', text: '시작 조건 거짓' };
    }
    case 'ending': {
      const e = w.endings?.find((x) => x.id === n.id); if (!e) return { st: 'none', text: '' };
      if (s.ending === e.id) return { st: 'reached', text: '결말 도달' };
      return ok(w, s, e.condition) ? { st: 'open', text: '조건 참' } : { st: 'locked', text: '조건 거짓' };
    }
    case 'card': {
      const c = w.storylets?.find((x) => x.id === n.id); if (!c) return { st: 'none', text: '' };
      const r = s.storylets?.[c.id];
      if (r?.chosen) return { st: 'done', text: `고름: ${c.options.find((o) => o.id === r.chosen)?.label ?? r.chosen}` };
      return ok(w, s, c.when) ? { st: 'open', text: '덱에 있음' } : { st: 'locked', text: '덱 밖' };
    }
    case 'choice': {
      const c = w.choices?.find((x) => x.id === n.id); if (!c) return { st: 'none', text: '' };
      const ch = s.choices?.[c.id]?.chosen;
      if (ch) return { st: 'done', text: `고름: ${c.options.find((o) => o.id === ch)?.text ?? ch}` };
      return ok(w, s, c.when) ? { st: 'open', text: '고를 수 있음' } : { st: 'locked', text: '조건 거짓' };
    }
    case 'scene': case 'gimmick': {
      const d = w.scenes?.find((x) => x.id === n.id); if (!d) return { st: 'none', text: '' };
      const r = s.sceneResults?.[d.id];
      if (r && r.outcome !== 'abandoned') return { st: r.outcome === 'failure' ? 'failed' : 'done', text: `끝: ${d.ends.find((e) => e.id === r.endId)?.name ?? r.endId}` };
      return ok(w, s, d.start) ? { st: 'open', text: '열림' } : { st: 'locked', text: '조건 거짓' };
    }
    case 'encounter': {
      const e = w.encounters?.find((x) => x.id === n.id); if (!e) return { st: 'none', text: '' };
      const r = s.encounterResults?.[e.id];
      if (r) return { st: r.outcome === 'victory' ? 'done' : 'failed', text: { victory: '승리', defeat: '패배', fled: '도망' }[r.outcome] };
      return ok(w, s, e.when) ? { st: 'open', text: '일어날 수 있음' } : { st: 'locked', text: '조건 거짓' };
    }
    case 'event': {
      const e = w.events?.find((x) => x.id === n.id); if (!e) return { st: 'none', text: '' };
      const r = s.worldEvents?.[e.id];
      if (r) return { st: r.skipped ? 'failed' : 'done', text: r.skipped ? '막힘' : '일어남' };
      return ok(w, s, e.when.condition) ? { st: 'open', text: '일어날 수 있음' } : { st: 'locked', text: '조건 거짓' };
    }
    case 'arc': {
      const a = w.arcs?.find((x) => x.id === n.id); if (!a) return { st: 'none', text: '' };
      const r = s.arcs?.[a.id];
      if (r?.done) return { st: r.failed ? 'failed' : 'done', text: r.failed ? '실패' : '끝남' };
      if (r) return { st: 'active', text: `${r.chapter + 1}/${a.chapters.length}장` };
      return ok(w, s, a.start) ? { st: 'open', text: '시작 가능' } : { st: 'locked', text: '조건 거짓' };
    }
    case 'clock': {
      const c = w.clocks?.find((x) => x.id === n.id); if (!c) return { st: 'none', text: '' };
      const v = s.clocks?.[c.id]?.value ?? c.start ?? 0;
      return { st: v >= c.segments ? 'done' : 'active', text: `${v}/${c.segments}칸` };
    }
    case 'flag': return s.flags.includes(n.id) ? { st: 'on', text: '섰음' } : { st: 'off', text: '안 섬' };
    case 'claim': return ok(w, s, { knows: n.id }) ? { st: 'on', text: '앎' } : { st: 'off', text: '모름' };
    case 'phase': return s.phase === n.id ? { st: 'on', text: '지금 국면' } : { st: 'off', text: '' };
    case 'location': return s.player.locationId === n.id ? { st: 'on', text: '지금 여기' } : { st: 'off', text: '' };
    case 'faction': return { st: 'off', text: `평판 ${reputationOf(w, s.reputation ?? {}, n.id)}` };
    case 'item': { const k = s.inventory?.[n.id] ?? 0; return k > 0 ? { st: 'on', text: `가짐 ${k}개` } : { st: 'off', text: '없음' }; }
    case 'monster': { const k = s.kills?.[n.id] ?? 0; return k > 0 ? { st: 'on', text: `${k}마리 쓰러뜨림` } : { st: 'off', text: '' }; }
    case 'character': return s.deadNpcs.includes(n.id) ? { st: 'failed', text: '죽음' } : s.party[n.id] ? { st: 'on', text: '동료' } : { st: 'none', text: '' };
    default: return { st: 'none', text: '' };
  }
}

const ev = (fn: (s: GameState) => GameEvent[]) => (w: WorldPackage, s: GameState) => labRun(w, s, fn);

/** 이 상자로 지금 할 수 있는 일 */
export function simActs(w: WorldPackage, s: GameState, n: GNode): SimAct[] {
  const st = nodeSim(w, s, n).st;
  if (s.ending) return [];
  switch (n.kind) {
    case 'quest': {
      const q = w.quests?.find((x) => x.id === n.id); if (!q) return [];
      const p = s.quests[q.id];
      if (!p) return st === 'open' ? [{ id: 'start', label: '시작하기', weight: 1, run: ev(() => [{ type: 'quest_started', questId: q.id, name: q.name, objective: q.stages[0]?.objective ?? '' }]) }]
        : [{ id: 'force', label: '억지로 시작하기 (조건 무시)', weight: 0, run: ev(() => [{ type: 'quest_started', questId: q.id, name: q.name, objective: q.stages[0]?.objective ?? '' }]) }];
      if (p.done || p.failed) return [];
      const last = p.stage >= q.stages.length - 1;
      const outs: SimAct[] = [];
      if (!last) outs.push({ id: 'stage', label: `${p.stage + 1}단계 「${q.stages[p.stage]?.objective ?? ''}」 끝내기`, weight: 4, run: ev(() => [{ type: 'quest_advanced', questId: q.id, name: q.name, stage: p.stage + 1, objective: q.stages[p.stage + 1]?.objective ?? '' }]) });
      if ((q.outcomes ?? []).length && last) for (const o of q.outcomes!) outs.push({ id: `out:${o.id}`, label: `완료 — 결과 「${o.name}」`, weight: 3, run: ev(() => [{ type: 'quest_completed', questId: q.id, name: q.name, stages: q.stages.length }, { type: 'quest_outcome', questId: q.id, questName: q.name, outcomeId: o.id, name: o.name }]) });
      else outs.push({ id: 'done', label: last ? '완료하기' : '남은 단계까지 모두 완료', weight: last ? 4 : 1, run: ev(() => [{ type: 'quest_completed', questId: q.id, name: q.name, stages: q.stages.length }]) });
      outs.push({ id: 'fail', label: '실패하기', weight: 1, run: ev(() => [{ type: 'quest_failed', questId: q.id, name: q.name, reason: '시뮬레이션' }]) });
      return outs;
    }
    case 'choice': {
      const c = w.choices?.find((x) => x.id === n.id); if (!c || (st !== 'open' && st !== 'locked')) return [];
      // 잠긴 선택도 결과를 볼 수 있게 「조건 무시하고」 고를 수 있다 (v0.160 — 자동 탐색은 고르지 않는다)
      const forced = st === 'locked';
      return c.options.map((o) => ({ id: `${forced ? 'force' : 'opt'}:${o.id}`, label: `「${o.text}」 고르기${forced ? ' (조건 무시)' : ''}`, weight: forced ? 0 : 2, run: ev((s2) => {
        const made: GameEvent = { type: 'choice_made', choiceId: c.id, optionId: o.id, text: `${c.name}: ${o.text}` };
        return [made, ...effectEvents(w, { ...s2, choices: { ...s2.choices, [c.id]: { turn: s2.turn, chosen: o.id } } }, o.effects, c.name)];
      }) }));
    }
    case 'card': {
      const c = w.storylets?.find((x) => x.id === n.id); if (!c || st !== 'open') return [];
      return c.options.flatMap((o) => [
        { id: `ok:${o.id}`, label: `「${o.label}」 — 성공`, weight: 2, run: ev((s2) => [{ type: 'storylet_chosen', id: c.id, optionId: o.id, label: o.label, tier: 'success' }, ...effectEvents(w, s2, o.success ?? [], c.title)]) },
        ...(o.check || o.fail?.length ? [{ id: `fail:${o.id}`, label: `「${o.label}」 — 실패`, weight: 1, run: ev((s2: GameState) => [{ type: 'storylet_chosen', id: c.id, optionId: o.id, label: o.label, tier: 'fail' } as GameEvent, ...effectEvents(w, s2, o.fail ?? [], c.title)]) }] : []),
      ]);
    }
    case 'scene': case 'gimmick': {
      const d = w.scenes?.find((x) => x.id === n.id); if (!d || st !== 'open') return [];
      return d.ends.map((e) => ({ id: `end:${e.id}`, label: `끝 「${e.name}」 (${{ success: '성공', failure: '실패', neutral: '보통' }[e.outcome]})`, weight: e.outcome === 'success' ? 3 : 1,
        run: ev((s2) => [{ type: 'scene_ended', sceneId: d.id, endId: e.id, name: d.name, outcome: e.outcome }, ...effectEvents(w, s2, e.effects ?? [], d.name)]) }));
    }
    case 'encounter': {
      const e = w.encounters?.find((x) => x.id === n.id); if (!e || st !== 'open') return [];
      const result = (outcome: 'victory' | 'defeat' | 'fled') => (w2: WorldPackage, s2: GameState) => labRun(w2, {
        ...s2, encounterResults: { ...(s2.encounterResults ?? {}), [e.id]: { outcome, turn: s2.turn } },
        clearedEncounters: outcome === 'victory' ? [...s2.clearedEncounters, e.id] : s2.clearedEncounters,
      }, () => []);
      return [{ id: 'win', label: '이기기', weight: 3, run: result('victory') }, { id: 'lose', label: '지기', weight: 1, run: result('defeat') }, { id: 'flee', label: '도망치기', weight: 1, run: result('fled') }];
    }
    case 'event': {
      const e = w.events?.find((x) => x.id === n.id); if (!e || st !== 'open') return [];
      return [{ id: 'fire', label: '일어나게 하기', weight: 1, run: ev((s2) => [{ type: 'world_event', eventId: e.id, name: e.name, skipped: false }, ...effectEvents(w, s2, e.effects, e.name)]) }];
    }
    case 'clock': {
      const c = w.clocks?.find((x) => x.id === n.id); if (!c || st === 'done') return [];
      return [{ id: 'tick', label: '한 칸 채우기', weight: 1, run: ev((s2) => effectEvents(w, s2, [{ clock: c.id, by: 1 }], c.name)) }];
    }
    case 'flag': {
      if (st === 'on') return [];
      // 선언된 플래그는 GM이 설명대로 세운다 — 자동 탐색도 가끔 세운다. 선언 안 된 것은 억지로만
      const decl = (w.flags ?? []).some((f) => f.id === n.id && f.when?.trim());
      return [{ id: 'set', label: decl ? '세우기 (GM이 세우는 때가 됐다)' : '억지로 세우기', weight: decl ? 1 : 0, run: ev(() => [{ type: 'flag_set', flag: n.id }]) }];
    }
    case 'item': return [{ id: 'get', label: '얻기', weight: 0, run: ev((s2) => effectEvents(w, s2, [{ giveItem: n.id }], '시뮬레이션')) }];
    case 'monster': return [{ id: 'kill', label: '한 마리 쓰러뜨리기', weight: 0, run: ev(() => [{ type: 'enemies_defeated', counts: { [n.id]: 1 } }]) }];
    case 'location': return s.player.locationId === n.id ? [] : [{ id: 'go', label: '이곳으로 옮기기', weight: 0, run: (w2, s2) => simMove(w2, s2, n.id) }];
    case 'claim': {
      if (nodeSim(w, s, n).st === 'on') return [];
      return [{ id: 'know', label: '알게 하기', weight: 0, run: ev((s2) => effectEvents(w, s2, [{ reveal: n.id, state: 'confirmed' }], '시뮬레이션')) }];
    }
    default: return [];
  }
}

/** 장소 옮기기 (장소 조건을 채우려고) — 경로에는 "move|장소ID"로 남는다 */
export const simMove = (w: WorldPackage, s: GameState, to: string) => labRun(w, s, () => [{ type: 'moved', to }]);

function atLeaves(c: Condition | undefined, out: string[] = []): string[] {
  if (!c) return out;
  if ('all' in c) c.all.forEach((x) => atLeaves(x, out));
  else if ('any' in c) c.any.forEach((x) => atLeaves(x, out));
  else if ('at' in c) out.push(c.at);
  return out;
}
/** 잠긴 상자·진행 중인 임무 단계가 바라는 장소 — 그곳에 가면 실제로 조건이 참이 되는 곳만 (지금 장소 말고) */
export function wantedPlaces(w: WorldPackage, s: GameState, g: StoryGraph): string[] {
  const conds: Condition[] = [];
  for (const n of g.nodes) {
    const st = nodeSim(w, s, n).st;
    if (st === 'locked') { const c = openCondition(w, n); if (c && atLeaves(c).length) conds.push(c); }
    if (st === 'active' && n.kind === 'quest') { const q = w.quests?.find((x) => x.id === n.id); const p = s.quests[n.id]; const c = q && p ? q.stages[p.stage]?.complete : undefined; if (c && atLeaves(c).length && !evalCondition(w, s, c)) conds.push(c); }
  }
  const places = new Set(conds.flatMap((c) => atLeaves(c)));
  places.delete(s.player.locationId);
  return [...places].filter((id) => {
    if (!w.locations.some((l) => l.id === id)) return false;
    const there: GameState = { ...s, player: { ...s.player, locationId: id } };
    return conds.some((c) => evalCondition(w, there, c));
  });
}

// ---------------------------------------------------------------- 고르면 어떻게 되나 (v0.160)

export interface ActPreview {
  id: string; label: string; forced: boolean;
  /** 엔진이 적은 일 (효과·전환) */
  lines: string[];
  /** 새로 열리거나 진행이 시작된 상자 · 끝난 상자 · 실패·잠긴 상자 */
  opened: GNode[]; done: GNode[]; failed: GNode[];
  /** 섰거나 알게 된 것 (플래그·지식·장소·아이템…) */
  on: GNode[];
  ending?: GNode;
  error?: string;
}
/** 이 상자의 할 일마다, 지금 상태에서 하면 무엇이 바뀌는지 (상태는 바꾸지 않는다) */
export function previewActs(w: WorldPackage, s: GameState, g: StoryGraph, n: GNode): ActPreview[] {
  const before = new Map(g.nodes.map((x) => [x.key, nodeSim(w, s, x).st]));
  return simActs(w, s, n).map((a) => {
    const r = a.run(w, s);
    const base = { id: a.id, label: a.label, forced: a.weight === 0, lines: r.lines };
    if (r.error) return { ...base, opened: [], done: [], failed: [], on: [], error: r.error };
    const ch = g.nodes.map((x) => ({ x, was: before.get(x.key), now: nodeSim(w, r.state, x).st })).filter((c) => c.was !== c.now && c.x.key !== n.key);
    const end = r.state.ending ? g.nodes.find((x) => x.kind === 'ending' && x.id === r.state.ending) : undefined;
    return { ...base,
      opened: ch.filter((c) => (c.now === 'open' || c.now === 'active') && c.was === 'locked').map((c) => c.x),
      done: ch.filter((c) => c.now === 'done' && c.x.kind !== 'ending').map((c) => c.x),
      failed: ch.filter((c) => c.now === 'failed' || (c.now === 'locked' && (c.was === 'open' || c.was === 'active'))).map((c) => c.x),
      on: ch.filter((c) => c.now === 'on').map((c) => c.x),
      ...(end ? { ending: end } : {}) };
  });
}

// ---------------------------------------------------------------- 성향·관계·평판·수치 정하기 (v0.161)

/** 시험으로 정하는 값: 성향 축 · 인물 관계 축 · 세력 평판 · 세계 수치 */
export interface SimSetting { kind: 'trait' | 'rel' | 'rep' | 'var'; id: string; axis?: string; value: number }
/** 경로 한 걸음: "set|trait:good_evil=40" · "set|rel:npc/mina:trust=60" · "set|rep:fac/x=-20" · "set|var:security=70" */
export const settingStep = (st: SimSetting) => `set|${st.kind}:${st.id}${st.axis ? `:${st.axis}` : ''}=${st.value}`;
/** 같은 값을 다시 정하는 걸음인가 (마지막 걸음을 바꿔 끼우기용) */
export const settingKey = (step: string) => (step.startsWith('set|') ? step.slice(0, step.lastIndexOf('=')) : null);
export function parseSetting(step: string): SimSetting | null {
  const m = /^set\|(trait|rel|rep|var):(.+)=(-?\d+(?:\.\d+)?)$/.exec(step);
  if (!m) return null;
  const kind = m[1] as SimSetting['kind'], rest = m[2]!, value = Number(m[3]);
  if (kind === 'rel') { const i = rest.lastIndexOf(':'); return { kind, id: rest.slice(0, i), axis: rest.slice(i + 1), value }; }
  return { kind, id: rest, value };
}
/** 지금 값 */
export function settingValue(w: WorldPackage, s: GameState, st: Omit<SimSetting, 'value'>): number {
  if (st.kind === 'trait') return traitValue(w, s.player.sheet, st.id);
  if (st.kind === 'rel') return (relationshipOf(w, s.relationships, st.id) as unknown as Record<string, number>)[st.axis!] ?? 0;
  if (st.kind === 'rep') return reputationOf(w, s.reputation ?? {}, st.id);
  return varValue(w, s, st.id);
}
/** 값을 정한다 (그 값이 되도록 사건을 넣고 엔진 한 단계 — 이 값으로 열리는 것이 있으면 열린다) */
export function simSet(w: WorldPackage, s: GameState, st: SimSetting): LabResult {
  return labRun(w, s, (s2) => {
    const cur = settingValue(w, s2, st);
    const v = Math.round(st.value);
    if (v === cur) return [];
    if (st.kind === 'trait') {
      const ax = traitsFor(w).find((t) => t.id === st.id);
      return [{ type: 'trait_changed', trait: st.id, value: v, delta: v - cur, name: ax?.name ?? st.id, label: `${v}`, reason: '시험 설정' }];
    }
    if (st.kind === 'rel') {
      const npc = w.characters.find((c) => c.id === st.id);
      return [{ type: 'relationship_changed', npcId: st.id, delta: { [st.axis!]: v - cur }, reason: '시험 설정', name: npc?.name ?? st.id, base: relationshipOf(w, s2.relationships, st.id) }];
    }
    if (st.kind === 'rep') {
      const f = w.factions?.find((x) => x.id === st.id);
      return [{ type: 'reputation_changed', factionId: st.id, name: f?.name ?? st.id, delta: v - cur, reason: '시험 설정' }];
    }
    const def = w.vars?.find((x) => x.id === st.id);
    return def ? [{ type: 'var_changed', varId: st.id, value: v, name: def.name, label: varLabel(def, v) }] : [];
  });
}

/** 한 일 기록: "상자키|할일id" · "move|장소ID" · "set|…" (값 정하기) */
export type SimPath = string[];

export function simReplay(w: WorldPackage, g: StoryGraph, path: SimPath): { state: GameState; lines: string[]; done: number } {
  let { state } = simStart(w);
  const lines: string[] = [];
  let done = 0;
  for (const step of path) {
    const [k, id] = [step.slice(0, step.lastIndexOf('|')), step.slice(step.lastIndexOf('|') + 1)];
    if (k === 'move') { const r = simMove(w, state, id); if (r.error) break; state = r.state; lines.push(...r.lines); done++; continue; }
    if (k === 'set') { const st = parseSetting(step); const r = st ? simSet(w, state, st) : null; if (!r || r.error) break; state = r.state; lines.push(...r.lines); done++; continue; }
    const n = g.nodes.find((x) => x.key === k);
    const act = n && simActs(w, state, n).find((a) => a.id === id);
    if (!act) break;
    const r = act.run(w, state);
    if (r.error) break;
    state = r.state; lines.push(...r.lines); done++;
  }
  return { state, lines, done };
}

// ---------------------------------------------------------------- 자동 탐색

export interface ExploreReport {
  runs: number;
  /** 결말 키 → 이른 횟수 */
  endings: Record<string, number>;
  /** 결말 없이 더 할 일이 없어진 횟수 · 한 예 */
  deadEnds: number; deadPath?: SimPath;
  /** 걸음 수를 다 써도 끝나지 않은 횟수 */
  tooLong: number;
  /** 한 번이라도 열리거나(진행·끝남 포함) 닿은 상자 */
  touched: string[];
  /** 한 번도 열리지 않은 상자 (플래그·지식·국면·시작 빼고) */
  never: string[];
  /** 결말마다 처음 이른 경로 */
  pathTo: Record<string, SimPath>;
  avgSteps: number;
  /** 갈림길별 결과 (v0.160): 상자키 → 할일id → 그 길로 간 판의 결말 (dead = 결말 없이 막힘, long = 끝나지 않음) */
  byChoice: Record<string, Record<string, { runs: number; endings: Record<string, number>; dead: number; long: number; path?: SimPath }>>;
}

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SKIP_NEVER = new Set(['flag', 'claim', 'phase', 'start', 'rule', 'clock']);

export async function simExplore(w: WorldPackage, g: StoryGraph, opts: { runs?: number; steps?: number; seed?: number; onProgress?: (done: number, total: number) => void; cancelled?: () => boolean; /** 모든 판의 시작에 먼저 하는 걸음 (v0.161: 정해 둔 성향·관계 등) */ prefix?: SimPath } = {}): Promise<ExploreReport> {
  const runs = opts.runs ?? 100, steps = opts.steps ?? 120;
  const rand = rng(opts.seed ?? 7);
  const touched = new Set<string>();
  const endings: Record<string, number> = {};
  const pathTo: Record<string, SimPath> = {};
  let deadEnds = 0, tooLong = 0, totalSteps = 0, finished = 0;
  let deadPath: SimPath | undefined;
  const byChoice: ExploreReport['byChoice'] = {};
  const prefix = opts.prefix ?? [];
  const start = prefix.length ? simReplay(w, g, prefix) : simStart(w);
  const mark = (s: GameState) => { for (const n of g.nodes) { const st = nodeSim(w, s, n).st; if (st !== 'locked' && st !== 'off' && st !== 'none') touched.add(n.key); } };
  for (let r = 0; r < runs; r++) {
    if (opts.cancelled?.()) break;
    let s = start.state;
    const path: SimPath = [...prefix];
    mark(s);
    let ended = false;
    for (let i = 0; i < steps; i++) {
      if (s.ending) { ended = true; break; }
      const acts: { key: string; a: { id: string; weight: number; run: (w2: WorldPackage, s2: GameState) => LabResult } }[] = g.nodes.flatMap((n) => simActs(w, s, n).filter((a) => a.weight > 0).map((a) => ({ key: n.key, a })));
      // 장소 조건 때문에 잠긴 것이 있으면 그 장소로 가 보기도 한다
      const places = wantedPlaces(w, s, g).slice(0, 5);
      for (const loc of places) acts.push({ key: 'move', a: { id: loc, weight: 1 / places.length, run: (w2, s2) => simMove(w2, s2, loc) } }); // 옮기기는 모두 합쳐 한 몫
      if (!acts.length) break;
      const sum = acts.reduce((t, x) => t + x.a.weight, 0);
      let pick = rand() * sum, chosen = acts[0]!;
      for (const x of acts) { pick -= x.a.weight; if (pick <= 0) { chosen = x; break; } }
      const res = chosen.a.run(w, s);
      if (res.error) break;
      s = res.state; path.push(`${chosen.key}|${chosen.a.id}`);
      mark(s);
    }
    totalSteps += path.length - prefix.length;
    // 결정적 선택·갈래 카드의 갈림길을 고른 판마다 그 판의 끝을 센다
    const outcome = s.ending ? `ending:${s.ending}` : !ended && path.length - prefix.length >= steps ? 'long' : 'dead';
    for (const st of new Set(path)) {
      const i = st.lastIndexOf('|'), k = st.slice(0, i), id = st.slice(i + 1);
      if (!k.startsWith('choice:') && !k.startsWith('card:')) continue;
      const t = ((byChoice[k] ??= {})[id] ??= { runs: 0, endings: {}, dead: 0, long: 0 });
      t.runs++;
      if (outcome === 'dead') t.dead++; else if (outcome === 'long') t.long++; else { t.endings[outcome] = (t.endings[outcome] ?? 0) + 1; t.path ??= path; }
    }
    if (s.ending) {
      const k = `ending:${s.ending}`;
      endings[k] = (endings[k] ?? 0) + 1;
      pathTo[k] ??= path;
      touched.add(k);
    } else if (!ended && path.length - prefix.length >= steps) tooLong++;
    else { deadEnds++; deadPath ??= path; }
    finished++;
    if (r % 5 === 4) { opts.onProgress?.(r + 1, runs); await new Promise((ok2) => setTimeout(ok2, 0)); }
  }
  return {
    runs: finished, endings, deadEnds, ...(deadPath ? { deadPath } : {}), tooLong, touched: [...touched], pathTo,
    never: g.nodes.filter((n) => !SKIP_NEVER.has(n.kind) && !touched.has(n.key)).map((n) => n.key),
    avgSteps: finished ? Math.round((totalSteps / finished) * 10) / 10 : 0,
    byChoice,
  };
}
