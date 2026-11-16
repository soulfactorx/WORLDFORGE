/**
 * 이야기 흐름도 (v0.142): 세계의 조건·효과를 읽어 "무엇이 무엇을 여는가"를 그래프로 만든다.
 *  - 노드: 임무 · 결말 · 갈래 카드 · 장면 · 함정·퍼즐 · 전투(조우) · 결정적 선택 · 줄기 · 연표 사건 · 진행 시계 · 세계 규칙 · 플래그 · 지식
 *  - 화살표: A → B = "A가 일어나면(끝나면 · 고르면 · 세우면) B가 열린다(시작 · 끝 · 실패 · 결말)"
 * 레이아웃: 화살표를 따라 단을 나눈다 (가장 긴 길), 같은 단에서는 앞 단의 이웃 자리 평균으로 줄을 세운다.
 */
import { stageGates } from '../engine/encounter';
import type { Condition, StoryEffect, WorldPackage } from '../engine/schema';

export type NodeKind = 'start' | 'quest' | 'ending' | 'card' | 'scene' | 'gimmick' | 'encounter' | 'choice' | 'arc' | 'event' | 'clock' | 'rule' | 'flag' | 'claim' | 'phase';
export const NODE_LABEL: Record<NodeKind, string> = {
  start: '시작', quest: '임무', ending: '결말', card: '갈래 카드', scene: '장면', gimmick: '함정·퍼즐', encounter: '전투', choice: '결정적 선택',
  arc: '줄기', event: '연표 사건', clock: '진행 시계', rule: '세계 규칙', flag: '플래그', claim: '지식', phase: '국면',
};
export const NODE_ICON: Record<NodeKind, string> = {
  start: '▶', quest: '🎯', ending: '◆', card: '🃏', scene: '🎭', gimmick: '🧩', encounter: '⚔', choice: '⚖', arc: '📖', event: '📅', clock: '⏳', rule: '⚙', flag: '🏳', claim: '💡', phase: '🌗',
};

export interface GNode { key: string; kind: NodeKind; id: string; name: string; sub?: string; warn?: string }
export type EdgeKind = 'start' | 'complete' | 'fail' | 'effect' | 'ending' | 'stage';
export interface GEdge { from: string; to: string; kind: EdgeKind; label: string }
export interface StoryGraph { nodes: GNode[]; edges: GEdge[] }

export const START_KEY = 'start:begin';
const key = (kind: NodeKind, id: string) => `${kind}:${id}`;

/** 조건이 가리키는 것: (노드, 그 뜻) */
function refsOf(c: Condition | undefined, out: { node: string; label: string }[] = []): { node: string; label: string }[] {
  if (!c || typeof c !== 'object') return out;
  const r = c as Record<string, unknown>;
  if (Array.isArray(r.all)) (r.all as Condition[]).forEach((x) => refsOf(x, out));
  if (Array.isArray(r.any)) (r.any as Condition[]).forEach((x) => refsOf(x, out));
  if (r.not) refsOf(r.not as Condition, out); // "~이 아니면"도 이어짐으로 보인다 (라벨에 표시)
  const neg = '';
  if (typeof r.questDone === 'string') out.push({ node: key('quest', r.questDone), label: `완료${neg}` });
  if (typeof r.questFailed === 'string') out.push({ node: key('quest', r.questFailed), label: '실패' });
  if (typeof r.questOutcome === 'string') out.push({ node: key('quest', r.questOutcome), label: r.is ? `결과 「${r.is}」` : '끝남' });
  if (typeof r.questStage === 'string') out.push({ node: key('quest', r.questStage), label: `${Number(r.is ?? 0) + 1}단계 중` });
  if (typeof r.sceneEnd === 'string') out.push({ node: r.sceneEnd as string, label: r.outcome === 'success' ? '성공' : r.outcome === 'failure' ? '실패' : r.is ? `끝 「${r.is}」` : '끝남' });
  if (typeof r.encounter === 'string') out.push({ node: key('encounter', r.encounter), label: r.is === 'defeat' ? '패배' : r.is === 'fled' ? '도망' : r.is ? '승리' : '치름' });
  if (typeof r.cleared === 'string') out.push({ node: key('encounter', r.cleared), label: '승리' });
  if (typeof r.flag === 'string') out.push({ node: key('flag', r.flag), label: '섬' });
  if (typeof r.choice === 'string') out.push({ node: key('choice', r.choice), label: r.is ? `「${r.is}」 고름` : '고름' });
  if (typeof r.storylet === 'string') out.push({ node: key('card', r.storylet), label: r.is ? `「${r.is}」 고름` : '고름' });
  if (typeof r.knows === 'string') out.push({ node: key('claim', r.knows), label: '앎' });
  if (typeof r.arcDone === 'string') out.push({ node: key('arc', r.arcDone), label: r.failed ? '실패' : '끝남' });
  if (typeof r.chapter === 'string') out.push({ node: key('arc', r.chapter), label: `${r.gte}장 끝` });
  if (typeof r.clock === 'string') out.push({ node: key('clock', r.clock), label: r.gte !== undefined ? `${r.gte}칸 이상` : '칸' });
  if (typeof r.phase === 'string') out.push({ node: key('phase', r.phase), label: '이 국면' });
  return out;
}

/** 효과가 일으키는 것 */
function effectRefs(list: StoryEffect[] | undefined, world: WorldPackage): { node: string; label: string }[] {
  const out: { node: string; label: string }[] = [];
  for (const e of list ?? []) {
    const r = e as Record<string, unknown>;
    if (typeof r.setFlag === 'string') out.push({ node: key('flag', r.setFlag), label: '세움' });
    if (typeof r.startScene === 'string') out.push({ node: sceneKey(world, r.startScene), label: '장면 시작' });
    if (typeof r.startEncounter === 'string') out.push({ node: key('encounter', r.startEncounter), label: '전투 시작' });
    if (typeof r.openStorylet === 'string') out.push({ node: key('card', r.openStorylet), label: '카드 펼침' });
    if (typeof r.advanceQuest === 'string') out.push({ node: key('quest', r.advanceQuest), label: '단계 진행' });
    if (typeof r.reveal === 'string') out.push({ node: key('claim', r.reveal), label: '알려 줌' });
  }
  return out;
}
const sceneKey = (w: WorldPackage, id: string) => key((w.scenes ?? []).find((s) => s.id === id)?.gimmick ? 'gimmick' : 'scene', id);

export function buildStoryGraph(w: WorldPackage): StoryGraph {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const add = (n: GNode) => { if (!nodes.has(n.key)) nodes.set(n.key, n); };
  const link = (from: string, to: string, kind: EdgeKind, label: string) => { if (from !== to && !edges.some((e) => e.from === from && e.to === to && e.label === label)) edges.push({ from, to, kind, label }); };
  const opens = (c: Condition | undefined, to: string, kind: EdgeKind, prefix = '') => {
    for (const r of refsOf(c)) {
      // 조건의 scene 가리킴은 장면·함정을 가려 쓴다
      const from = r.node.includes(':') ? r.node : sceneKey(w, r.node);
      link(from, to, kind, `${prefix}${r.label}`);
    }
  };
  const effects = (list: StoryEffect[] | undefined, from: string, prefix = '') => { for (const r of effectRefs(list, w)) link(from, r.node, 'effect', `${prefix}${r.label}`); };

  for (const q of w.quests ?? []) add({ key: key('quest', q.id), kind: 'quest', id: q.id, name: q.name, sub: `${q.kind === 'main' ? '메인' : '사이드'} · ${q.stages.length}단계` });
  for (const e of w.endings ?? []) add({ key: key('ending', e.id), kind: 'ending', id: e.id, name: e.name });
  for (const s of w.storylets ?? []) add({ key: key('card', s.id), kind: 'card', id: s.id, name: s.title, sub: `갈림길 ${s.options.length}${s.tags?.length ? ` · ${s.tags.join('·')}` : ''}` });
  for (const s of w.scenes ?? []) add({ key: sceneKey(w, s.id), kind: s.gimmick ? 'gimmick' : 'scene', id: s.id, name: s.name, ...(s.locationId ? { sub: w.locations.find((l) => l.id === s.locationId)?.name ?? '' } : {}) });
  for (const e of w.encounters ?? []) add({ key: key('encounter', e.id), kind: 'encounter', id: e.id, name: e.name, sub: w.locations.find((l) => l.id === e.locationId)?.name ?? '' });
  for (const c of w.choices ?? []) add({ key: key('choice', c.id), kind: 'choice', id: c.id, name: c.name, sub: `선택 ${c.options.length}` });
  for (const a of w.arcs ?? []) add({ key: key('arc', a.id), kind: 'arc', id: a.id, name: a.name, sub: `${a.chapters.length}장` });
  for (const e of w.events ?? []) add({ key: key('event', e.id), kind: 'event', id: e.id, name: e.name });
  for (const c of w.clocks ?? []) add({ key: key('clock', c.id), kind: 'clock', id: c.id, name: c.name, sub: `${c.segments}칸` });

  // 조건 (무엇이 열고 · 끝내고 · 실패시키는가)
  for (const q of w.quests ?? []) {
    const me = key('quest', q.id);
    opens(q.start, me, 'start', '→ 시작: ');
    opens(q.fail, me, 'fail', '→ 실패: ');
    q.stages.forEach((st, i) => {
      opens(st.complete, me, 'complete', `→ ${i + 1}단계 끝: `);
      const g = stageGates(st);
      g.scenes.forEach((id) => link(sceneKey(w, id), me, 'stage', `${i + 1}단계의 고비`));
      g.encounters.forEach((id) => link(key('encounter', id), me, 'stage', `${i + 1}단계의 고비`));
    });
    for (const o of q.outcomes ?? []) effects(o.effects, me, `결과 「${o.name}」: `);
  }
  for (const e of w.endings ?? []) opens(e.condition, key('ending', e.id), 'ending', '→ 결말: ');
  for (const s of w.storylets ?? []) {
    const me = key('card', s.id);
    opens(s.when, me, 'start', '→ 덱에 들어옴: ');
    if (s.quest) link(me, key('quest', s.quest), 'stage', '이 임무의 카드');
    for (const o of s.options) { effects(o.success, me, `「${o.label}」 성공: `); effects(o.fail, me, `「${o.label}」 실패: `); }
  }
  for (const s of w.scenes ?? []) {
    const me = sceneKey(w, s.id);
    opens(s.start, me, 'start', '→ 열림: ');
    for (const e of s.ends) effects(e.effects, me, `끝 「${e.name}」: `);
  }
  for (const e of w.encounters ?? []) { opens(e.when, key('encounter', e.id), 'start', '→ 일어남: '); opens(e.force, key('encounter', e.id), 'start', '→ 반드시: '); }
  for (const c of w.choices ?? []) {
    const me = key('choice', c.id);
    opens(c.when, me, 'start', '→ 열림: ');
    for (const o of c.options) effects(o.effects, me, `「${o.text}」: `);
  }
  for (const a of w.arcs ?? []) {
    const me = key('arc', a.id);
    opens(a.start, me, 'start', '→ 시작: ');
    a.chapters.forEach((ch, i) => { opens(ch.complete, me, 'complete', `→ ${i + 1}장 끝: `); effects(ch.effects, me, `${i + 1}장: `); });
  }
  for (const e of w.events ?? []) { const me = key('event', e.id); opens(e.when.condition, me, 'start', '→ 일어남: '); opens(e.unless, me, 'fail', '→ 막힘: '); effects(e.effects, me); }
  for (const c of w.clocks ?? []) { const me = key('clock', c.id); for (const t of c.tick) if ('on' in t) opens(t.on, me, 'start', '→ 차오름: '); for (const a of c.at) effects(a.effects, me, `${a.segment}칸: `); }
  for (const r of w.rules ?? []) {
    const fx = effectRefs(r.effects, w);
    const conds = r.trigger.kind === 'state' ? refsOf(r.trigger.condition) : [];
    if (!fx.length && !conds.length) continue;
    const me = key('rule', r.id);
    add({ key: me, kind: 'rule', id: r.id, name: r.name, sub: r.trigger.kind === 'action' ? '행동 규칙' : '상태 규칙' });
    if (r.trigger.kind === 'state') opens(r.trigger.condition, me, 'start', '→ 발동: ');
    effects(r.effects, me);
  }
  // 이어진 플래그·지식·국면만 노드로
  const used = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const k of used) {
    if (nodes.has(k)) continue;
    const [kind, ...rest] = k.split(':');
    const id = rest.join(':');
    if (kind === 'flag') {
      const set = edges.some((e) => e.to === k), read = edges.some((e) => e.from === k);
      // 선언된 플래그는 GM(AI)이 그 설명대로 세운다 — 효과로 세우는 곳이 없어도 괜찮다
      const decl = (w.flags ?? []).find((f) => f.id === id);
      add({ key: k, kind: 'flag', id, name: id, ...(decl?.when?.trim() ? { sub: `GM이 세움: ${decl.when.trim()}` } : {}),
        ...(read && !set && !decl ? { warn: '이 플래그를 세우는 곳이 없다 — 효과로 세우거나 플래그 목록에 「언제 세우는지」를 적어 GM이 세우게 하세요' } : {}) });
    } else if (kind === 'claim') add({ key: k, kind: 'claim', id, name: w.claims.find((c) => c.id === id)?.statement.slice(0, 40) ?? id });
    else if (kind === 'phase') add({ key: k, kind: 'phase', id, name: w.phases?.find((p) => p.id === id)?.name ?? id });
    else add({ key: k, kind: kind as NodeKind, id, name: id, warn: '세계에 없는 것을 가리킨다' });
  }
  // 없는 것을 가리키는 조건 · 막힌 결말
  for (const n of nodes.values()) {
    if (n.kind === 'quest' && !edges.some((e) => e.to === n.key && e.kind === 'start') && !(w.quests ?? []).find((q) => q.id === n.id)?.start) n.warn ??= '시작 조건이 없다';
  }
  // ▶ 시작 (v0.143): 들어오는 화살표가 없는 이야기 덩어리는 플레이어가 시작할 때부터 열려 있다 (또는 장소·날짜 같은 다른 조건으로 열린다)
  // 여는 화살표(시작·일으킴)가 없는 것 — 끝·실패 조건으로만 이어진 것도 처음부터 열린다
  const roots = [...nodes.values()].filter((n) => ROOT_KINDS.includes(n.kind) && !edges.some((e) => e.to === n.key && (e.kind === 'start' || e.kind === 'effect' || e.kind === 'ending')));
  // 시작 상자는 늘 있다 (v0.146) — 빈 세계도 흐름도에서 만들기 시작한다
  nodes.set(START_KEY, { key: START_KEY, kind: 'start', id: 'begin', name: '플레이 시작', sub: roots.length ? `처음부터 열리는 것 ${roots.length}` : '눌러서 첫 이야기 만들기' });
  {
    for (const r of roots) {
      const c = openCondition(w, r);
      edges.push({ from: START_KEY, to: r.key, kind: 'start', label: isEmptyCond(c) ? '처음부터 열림' : '처음부터 · 다른 조건(장소·관계·날짜 등)이 맞으면' });
    }
  }
  return { nodes: [...nodes.values()], edges };
}
const ROOT_KINDS: NodeKind[] = ['quest', 'card', 'scene', 'gimmick', 'encounter', 'choice', 'arc', 'event'];
export const isEmptyCond = (c: Condition | undefined) => !c || (typeof c === 'object' && 'all' in c && !c.all.length);
/** 이것이 열리는 조건 (임무 시작 · 카드 덱에 들어옴 · 장면 열림 …) */
export function openCondition(w: WorldPackage, n: GNode): Condition | undefined {
  switch (n.kind) {
    case 'quest': return w.quests?.find((x) => x.id === n.id)?.start;
    case 'ending': return w.endings?.find((x) => x.id === n.id)?.condition;
    case 'card': return w.storylets?.find((x) => x.id === n.id)?.when;
    case 'scene': case 'gimmick': return w.scenes?.find((x) => x.id === n.id)?.start;
    case 'encounter': return w.encounters?.find((x) => x.id === n.id)?.when;
    case 'choice': return w.choices?.find((x) => x.id === n.id)?.when;
    case 'arc': return w.arcs?.find((x) => x.id === n.id)?.start;
    case 'event': return w.events?.find((x) => x.id === n.id)?.when.condition;
    default: return undefined;
  }
}

export interface Placed extends GNode { x: number; y: number; layer: number }
export const NODE_W = 176, NODE_H = 58, GAP_X = 70, GAP_Y = 18;
/** 흐름 방향: 가로(왼쪽 → 오른쪽) · 세로(위 → 아래) */
export type FlowDir = 'right' | 'down';
const V_GAP_X = 16, V_GAP_Y = 56;
const KIND_ORDER: NodeKind[] = ['start', 'quest', 'arc', 'choice', 'card', 'scene', 'gimmick', 'encounter', 'event', 'clock', 'rule', 'flag', 'claim', 'phase', 'ending'];

/**
 * 단 나누기 (v0.143 손봄):
 *  - ▶ 시작이 맨 앞(왼쪽·위), 들어오는 화살표를 따라 가장 긴 길로 단을 정한다 (돌아오는 화살표는 무시)
 *  - 결말은 모두 맨 끝 단에 — 이야기가 어디로 흘러가 끝나는지 한눈에
 *  - 같은 단의 줄 순서: 앞뒤 이웃의 자리 평균으로 여러 번 고쳐 교차를 줄인다 (메인 임무가 먼저)
 *  - 이어진 것이 없는 노드는 맨 아래 따로
 */
export function layoutGraph(g: StoryGraph, dir: FlowDir = 'right', pinned?: Record<string, [number, number]>): { nodes: Placed[]; width: number; height: number; dir: FlowDir } {
  const ids = g.nodes.map((n) => n.key);
  const byKey = new Map(g.nodes.map((n) => [n.key, n]));
  const out = new Map<string, string[]>(ids.map((k) => [k, []]));
  const inn = new Map<string, string[]>(ids.map((k) => [k, []]));
  for (const e of g.edges) { if (out.has(e.from) && inn.has(e.to)) { out.get(e.from)!.push(e.to); inn.get(e.to)!.push(e.from); } }
  // DFS로 돌아오는 화살표를 찾는다 (시작에서 먼저 — 시작 쪽이 앞이 되게)
  const state = new Map<string, number>();
  const back = new Set<string>();
  const dfs = (k: string) => { state.set(k, 1); for (const t of out.get(k)!) { const s = state.get(t); if (s === 1) back.add(`${k}>${t}`); else if (!s) dfs(t); } state.set(k, 2); };
  const firstOrder = [...ids].sort((a, b) => (a === START_KEY ? -1 : b === START_KEY ? 1 : inn.get(a)!.length - inn.get(b)!.length));
  for (const k of firstOrder) if (!state.get(k)) dfs(k);
  const layer = new Map<string, number>();
  const hasStart = byKey.has(START_KEY);
  const depth = (k: string, seen = new Set<string>()): number => {
    if (layer.has(k)) return layer.get(k)!;
    if (seen.has(k)) return 0;
    seen.add(k);
    const preds = inn.get(k)!.filter((p) => !back.has(`${p}>${k}`));
    // 시작이 있으면 맨 앞 단은 시작만 — 고리로만 이어진 것(카드 ↔ 플래그)도 그 다음 단부터
    const d = preds.length ? Math.max(...preds.map((p) => depth(p, seen) + 1)) : hasStart && k !== START_KEY ? 1 : 0;
    layer.set(k, d);
    return d;
  };
  ids.forEach((k) => depth(k));
  const lonely = ids.filter((k) => k !== START_KEY && !out.get(k)!.length && !inn.get(k)!.length);
  const linked = ids.filter((k) => !lonely.includes(k));
  // 결말은 맨 끝 단
  const isEnd = (k: string) => byKey.get(k)!.kind === 'ending' && !out.get(k)!.length;
  const lastBody = Math.max(0, ...linked.filter((k) => !isEnd(k)).map((k) => layer.get(k)!));
  for (const k of linked) if (isEnd(k)) layer.set(k, lastBody + 1);
  const layers: string[][] = [];
  for (const k of linked) (layers[layer.get(k)!] ??= []).push(k);
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];
  const rank = (k: string) => { const n = byKey.get(k)!; return KIND_ORDER.indexOf(n.kind) * 2 + (n.kind === 'quest' && n.sub?.startsWith('메인') ? 0 : 1); };
  layers.forEach((col) => col.sort((a, b) => rank(a) - rank(b)));
  // 앞뒤 이웃 자리 평균 — 몇 번 오가며 다듬는다
  const pos = new Map<string, number>();
  const setPos = () => layers.forEach((col) => col.forEach((k, i) => pos.set(k, i)));
  setPos();
  const bary = (k: string, nb: string[]) => { const ps = nb.filter((p) => pos.has(p)); return ps.length ? ps.reduce((s, p) => s + pos.get(p)!, 0) / ps.length : pos.get(k)!; };
  for (let it = 0; it < 4; it++) {
    for (let li = 1; li < layers.length; li++) { layers[li]!.sort((a, b) => bary(a, inn.get(a)!) - bary(b, inn.get(b)!) || rank(a) - rank(b)); layers[li]!.forEach((k, i) => pos.set(k, i)); }
    for (let li = layers.length - 2; li >= 0; li--) { layers[li]!.sort((a, b) => bary(a, out.get(a)!) - bary(b, out.get(b)!) || rank(a) - rank(b)); layers[li]!.forEach((k, i) => pos.set(k, i)); }
  }
  const tallest = Math.max(0, ...layers.map((c) => c.length));
  const placed: Placed[] = [];
  const down = dir === 'down';
  const stepL = down ? NODE_H + V_GAP_Y : NODE_W + GAP_X; // 단과 단 사이
  const stepI = down ? NODE_W + V_GAP_X : NODE_H + GAP_Y; // 한 단 안에서
  layers.forEach((col, li) => {
    const off = ((tallest - col.length) / 2) * stepI; // 단마다 가운데 맞춤
    col.forEach((k, i) => {
      const a = 20 + li * stepL, b = 40 + off + i * stepI;
      placed.push({ ...byKey.get(k)!, layer: li, x: down ? b - 20 : a, y: down ? a + 20 : b });
    });
  });
  const bodyEnd = down ? 40 + layers.length * stepL : 40 + tallest * stepI;
  const lonelyTop = bodyEnd + (lonely.length ? 50 : 0);
  const perRow = Math.max(4, down ? tallest : layers.length || 4);
  lonely.forEach((k, i) => placed.push({ ...byKey.get(k)!, layer: -1, x: 20 + (i % perRow) * (NODE_W + (down ? V_GAP_X : GAP_X)), y: lonelyTop + Math.floor(i / perRow) * (NODE_H + GAP_Y) }));
  // 손으로 옮긴 상자 (v0.144)
  if (pinned) for (const p of placed) { const at = pinned[p.key]; if (Array.isArray(at) && Number.isFinite(at[0]) && Number.isFinite(at[1])) { p.x = Math.max(0, at[0]); p.y = Math.max(0, at[1]); } }
  const width = Math.max(...placed.map((p) => p.x + NODE_W), 400) + 20;
  const height = Math.max(...placed.map((p) => p.y + NODE_H), 200) + 20;
  return { nodes: placed, width, height, dir };
}

/** 한 노드와 이어진 것 (depth 걸음까지) */
export function neighbors(g: StoryGraph, k: string, depth = 1): Set<string> {
  const seen = new Set([k]);
  let frontier = [k];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const f of frontier) for (const e of g.edges) { const o = e.from === f ? e.to : e.to === f ? e.from : null; if (o && !seen.has(o)) { seen.add(o); next.push(o); } }
    frontier = next;
  }
  return seen;
}
