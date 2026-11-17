/**
 * 이야기 흐름도 (v0.142): 임무·분기·조건으로 열리는 것을 한 장의 그림으로. 누르면 옆(휴대폰은 아래)에서 자세히 보고 바로 고친다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Arc, Character, Clock, Condition, CustomMonster, Ending, ItemDef, Location, Quest, StoryEffect, WorldEvent, WorldPackage, WorldRule } from '../engine/schema';
import { QUEST_TYPE_LABEL, UNSET_CONDITION } from '../engine/scenario';
import { QUEST_TYPES, type QuestStage } from '../engine/schema';
import { SKILLS, SKILL_IDS } from '../engine/character/rules';
import { STAKE_ICON } from '../engine/stakes';
import type { Storylet, StoryletOption, DecisiveChoice, Claim, KnowledgeState } from '../engine/schema';
import { setLink } from '../engine/locationLinks';
import { buildStoryGraph, type FlowDir, isEmptyCond, isLane, openCondition, START_KEY, layoutGraph, neighbors, NODE_H, NODE_ICON, NODE_LABEL, NODE_W, type GEdge, type GNode, type NodeKind, type StoryGraph } from '../gm/storyGraph';
import { renameFlag, restageQuest, edgeSlots, effectSlots, firstLeaf, getCond, getEffects, type LinkOption, linkOptions, replaceLeaf, setCond, setEffects, sourceWays, unlink } from '../gm/flowLink';
import { type ActPreview, type ExploreReport, nodeSim, type NodeSim, previewActs, settingKey, settingStep, settingValue, type SimSetting, simSet, simActs, simExplore, simIcon, simMove, type SimPath, simReplay, simStart, wantedPlaces } from '../gm/flowSim';
import { condTrace } from '../gm/lab';
import type { GameState } from '../engine/state/state';
import { TraceView } from './WorldLab';
import { monsterTable } from '../engine/combat/monsters';
import { traitsFor } from '../engine/traits';
import { ClassEditor } from './ClassEditor';
import { SPEC, StructField } from './Struct';
import { RELATION_KIND_LABEL } from '../engine/relationship';
import type { Faction, NpcRelationKind, RelationBeat } from '../engine/schema';
import { STD_ITEMS } from '../data/items';
import { ProfileEditor } from './ProfileEditor';
import type { StartOption } from '../engine/schema';
import { AXES, AXIS_NAMES } from '../engine/relationship';
import type { Encounter } from '../engine/schema';
import { isMyAssets, keepAsAsset } from '../storage/myAssets';
import { FlowLibrary } from './FlowLibrary';
import type { BorrowKind } from '../engine/borrow';
import { GIMMICK_DEFAULTS, GimmickForm } from './GimmickForms';
import { newSceneDef, SceneForm } from './SceneForms';
import { SceneTester } from './SceneTester';
import { GIMMICK_KINDS, gimmickScene } from '../engine/gimmick';
import type { Gimmick, SceneDef } from '../engine/schema';
import { ConditionField } from './ConditionEditor';
import { Area, Text } from './form';
import { EffectsEditor } from './WorldForms';

type SetW = (patch: Partial<WorldPackage>) => void;
/** 전체 편집 탭 */
export type FlowTab = 'quests' | 'story' | 'scenes' | 'gimmicks' | 'encounters' | 'rules' | 'knowledge' | 'locations' | 'characters' | 'items' | 'relations';
const TAB_OF: Partial<Record<NodeKind, FlowTab>> = { quest: 'quests', ending: 'quests', flag: 'quests', card: 'story', choice: 'story', arc: 'story', event: 'story', clock: 'story', phase: 'story', scene: 'scenes', gimmick: 'gimmicks', encounter: 'encounters', rule: 'rules', claim: 'knowledge', location: 'locations', character: 'characters', item: 'items', monster: 'encounters', faction: 'relations' };
const TAB_NAME: Record<FlowTab, string> = { quests: '임무·플래그·결말', story: '이야기 흐름', scenes: '장면', gimmicks: '함정·퍼즐', encounters: '조우', rules: '세계 규칙', knowledge: '지식', locations: '장소', characters: '인물', items: '아이템·상점', relations: '관계·세력' };
const MAIN_KINDS: NodeKind[] = ['quest', 'ending', 'card', 'scene', 'gimmick', 'encounter', 'choice', 'arc', 'event', 'clock', 'rule', 'flag', 'claim', 'phase', 'location', 'character', 'faction', 'item', 'monster'];
const DIR_KEY = 'worldforge.flow.dir';
/** 흐름도 상자 종류 → 만계서고에서 옮기는 종류 (v0.158) */
export const BORROW_OF: Partial<Record<NodeKind, BorrowKind>> = {
  quest: 'quest', ending: 'ending', card: 'storylet', scene: 'scene', gimmick: 'scene', encounter: 'encounter', choice: 'choice', arc: 'arc', event: 'event',
  clock: 'clock', rule: 'rule', flag: 'flag', claim: 'knowledge', location: 'location', character: 'character', item: 'item', monster: 'monster', faction: 'faction',
};
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function StoryFlow({ w, set, onTab, onSave, dirty }: { w: WorldPackage; set: SetW; onTab: (t: FlowTab) => void; /** 넓게 보기에서 저장 (v0.164) */ onSave?: () => void; dirty?: boolean }) {
  // 화면 넓게 쓰기 (v0.164): 위 도구를 접고(기억 — 휴대폰은 처음엔 접힘), 「⛶ 넓게」면 흐름도가 화면 전체를 쓴다
  const narrow = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 900px)').matches;
  const [tools, setToolsRaw] = useState<boolean>(() => { try { const v = localStorage.getItem('worldforge.flow.tools'); return v ? v === '1' : !narrow(); } catch { return true; } });
  const setTools = (v: boolean) => { setToolsRaw(v); try { localStorage.setItem('worldforge.flow.tools', v ? '1' : '0'); } catch { /* 괜찮다 */ } };
  const [wide, setWide] = useState(false);
  const graph = useMemo(() => buildStoryGraph(w), [w]);
  const counts = useMemo(() => { const m = new Map<NodeKind, number>(); for (const n of graph.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1); return m; }, [graph]);
  const [hidden, setHidden] = useState<globalThis.Set<NodeKind>>(() => new globalThis.Set<NodeKind>(graph.nodes.length > 40 ? ['claim', 'phase', 'location', 'character', 'faction', 'item', 'monster'] : ['claim', 'phase'])); // 큰 세계는 장소·인물을 처음엔 숨긴다
  const [q, setQ] = useState('');
  const empty = graph.nodes.every((n) => n.kind === 'start' || isLane(n.key)); // 장소·인물만 있으면 아직 이야기는 빈 것
  // 빈 세계: 시작 상자를 골라 둔다 — 옆 창에 「처음부터 열리는 …」 만들기가 바로 보인다
  const [sel, setSel] = useState<string | null>(() => (empty && typeof window !== 'undefined' && window.matchMedia?.('(min-width: 901px)').matches ? START_KEY : null)); // 휴대폰은 아래 창이 화면을 덮으므로 안내 카드만
  const [focus, setFocus] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dir, setDir] = useState<FlowDir>(() => { try { return localStorage.getItem(DIR_KEY) === 'down' ? 'down' : 'right'; } catch { return 'right'; } });
  /** 잇기: 끄는 중 · 누를 상자를 기다리는 중 · 방법 고르기 */
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const [note, setNote] = useState('');
  /** 목록 (v0.159): PC는 왼쪽에 늘 · 휴대폰은 그림 대신 */
  const OUTLINE_KEY = 'worldforge.flow.outline';
  const [outline, setOutlineRaw] = useState<boolean>(() => { try { const v = localStorage.getItem(OUTLINE_KEY); return v ? v === '1' : window.matchMedia?.('(min-width: 901px)').matches ?? true; } catch { return true; } });
  const setOutline = (v: boolean) => { setOutlineRaw(v); try { localStorage.setItem(OUTLINE_KEY, v ? '1' : '0'); } catch { /* 괜찮다 */ } };
  const scrollTo = useRef<string | null>(null);
  const scrollHalf = useRef(false);
  /** 만계서고에서 가져오기 (v0.158): 이어 붙일 조건 */
  const [lib, setLib] = useState<{ after?: Condition; afterName?: string; kind?: BorrowKind } | null>(null);
  /** 화살표 고치기 (v0.145) */
  const [edgeSel, setEdgeSel] = useState<GEdge | null>(null);
  /** 시뮬레이션 (v0.145): 한 일의 경로로 상태를 다시 만든다 (되돌리기 · 세계를 고치면 다시 돌리기) */
  const [sim, setSim] = useState<{ path: SimPath; state: GameState; lines: string[]; stopped?: number } | null>(null);
  const [report, setReport] = useState<ExploreReport | null>(null);
  const [exploring, setExploring] = useState<string>('');
  const cancelExplore = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const selNode = sel ? graph.nodes.find((n) => n.key === sel) ?? null : null;
  useEffect(() => { if (sel && !selNode) setSel(null); }, [selNode]);
  useEffect(() => { try { localStorage.setItem(DIR_KEY, dir); } catch { /* 저장 못 해도 괜찮다 */ } }, [dir]);
  const simGo = (path: SimPath) => { const r = path.length ? simReplay(w, graph, path) : { ...simStart(w), done: 0 }; setSim({ path: path.slice(0, r.done), state: r.state, lines: r.lines, ...(r.done < path.length ? { stopped: path.length - r.done } : {}) }); };
  // 시뮬레이션 중 세계를 고치면 같은 경로로 다시 돌린다 — 고친 것이 바로 반영된다
  const simW = useRef(w);
  useEffect(() => { if (sim && simW.current !== w) simGo(sim.path); simW.current = w; }, [w]);
  const simMap = useMemo(() => (sim ? new Map(graph.nodes.map((n) => [n.key, nodeSim(w, sim.state, n)])) : null), [sim, graph]);
  const simOpen = useMemo(() => (sim && !sim.state.ending ? graph.nodes.filter((n) => simActs(w, sim.state, n).some((a) => a.weight > 0)).length : 0), [sim, graph]);
  const neverSet = useMemo(() => new globalThis.Set(report?.never ?? []), [report]);

  // 보이는 것: 종류 거르기 · (고른 것의 이웃만) — 거른 뒤 다시 배치해 빈칸 없이
  const shown: StoryGraph = useMemo(() => {
    const near = focus && sel ? neighbors(graph, sel, 2) : null;
    const nodes = graph.nodes.filter((n) => (!hidden.has(n.kind) || n.key === sel) && (!near || near.has(n.key)));
    const keys = new globalThis.Set(nodes.map((n) => n.key));
    return { nodes, edges: graph.edges.filter((e) => keys.has(e.from) && keys.has(e.to)) };
  }, [graph, hidden, focus, sel]);
  const pins = w.flowLayout?.[dir];
  const lay = useMemo(() => layoutGraph(shown, dir, pins), [shown, dir, pins]);
  /** 상자 옮기기 (v0.144): 마우스는 바로 끌고, 손가락은 길게 눌러서 (그냥 쓸면 화면이 굴러간다) */
  const moveRef = useRef<{ key: string; ox: number; oy: number; sx: number; sy: number; touch: boolean; started: boolean; timer?: number } | null>(null);
  const [moving, setMoving] = useState<{ key: string; x: number; y: number } | null>(null);
  const justMoved = useRef(false);
  const pos = useMemo(() => {
    const m = new Map(lay.nodes.map((n) => [n.key, n as { x: number; y: number }]));
    if (moving) m.set(moving.key, { x: moving.x, y: moving.y });
    return m;
  }, [lay, moving]);
  // 목록에서 고른 상자로 굴리기 (v0.159)
  useEffect(() => {
    const k = scrollTo.current, c = canvasRef.current, at = k ? pos.get(k) : undefined;
    if (!k || !c || !at || c.clientWidth === 0) return;
    scrollTo.current = null;
    let cx = c.clientWidth / 2, cy = c.clientHeight / 2; // 상자를 둘 자리 (그림판 안 좌표)
    if (scrollHalf.current) {
      // 창이 덮지 않는 부분의 가운데: 가로 화면은 왼쪽 절반, 세로 화면은 위쪽 절반
      const r = c.getBoundingClientRect(), landscape = window.innerWidth > window.innerHeight;
      if (landscape) cx = (Math.max(r.left, 0) + Math.min(r.right, window.innerWidth / 2)) / 2 - r.left;
      else cy = (Math.max(r.top, 0) + Math.min(r.bottom, window.innerHeight / 2)) / 2 - r.top;
      scrollHalf.current = false;
    }
    c.scrollLeft = Math.max(0, (at.x + NODE_W / 2) * zoom - cx);
    c.scrollTop = Math.max(0, (at.y + NODE_H / 2) * zoom - cy);
  });
  const savePins = (next: Record<string, [number, number]> | undefined) => {
    const cur = { ...(w.flowLayout ?? {}) };
    if (next && Object.keys(next).length) cur[dir] = next; else delete cur[dir];
    set({ flowLayout: cur.right || cur.down ? cur : undefined });
  };
  const pin = (key: string, x: number, y: number) => {
    const keys = new globalThis.Set(graph.nodes.map((n) => n.key)); // 없어진 상자의 자리는 버린다
    const kept = Object.fromEntries(Object.entries(pins ?? {}).filter(([k]) => keys.has(k)));
    savePins({ ...kept, [key]: [Math.max(0, Math.round(x / 10) * 10), Math.max(0, Math.round(y / 10) * 10)] });
  };
  const onTop = (k: string) => (moving?.key === k ? 3 : k === sel ? 2 : pins?.[k] ? 1 : 0);
  const endMove = () => { const m = moveRef.current; if (m?.timer) window.clearTimeout(m.timer); moveRef.current = null; setMoving(null); };
  // 손가락으로 옮기는 동안은 화면이 굴러가지 않게 (React의 터치 이벤트는 막을 수 없어 직접 단다)
  const hasSvg = shown.nodes.length > 0;
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const h = (e: TouchEvent) => { if (moveRef.current?.started) e.preventDefault(); };
    el.addEventListener('touchmove', h, { passive: false });
    return () => el.removeEventListener('touchmove', h);
  }, [hasSvg]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (n: GNode) => !words.length || words.every((t) => `${n.name} ${n.id} ${n.sub ?? ''} ${NODE_LABEL[n.kind]}`.toLowerCase().includes(t));
  const near1 = sel ? neighbors(shown, sel, 1) : null;
  const warns = graph.nodes.filter((n) => n.warn).length;
  const down = dir === 'down';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pending || edgeSel) return; // 방법 고르기 · 화살표 창은 스스로 닫는다
      if (document.querySelector('.scene-tester, .lightbox')) return; // 장면 시험 창·그림 크게 보기가 먼저 닫힌다 (v0.156)
      if (linking || drag) { setLinking(null); setDrag(null); } else if (sel) setSel(null); else setWide(false); // 고른 것이 없으면 넓게 보기를 끝낸다
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [linking, drag, pending, edgeSel, sel]);

  const toSvg = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };
  const nodeAt = (x: number, y: number) => lay.nodes.find((n) => x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H);
  const dropTarget = drag ? nodeAt(drag.x, drag.y) : undefined;
  const fit = () => { const c = canvasRef.current; if (c) setZoom(Math.max(0.3, Math.min(1, +((c.clientWidth - 4) / lay.width).toFixed(2)))); };
  // 그림판 크기 (v0.147): 상자들보다 넉넉히 크고, 보이는 창보다 작지 않게 — 끌고 있는 상자를 따라 더 커진다
  const [viewSz, setViewSz] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const c = canvasRef.current; if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewSz({ w: c.clientWidth, h: c.clientHeight }));
    ro.observe(c); return () => ro.disconnect();
  }, [hasSvg]);
  const farX = Math.max(lay.width, moving ? moving.x + NODE_W + 40 : 0, drag ? drag.x + 40 : 0);
  const farY = Math.max(lay.height, moving ? moving.y + NODE_H + 40 : 0, drag ? drag.y + 40 : 0);
  const svgW = Math.round(Math.max(farX + 480, viewSz.w / zoom)), svgH = Math.round(Math.max(farY + 320, viewSz.h / zoom));
  // 미니맵 (v0.159): 보이는 자리
  const [view, setView] = useState({ sl: 0, st: 0, cw: 0, ch: 0 });
  const viewRaf = useRef(0);
  const onCanvasScroll = () => {
    cancelAnimationFrame(viewRaf.current);
    viewRaf.current = requestAnimationFrame(() => { const c = canvasRef.current; if (c) setView({ sl: c.scrollLeft, st: c.scrollTop, cw: c.clientWidth, ch: c.clientHeight }); });
  };
  useEffect(() => { onCanvasScroll(); }, [viewSz.w, viewSz.h, zoom, lay.width, lay.height]);
  // 빈 곳을 끌면 화면을 옮긴다 (마우스 — 손가락은 원래 굴러간다)
  const panRef = useRef<{ sx: number; sy: number; sl: number; st: number; moved: boolean } | null>(null);
  // 끄는 동안 가장자리에 머물면 계속 굴린다 (가까울수록 빠르게)
  const lastPt = useRef<{ clientX: number; clientY: number } | null>(null);
  useEffect(() => {
    if (!moving && !drag) return;
    let raf = 0;
    const tick = () => {
      const c = canvasRef.current, pt = lastPt.current;
      if (c && pt) {
        const r = c.getBoundingClientRect(), edge = 56;
        const sp = (d: number) => Math.ceil(Math.max(0, edge - d) / 3);
        const dx = pt.clientX > r.right - edge ? sp(r.right - pt.clientX) : pt.clientX < r.left + edge ? -sp(pt.clientX - r.left) : 0;
        const dy = pt.clientY > r.bottom - edge ? sp(r.bottom - pt.clientY) : pt.clientY < r.top + edge ? -sp(pt.clientY - r.top) : 0;
        if (dx || dy) {
          c.scrollLeft += dx; c.scrollTop += dy;
          const p = toSvg(pt), m = moveRef.current;
          if (m?.started) setMoving({ key: m.key, x: Math.max(0, p.x - m.ox), y: Math.max(0, p.y - m.oy) });
          else setDrag((d) => (d ? { ...d, ...p } : d));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [!!moving, !!drag, zoom]);
  const pick = (k: string) => {
    if (linking) { if (k !== linking) setPending({ from: linking, to: k }); setLinking(null); return; }
    setSel(k === sel ? null : k);
    // 휴대폰 (v0.164): 창이 화면 절반(가로면 오른쪽, 세로면 아래)을 덮으므로 고른 상자를 남은 절반으로 굴린다
    if (k !== sel && narrow()) { scrollTo.current = k; scrollHalf.current = true; }
  };
  const byKey = (k: string) => graph.nodes.find((n) => n.key === k);
  // 처음 열 때 · 방향을 바꿀 때: ▶ 시작이 보이게 굴린다
  const startY = pos.get(START_KEY)?.y, startX = pos.get(START_KEY)?.x;
  useEffect(() => {
    const c = canvasRef.current; if (!c || startY === undefined || startX === undefined) return;
    c.scrollTop = Math.max(0, startY * zoom - c.clientHeight / 3);
    c.scrollLeft = Math.max(0, startX * zoom - 20);
  }, [dir, startY === undefined]);

  return (
    <div className={`story-flow${wide ? ' wide' : ''}${tools ? '' : ' tools-folded'}${selNode ? ' has-panel' : ''}`}>
      <div className="row flow-bar">
        <button type="button" className={`small${tools ? ' on' : ''}`} aria-expanded={tools} onClick={() => setTools(!tools)} title="설명·종류·찾기·범례를 펼치거나 접는다" aria-label={tools ? '도구 접기' : '도구 펼치기'}>{tools ? '▴' : '▾'}<span className="flow-bar-label">{tools ? ' 도구 접기' : ' 도구'}</span></button>
        <button type="button" className={`small${outline ? ' on' : ''}`} aria-pressed={outline} onClick={() => setOutline(!outline)} title="종류별 목록으로 찾아 고르기">📋<span className="flow-bar-label"> 목록</span></button>
        <button type="button" className={`small${sim ? ' on' : ''}`} aria-pressed={!!sim} onClick={() => { if (sim) { setSim(null); cancelExplore.current = true; } else { simGo([]); setLinking(null); } }} title="흐름도 위에서 이야기를 직접 진행해 보고, 자동으로 여러 번 끝까지 해 본다">{sim ? '■' : '🧪'}<span className="flow-bar-label">{sim ? ' 시뮬레이션 끝내기' : ' 시뮬레이션'}</span></button>
        <span className="row flow-zoom">
          <button type="button" className="small" aria-label="작게" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)))}>−</button>
          <button type="button" className="small zoom-pct" onClick={() => setZoom(1)} title="100%로">{Math.round(zoom * 100)}%</button>
          <button type="button" className="small" aria-label="크게" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}>＋</button>
          <button type="button" className="small" onClick={fit} title="화면 폭에 맞추기" aria-label="화면 폭에 맞추기">⤢</button>
        </span>
        <span className="spacer" />
        {wide && onSave && <button type="button" className="small primary" onClick={onSave} title="세계 저장">{dirty ? '● ' : ''}저장</button>}
        <button type="button" className={`small${wide ? ' on' : ''}`} aria-pressed={wide} onClick={() => setWide(!wide)} title={wide ? '원래 화면으로 (Esc)' : '흐름도가 화면 전체를 쓴다 — 머리말·탭을 가린다'} aria-label={wide ? '넓게 보기 끝' : '넓게 보기'}>{wide ? '✕' : '⛶'}<span className="flow-bar-label">{wide ? ' 넓게 끝' : ' 넓게'}</span></button>
      </div>
      {tools && <p className="muted small">세계의 <b>임무·결말·갈래 카드·장면·함정·전투·결정적 선택·사건</b>이 어떤 조건으로 이어지는지 그린 지도입니다. <b>▶ 플레이 시작</b>에서 출발해 {down ? '아래로' : '오른쪽으로'} 흘러가 맨 끝의 <b>◆ 결말</b>에 이릅니다. 화살표 <b>A → B</b>는 "A가 끝나거나(고르거나 · 세우면) B가 열린다"는 뜻입니다. 상자를 누르면 자세히 보고 고치며, 상자의 <b>●</b> 손잡이를 다른 상자로 끌면 둘을 잇습니다. 상자를 끌면(휴대폰은 길게 누른 뒤 끌면) 자리를 옮기고, 옮긴 자리는 세계와 함께 저장됩니다.</p>}
      <div className="flow-toolbar">
        {tools && <>
        <div className="flow-kinds">
          {MAIN_KINDS.filter((k) => counts.get(k)).map((k) => {
            const on = !hidden.has(k);
            return <button key={k} type="button" className={`tag-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setHidden((h) => { const n = new globalThis.Set(h); if (on) n.add(k); else n.delete(k); return n; })}>{NODE_ICON[k]} {NODE_LABEL[k]} {counts.get(k)}</button>;
          })}
        </div>
        <div className="row flow-tools">
          <input type="search" placeholder="🔍 이름으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={focus} disabled={!sel} onChange={(e) => setFocus(e.target.checked)} /> 고른 것과 이어진 것만</label>
          <button type="button" className="small" onClick={() => setDir(down ? 'right' : 'down')} title="흐름 방향 바꾸기">{down ? '↓ 위에서 아래로' : '→ 왼쪽에서 오른쪽으로'}</button>
          {pins && Object.keys(pins).length > 0 && <button type="button" className="small" onClick={() => { if (confirm(`옮긴 상자 ${Object.keys(pins).length}개를 자동 배치 자리로 되돌릴까요? (${down ? '세로' : '가로'} 방향만)`)) savePins(undefined); }} title="손으로 옮긴 자리를 지우고 자동으로 다시 놓는다">↺ 자동 배치로</button>}
        </div>
        <p className="small muted flow-legend">
          <span className="lg start">— 시작·열림</span> <span className="lg complete">— 끝·결말</span> <span className="lg fail">- - 실패·막힘</span> <span className="lg effect">··· 일으킴(플래그·장면·카드)</span>
          {warns > 0 && <span className="warn-text"> · ⚠ 살펴볼 곳 {warns}</span>}
        </p>
        </>}
        {empty && (
          <div className="flow-empty" role="note">
            <b>🗺 흐름도에서 이야기 만들기</b>
            <ol className="small">
              <li><b>▶ 플레이 시작</b>에서 처음 열릴 것을 만드세요 — 첫 임무·갈래 카드·결정적 선택.</li>
              <li>만든 상자를 고르고 <b>「＋ 이것 다음에 열리는 임무」</b>로 이야기를 이어 가고, 갈라지는 곳은 선택지·카드의 갈림길로 만드세요.</li>
              <li>끝에는 <b>「＋ 이것으로 이르는 결말」</b> (또는 <b>＋ 결말</b>로 먼저 만들고 이어도 됩니다). 상자의 ● 손잡이를 끌어 잇고, 화살표를 눌러 조건을 고칩니다.</li>
              <li><b>＋ 장면 · ＋ 함정·퍼즐</b>은 판정으로 풀어 가는 고비입니다 — 성공·실패에 따라 다음이 갈라집니다.</li>
              <li><b>＋ 장소 · ＋ 인물 · ＋ 아이템 · ＋ 적</b>은 흐름 아래 띠에 놓입니다. 장소를 이야기 상자로 끌면 「여기 있으면 열림」 「여기서 일어남」이 됩니다.</li>
              <li>다 되면 <b>🧪 시뮬레이션</b>으로 끝까지 가 보세요.</li>
            </ol>
            <div className="row flow-empty-actions">{startCreators(w, set, setSel).map((c) => <button key={c.label} type="button" onClick={c.run}>{c.label}</button>)}
              <SceneAdd w={w} set={set} onPick={setSel} scene="＋ 장면" gimmick="＋ 함정·퍼즐" />
              <button type="button" onClick={() => setLib({})}>🌌 만계서고에서 가져오기</button></div>
          </div>
        )}
        {sim && (
          <div className="flow-sim" role="region" aria-label="시뮬레이션">
            <p className="small"><b>🧪 시뮬레이션</b> — 진행 {sim.path.length}번 · {sim.state.ending ? <b>🏁 결말: {w.endings?.find((e) => e.id === sim.state.ending)?.name ?? sim.state.ending}</b> : simOpen ? <>할 수 있는 상자 <b>{simOpen}</b>개 (🟢·▶ 상자를 눌러 진행)</> : <span className="warn-text">⚠ 더 할 수 있는 일이 없습니다 — 결말 없이 막혔습니다</span>}
              {sim.stopped ? <span className="warn-text"> · 고친 세계에서는 마지막 {sim.stopped}걸음을 다시 할 수 없어 멈췄습니다</span> : null}</p>
            <div className="row flow-sim-tools">
              <label className="flow-sim-place">📍 지금 장소
                <select value={sim.state.player.locationId} onChange={(ev) => {
                  const to = ev.target.value, r = simMove(w, sim.state, to);
                  if (r.error) { setNote(`❌ ${r.error}`); return; }
                  setSim({ path: [...sim.path, `move|${to}`], state: r.state, lines: [...sim.lines, `▸ 📍 ${w.locations.find((l) => l.id === to)?.name ?? to}(으)로 옮김`, ...r.lines.map((x) => `   ${x}`)] });
                }}>
                  {(() => { const want = new globalThis.Set(wantedPlaces(w, sim.state, graph)); return w.locations.map((l) => <option key={l.id} value={l.id}>{want.has(l.id) ? '★ ' : ''}{l.name}</option>); })()}
                </select>
              </label>
              <button type="button" className="small" disabled={!sim.path.length} onClick={() => simGo(sim.path.slice(0, -1))}>↶ 한 걸음 되돌리기</button>
              <button type="button" className="small" disabled={!sim.path.length} onClick={() => simGo([])}>⟲ 처음부터</button>
              {exploring ? <button type="button" className="small" onClick={() => { cancelExplore.current = true; }}>그만 ({exploring})</button>
                : <button type="button" className="small" onClick={() => {
                  cancelExplore.current = false; setExploring('0%');
                  // 정해 둔 성향·관계 등이 있으면 모든 판을 그 값에서 시작한다 (v0.161)
                  const prefix = sim.path.filter((x) => x.startsWith('set|'));
                  void simExplore(w, graph, { runs: 100, seed: Date.now() % 100000, prefix, onProgress: (d, t) => setExploring(`${Math.round((d / t) * 100)}%`), cancelled: () => cancelExplore.current })
                    .then((r) => { setReport(r); setExploring(''); });
                }} title="무작위로 100번 끝까지 해 본다 (AI 없이 엔진만)">🎲 자동 탐색 100번{sim.path.some((x) => x.startsWith('set|')) ? ` (정한 값 ${new globalThis.Set(sim.path.filter((x) => x.startsWith('set|')).map((x) => settingKey(x))).size}개에서)` : ''}</button>}
            </div>
            <SimSettings w={w} state={sim.state} path={sim.path}
              onSet={(st) => {
                const step = settingStep(st), key = settingKey(step);
                const last = sim.path.at(-1);
                const replace = !!last && settingKey(last) === key; // 같은 값을 이어서 끌면 마지막 걸음을 바꿔 끼운다
                const base = replace ? simReplay(w, graph, sim.path.slice(0, -1)).state : sim.state;
                const r = simSet(w, base, st);
                if (r.error) { setNote(`❌ ${r.error}`); return; }
                setSim({ path: [...(replace ? sim.path.slice(0, -1) : sim.path), step], state: r.state, lines: replace ? sim.lines : [...sim.lines, ...r.lines.map((x) => `▸ ${x}`)] });
              }}
              onReset={() => simGo(sim.path.filter((x) => !x.startsWith('set|')))} />
            {sim.lines.length > 0 && (
              <details className="flow-sim-log"><summary className="small">지금까지 일어난 일 ({sim.path.length}걸음)</summary>
                <pre className="small">{sim.lines.slice(-60).join('\n')}</pre>
              </details>
            )}
            {report && <ExploreView w={w} g={graph} r={report} onPath={(p) => { simGo(p); setNote('경로를 따라갔습니다 — 상자 상태가 그 순간으로 바뀌었습니다.'); }} onPick={setSel} onClose={() => setReport(null)} />}
          </div>
        )}
        {linking && <p className="flow-linking small" role="status">🔗 「{byKey(linking)?.name}」과(와) 이을 상자를 누르세요 <button type="button" className="small" onClick={() => setLinking(null)}>그만두기</button></p>}
        {note && <p className="small status" role="status">{note} <button type="button" className="small" onClick={() => setNote('')} aria-label="알림 닫기">✕</button></p>}
      </div>

      {!shown.nodes.length ? <p className="muted">그릴 것이 없습니다. 임무·결말·갈래 카드 등을 만들면 여기에 이어진 모습이 나타납니다.</p> : (
        <div className={`flow-wrap${selNode ? ' with-panel' : ''}${linking ? ' linking' : ''}${outline ? ' with-outline' : ''}`}>
          {outline && <FlowOutline g={graph} sel={sel} q={q} simMap={simMap} onPick={(k) => {
            setSel(k);
            // 휴대폰: 목록을 닫고 그림에서 보이게
            if (!window.matchMedia?.('(min-width: 901px)').matches) setOutline(false);
            scrollTo.current = k; // 상자가 그려진 뒤(숨긴 종류면 고르면서 나타난다) 아래 효과가 그쪽으로 굴린다
          }} onNew={() => { setSel(START_KEY); }} />}
          <div className="flow-canvas-wrap">
          <div ref={canvasRef} className={`flow-canvas${drag ? ' dragging' : ''}${linking ? ' linking' : ''}`} role="region" aria-label="이야기 흐름도" onScroll={onCanvasScroll}>
            <svg ref={svgRef} width={svgW * zoom} height={svgH * zoom} viewBox={`0 0 ${svgW} ${svgH}`} role="img" aria-label={`노드 ${shown.nodes.length}개, 화살표 ${shown.edges.length}개`}
              onPointerMove={(e) => {
                lastPt.current = { clientX: e.clientX, clientY: e.clientY };
                const pan = panRef.current, cv = canvasRef.current;
                if (pan && cv) { const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy; if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true; cv.scrollLeft = pan.sl - dx; cv.scrollTop = pan.st - dy; return; }
                const m = moveRef.current;
                if (m) {
                  const dist = Math.hypot(e.clientX - m.sx, e.clientY - m.sy);
                  if (!m.started) {
                    if (m.touch) { if (dist > 8) endMove(); return; } // 길게 누르기 전에 움직이면 화면 굴리기
                    if (dist < 5) return;
                    m.started = true;
                  }
                  const p = toSvg(e);
                  setMoving({ key: m.key, x: Math.max(0, p.x - m.ox), y: Math.max(0, p.y - m.oy) });
                } else if (!drag) return;
                else setDrag({ ...drag, ...toSvg(e) });
                // 가장자리 굴리기는 위의 반복(requestAnimationFrame)이 한다
              }}
              onPointerUp={(e) => {
                lastPt.current = null;
                if (panRef.current) { const moved = panRef.current.moved; panRef.current = null; if (!moved && !linking) setSel(null); return; }
                const m = moveRef.current;
                if (m) {
                  if (m.started) {
                    const p = toSvg(e);
                    pin(m.key, p.x - m.ox, p.y - m.oy);
                    justMoved.current = true; window.setTimeout(() => { justMoved.current = false; }, 0); // 놓을 때 바로 따라오는 클릭만 고르기가 아니다 (상자를 위로 다시 그리면 클릭이 안 올 수도 있다)
                  }
                  endMove();
                  return;
                }
                if (!drag) return;
                const p = toSvg(e), t = nodeAt(p.x, p.y);
                if (t && t.key !== drag.from) setPending({ from: drag.from, to: t.key });
                setDrag(null);
              }}
              onPointerCancel={() => { setDrag(null); endMove(); panRef.current = null; lastPt.current = null; }}
              onContextMenu={(e) => { if (moveRef.current) e.preventDefault(); }}>
              <defs>
                {(['start', 'complete', 'fail', 'effect', 'place'] as const).map((k) => (
                  <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className={`flow-arrow ${k}`} /></marker>
                ))}
              </defs>
              <rect className="flow-bg" x={0} y={0} width={svgW} height={svgH}
                onPointerDown={(e) => { const c = canvasRef.current; if (e.pointerType !== 'mouse' || e.button !== 0 || !c) return; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); panRef.current = { sx: e.clientX, sy: e.clientY, sl: c.scrollLeft, st: c.scrollTop, moved: false }; }} />
              {lay.nodes.some((n) => n.layer === -2) && <text x={20} y={Math.min(...lay.nodes.filter((n) => n.layer === -2).map((n) => n.y)) - 12} className="flow-lane">📍 장소 · 👤 인물 · ⚑ 세력 · 🎒 아이템 · 👾 적 — 눌러서 고치고, 끌어서 이야기 상자와 이으면 「여기 있으면」 「가지고 있으면」 「쓰러뜨리면」이 됩니다</text>}
              {lay.nodes.some((n) => n.layer === -1) && <text x={20} y={Math.min(...lay.nodes.filter((n) => n.layer === -1).map((n) => n.y)) - 12} className="flow-lane">따로 있는 것 (이어진 조건이 없다)</text>}
              {shown.edges.map((e, i) => ((isLane(e.from) || isLane(e.to)) && !(sel && (e.from === sel || e.to === sel)) && !(edgeSel?.from === e.from && edgeSel.to === e.to)) ? null : <Edge key={i} part="line" e={e} a={pos.get(e.from)} b={pos.get(e.to)} down={down} active={(!!sel && (e.from === sel || e.to === sel)) || (edgeSel?.from === e.from && edgeSel.to === e.to)} dim={!!sel && !(e.from === sel || e.to === sel)} onPick={() => { if (!drag && !moveRef.current) setEdgeSel(e); }} />)}
              {/* 겹치면 위에: 옮긴 것 < 고른 것 < 끄는 것 */}
              {[...lay.nodes].sort((x, y) => onTop(x.key) - onTop(y.key)).map((n0) => {
                const at = pos.get(n0.key)!, n = { ...n0, x: at.x, y: at.y };
                const canFrom = !sim;
                const hx = down ? NODE_W / 2 : NODE_W, hy = down ? NODE_H : NODE_H / 2;
                return (
                  <g key={n.key} className={`flow-node k-${n.kind}${n.key === sel ? ' sel' : ''}${n.warn ? ' warn' : ''}${dropTarget?.key === n.key && drag?.from !== n.key ? ' drop' : ''}${linking === n.key || drag?.from === n.key ? ' src' : ''}${(near1 && !near1.has(n.key)) || !hit(n) ? ' dim' : ''}${moving?.key === n.key ? ' moving' : ''}${pins?.[n.key] ? ' pinned' : ''}${simMap ? ` sim-${simMap.get(n.key)?.st ?? 'none'}` : ''}${sim && neverSet.has(n.key) ? ' never' : ''}`} transform={`translate(${n.x},${n.y})`}>
                    <g className="flow-box" role="button" tabIndex={0} aria-label={`${NODE_LABEL[n.kind]} ${n.name}${n.warn ? ` — ${n.warn}` : ''}`} aria-pressed={n.key === sel}
                      onClick={() => { if (justMoved.current) { justMoved.current = false; return; } pick(n.key); }}
                      onPointerDown={(e) => {
                        if (e.button !== 0 || linking || drag) return;
                        const p = toSvg(e), touch = e.pointerType === 'touch';
                        const m = { key: n.key, ox: p.x - n.x, oy: p.y - n.y, sx: e.clientX, sy: e.clientY, touch, started: false } as NonNullable<typeof moveRef.current>;
                        const el = e.currentTarget as Element, id = e.pointerId;
                        if (touch) m.timer = window.setTimeout(() => { if (moveRef.current !== m) return; m.started = true; el.setPointerCapture?.(id); setMoving({ key: n.key, x: n.x, y: n.y }); navigator.vibrate?.(15); }, 350);
                        else el.setPointerCapture?.(id);
                        moveRef.current = m;
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(n.key); return; }
                        // 화살표 키로 옮기기 (Shift: 크게)
                        const d = ev.shiftKey ? 50 : 10, mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[ev.key];
                        if (mv) { ev.preventDefault(); pin(n.key, n.x + mv[0]!, n.y + mv[1]!); }
                      }}>
                      <rect width={NODE_W} height={NODE_H} rx={n.kind === 'flag' || n.kind === 'claim' || n.kind === 'phase' || n.kind === 'start' ? 28 : 8} />
                      <text x={10} y={22} className="flow-title">{NODE_ICON[n.kind]} {short(n.name, 13)}{n.warn ? ' ⚠' : ''}</text>
                      <text x={10} y={42} className="flow-sub">{simMap?.get(n.key)?.st && simMap.get(n.key)!.st !== 'none' ? short(`${simIcon(simMap.get(n.key)!.st)} ${simMap.get(n.key)!.text}`, 22) : short(n.kind === 'start' ? n.sub ?? '' : `${NODE_LABEL[n.kind]}${n.sub ? ` · ${n.sub}` : ''}`, 22)}</text>
                      <title>{`${n.name}\n${n.id}${n.warn ? `\n⚠ ${n.warn}` : ''}`}</title>
                    </g>
                    {canFrom && (
                      <g className="flow-handle" transform={`translate(${hx},${hy})`} aria-hidden="true"
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setDrag({ from: n.key, ...toSvg(e) }); }}>
                        <circle r={18} className="flow-handle-hit" />
                        <circle r={7} className="flow-handle-dot" />
                        <title>끌어서 다른 상자와 잇기</title>
                      </g>
                    )}
                  </g>
                );
              })}
              {/* 연결선 글자는 선·상자 위에 (v0.165) */}
              {shown.edges.map((e, i) => ((isLane(e.from) || isLane(e.to)) && !(sel && (e.from === sel || e.to === sel)) && !(edgeSel?.from === e.from && edgeSel.to === e.to)) ? null : <Edge key={`l${i}`} part="label" e={e} a={pos.get(e.from)} b={pos.get(e.to)} down={down} active={(!!sel && (e.from === sel || e.to === sel)) || (edgeSel?.from === e.from && edgeSel.to === e.to)} dim={!!sel && !(e.from === sel || e.to === sel)} onPick={() => { if (!drag && !moveRef.current) setEdgeSel(e); }} />)}
              {drag && (() => {
                const a = pos.get(drag.from); if (!a) return null;
                const x1 = down ? a.x + NODE_W / 2 : a.x + NODE_W, y1 = down ? a.y + NODE_H : a.y + NODE_H / 2;
                return <line x1={x1} y1={y1} x2={drag.x} y2={drag.y} className="flow-drag-line" markerEnd="url(#arrow-start)" />;
              })()}
            </svg>
          </div>
          <MiniMap nodes={lay.nodes} width={lay.width} height={lay.height} zoom={zoom} view={view} sel={sel} onGo={(x, y) => { const c = canvasRef.current; if (c) { c.scrollLeft = Math.max(0, x * zoom - c.clientWidth / 2); c.scrollTop = Math.max(0, y * zoom - c.clientHeight / 2); } }} />
          </div>
          {selNode && (sim ? <SimPanel w={w} set={set} g={graph} report={report} n={selNode} state={sim.state} info={simMap?.get(selNode.key)} never={neverSet.has(selNode.key)} onClose={() => setSel(null)}
            onAct={(id, label) => {
              const act = simActs(w, sim.state, selNode).find((a) => a.id === id); if (!act) return;
              const r = act.run(w, sim.state);
              if (r.error) { setNote(`❌ ${r.error}`); return; }
              setSim({ path: [...sim.path, `${selNode.key}|${id}`], state: r.state, lines: [...sim.lines, `▸ ${selNode.name}: ${label}`, ...r.lines.map((x) => `   ${x}`)] });
            }} />
            : <NodePanel w={w} set={set} g={graph} n={selNode} onPick={setSel} onClose={() => setSel(null)} onTab={onTab} onLink={() => { setLinking(selNode.key); setNote(''); }} onNote={setNote} onEdge={setEdgeSel} onLibrary={(after) => setLib(after ? { after, afterName: selNode.name } : {})} />)}
        </div>
      )}
      {lib && <FlowLibrary w={w} {...(lib.kind ? { kind: lib.kind } : {})} {...(lib.after ? { after: lib.after } : {})} {...(lib.afterName ? { afterName: lib.afterName } : {})} onClose={() => setLib(null)}
        onApply={(nw, msg, key) => { set(nw); setLib(null); setNote(msg); if (key) setSel(key); }} />}
      {edgeSel && byKey(edgeSel.from) && byKey(edgeSel.to) && (
        <EdgeDialog w={w} set={set} g={graph} e={edgeSel} onClose={() => setEdgeSel(null)} onNote={setNote} onPick={(k) => { setEdgeSel(null); setSel(k); }} />
      )}
      {pending && byKey(pending.from) && byKey(pending.to) && (
        <LinkDialog w={w} a={byKey(pending.from)!} b={byKey(pending.to)!} onSwap={() => setPending({ from: pending.to, to: pending.from })} onClose={() => setPending(null)}
          onLink={(opt) => { set(opt.apply(w)); setPending(null); setNote(`🔗 이었습니다: ${opt.label}`); setSel(pending.to); }} />
      )}
    </div>
  );
}

/** 잇는 방법 고르기 */
function LinkDialog({ w, a, b, onLink, onSwap, onClose }: { w: WorldPackage; a: GNode; b: GNode; onLink: (o: LinkOption) => void; onSwap: () => void; onClose: () => void }) {
  const opts = useMemo(() => linkOptions(w, a, b), [w, a.key, b.key]);
  const reverse = useMemo(() => linkOptions(w, b, a).length, [w, a.key, b.key]);
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [a.key, b.key]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const starts = opts.map((o, k) => [o, k] as const).filter(([o]) => o.group === 'start');
  const conds = opts.map((o, k) => [o, k] as const).filter(([o]) => o.group === 'cond'), fxs = opts.map((o, k) => [o, k] as const).filter(([o]) => o.group === 'effect');
  return (
    <div className="flow-dialog-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flow-dialog" role="dialog" aria-modal="true" aria-label="상자 잇기">
        <b>🔗 잇기</b>
        <p className="flow-pair"><span>{NODE_ICON[a.kind]} {a.name}</span> <span aria-hidden="true">→</span> <span>{NODE_ICON[b.kind]} {b.name}</span></p>
        {opts.length ? (
          <>
            <label>어떻게 이을까
              <select value={i} onChange={(e) => setI(Number(e.target.value))}>
                {starts.length > 0 && <optgroup label="▶ 처음부터">{starts.map(([o, k]) => <option key={k} value={k}>{o.label}</option>)}</optgroup>}
                {conds.length > 0 && <optgroup label={`「${b.name}」의 조건에 넣기`}>{conds.map(([o, k]) => <option key={k} value={k}>{o.label}</option>)}</optgroup>}
                {fxs.length > 0 && <optgroup label={`「${a.name}」의 효과로 일으키기`}>{fxs.map(([o, k]) => <option key={k} value={k}>{o.label}</option>)}</optgroup>}
              </select>
            </label>
            <p className="small muted">{opts[i]?.note ? opts[i]!.note : opts[i]?.group === 'effect' ? '앞 상자의 효과에 더합니다 — 그 일이 일어나면 바로 뒤 상자가 일어납니다.' : '뒤 상자의 조건에 「그리고」로 더합니다 — 원래 있던 조건도 함께 맞아야 합니다. 「또는」로 바꾸려면 상자를 눌러 조건 칸에서 고치세요.'}</p>
          </>
        ) : <p className="small">이 둘은 이 방향으로 이을 수 없습니다 (예: 결말에서는 아무것도 이어지지 않고, 「플레이 시작」은 조건이 없는 상자에 저절로 이어집니다).</p>}
        <div className="row flow-dialog-actions">
          {opts.length > 0 && <button type="button" className="primary" onClick={() => onLink(opts[i]!)}>잇기</button>}
          {reverse > 0 && <button type="button" onClick={onSwap}>⇄ 방향 바꾸기</button>}
          <button type="button" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

function Edge({ e, a, b, active, dim, down, onPick, part }: { part: 'line' | 'label'; e: GEdge; a?: { x: number; y: number }; b?: { x: number; y: number }; active: boolean; dim: boolean; down: boolean; onPick: () => void }) {
  if (!a || !b) return null;
  let d: string, lx: number, ly: number;
  if (down) {
    const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
    const backward = y2 <= y1;
    // 여러 단을 건너는 화살표는 옆으로 휘어 사이의 상자를 비켜 간다
    const bow = backward ? 0 : Math.min(150, Math.max(0, Math.round((y2 - y1) / (NODE_H + 56))) * 120);
    d = backward ? `M${x1},${y1} C${x1 - 90},${y1 + 60} ${x2 - 90},${y2 - 60} ${x2},${y2}` : `M${x1},${y1} C${x1 - bow},${y1 + (y2 - y1) / 2} ${x2 - bow},${y1 + (y2 - y1) / 2} ${x2},${y2}`;
    // 글자는 받는 상자 바로 위에 — 한 상자에서 여러 갈래가 나가도 겹치지 않는다 (v0.165)
    lx = x2; ly = y2 - 12;
  } else {
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
    // 뒤로 가는 화살표(같은 단·앞 단)는 위로 크게 돌아간다
    const backward = x2 <= x1;
    // 여러 단을 건너는 화살표는 위로 휘어 사이의 상자를 비켜 간다 (v0.146)
    const bow = backward ? 0 : Math.min(110, Math.max(0, Math.round((x2 - x1) / (NODE_W + 70))) * 58);
    const top = Math.min(y1, y2) - bow;
    d = backward ? `M${x1},${y1} C${x1 + 60},${y1 - 70} ${x2 - 60},${y2 - 70} ${x2},${y2}`
      : bow ? `M${x1},${y1} C${x1 + 50},${top} ${x2 - 50},${top} ${x2},${y2}`
      : `M${x1},${y1} C${x1 + (x2 - x1) / 2},${y1} ${x1 + (x2 - x1) / 2},${y2} ${x2},${y2}`;
    // 글자는 받는 상자의 화살촉 바로 위에 — 한 상자에서 여러 갈래가 나가도 겹치지 않는다 (v0.165)
    lx = x2 - 14; ly = y2 - 10;
  }
  if (part === 'label') return active ? <EdgeLabel x={lx} y={ly} text={short(e.label.replace(/^→ /, ''), down ? 16 : 26)} anchor={down ? 'middle' : 'end'} /> : null;
  const cls = e.kind === 'place' ? 'place' : e.kind === 'fail' ? 'fail' : e.kind === 'effect' ? 'effect' : e.kind === 'start' ? 'start' : 'complete';
  return (
    <g className={`flow-edge ${cls}${active ? ' active' : ''}${dim ? ' dim' : ''}`}>
      <path d={d} markerEnd={`url(#arrow-${cls})`} />
      {/* 누르기 쉽게 넓은 투명 선 (v0.145): 누르면 연결 조건을 고친다 */}
      <path d={d} className="flow-edge-hit" onClick={onPick}><title>{`${e.label.replace(/^→ /, '')}\n누르면 이 연결을 고칩니다`}</title></path>
    </g>
  );
}

/** 연결선 글자: 바탕 상자 위에 쓴다 (글자 테두리는 일부 휴대폰 브라우저의 강제 어두운 모드에서 글자를 덮는다, v0.165) */
function EdgeLabel({ x, y, text, anchor }: { x: number; y: number; text: string; anchor: 'middle' | 'end' }) {
  const width = [...text].reduce((n, c) => n + (c.charCodeAt(0) > 0x2000 ? 11 : 6.5), 0) + 10;
  const left = anchor === 'end' ? x - width + 5 : x - width / 2;
  return (
    <g className="flow-label-g" pointerEvents="none">
      <rect x={left} y={y - 12} width={width} height={17} rx={4} className="flow-label-bg" />
      <text x={x} y={y} className="flow-label" textAnchor={anchor}>{text}</text>
    </g>
  );
}

/** 고른 노드: 이어진 것 · 바로 고치기 · 다음 것 만들기 */
function NodePanel({ w, set, g, n, onPick, onClose, onTab, onLink, onNote, onEdge, onLibrary }: { w: WorldPackage; set: SetW; g: StoryGraph; n: GNode; onPick: (k: string) => void; onClose: () => void; onTab: (t: FlowTab) => void; onLink: () => void; onNote: (s: string) => void; onEdge: (e: GEdge) => void; onLibrary: (after?: Condition) => void }) {
  const ins = g.edges.filter((e) => e.to === n.key), outs = g.edges.filter((e) => e.from === n.key);
  const nameOf = (k: string) => { const x = g.nodes.find((y) => y.key === k); return x ? `${NODE_ICON[x.kind]} ${x.name}` : k; };
  const tab = TAB_OF[n.kind];
  const node = (k: string) => g.nodes.find((y) => y.key === k);
  const cut = (e: GEdge) => {
    const a = node(e.from), b = node(e.to); if (!a || !b) return;
    const r = unlink(w, e, a, b);
    if (r.patch) set(r.patch);
    onNote(r.patch ? `✂ ${r.note}` : `ℹ ${r.note}`);
  };
  const cutBtn = (e: GEdge) => e.from !== START_KEY && e.kind !== 'stage' && <button type="button" className="small flow-cut" onClick={() => cut(e)} title="이 연결을 설정에서 뺍니다">✂ 끊기</button>;
  // 다음 것 만들기: 이것이 끝나면 열리는 임무 · 이것으로 끝나는 결말
  const after: Condition | null = n.kind === 'quest' ? { questDone: n.id } : n.kind === 'scene' || n.kind === 'gimmick' ? { sceneEnd: n.id, outcome: 'success' } : n.kind === 'encounter' ? { cleared: n.id } : n.kind === 'card' ? { storylet: n.id } : n.kind === 'choice' ? { choice: n.id } : n.kind === 'flag' ? { flag: n.id } : n.kind === 'claim' ? { knows: n.id } : n.kind === 'location' ? { at: n.id } : n.kind === 'arc' ? { arcDone: n.id } : n.kind === 'clock' ? { clock: n.id, gte: w.clocks?.find((c) => c.id === n.id)?.segments ?? 1 } : null;
  const newId = (prefix: string, list: { id: string }[]) => { let i = list.length + 1; while (list.some((x) => x.id === `${prefix}${i}`)) i++; return `${prefix}${i}`; };
  return (
    <aside className="flow-panel" aria-label={`${n.name} 자세히`}>
      <div className="row flow-panel-head">
        <b>{NODE_ICON[n.kind]} {n.name}</b><span className="spacer" />
        <button type="button" className="small" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <p className="small muted">{NODE_LABEL[n.kind]} · <code>{n.id}</code></p>
      {n.warn && <p className="small warn-text">⚠ {n.warn}</p>}
      <details open><summary className="small"><b>이것을 여는 것 {ins.length}</b></summary>
        {ins.length ? <ul className="flow-links">{ins.map((e, i) => <li key={i}><button type="button" className="small" onClick={() => onPick(e.from)}>{nameOf(e.from)}</button> <button type="button" className="small flow-edge-btn" onClick={() => onEdge(e)} title="이 연결의 조건을 고칩니다">✎ {e.label.replace(/^→ /, '')}</button>{cutBtn(e)}</li>)}</ul> : <p className="small muted">없음 — 처음부터 열려 있거나 조건이 다른 것(장소·관계·날짜 등)이다.</p>}
      </details>
      <details open><summary className="small"><b>이것이 여는 것 {outs.length}</b></summary>
        {outs.length ? <ul className="flow-links">{outs.map((e, i) => <li key={i}><button type="button" className="small" onClick={() => onPick(e.to)}>{nameOf(e.to)}</button> <button type="button" className="small flow-edge-btn" onClick={() => onEdge(e)} title="이 연결의 조건을 고칩니다">✎ {e.label.replace(/^→ /, '')}</button>{cutBtn(e)}</li>)}</ul> : <p className="small muted">없음</p>}
      </details>

      <div className="flow-edit">
        <NodeEditor w={w} set={set} n={n} onPick={onPick} />
      </div>

      <div className="flow-actions">
        <button type="button" onClick={onLink} title="상자의 ● 손잡이를 다른 상자로 끌어도 됩니다">🔗 {n.kind === 'start' ? '다른 상자를 처음부터 열리게' : '다른 상자와 잇기'}</button>
        {n.kind === 'location' && <>
          <button type="button" onClick={() => { const c = newPerson(w, n.id); set({ characters: [...w.characters, c] }); onPick(`character:${c.id}`); }}>＋ 이곳에 있는 인물</button>
          <button type="button" onClick={() => { const l = newPlace(w, n.id); set({ locations: l.locations }); onPick(`location:${l.id}`); }}>＋ 이곳과 길로 이어진 장소</button>
          <button type="button" onClick={() => { const it = newItem(w); set({ items: [...(w.items ?? []), it], locations: w.locations.map((l) => (l.id === n.id ? { ...l, pickups: [...(l.pickups ?? []), { itemId: it.id, n: 1, hint: '' }] } : l)) }); onPick(`item:${it.id}`); }}>＋ 이곳에서 주울 아이템</button>
        </>}
        {n.kind === 'encounter' && <button type="button" onClick={() => { const m = newMonster(w); set({ monsters: [...(w.monsters ?? []), m], encounters: (w.encounters ?? []).map((e) => (e.id === n.id ? { ...e, enemies: [...e.enemies, { monsterId: m.id, zone: 3 }] } : e)) }); onPick(`monster:${m.id}`); }}>＋ 이 전투에 나오는 새 적</button>}
        {n.kind === 'monster' && <button type="button" onClick={() => {
          const id = newId('enc/new-', w.encounters ?? []);
          set({ encounters: [...(w.encounters ?? []), { id, name: `${n.name}와(과)의 싸움`, locationId: w.start.locationId || (w.locations[0]?.id ?? ''), enemies: [{ monsterId: n.id, zone: 2 }], trigger: `${n.name}이(가) 길을 막아선다` }] });
          onPick(`encounter:${id}`);
        }}>＋ 이 적이 나오는 전투</button>}
        {(n.kind === 'item' || n.kind === 'monster') && (() => {
          // 이것을 얻으면/쓰러뜨리면 열리는 임무
          const cond: Condition = n.kind === 'item' ? { hasItem: n.id } : { defeated: n.id };
          return <>
            <button type="button" onClick={() => { const id = newId('quest/next-', w.quests ?? []); set(newQuest(w, id, `${n.name} ${n.kind === 'item' ? '얻은 뒤' : '쓰러뜨린 뒤'}`, 'side', cond)); onPick(`quest:${id}`); }}>{n.kind === 'item' ? '＋ 이것을 가지면 열리는 임무' : '＋ 이것을 쓰러뜨리면 열리는 임무'}</button>
            <button type="button" onClick={() => { const e = newEnding(w, `${n.name}의 끝`, cond); set(e.patch); onPick(`ending:${e.id}`); }}>{n.kind === 'item' ? '＋ 이것을 가지면 이르는 결말' : '＋ 이것을 쓰러뜨리면 이르는 결말'}</button>
          </>;
        })()}
        {n.kind === 'start' && startCreators(w, set, onPick).map((c) => <button key={c.label} type="button" onClick={c.run}>{c.label}</button>)}
        {n.kind === 'start' && <button type="button" onClick={() => onLibrary()}>🌌 만계서고에서 가져오기</button>}
        {after && n.kind !== 'start' && <button type="button" onClick={() => onLibrary(after)}>🌌 이것 다음에 — 만계서고에서 가져오기</button>}
        {n.kind === 'start' && <SceneAdd w={w} set={set} onPick={onPick} scene="＋ 처음부터 열리는 장면" gimmick="＋ 함정·퍼즐" />}
        {n.kind === 'location' && <SceneAdd w={w} set={set} onPick={onPick} at={n.id} scene="＋ 이곳에서 일어나는 장면" gimmick="＋ 이곳의 함정·퍼즐" />}
        {after && n.kind !== 'location' && n.kind !== 'start' && <SceneAdd w={w} set={set} onPick={onPick} start={after} scene="＋ 이것 다음에 열리는 장면" gimmick="＋ 다음에 나오는 함정·퍼즐" />}
        {after && <button type="button" onClick={() => {
          const id = newId('quest/next-', w.quests ?? []);
          set(newQuest(w, id, `${n.name} 다음`, 'side', after)); onPick(`quest:${id}`);
        }}>{n.kind === 'location' ? '＋ 이곳에 오면 열리는 임무' : '＋ 이것 다음에 열리는 임무'}</button>}
        {after && <button type="button" onClick={() => { const e = newEnding(w, `${n.name}의 끝`, after); set(e.patch); onPick(`ending:${e.id}`); }}>{n.kind === 'location' ? '＋ 이곳에 이르면 맞는 결말' : '＋ 이것으로 이르는 결말'}</button>}
        {after && <button type="button" onClick={() => { const e = newEvent(w, `${n.name} ${n.kind === 'clock' ? '— 시계가 찼다' : '뒤의 사건'}`, after); set({ events: [...(w.events ?? []), e] }); onPick(`event:${e.id}`); }}>{n.kind === 'clock' ? '＋ 시계가 차면 일어나는 사건' : n.kind === 'location' ? '＋ 이곳에 오면 일어나는 사건' : '＋ 이것 다음에 일어나는 사건'}</button>}
        {after && <button type="button" onClick={() => { const id = newId('card/new-', w.storylets ?? []); set({ storylets: [...(w.storylets ?? []), { id, title: '새 갈래 카드', situation: '상황을 적어 주세요', tags: ['main'], when: after, options: [{ id: 'a', label: '첫째 길' }, { id: 'b', label: '둘째 길' }] }] }); onPick(`card:${id}`); }}>{n.kind === 'location' ? '＋ 이곳에서 펼쳐지는 갈래 카드' : '＋ 이것 다음에 펼쳐지는 갈래 카드'}</button>}
        {after && <button type="button" onClick={() => { const id = newId('choice/new-', w.choices ?? []); set({ choices: [...(w.choices ?? []), { id, name: '새 결정적 선택', prompt: '무엇을 할까?', when: after, options: [{ id: 'a', text: '이쪽', effects: [] }, { id: 'b', text: '저쪽', effects: [] }] }] }); onPick(`choice:${id}`); }}>{n.kind === 'location' ? '＋ 이곳에서 열리는 결정적 선택' : '＋ 이것 다음에 열리는 결정적 선택'}</button>}
        {after && n.kind !== 'location' && <button type="button" onClick={() => { const a = newArc(w, after); set({ arcs: [...(w.arcs ?? []), a] }); onPick(`arc:${a.id}`); }}>{n.kind === 'arc' ? '＋ 이 줄기가 끝나면 시작하는 줄기' : '＋ 이것 다음에 시작하는 줄기'}</button>}
        {after && <button type="button" onClick={() => { const r = newRule(w, after); set({ rules: [...(w.rules ?? []), r] }); onPick(`rule:${r.id}`); }}>{n.kind === 'location' ? '＋ 이곳에서 발동하는 규칙' : '＋ 이것이 되면 발동하는 규칙'}</button>}
        {(() => {
          // 이것이 세우는 플래그 · 알려 주는 지식 (v0.155): 이 상자의 첫 효과 칸에 더한다
          const slot = effectSlots(w, n)[0];
          if (!slot) return null;
          const addFx = (fx: StoryEffect, patch: Partial<WorldPackage>, pick: string) => { const w2 = { ...w, ...patch }; set({ ...patch, ...setEffects(w2, n, slot.key, [...getEffects(w2, n, slot.key), fx]) }); onPick(pick); };
          return <>
            <button type="button" onClick={() => { const id = nextFlag(w); addFx({ setFlag: id }, {}, `flag:${id}`); }} title={`「${slot.label}」 효과로 세운다`}>＋ 이것이 세우는 플래그</button>
            <button type="button" onClick={() => { const c = newClaim(w); addFx({ reveal: c.id }, { claims: [...w.claims, c] }, `claim:${c.id}`); }} title={`「${slot.label}」 효과로 알려 준다`}>＋ 이것이 알려 주는 지식</button>
          </>;
        })()}
        {n.kind === 'ending' && <button type="button" onClick={() => { const e = newEnding(w, '다른 결말'); set(e.patch); onPick(`ending:${e.id}`); }} title="다른 길의 끝 — GM이 세우는 플래그로 시작하고, 상자를 끌어 조건을 이으세요">＋ 다른 결말</button>}
        {BORROW_OF[n.kind] && !isMyAssets(w) && <button type="button" className="small" title="이 상자를 (딸린 것·그림과 함께) 내 에셋 보관함에 복사해 둔다 — 다른 세계의 흐름도에서 「만계서고에서」로 꺼내 쓴다" onClick={() => {
          void keepAsAsset(w, [{ kind: BORROW_OF[n.kind]!, id: n.id }]).then((r) => onNote(`⭐ 「${n.name}」을(를) 내 에셋에 보관했습니다${Object.values(r.added).reduce((a, b) => a + (b ?? 0), 0) > 1 ? ` (딸린 것 포함 ${Object.values(r.added).reduce((a, b) => a + (b ?? 0), 0)}개)` : ''}.`)).catch((e: Error) => onNote(`❌ ${e.message}`));
        }}>⭐ 에셋으로 보관</button>}
        {tab && <button type="button" className="small" onClick={() => onTab(tab)}>전체 편집 — 「{TAB_NAME[tab]}」 탭</button>}
      </div>
    </aside>
  );
}

/**
 * 새 임무 (v0.146): 단계의 끝 조건을 비워 두면 시작하자마자 끝나 버린다 — 대신 「할 일을 해냈다」 플래그를 만들어
 * GM이 그 설명대로 세우게 한다 (시뮬레이션에서는 「단계 끝내기」나 플래그 「세우기」로 진행).
 */
function newQuest(w: WorldPackage, id: string, name: string, kind: Quest['kind'], start: Condition): Partial<WorldPackage> {
  let flag = `${id.replace(/[^A-Za-z0-9]+/g, '_')}_done`;
  while ((w.flags ?? []).some((f) => f.id === flag)) flag += '_';
  return {
    quests: [...(w.quests ?? []), { id, name, kind, start, stages: [{ objective: '할 일을 적어 주세요', hint: '', complete: { flag } }] }],
    flags: [...(w.flags ?? []), { id: flag, when: `「${name}」의 할 일을 플레이어가 해냈을 때` }],
  };
}

/** 새 장소 (v0.147): 편집기의 「새 장소」와 같은 꼴 — near가 있으면 그곳과 길로 잇는다 (없으면 시작 장소와) */
function newPlace(w: WorldPackage, near?: string): { id: string; locations: Location[] } {
  const id = nextId('loc/new-', w.locations);
  let locations: Location[] = [...w.locations, { id, name: '새 장소', description: '', connections: [] }];
  const to = near ?? (w.locations.some((l) => l.id === w.start.locationId) ? w.start.locationId : undefined);
  if (to) locations = setLink(locations, id, to, true);
  return { id, locations };
}
/**
 * 새 결말 (v0.150): 조건을 주면 그 조건으로, 없으면 「이 결말에 이르렀다」 플래그를 함께 만들어 GM이 설명대로 세우게 한다
 * (빈 조건의 결말은 시작하자마자 끝나 버린다). 다른 상자를 끌어 이으면 조건이 더해진다.
 */
function newEnding(w: WorldPackage, name: string, cond?: Condition): { id: string; patch: Partial<WorldPackage> } {
  const id = nextId('ending/new-', w.endings ?? []);
  if (cond) return { id, patch: { endings: [...(w.endings ?? []), { id, name, condition: cond, epilogue: '' }] } };
  let flag = `${id.replace(/[^A-Za-z0-9]+/g, '_')}_reached`;
  while ((w.flags ?? []).some((f) => f.id === flag)) flag += '_';
  return { id, patch: {
    endings: [...(w.endings ?? []), { id, name, condition: { flag }, epilogue: '' }],
    flags: [...(w.flags ?? []), { id: flag, when: `이야기가 「${name}」(으)로 끝날 때가 되었을 때` }],
  } };
}

/** 새 연표 사건·진행 시계 (v0.151): 「이야기 흐름」 탭의 새 항목과 같은 꼴 — 사건에 조건을 주면 날짜 대신 그 조건으로 */
function newEvent(w: WorldPackage, name: string, cond?: Condition): WorldEvent {
  return { id: nextId('event/new-', w.events ?? []), name, when: cond ? { condition: cond } : { day: 3 }, effects: [], announce: '📜 소식이 돈다.' };
}
function newClock(w: WorldPackage): Clock {
  return { id: nextId('clock/new-', w.clocks ?? []), name: '다가오는 위협', segments: 6, tick: [{ every: 'beat', by: 1 }], at: [{ segment: 3, omen: '불길한 소문이 돈다.' }, { segment: 6, effects: [] }] };
}

/** 새 플래그·지식 (v0.155) */
function nextFlag(w: WorldPackage): string { const ids = new globalThis.Set((w.flags ?? []).map((f) => f.id)); let i = 1; while (ids.has(`flag_new_${i}`)) i++; return `flag_new_${i}`; }
function newClaim(w: WorldPackage): Claim { return { id: nextId('claim/new-', w.claims), statement: '새 지식 — 무엇이 사실(또는 소문)인가', truth: 'true' }; }

/** 새 줄기·세계 규칙 (v0.152): 「이야기 흐름」「세계 규칙」 탭의 새 항목과 같은 꼴 — start: 줄기가 시작하는 조건 · 규칙이 발동하는 상태 */
function newArc(w: WorldPackage, start?: Condition): Arc {
  return { id: nextId('arc/new-', w.arcs ?? []), name: (w.arcs ?? []).length ? '새 줄기' : '큰 줄기', kind: 'main', start: start ?? { all: [] }, chapters: [{ name: '1장', goal: '', complete: UNSET_CONDITION }] };
}
function newRule(w: WorldPackage, when?: Condition): WorldRule {
  return { id: nextId('rule/new-', w.rules ?? []), name: '새 규칙', trigger: when ? { kind: 'state', condition: when } : { kind: 'action', describe: '' }, outcome: '' };
}

/** 새 장면·함정·퍼즐 (v0.149): 「장면」「함정·퍼즐」 탭의 새 항목과 같은 꼴 — start: 열리는 조건, at: 장소 */
function newScene(w: WorldPackage, o: { start?: Condition; at?: string } = {}): SceneDef {
  return { ...newSceneDef(nextId('scene/new-', w.scenes ?? [])), ...(o.start ? { start: o.start } : {}), ...(o.at ? { locationId: o.at } : {}) };
}
function newGimmick(w: WorldPackage, kind: Gimmick['kind'], o: { start?: Condition; at?: string } = {}): SceneDef {
  const d = GIMMICK_DEFAULTS[kind];
  return gimmickScene({ id: nextId('scene/gimmick-', w.scenes ?? []), name: d.name, locationId: o.at ?? w.start.locationId, ...(o.start ? { start: o.start } : {}) }, structuredClone(d.g));
}
/** 「＋ 장면」 · 종류를 골라 「＋ 함정·퍼즐」 */
function SceneAdd({ w, set, onPick, start, at, scene, gimmick }: { w: WorldPackage; set: SetW; onPick: (k: string) => void; start?: Condition; at?: string; scene: string; gimmick: string }) {
  const [kind, setKind] = useState<Gimmick['kind']>('trap');
  const o = { ...(start ? { start } : {}), ...(at ? { at } : {}) };
  return (
    <>
      <button type="button" onClick={() => { const d = newScene(w, o); set({ scenes: [...(w.scenes ?? []), d] }); onPick(`scene:${d.id}`); }}>{scene}</button>
      <div className="row flow-gimmick-add">
        <select aria-label="함정·퍼즐 종류" value={kind} onChange={(e) => setKind(e.target.value as Gimmick['kind'])}>
          {GIMMICK_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="button" onClick={() => { const d = newGimmick(w, kind, o); set({ scenes: [...(w.scenes ?? []), d] }); onPick(`gimmick:${d.id}`); }}>{gimmick}</button>
      </div>
    </>
  );
}

/** 새 아이템·적 (v0.148): 「아이템·상점」「조우」 탭의 새 항목과 같은 꼴 */
function newItem(w: WorldPackage): ItemDef { return { id: nextId('item/new-', w.items ?? []), name: '새 물건', description: '', kind: 'misc', price: 10 }; }
function newMonster(w: WorldPackage): CustomMonster {
  return { id: nextId('mon/new-', w.monsters ?? []), name: '새 적', look: '', role: 'brute', cr: '1', xp: 200, ac: 13, hp: 30, abilities: { str: 14, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, attacks: [{ name: '공격', kind: 'melee', toHit: 4, damage: '1d8', bonus: 2, type: '참격' }] };
}
function newPerson(w: WorldPackage, at: string): Character {
  return { id: nextId('npc/new-', w.characters), name: '새 인물', appearance: '', personality: '', speech: '', locationId: at, improvisation: 'minor' };
}

/** ▶ 시작에서 새 흐름 만들기 (v0.145, v0.146: 빈 세계 안내에서도) */
function nextId(prefix: string, list: { id: string }[]) { let i = list.length + 1; while (list.some((x) => x.id === `${prefix}${i}`)) i++; return `${prefix}${i}`; }
function startCreators(w: WorldPackage, set: SetW, onPick: (k: string) => void): { label: string; run: () => void }[] {
  return [
    { label: '＋ 처음부터 열리는 임무', run: () => {
      const id = nextId('quest/new-', w.quests ?? []);
      set(newQuest(w, id, (w.quests ?? []).length ? '새 임무' : '첫 임무', 'main', { all: [] })); onPick(`quest:${id}`);
    } },
    { label: '＋ 결말', run: () => { const e = newEnding(w, (w.endings ?? []).length ? '새 결말' : '첫 결말'); set(e.patch); onPick(`ending:${e.id}`); } },
    { label: '＋ 플래그', run: () => { const id = nextFlag(w); set({ flags: [...(w.flags ?? []), { id, when: '언제 세우는지 적어 주세요' }] }); onPick(`flag:${id}`); } },
    { label: '＋ 지식', run: () => { const c = newClaim(w); set({ claims: [...w.claims, c] }); onPick(`claim:${c.id}`); } },
    { label: '＋ 줄기', run: () => { const a = newArc(w); set({ arcs: [...(w.arcs ?? []), a] }); onPick(`arc:${a.id}`); } },
    { label: '＋ 세계 규칙', run: () => { const r = newRule(w); set({ rules: [...(w.rules ?? []), r] }); onPick(`rule:${r.id}`); } },
    { label: '＋ 연표 사건', run: () => { const e = newEvent(w, '새 사건'); set({ events: [...(w.events ?? []), e] }); onPick(`event:${e.id}`); } },
    { label: '＋ 진행 시계', run: () => { const c = newClock(w); set({ clocks: [...(w.clocks ?? []), c] }); onPick(`clock:${c.id}`); } },
    { label: '＋ 장소', run: () => { const l = newPlace(w); set({ locations: l.locations }); onPick(`location:${l.id}`); } },
    { label: '＋ 인물', run: () => { const c = newPerson(w, w.start.locationId); set({ characters: [...w.characters, c] }); onPick(`character:${c.id}`); } },
    { label: '＋ 세력', run: () => { const f: Faction = { id: nextId('fac/new-', w.factions ?? []), name: '새 세력', description: '' }; set({ factions: [...(w.factions ?? []), f] }); onPick(`faction:${f.id}`); } },
    { label: '＋ 아이템', run: () => { const it = newItem(w); set({ items: [...(w.items ?? []), it] }); onPick(`item:${it.id}`); } },
    { label: '＋ 적', run: () => { const m = newMonster(w); set({ monsters: [...(w.monsters ?? []), m] }); onPick(`monster:${m.id}`); } },
    { label: '＋ 처음부터 펼쳐지는 갈래 카드', run: () => {
      const id = nextId('card/new-', w.storylets ?? []);
      set({ storylets: [...(w.storylets ?? []), { id, title: '새 갈래 카드', situation: '상황을 적어 주세요', tags: ['main'], options: [{ id: 'a', label: '첫째 길' }, { id: 'b', label: '둘째 길' }] }] }); onPick(`card:${id}`);
    } },
    { label: '＋ 처음부터 열리는 결정적 선택', run: () => {
      const id = nextId('choice/new-', w.choices ?? []);
      set({ choices: [...(w.choices ?? []), { id, name: '새 결정적 선택', prompt: '무엇을 할까?', when: { all: [] }, options: [{ id: 'a', text: '이쪽', effects: [] }, { id: 'b', text: '저쪽', effects: [] }] }] }); onPick(`choice:${id}`);
    } },
  ];
}

/** Esc로 닫기 */
function useEsc(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** 화살표 고치기 (v0.145): 이 연결이 적힌 조건·효과 칸을 바로 고친다 */
function EdgeDialog({ w, set, g, e, onClose, onNote, onPick }: { w: WorldPackage; set: SetW; g: StoryGraph; e: GEdge; onClose: () => void; onNote: (s: string) => void; onPick: (k: string) => void }) {
  useEsc(onClose);
  const a = g.nodes.find((n) => n.key === e.from)!, b = g.nodes.find((n) => n.key === e.to)!;
  const slots = edgeSlots(w, e, a, b);
  const still = g.edges.some((x) => x.from === e.from && x.to === e.to);
  const ways = sourceWays(w, a);
  const isStart = e.from === START_KEY;
  return (
    <div className="flow-dialog-back" onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="flow-dialog flow-edge-dialog" role="dialog" aria-modal="true" aria-label="연결 고치기">
        <div className="row"><b>✎ 연결 고치기</b><span className="spacer" /><button type="button" className="small" onClick={onClose} aria-label="닫기">✕</button></div>
        <p className="flow-pair">
          <button type="button" className="small" onClick={() => onPick(a.key)}>{NODE_ICON[a.kind]} {a.name}</button> <span aria-hidden="true">→</span>
          <button type="button" className="small" onClick={() => onPick(b.key)}>{NODE_ICON[b.kind]} {b.name}</button>
        </p>
        <p className="small muted">{e.label.replace(/^→ /, '')}{still ? '' : ' — (이제 이 연결은 없습니다)'}</p>
        {isStart && <p className="small muted">「{b.name}」은(는) 다른 상자에 걸린 조건이 없어 처음부터 열립니다. 아래 조건에 다른 상자(임무 완료·플래그 등)를 넣으면 그 상자 뒤로 옮겨 갑니다.</p>}
        {!slots.length && <p className="small">이 연결은 여기서 고칠 칸을 찾지 못했습니다 — 「{TAB_OF[b.kind] ? TAB_NAME[TAB_OF[b.kind]!] : '전체 편집'}」 탭에서 고치세요.</p>}
        {slots.map(({ where, node, slot }) => {
          if (where === 'effect') return (
            <div key={slot.key} className="flow-edge-slot">
              <EffectsEditor label={`「${node.name}」 ${slot.label} 일어나는 일`} value={getEffects(w, node, slot.key)} w={w} onChange={(list) => set(setEffects(w, node, slot.key, list))} />
            </div>
          );
          const c = getCond(w, node, slot.key);
          const leaf = isStart ? undefined : firstLeaf(w, c, a);
          const cur = leaf ? ways.findIndex((x) => JSON.stringify(x.cond) === JSON.stringify(leaf)) : -1;
          return (
            <div key={slot.key} className="flow-edge-slot">
              {!isStart && ways.length > 0 && c && leaf && (
                <label>「{a.name}」이(가) 어떻게 되면
                  <select value={cur} onChange={(ev) => { const k = Number(ev.target.value); if (k >= 0) set(setCond(w, node, slot.key, replaceLeaf(w, c, a, ways[k]!.cond))); }}>
                    {cur < 0 && <option value={-1}>(직접 쓴 조건 — 아래에서 고치세요)</option>}
                    {ways.map((x, k) => <option key={k} value={k}>{x.label}</option>)}
                  </select>
                </label>
              )}
              <ConditionField label={`「${node.name}」의 ${slot.label} (전체)`} value={c} world={w} optional onChange={(nc) => set(setCond(w, node, slot.key, nc))} />
            </div>
          );
        })}
        <div className="row flow-dialog-actions">
          {!isStart && e.kind !== 'stage' && still && <button type="button" onClick={() => { const r = unlink(w, e, a, b); if (r.patch) set(r.patch); onNote(r.patch ? `✂ ${r.note}` : `ℹ ${r.note}`); onClose(); }}>✂ 이 연결 끊기</button>}
          <button type="button" className="primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/** 시뮬레이션에서 고른 상자: 지금 상태 · 왜 잠겼나 · 할 수 있는 일 · 바로 고치기 */
function SimPanel({ w, set, g, report, n, state, info, never, onAct, onClose }: { w: WorldPackage; set: SetW; g: StoryGraph; report: ExploreReport | null; n: GNode; state: GameState; info?: NodeSim; never: boolean; onAct: (id: string, label: string) => void; onClose: () => void }) {
  const acts = simActs(w, state, n);
  // 갈림길(결정적 선택·갈래 카드)은 고르면 어떻게 되나를 미리 보여 준다 (v0.160)
  const branching = n.kind === 'choice' || n.kind === 'card';
  const previews = useMemo(() => (branching && acts.length ? previewActs(w, state, g, n) : []), [w, state, n.key, branching]);
  const tally = report?.byChoice[n.key];
  const q = n.kind === 'quest' ? w.quests?.find((x) => x.id === n.id) : undefined;
  const p = q ? state.quests[q.id] : undefined;
  // 지금 보여 줄 조건: 진행 중인 임무는 지금 단계의 끝 조건, 아니면 열리는 조건 (결말은 결말 조건)
  const cond = p && !p.done && !p.failed ? q!.stages[p.stage]?.complete : openCondition(w, n);
  const condLabel = p && !p.done && !p.failed ? `${p.stage + 1}단계 끝 조건` : n.kind === 'ending' ? '결말 조건' : '열리는 조건';
  return (
    <aside className="flow-panel flow-sim-panel" aria-label={`${n.name} 시뮬레이션`}>
      <div className="row flow-panel-head">
        <b>{NODE_ICON[n.kind]} {n.name}</b><span className="spacer" />
        <button type="button" className="small" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <p className="small"><b>{info ? `${simIcon(info.st)} ${info.text}` : ''}</b> <span className="muted">· {NODE_LABEL[n.kind]}</span></p>
      {never && <p className="small warn-text">⚠ 자동 탐색에서 한 번도 열리지 않았습니다 — 아래 조건 중 ✗인 것을 채우는 상자가 있는지 보세요.</p>}
      {cond && <div className="flow-trace"><span className="small muted">{condLabel}</span><TraceView t={condTrace(w, state, cond)} w={w} /></div>}
      {previews.length > 0 ? (
        <div className="flow-previews">
          <span className="small muted">🔍 고르면 어떻게 되나 — 지금 상태에서 미리 본 결과 (고르기 전에는 바뀌지 않는다)</span>
          {previews.map((pv) => <PreviewCard key={pv.id} pv={pv} tally={tally?.[pv.id.replace(/^force:/, 'opt:')]} g={g} onPick={() => onAct(pv.id, pv.label)} />)}
        </div>
      ) : acts.length > 0 ? (
        <div className="flow-actions">
          <span className="small muted">무엇이 일어났다고 할까</span>
          {acts.map((a) => <button key={a.id} type="button" className={a.weight ? '' : 'small'} onClick={() => onAct(a.id, a.label)}>{a.label}</button>)}
        </div>
      ) : <p className="small muted">{state.ending ? '결말에 이르렀습니다. 「↶ 한 걸음 되돌리기」나 「⟲ 처음부터」로 다른 길을 해 보세요.' : info?.st === 'locked' ? '아직 잠겨 있습니다 — 위 조건이 참이 되어야 열립니다.' : '지금 이 상자로 할 일은 없습니다.'}</p>}
      {n.kind !== 'start' && (
        <details className="flow-sim-edit"><summary className="small">✎ 이 상자 고치기 (고치면 시뮬레이션이 같은 길로 다시 돌아갑니다)</summary>
          <div className="flow-edit"><NodeEditor w={w} set={set} n={n} /></div>
        </details>
      )}
    </aside>
  );
}

/** 갈림길 하나의 미리 보기 (v0.160) */
function PreviewCard({ pv, tally, g, onPick }: { pv: ActPreview; tally?: ExploreReport['byChoice'][string][string]; g: StoryGraph; onPick: () => void }) {
  const names = (list: GNode[]) => list.map((x) => `${NODE_ICON[x.kind]} ${x.name}`).join(', ');
  return (
    <div className={`flow-preview${pv.ending ? ' ends' : ''}`}>
      <b>{pv.label}</b>
      {pv.error ? <span className="small warn-text">❌ {pv.error}</span> : <>
        {pv.ending && <span className="small"><b>🏁 결말: {pv.ending.name}</b></span>}
        {pv.opened.length > 0 && <span className="small">🟢 열림: {names(pv.opened)}</span>}
        {pv.done.length > 0 && <span className="small">✔ 끝남: {names(pv.done)}</span>}
        {pv.failed.length > 0 && <span className="small">✗ 막힘·실패: {names(pv.failed)}</span>}
        {pv.on.length > 0 && <span className="small muted">● {names(pv.on)}</span>}
        {(() => {
          const boxes = !!(pv.ending || pv.opened.length || pv.done.length || pv.failed.length || pv.on.length);
          if (!boxes && !pv.lines.length) return <span className="small muted">바로 바뀌는 것은 없습니다 (나중에 다른 조건과 함께 쓰일 수 있다).</span>;
          // 흐름도 상자는 그대로라도 성향·관계·수치 등은 바뀔 수 있다 — 그때는 엔진이 적용한 것을 펼쳐 보여 준다
          return pv.lines.length > 0 && <details open={!boxes}><summary className="small">{boxes ? `엔진이 적용한 것 ${pv.lines.length}` : `흐름도 상자는 그대로 — 바뀌는 것 ${pv.lines.length} (성향·관계·수치 등)`}</summary><pre className="small">{pv.lines.join('\n')}</pre></details>;
        })()}
        </>}
      {tally && <span className="small flow-tally">🎲 자동 탐색: 이 길로 간 {tally.runs}판 → {tallyText(tally, g)}</span>}
      <button type="button" className={pv.forced ? 'small' : ''} onClick={onPick}>이걸로 고르기</button>
    </div>
  );
}
const tallyText = (t: ExploreReport['byChoice'][string][string], g: StoryGraph) => {
  const pct = (n: number) => `${Math.round((n / Math.max(1, t.runs)) * 100)}%`;
  const parts = Object.entries(t.endings).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${g.nodes.find((x) => x.key === k)?.name ?? k} ${pct(n)}`);
  if (t.dead) parts.push(`막힘 ${pct(t.dead)}`);
  if (t.long) parts.push(`끝나지 않음 ${pct(t.long)}`);
  return parts.join(' · ') || '—';
};

/** 자동 탐색 결과 */
function ExploreView({ w, g, r, onPath, onPick, onClose }: { w: WorldPackage; g: StoryGraph; r: ExploreReport; onPath: (p: SimPath) => void; onPick: (k: string) => void; onClose: () => void }) {
  const name = (k: string) => { const n = g.nodes.find((x) => x.key === k); return n ? `${NODE_ICON[n.kind]} ${n.name}` : k; };
  const endings = (w.endings ?? []).map((e) => `ending:${e.id}`);
  const unreached = endings.filter((k) => !r.endings[k]);
  return (
    <div className="flow-report">
      <div className="row"><b className="small">🎲 자동 탐색 {r.runs}번 (평균 {r.avgSteps}걸음)</b><span className="spacer" /><button type="button" className="small" onClick={onClose} aria-label="결과 닫기">✕</button></div>
      <ul className="flow-report-list">
        {Object.entries(r.endings).sort((x, y) => y[1] - x[1]).map(([k, n]) => (
          <li key={k}><span>🏁 {name(k).replace(/^◆ /, '')} — <b>{n}번</b> ({Math.round((n / r.runs) * 100)}%)</span> <button type="button" className="small" onClick={() => onPath(r.pathTo[k]!)}>이 길 따라가기</button></li>
        ))}
        {unreached.length > 0 && <li className="warn-text">⚠ 한 번도 이르지 못한 결말: {unreached.map((k) => <button key={k} type="button" className="small" onClick={() => onPick(k)}>{name(k)}</button>)}</li>}
        {r.deadEnds > 0 && <li><span className="warn-text">⚠ 결말 없이 막힌 판 {r.deadEnds}번</span> {r.deadPath && <button type="button" className="small" onClick={() => onPath(r.deadPath!)}>막힌 길 따라가기</button>}</li>}
        {r.tooLong > 0 && <li className="small muted">{r.tooLong}번은 120걸음 안에 끝나지 않았습니다 (반복되는 카드·시계가 많거나 결말 조건이 멀다).</li>}
        {r.never.length > 0 && <li><span className="warn-text">⚠ 한 번도 열리지 않은 상자 {r.never.length}개</span> (흐름도에 굵은 점선) — {r.never.slice(0, 12).map((k) => <button key={k} type="button" className="small" onClick={() => onPick(k)}>{name(k)}</button>)}{r.never.length > 12 ? ` 외 ${r.never.length - 12}개` : ''}</li>}
        {!r.never.length && !unreached.length && !r.deadEnds && <li>✓ 모든 상자가 열리고 모든 결말에 이를 수 있었습니다.</li>}
        {Object.keys(r.byChoice).some((k) => k.startsWith('choice:')) && (
          <li className="flow-bychoice"><details open><summary className="small"><b>⚖ 결정적 선택별 결말</b> — 그 선택지를 고른 판이 어디로 갔나</summary>
            {Object.entries(r.byChoice).filter(([k]) => k.startsWith('choice:')).map(([k, opts]) => {
              const c = w.choices?.find((x) => `choice:${x.id}` === k);
              return (
                <div key={k} className="flow-bychoice-item">
                  <button type="button" className="small" onClick={() => onPick(k)}>⚖ {c?.name ?? k}</button>
                  <ul>{Object.entries(opts).map(([id, t]) => (
                    <li key={id} className="small">「{c?.options.find((o) => `opt:${o.id}` === id)?.text ?? id}」 {t.runs}판 → {tallyText(t, g)} {t.path && <button type="button" className="small" onClick={() => onPath(t.path!)}>이 길 따라가기</button>}</li>
                  ))}</ul>
                </div>
              );
            })}
          </details></li>
        )}
      </ul>
      <p className="small muted">무작위로 고른 길이라 매번 조금 다릅니다. GM이 세우는 플래그는 가끔만 세우고, 조건을 무시하는 「억지로」 일은 하지 않습니다. 잠긴 상자가 바라는 장소(★)로는 옮겨 가 보지만, 관계·성향·날짜 조건은 시작 상태 그대로 봅니다.</p>
    </div>
  );
}

/** 종류마다 자주 고치는 칸 (나머지는 전체 편집 탭에서) */
function NodeEditor({ w, set, n, onPick }: { w: WorldPackage; set: SetW; n: GNode; onPick?: (k: string) => void }) {
  const upd = <T extends { id: string }>(list: T[] | undefined, patch: Partial<T>) => (list ?? []).map((x) => (x.id === n.id ? { ...x, ...patch } : x));
  switch (n.kind) {
    case 'quest': return <QuestEditor w={w} set={set} id={n.id} />;
    case 'ending': {
      const e = w.endings?.find((x) => x.id === n.id); if (!e) return null;
      const up = (p: Partial<Ending>) => set({ endings: upd(w.endings, p) });
      return (
        <>
          <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
          <ConditionField label="이 결말에 이르는 조건" value={e.condition} world={w} onChange={(condition) => up({ condition: condition ?? { all: [] } })} />
          <Area label="마지막 장면 (서술 AI에게 주는 방향)" value={e.epilogue} onChange={(epilogue) => up({ epilogue })} rows={3} />
        </>
      );
    }
    case 'card': return <CardEditor w={w} set={set} id={n.id} />;
    case 'choice': return <ChoiceEditor w={w} set={set} id={n.id} />;
    case 'scene': case 'gimmick': {
      const s = w.scenes?.find((x) => x.id === n.id); if (!s) return null;
      const up = (p: Partial<typeof s>) => set({ scenes: upd(w.scenes, p) });
      return (
        <>
          {n.kind === 'gimmick' && <ConditionField label="열리는 조건 (선택)" value={s.start} world={w} optional onChange={(start) => up({ start })} />}
          {n.kind === 'gimmick' ? (
            // 함정·퍼즐: 탭과 같은 양식 (바꿀 때마다 장면을 다시 만든다 — 열리는 조건은 지킨다)
            <div className="flow-gimmick-form"><GimmickForm w={w} d={s} onChange={(nd) => set({ scenes: (w.scenes ?? []).map((x) => (x.id === s.id ? nd : x)) })} /></div>
          ) : (
            // 장면: 「장면」 탭과 같은 양식 (수치·상태·단계·행동·반작용·끝·차례 한도) + 바로 테스트 (v0.156)
            <FlowSceneForm w={w} set={set} d={s} />
          )}
        </>
      );
    }
    case 'encounter': return <EncounterEditor w={w} set={set} id={n.id} />;
    case 'event': {
      const e = w.events?.find((x) => x.id === n.id); if (!e) return null;
      const up = (p: Partial<typeof e>) => set({ events: upd(w.events, p) });
      return (
        <>
          <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
          <label>며칠째에 (비우면 날 수와 상관없이)<input type="number" min={0} value={e.when.day ?? ''} placeholder="예: 3" onChange={(ev) => { const v = ev.target.value; const { day: _d, ...rest } = e.when; up({ when: v === '' ? rest : { ...rest, day: Math.max(0, Number(v) || 0) } }); }} /></label>
          {e.when.date && <p className="small muted">달력 날짜 {e.when.date.year}.{e.when.date.month}.{e.when.date.day}에도 걸려 있습니다 (「이야기 흐름」 탭에서 고칩니다).</p>}
          <ConditionField label="일어나는 조건 (선택 — 날 수와 함께면 둘 다 맞아야)" value={e.when.condition} world={w} optional onChange={(condition) => { const { condition: _c, ...rest } = e.when; up({ when: condition ? { ...rest, condition } : rest }); }} />
          <ConditionField label="막히는 조건 (선택 — 참이면 일어나지 않는다)" value={e.unless} world={w} optional onChange={(unless) => up({ unless })} />
          <Area label="플레이어에게 보이는 소식 (비우면 조용히 일어난다)" value={e.announce ?? ''} onChange={(announce) => up({ announce: announce || undefined })} rows={2} />
          <EffectsEditor label="일어나는 일" value={e.effects} w={w} onChange={(effects) => up({ effects })} />
          {!e.when.day && !e.when.date && !e.when.condition && <p className="small warn-text">⚠ 날 수·날짜·조건이 모두 비어 있어 시작하자마자 일어납니다.</p>}
        </>
      );
    }
    case 'start': return <><StartEditor w={w} set={set} /><p className="small muted">플레이어가 게임을 시작할 때의 자리입니다. 여기서 이어지는 상자는 다른 상자에 걸린 조건이 없어 처음부터 열려 있는 것들입니다(장소·관계·날짜 같은 조건만 있는 것 포함). 이 상자의 ● 손잡이를 다른 상자로 끌면 그 상자를 처음부터 열리게 하고(열리는 조건을 비운다), 아래 버튼으로 처음부터 열리는 새 임무·카드·선택을 만듭니다.</p></>;
    case 'location': {
      const l = w.locations.find((x) => x.id === n.id); if (!l) return null;
      const up = (p: Partial<Location>) => set({ locations: w.locations.map((x) => (x.id === l.id ? { ...x, ...p } : x)) });
      return (
        <>
          <Text label="이름" value={l.name} onChange={(name) => up({ name })} />
          <Area label="묘사 (플레이어가 여기 있을 때 느끼는 것)" value={l.description} onChange={(description) => up({ description })} rows={3} />
          <fieldset className="flow-stage"><legend>길로 이어진 장소 (양쪽 모두)</legend>
            {w.locations.filter((x) => x.id !== l.id).map((x) => (
              <label key={x.id} className="check"><input type="checkbox" checked={l.connections.includes(x.id)} onChange={(e) => set({ locations: setLink(w.locations, l.id, x.id, e.target.checked) })} /> {x.name}</label>
            ))}
            {w.locations.length < 2 && <span className="small muted">다른 장소가 없습니다.</span>}
          </fieldset>
          <label className="check"><input type="checkbox" checked={w.start.locationId === l.id} disabled={w.start.locationId === l.id} onChange={() => set({ start: { ...w.start, locationId: l.id } })} /> 플레이 시작 장소</label>
        </>
      );
    }
    case 'character': {
      const c = w.characters.find((x) => x.id === n.id); if (!c) return null;
      const up = (p: Partial<Character>) => set({ characters: w.characters.map((x) => (x.id === c.id ? { ...x, ...p } : x)) });
      return (
        <>
          <Text label="이름" value={c.name} onChange={(name) => up({ name })} />
          <label>있는 곳<select value={c.locationId} onChange={(e) => up({ locationId: e.target.value })}>{w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <Area label="생김새" value={c.appearance} onChange={(appearance) => up({ appearance })} rows={2} />
          <Area label="성격" value={c.personality} onChange={(personality) => up({ personality })} rows={2} />
          <Area label="말투" value={c.speech} onChange={(speech) => up({ speech })} rows={2} />
          <label>소속 세력<select value={c.faction ?? ''} onChange={(e) => up({ faction: e.target.value || undefined })}><option value="">없음</option>{(w.factions ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <CharacterRelations w={w} set={set} id={c.id} />
        </>
      );
    }
    case 'faction': return <FactionEditor w={w} set={set} id={n.id} />;
    case 'item': {
      const it = w.items?.find((x) => x.id === n.id);
      if (!it) return <p className="small muted">앱의 기본 아이템입니다 — 이 세계의 아이템이 아니어서 여기서는 고치지 않습니다.</p>;
      const up = (p: Partial<ItemDef>) => set({ items: (w.items ?? []).map((x) => (x.id === it.id ? { ...x, ...p } : x)) });
      return (
        <>
          <Text label="이름" value={it.name} onChange={(name) => up({ name })} />
          <label>종류<select value={it.kind} onChange={(e) => up({ kind: e.target.value as ItemDef['kind'] })}>
            {([['consumable', '소모품'], ['weapon', '무기'], ['armor', '갑옷'], ['shield', '방패'], ['trinket', '장신구'], ['scroll', '비급·주문서'], ['key', '열쇠'], ['treasure', '보물'], ['misc', '물건']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <Area label="설명" value={it.description} onChange={(description) => up({ description })} rows={2} />
          <label>값<input type="number" min={0} value={it.price ?? 0} onChange={(e) => up({ price: Math.max(0, Number(e.target.value) || 0) })} /></label>
          <p className="small muted">무기 보너스·회복·카드 같은 자세한 성능은 「아이템·상점」 탭에서 고칩니다.</p>
        </>
      );
    }
    case 'monster': {
      const m = w.monsters?.find((x) => x.id === n.id);
      if (!m) return <p className="small muted">앱의 기본 적입니다 — 이 세계의 적이 아니어서 여기서는 고치지 않습니다. 「조우」 탭에서 이 세계만의 적을 만들 수 있습니다.</p>;
      const up = (p: Partial<CustomMonster>) => set({ monsters: (w.monsters ?? []).map((x) => (x.id === m.id ? { ...x, ...p } : x)) });
      return (
        <>
          <Text label="이름" value={m.name} onChange={(name) => up({ name })} />
          <Area label="외형·성격 (전투 서술에 쓰임)" value={m.look} onChange={(look) => up({ look })} rows={2} />
          <label>역할<select value={m.role} onChange={(e) => up({ role: e.target.value as CustomMonster['role'] })}>
            {([['minion', '졸개'], ['brute', '돌격'], ['skirmisher', '유격'], ['artillery', '원거리'], ['controller', '방해'], ['leader', '지휘'], ['boss', '우두머리']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <div className="row flow-nums">
            <label>HP<input type="number" min={1} value={m.hp} onChange={(e) => up({ hp: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label>AC<input type="number" min={1} value={m.ac} onChange={(e) => up({ ac: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label>경험치<input type="number" min={0} value={m.xp} onChange={(e) => up({ xp: Math.max(0, Number(e.target.value) || 0) })} /></label>
          </div>
          <p className="small muted">능력치·공격·기술은 「조우」 탭의 「이 세계만의 적」에서 고칩니다.</p>
        </>
      );
    }
    case 'arc': {
      const a = w.arcs?.find((x) => x.id === n.id); if (!a) return null;
      const up = (p: Partial<Arc>) => set({ arcs: upd(w.arcs, p) });
      const upCh = (i: number, p: Partial<Arc['chapters'][number]>) => up({ chapters: a.chapters.map((x, j) => (j === i ? { ...x, ...p } : x)) });
      return (
        <>
          <Text label="이름" value={a.name} onChange={(name) => up({ name })} />
          <label>종류<select value={a.kind} onChange={(e) => up({ kind: e.target.value as Arc['kind'] })}><option value="main">큰 줄기</option><option value="faction">세력 줄기</option><option value="character">인물 줄기</option></select></label>
          <ConditionField label="시작 조건" value={a.start} world={w} onChange={(start) => up({ start: start ?? { all: [] } })} />
          {a.chapters.map((ch, i) => (
            <fieldset key={i} className="flow-stage"><legend>{i + 1}장</legend>
              <Text label="장 이름" value={ch.name} onChange={(name) => upCh(i, { name })} />
              <Area label="GM에게: 이 장에서 일어나야 할 일" value={ch.goal} onChange={(goal) => upCh(i, { goal })} rows={2} />
              <ConditionField label="끝나는 조건" value={ch.complete} world={w} completion onChange={(complete) => upCh(i, { complete: complete ?? UNSET_CONDITION })} />
              <EffectsEditor label="이 장을 끝내면" value={ch.effects} w={w} onChange={(effects) => upCh(i, { effects })} />
              {a.chapters.length > 1 && <button type="button" className="small" onClick={() => up({ chapters: a.chapters.filter((_, j) => j !== i) })}>🗑 이 장 지우기</button>}
            </fieldset>
          ))}
          <button type="button" className="small" onClick={() => up({ chapters: [...a.chapters, { name: `${a.chapters.length + 1}장`, goal: '', complete: UNSET_CONDITION }] })}>＋ 장 더하기</button>
        </>
      );
    }
    case 'rule': {
      const r = w.rules?.find((x) => x.id === n.id); if (!r) return null;
      const up = (p: Partial<WorldRule>) => set({ rules: upd(w.rules, p) });
      const t = r.trigger;
      return (
        <>
          <Text label="이름" value={r.name} onChange={(name) => up({ name })} />
          <label>언제 발동하나<select value={t.kind} onChange={(e) => up({ trigger: e.target.value === 'state' ? { kind: 'state', condition: { all: [] } } : { kind: 'action', describe: '' } })}>
            <option value="action">플레이어가 어떤 행동을 하면</option><option value="state">어떤 상태가 되면</option>
          </select></label>
          {t.kind === 'action' ? <>
            <Area label="어떤 행동인가 (GM이 알아듣게)" value={t.describe} onChange={(describe) => up({ trigger: { ...t, describe } })} rows={2} />
            <Text label="걸리는 낱말 (쉼표로, 선택)" value={(t.keywords ?? []).join(', ')} onChange={(v) => { const keywords = v.split(',').map((x) => x.trim()).filter(Boolean); up({ trigger: { kind: 'action', describe: t.describe, ...(keywords.length ? { keywords } : {}) } }); }} />
          </> : <ConditionField label="발동 조건" value={t.condition} world={w} onChange={(condition) => up({ trigger: { kind: 'state', condition: condition ?? { all: [] } } })} />}
          <ConditionField label="추가 조건 (선택 — 이것도 참이어야 발동)" value={r.requires} world={w} optional onChange={(requires) => up({ requires })} />
          <EffectsEditor label="엔진이 바로 적용하는 결과" value={r.effects} w={w} onChange={(effects) => up({ effects })} />
          <Area label="서술에 주는 결과 (GM용)" value={r.outcome ?? ''} onChange={(outcome) => up({ outcome })} rows={2} />
          <Text label="기록에 보이는 한 줄 (선택)" value={r.announce ?? ''} onChange={(announce) => up({ announce: announce || undefined })} />
          <label>되풀이<select value={typeof r.repeat === 'number' ? 'n' : r.repeat ?? 'once'} onChange={(e) => up({ repeat: e.target.value === 'n' ? 3 : e.target.value as 'once' | 'always' })}>
            <option value="once">한 번만</option><option value="always">매번</option><option value="n">몇 턴 쉬었다가 다시</option>
          </select></label>
          {typeof r.repeat === 'number' && <label>쉬는 턴<input type="number" min={1} value={r.repeat} onChange={(e) => up({ repeat: Math.max(1, Number(e.target.value) || 1) })} /></label>}
          <label className="check"><input type="checkbox" checked={r.enabled !== false} onChange={(e) => up({ enabled: e.target.checked ? undefined : false })} /> 켜짐</label>
          <p className="small muted">인물 반응은 「세계 규칙」 탭에서 고칩니다.</p>
        </>
      );
    }
    case 'clock': {
      const c = w.clocks?.find((x) => x.id === n.id); if (!c) return null;
      const up = (p: Partial<Clock>) => set({ clocks: upd(w.clocks, p) });
      const timeIdx = c.tick.findIndex((t) => 'every' in t);
      const time = timeIdx >= 0 ? c.tick[timeIdx] as { every: 'day' | 'hour' | 'beat'; by: number } : null;
      const onCount = c.tick.filter((t) => 'on' in t).length;
      const setTime = (every: string, by: number) => {
        const rest = c.tick.filter((t) => !('every' in t));
        up({ tick: every ? [{ every: every as 'day' | 'hour' | 'beat', by }, ...rest] : rest });
      };
      return (
        <>
          <Text label="이름" value={c.name} onChange={(name) => up({ name })} />
          <div className="row flow-nums">
            <label>칸 수<input type="number" min={1} max={24} value={c.segments} onChange={(e) => { const segments = Math.min(24, Math.max(1, Number(e.target.value) || 1)); up({ segments, at: c.at.map((x) => (x.segment > segments ? { ...x, segment: segments } : x)), ...(c.start && c.start > segments ? { start: segments } : {}) }); }} /></label>
            <label>처음 칸<input type="number" min={0} max={c.segments} value={c.start ?? 0} onChange={(e) => { const v = Math.max(0, Math.min(c.segments, Number(e.target.value) || 0)); up({ start: v || undefined }); }} /></label>
          </div>
          <div className="row flow-nums">
            <label>저절로 차오름<select value={time?.every ?? ''} onChange={(e) => setTime(e.target.value, time?.by ?? 1)}>
              <option value="">저절로는 안 참</option><option value="beat">이야기 장면마다</option><option value="hour">한 시간마다</option><option value="day">하루마다</option>
            </select></label>
            {time && <label>한 번에<input type="number" min={1} value={time.by} onChange={(e) => setTime(time.every, Math.max(1, Number(e.target.value) || 1))} /></label>}
          </div>
          {onCount > 0 && <p className="small muted">조건으로 차오르는 것 {onCount}개 — 위 「이것을 여는 것」에 보입니다 (「이야기 흐름」 탭에서 고칩니다).</p>}
          {c.at.map((a, i) => (
            <fieldset key={i} className="flow-stage"><legend>{a.segment}칸에 이르면</legend>
              <label>칸<input type="number" min={1} max={c.segments} value={a.segment} onChange={(e) => up({ at: c.at.map((x, j) => (j === i ? { ...x, segment: Math.min(c.segments, Math.max(1, Number(e.target.value) || 1)) } : x)) })} /></label>
              <Text label="징조 (플레이어에게 보이는 한 줄)" value={a.omen ?? ''} onChange={(omen) => up({ at: c.at.map((x, j) => (j === i ? { ...x, omen: omen || undefined } : x)) })} />
              <EffectsEditor label="일어나는 일" value={a.effects} w={w} onChange={(effects) => up({ at: c.at.map((x, j) => (j === i ? { ...x, effects } : x)) })} />
              <button type="button" className="small" onClick={() => up({ at: c.at.filter((_, j) => j !== i) })}>🗑 이 지점 지우기</button>
            </fieldset>
          ))}
          <button type="button" className="small" onClick={() => up({ at: [...c.at, { segment: c.segments }] })}>＋ 칸 지점 더하기</button>
        </>
      );
    }
    case 'flag': return <FlagEditor w={w} set={set} id={n.id} onRenamed={(to) => onPick?.(`flag:${to}`)} />;
    case 'claim': return <ClaimEditor w={w} set={set} id={n.id} />;
    default: return <p className="small muted">이 종류는 전체 편집 탭에서 고칩니다.</p>;
  }
}

// ---------------------------------------------------------------- 갈래 카드 · 결정적 선택 (v0.153: 흐름도에서 바로 다 고친다)

const DC_LABEL: [NonNullable<StoryletOption['check']>['dc'], string][] = [['very_easy', '아주 쉬움'], ['easy', '쉬움'], ['medium', '보통'], ['hard', '어려움'], ['very_hard', '아주 어려움']];
const TAG_LABEL: [NonNullable<Storylet['tags']>[number], string][] = [['main', '뼈대'], ['side', '곁가지'], ['random', '돌발'], ['twist', '반전'], ['job', '의뢰']];
const freshId = (ids: string[]) => { let i = ids.length + 1; while (ids.includes(`o${i}`)) i++; return `o${i}`; };

/** 걸린 것 고르기: 종류 + 대상 (세력·인물·명제·수치) — 엔진의 stake 모양으로 적는다 */
function StakePicker({ w, value, onChange }: { w: WorldPackage; value?: string; onChange: (v: string | undefined) => void }) {
  const [kind = '', ref = '', dir = ''] = (value ?? '').split(':');
  const k = kind === 'theme' ? `theme${dir}` : kind;
  const refs: [string, string][] = kind === 'side' ? (w.factions ?? []).map((f) => [f.id, f.name])
    : kind === 'bond' || kind === 'betray' ? w.characters.map((c) => [c.id, c.name])
    : kind === 'expose' ? w.claims.map((c) => [c.id, c.statement.slice(0, 30)])
    : kind === 'theme' ? (w.vars ?? []).map((v) => [v.id, v.name]) : [];
  const make = (nk: string, nref: string) => {
    if (!nk) return undefined;
    if (nk === 'escalate' || nk === 'defuse') return nk;
    if (nk === 'theme+' || nk === 'theme-') return nref ? `theme:${nref}:${nk.slice(-1)}` : undefined;
    return nref ? `${nk}:${nref}` : undefined;
  };
  const firstRef = (nk: string) => (nk === 'side' ? w.factions?.[0]?.id : nk === 'bond' || nk === 'betray' ? w.characters[0]?.id : nk === 'expose' ? w.claims[0]?.id : nk.startsWith('theme') ? w.vars?.[0]?.id : '') ?? '';
  const known = ['', 'escalate', 'defuse', 'side', 'bond', 'betray', 'expose', 'theme+', 'theme-'];
  return (
    <div className="row flow-nums">
      <label>걸린 것<select value={known.includes(k) ? k : '?'} onChange={(e) => { const nk = e.target.value; onChange(make(nk, firstRef(nk))); }}>
        <option value="">없음</option>
        <option value="escalate">{STAKE_ICON.escalate} 일이 커진다</option>
        <option value="defuse">{STAKE_ICON.defuse} 가라앉힌다</option>
        {(w.factions ?? []).length > 0 && <option value="side">{STAKE_ICON.side} 세력 편들기</option>}
        {w.characters.length > 0 && <option value="bond">{STAKE_ICON.bond} 인물과 가까워짐</option>}
        {w.characters.length > 0 && <option value="betray">{STAKE_ICON.betray} 인물을 배신</option>}
        {w.claims.length > 0 && <option value="expose">{STAKE_ICON.expose} 비밀을 드러냄</option>}
        {(w.vars ?? []).length > 0 && <option value="theme+">{STAKE_ICON.theme} 세계 수치 올림</option>}
        {(w.vars ?? []).length > 0 && <option value="theme-">{STAKE_ICON.theme} 세계 수치 내림</option>}
        {!known.includes(k) && <option value="?">그대로 ({value})</option>}
      </select></label>
      {refs.length > 0 && <label>대상<select value={ref} onChange={(e) => onChange(make(k, e.target.value))}>{refs.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}</select></label>}
    </div>
  );
}

function CardEditor({ w, set, id }: { w: WorldPackage; set: SetW; id: string }) {
  const c = w.storylets?.find((x) => x.id === id); if (!c) return null;
  const up = (p: Partial<Storylet>) => set({ storylets: (w.storylets ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const upO = (i: number, p: Partial<StoryletOption>) => up({ options: c.options.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const tags = c.tags ?? [];
  return (
    <>
      <Text label="제목" value={c.title} onChange={(title) => up({ title })} />
      <Area label="상황 (서술자가 펼칠 장면 — 누가·어디서·무엇이 걸렸나)" value={c.situation} onChange={(situation) => up({ situation })} rows={3} />
      <ConditionField label="덱에 들어오는 조건 (선택)" value={c.when} world={w} optional onChange={(when) => up({ when })} />
      <fieldset className="flow-stage"><legend>종류</legend>
        <div className="row flow-tags">{TAG_LABEL.map(([t, l]) => (
          <label key={t} className="check"><input type="checkbox" checked={tags.includes(t)} onChange={(e) => { const next = e.target.checked ? [...tags, t] : tags.filter((x) => x !== t); up({ tags: next.length ? next : undefined }); }} /> {l}</label>
        ))}</div>
      </fieldset>
      <div className="row flow-nums">
        <label>장소<select value={c.locationId ?? ''} onChange={(e) => up({ locationId: e.target.value || undefined })}><option value="">어디서나</option>{w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>무게<input type="number" min={1} value={c.weight ?? 1} onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 1); up({ weight: v === 1 ? undefined : v }); }} /></label>
      </div>
      <label>속한 임무<select value={c.quest ?? ''} onChange={(e) => up({ quest: e.target.value || undefined })}><option value="">없음</option>{(w.quests ?? []).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
      <div className="row flow-nums">
        <label className="check"><input type="checkbox" checked={!!c.repeat} onChange={(e) => up({ repeat: e.target.checked ? { after: 5 } : undefined })} /> 다시 나올 수 있다</label>
        {c.repeat && <label>몇 턴 뒤<input type="number" min={1} value={c.repeat.after} onChange={(e) => up({ repeat: { after: Math.max(1, Number(e.target.value) || 1) } })} /></label>}
      </div>
      {c.options.map((o, i) => (
        <fieldset key={o.id} className="flow-stage"><legend>갈림길 {i + 1}</legend>
          <Text label="선택지" value={o.label} onChange={(label) => upO(i, { label })} />
          <StakePicker w={w} value={o.stake} onChange={(stake) => upO(i, { stake })} />
          <div className="row flow-nums">
            <label>판정<select value={o.check?.skill ?? ''} onChange={(e) => upO(i, { check: e.target.value ? { skill: e.target.value, dc: o.check?.dc ?? 'medium' } : undefined })}>
              <option value="">판정 없이 성공</option>
              {SKILL_IDS.map((sk) => <option key={sk} value={sk}>{SKILLS[sk].name}</option>)}
            </select></label>
            {o.check && <label>어려움<select value={o.check.dc} onChange={(e) => upO(i, { check: { ...o.check!, dc: e.target.value as NonNullable<StoryletOption['check']>['dc'] } })}>{DC_LABEL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
          </div>
          <EffectsEditor label="성공하면" value={o.success} w={w} onChange={(success) => upO(i, { success })} />
          {o.check && <EffectsEditor label="실패하면 (비우면 엔진이 고른 전개)" value={o.fail} w={w} onChange={(fail) => upO(i, { fail })} />}
          {c.options.length > 2 && <button type="button" className="small" onClick={() => up({ options: c.options.filter((_, j) => j !== i) })}>🗑 이 갈림길 지우기</button>}
        </fieldset>
      ))}
      {c.options.length < 4 && <button type="button" className="small" onClick={() => up({ options: [...c.options, { id: freshId(c.options.map((o) => o.id)), label: '새 길' }] })}>＋ 갈림길 더하기 (2~4개)</button>}
      <p className="small muted">대가 있는 성공·결과 글·후폭풍은 「이야기 흐름」 탭에서 고칩니다.</p>
    </>
  );
}

function ChoiceEditor({ w, set, id }: { w: WorldPackage; set: SetW; id: string }) {
  const c = w.choices?.find((x) => x.id === id); if (!c) return null;
  const up = (p: Partial<DecisiveChoice>) => set({ choices: (w.choices ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) });
  return (
    <>
      <Text label="이름" value={c.name} onChange={(name) => up({ name })} />
      <Area label="플레이어에게 보이는 질문" value={c.prompt} onChange={(prompt) => up({ prompt })} rows={2} />
      <ConditionField label="열리는 조건" value={c.when} world={w} onChange={(when) => up({ when: when ?? { all: [] } })} />
      <label>장소<select value={c.locationId ?? ''} onChange={(e) => up({ locationId: e.target.value || undefined })}><option value="">어디서나</option>{w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      {c.options.map((o, i) => (
        <fieldset key={o.id} className="flow-stage"><legend>선택 {i + 1}</legend>
          <Text label="선택지" value={o.text} onChange={(text) => up({ options: c.options.map((x, j) => (j === i ? { ...x, text } : x)) })} />
          <EffectsEditor label="고르면" value={o.effects} w={w} onChange={(effects: StoryEffect[]) => up({ options: c.options.map((x, j) => (j === i ? { ...x, effects } : x)) })} />
          {c.options.length > 2 && <button type="button" className="small" onClick={() => up({ options: c.options.filter((_, j) => j !== i) })}>🗑 이 선택 지우기</button>}
        </fieldset>
      ))}
      <button type="button" className="small" onClick={() => up({ options: [...c.options, { id: freshId(c.options.map((o) => o.id)), text: '새 선택', effects: [] }] })}>＋ 선택 더하기</button>
      <p className="small muted">한 번 고르면 되돌릴 수 없는 선택입니다. 고른 것은 「고름」 조건으로 다른 상자를 엽니다 — 이 상자의 ● 손잡이를 끌어 이으세요.</p>
    </>
  );
}

// ---------------------------------------------------------------- 임무 (v0.154: 단계별로 바로 고친다)

function QuestEditor({ w, set, id }: { w: WorldPackage; set: SetW; id: string }) {
  const q = w.quests?.find((x) => x.id === id);
  const [openStage, setOpenStage] = useState<number | null>(0);
  if (!q) return null;
  const up = (p: Partial<Quest>) => set({ quests: (w.quests ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const upSt = (i: number, p: Partial<QuestStage>) => up({ stages: q.stages.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  // 순서·더하기·지우기는 「n단계 중이면」 조건 번호도 따라 고친다
  const restage = (stages: QuestStage[], map: (old: number) => number, open: number | null) => { set(restageQuest(w, id, stages, map)); setOpenStage(open); };
  const move = (i: number, d: -1 | 1) => { const k = i + d; const st = [...q.stages]; [st[i], st[k]] = [st[k]!, st[i]!]; restage(st, (o) => (o === i ? k : o === k ? i : o), k); };
  const insert = (i: number) => { const st = [...q.stages]; st.splice(i + 1, 0, { objective: '새 단계', hint: '', complete: { all: [] } }); restage(st, (o) => (o > i ? o + 1 : o), i + 1); };
  const remove = (i: number) => { const st = q.stages.filter((_, j) => j !== i); restage(st, (o) => (o > i ? o - 1 : o === i ? Math.min(i, st.length - 1) : o), null); };
  const xp = q.rewards?.xp;
  const opt = (list: { id: string; name: string }[], none: string) => [<option key="" value="">{none}</option>, ...list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)];
  return (
    <>
      <Text label="이름" value={q.name} onChange={(name) => up({ name })} />
      <div className="row flow-nums">
        <label>종류<select value={q.kind} onChange={(e) => up({ kind: e.target.value as Quest['kind'] })}><option value="main">메인</option><option value="side">사이드</option></select></label>
        <label>유형<select value={q.type ?? ''} onChange={(e) => up({ type: (e.target.value || undefined) as Quest['type'] })}><option value="">(일반)</option>{QUEST_TYPES.map((t) => <option key={t} value={t}>{QUEST_TYPE_LABEL[t]}</option>)}</select></label>
      </div>
      <div className="row flow-nums">
        <label>의뢰인<select value={q.giver ?? ''} onChange={(e) => up({ giver: e.target.value || undefined })}>{opt(w.characters, '없음')}</select></label>
        <label>대상 인물 (죽으면 실패)<select value={q.target ?? ''} onChange={(e) => up({ target: e.target.value || undefined })}>{opt(w.characters, '없음')}</select></label>
      </div>
      <Area label="왜 해야 하나" value={q.motive} onChange={(motive) => up({ motive: motive || undefined })} rows={2} />
      <ConditionField label="시작 조건" value={q.start} world={w} onChange={(start) => up({ start: start ?? { all: [] } })} />

      <div className="flow-stages">
        <b className="small">단계 {q.stages.length}개 — 위에서부터 차례로</b>
        {q.stages.map((st, i) => (
          <details key={i} className="flow-stage-card" open={openStage === i} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o) setOpenStage(i); else if (openStage === i) setOpenStage(null); }}>
            <summary><span className="flow-stage-no">{i + 1}</span> {st.objective || '(할 일 없음)'}{isEmptyCond(st.complete) ? ' ⚠' : ''}</summary>
            <div className="flow-stage-body">
              <Text label="할 일 (플레이어 수첩에 보임)" value={st.objective} onChange={(objective) => upSt(i, { objective })} />
              <Area label="GM 힌트 (플레이어에게 안 보임)" value={st.hint} onChange={(hint) => upSt(i, { hint })} rows={2} />
              <ConditionField label="끝나는 조건" value={st.complete} world={w} completion onChange={(complete) => upSt(i, { complete: complete ?? { all: [] } })} />
              <ConditionField label="이 단계에서 실패하는 조건 (선택)" value={st.fail} world={w} optional onChange={(fail) => upSt(i, { fail })} />
              <div className="row flow-nums">
                <label>고비 — 장면<select value={st.via?.scene ?? ''} onChange={(e) => { const v = { ...st.via, scene: e.target.value || undefined }; upSt(i, { via: v.scene || v.encounter ? v : undefined }); }}>{opt(w.scenes ?? [], '없음')}</select></label>
                <label>고비 — 전투<select value={st.via?.encounter ?? ''} onChange={(e) => { const v = { ...st.via, encounter: e.target.value || undefined }; upSt(i, { via: v.scene || v.encounter ? v : undefined }); }}>{opt(w.encounters ?? [], '없음')}</select></label>
              </div>
              <div className="row flow-stage-tools">
                <button type="button" className="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${i + 1}단계를 위로`}>↑ 위로</button>
                <button type="button" className="small" disabled={i === q.stages.length - 1} onClick={() => move(i, 1)} aria-label={`${i + 1}단계를 아래로`}>↓ 아래로</button>
                <button type="button" className="small" onClick={() => insert(i)}>＋ 아래에 단계 넣기</button>
                {q.stages.length > 1 && <button type="button" className="small" onClick={() => { if (confirm(`${i + 1}단계 「${st.objective}」를 지울까요?`)) remove(i); }}>🗑 지우기</button>}
              </div>
            </div>
          </details>
        ))}
        <button type="button" className="small" onClick={() => insert(q.stages.length - 1)}>＋ 마지막에 단계 더하기</button>
        <p className="small muted">순서를 바꾸거나 지우면 다른 곳의 「n단계 중이면」 조건 번호도 따라 고칩니다.</p>
      </div>

      <ConditionField label="언제든 실패하는 조건 (선택)" value={q.fail} world={w} optional onChange={(fail) => up({ fail })} />
      <div className="row flow-nums">
        <label>기한 (날 수, 선택)<input type="number" min={1} value={q.timeLimit?.days ?? ''} placeholder="없음" onChange={(e) => up({ timeLimit: e.target.value ? { days: Math.max(1, Number(e.target.value) || 1) } : undefined })} /></label>
        <label>경험치<select value={typeof xp === 'number' ? 'n' : xp ?? ''} onChange={(e) => { const v = e.target.value; const r = { ...q.rewards }; if (!v) delete r.xp; else r.xp = v === 'n' ? 100 : (v as 'minor' | 'major'); up({ rewards: Object.keys(r).length ? r : undefined }); }}>
          <option value="">기본</option><option value="minor">작은 보상</option><option value="major">큰 보상</option><option value="n">숫자로</option>
        </select></label>
        {typeof xp === 'number' && <label>경험치 값<input type="number" min={0} value={xp} onChange={(e) => up({ rewards: { ...q.rewards, xp: Math.max(0, Number(e.target.value) || 0) } })} /></label>}
        <label>돈<input type="number" min={0} value={q.rewards?.money ?? ''} placeholder="0" onChange={(e) => { const r = { ...q.rewards }; if (e.target.value) r.money = Math.max(0, Number(e.target.value) || 0); else delete r.money; up({ rewards: Object.keys(r).length ? r : undefined }); }} /></label>
      </div>

      <fieldset className="flow-stage"><legend>여러 결과 (선택 — 끝낼 때 위에서부터 처음 맞는 것)</legend>
        {(q.outcomes ?? []).map((o, i) => {
          const upO = (p: Partial<NonNullable<Quest['outcomes']>[number]>) => up({ outcomes: q.outcomes!.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          return (
            <div key={o.id} className="flow-outcome">
              <Text label={`결과 ${i + 1} 이름`} value={o.name} onChange={(name) => upO({ name })} />
              <ConditionField label="이 결과가 되는 조건" value={o.when} world={w} onChange={(when) => upO({ when: when ?? { all: [] } })} />
              <Text label="플레이어에게 보이는 한 줄 (선택)" value={o.text ?? ''} onChange={(text) => upO({ text: text || undefined })} />
              <EffectsEditor label="이 결과로 일어나는 일" value={o.effects} w={w} onChange={(effects) => upO({ effects })} />
              <button type="button" className="small" onClick={() => up({ outcomes: q.outcomes!.filter((_, j) => j !== i).length ? q.outcomes!.filter((_, j) => j !== i) : undefined })}>🗑 이 결과 지우기</button>
            </div>
          );
        })}
        <button type="button" className="small" onClick={() => up({ outcomes: [...(q.outcomes ?? []), { id: freshId((q.outcomes ?? []).map((o) => o.id)), name: '새 결과', when: { all: [] } }] })}>＋ 결과 더하기</button>
      </fieldset>
      <p className="small muted">접근법·단서·숨은 진실·보상 아이템은 「임무·플래그·결말」 탭에서 고칩니다.</p>
    </>
  );
}

// ---------------------------------------------------------------- 플래그 · 지식 (v0.155)

function FlagEditor({ w, set, id, onRenamed }: { w: WorldPackage; set: SetW; id: string; onRenamed?: (to: string) => void }) {
  const decl = (w.flags ?? []).find((f) => f.id === id);
  const [name, setName] = useState(id);
  useEffect(() => { setName(id); }, [id]);
  const clash = name !== id && (w.flags ?? []).some((f) => f.id === name);
  const valid = /^[A-Za-z0-9_\-가-힣]+$/.test(name);
  const up = (p: Partial<NonNullable<WorldPackage['flags']>[number]>) => set({ flags: (w.flags ?? []).map((f) => (f.id === id ? { ...f, ...p } : f)) });
  return (
    <>
      <p className="small muted">플래그는 「세움」(효과)으로 서고 「섬」(조건)으로 읽는 표시입니다. 위 목록에서 세우는 곳·읽는 곳을 보세요.</p>
      <div className="row flow-rename">
        <label>이름 (ID)<input value={name} onChange={(e) => setName(e.target.value.trim())} /></label>
        <button type="button" className="small" disabled={name === id || !name || clash || !valid} onClick={() => { set(renameFlag(w, id, name)); onRenamed?.(name); }}>이름 바꾸기</button>
      </div>
      {clash && <p className="small warn-text">⚠ 같은 이름의 플래그가 이미 있습니다.</p>}
      {!valid && name && <p className="small warn-text">⚠ 글자·숫자·_·- 만 쓸 수 있습니다.</p>}
      {name !== id && !clash && valid && <p className="small muted">바꾸면 이 플래그를 세우는 효과·읽는 조건이 모두 새 이름으로 바뀝니다.</p>}
      {decl ? (
        <>
          <Area label="GM이 언제 세우나 (이 설명대로 GM이 세운다)" value={decl.when} onChange={(when) => up({ when })} rows={2} />
          <label>이 장소에서만<select value={decl.locationId ?? ''} onChange={(e) => up({ locationId: e.target.value || undefined })}><option value="">어디서나</option>{w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <ConditionField label="이것도 참이어야 세울 수 있다 (선택)" value={decl.requires} world={w} optional onChange={(requires) => up({ requires })} />
          <button type="button" className="small" onClick={() => { if (confirm('플래그 선언을 지울까요? GM이 더는 이 플래그를 세우지 않습니다 (효과로 세우는 곳은 그대로).')) set({ flags: (w.flags ?? []).filter((f) => f.id !== id) }); }}>선언 지우기 (효과로만 세움)</button>
        </>
      ) : (
        <>
          <p className="small muted">선언되지 않은 플래그 — 효과(「세움」)로만 섭니다.</p>
          <button type="button" onClick={() => set({ flags: [...(w.flags ?? []), { id, when: '언제 세우는지 적어 주세요' }] })}>GM이 세울 수 있게 선언하기</button>
        </>
      )}
    </>
  );
}

const KNOW_LABEL: [KnowledgeState, string][] = [['rumor', '소문으로'], ['partial', '일부'], ['confirmed', '확실히'], ['mistaken', '잘못 알고'], ['secret', '숨기고']];
function ClaimEditor({ w, set, id }: { w: WorldPackage; set: SetW; id: string }) {
  const c = w.claims.find((x) => x.id === id);
  const [holder, setHolder] = useState('player');
  if (!c) return null;
  const up = (p: Partial<Claim>) => set({ claims: w.claims.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const knows = w.beliefs.map((b, i) => [b, i] as const).filter(([b]) => b.claim === id);
  const holderName = (h: string) => (h === 'player' ? '주인공' : h.startsWith('group:') ? `무리: ${h.slice(6)}` : w.characters.find((x) => x.id === h)?.name ?? h);
  const relOpts: [string, string][] = [['', '없음'], ...w.characters.map((x) => [x.id, `👤 ${x.name}`] as [string, string]), ...w.locations.map((x) => [x.id, `📍 ${x.name}`] as [string, string]), ...(w.factions ?? []).map((x) => [x.id, `⚑ ${x.name}`] as [string, string])];
  return (
    <>
      <Area label="내용 (무엇이 사실 · 소문인가)" value={c.statement} onChange={(statement) => up({ statement })} rows={3} />
      <div className="row flow-nums">
        <label>참인가<select value={c.truth} onChange={(e) => up({ truth: e.target.value as Claim['truth'] })}><option value="true">참</option><option value="false">거짓 (헛소문)</option><option value="partial">일부만 참</option></select></label>
        <label>무엇에 관한 것<select value={c.relatesTo ?? ''} onChange={(e) => up({ relatesTo: e.target.value || undefined })}>{relOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <fieldset className="flow-stage"><legend>처음부터 아는 이</legend>
        {knows.length === 0 && <p className="small muted">아직 아무도 모릅니다 — 효과(「알려 줌」)로 주인공이 알게 됩니다.</p>}
        {knows.map(([b, i]) => (
          <div key={i} className="row flow-nums">
            <span className="flow-holder">{holderName(b.holder)}</span>
            <label>어떻게<select value={b.state} onChange={(e) => set({ beliefs: w.beliefs.map((x, j) => (j === i ? { ...x, state: e.target.value as KnowledgeState } : x)) })}>{KNOW_LABEL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <button type="button" className="small" aria-label={`${holderName(b.holder)} 빼기`} onClick={() => set({ beliefs: w.beliefs.filter((_, j) => j !== i) })}>빼기</button>
          </div>
        ))}
        <div className="row flow-nums">
          <label>더할 사람<select value={holder} onChange={(e) => setHolder(e.target.value)}>
            <option value="player">주인공</option>
            {w.characters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            <option value="group:사람들">무리: 사람들 (소문)</option>
          </select></label>
          <button type="button" className="small" disabled={knows.some(([b]) => b.holder === holder)} onClick={() => set({ beliefs: [...w.beliefs, { holder, claim: id, state: holder === 'player' || holder.startsWith('group:') ? 'rumor' : 'confirmed' }] })}>＋ 아는 이 더하기</button>
        </div>
      </fieldset>
    </>
  );
}

/** 흐름도의 장면 양식 (v0.156): 「장면」 탭과 같은 양식, ID는 고치지 않는다. 「▶ 바로 테스트」는 장면 시험 창을 연다 */
function FlowSceneForm({ w, set, d }: { w: WorldPackage; set: SetW; d: SceneDef }) {
  const [testing, setTesting] = useState(false);
  const save = (nd: SceneDef) => set({ scenes: (w.scenes ?? []).map((x) => (x.id === d.id ? nd : x)) });
  return (
    <div className="flow-scene-form">
      <SceneForm w={w} d={d} hideId up={(p) => save({ ...d, ...p })} onTest={() => setTesting(true)} />
      {testing && <SceneTester w={w} sceneId={d.id} onClose={() => setTesting(false)} onApply={(nd) => save(nd)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 목록 (v0.159)

const OUTLINE_ORDER: NodeKind[] = ['quest', 'arc', 'card', 'choice', 'scene', 'gimmick', 'encounter', 'event', 'clock', 'rule', 'ending', 'flag', 'claim', 'location', 'character', 'faction', 'item', 'monster', 'phase'];
function FlowOutline({ g, sel, q, simMap, onPick, onNew }: { g: StoryGraph; sel: string | null; q: string; simMap: Map<string, NodeSim> | null; onPick: (k: string) => void; onNew: () => void }) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (n: GNode) => !words.length || words.every((t) => `${n.name} ${n.id} ${n.sub ?? ''}`.toLowerCase().includes(t));
  return (
    <nav className="flow-outline" aria-label="흐름도 목록">
      <button type="button" className="small" onClick={onNew}>＋ 새로 만들기 (▶ 시작에서)</button>
      {OUTLINE_ORDER.map((k) => {
        const list = g.nodes.filter((n) => n.kind === k && hit(n));
        if (!list.length) return null;
        return (
          <details key={k} open={k !== 'claim' && k !== 'phase'}>
            <summary className="small"><b>{NODE_ICON[k]} {NODE_LABEL[k]}</b> <span className="muted">{list.length}</span></summary>
            <ul>{list.map((n) => {
              const st = simMap?.get(n.key);
              return <li key={n.key}><button type="button" className={`flow-outline-item${n.key === sel ? ' on' : ''}`} aria-current={n.key === sel} onClick={() => onPick(n.key)} title={n.id}>
                {st && st.st !== 'none' ? `${simIcon(st.st)} ` : ''}{n.name}{n.warn ? ' ⚠' : ''}</button></li>;
            })}</ul>
          </details>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------- 미니맵 (v0.159)

/** 큰 흐름도의 전체 모습과 지금 보이는 자리 — 누르거나 끌면 그곳으로 */
function MiniMap({ nodes, width, height, zoom, view, sel, onGo }: { nodes: { key: string; kind: NodeKind; x: number; y: number }[]; width: number; height: number; zoom: number; view: { sl: number; st: number; cw: number; ch: number }; sel: string | null; onGo: (x: number, y: number) => void }) {
  const W = 180, H = 120;
  const sc = Math.min(W / width, H / height);
  if (!view.cw || (width * zoom <= view.cw + 4 && height * zoom <= view.ch + 4)) return null; // 다 보이면 필요 없다
  const go = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); onGo((e.clientX - r.left) / sc, (e.clientY - r.top) / sc); };
  return (
    <svg className="flow-minimap" width={width * sc} height={height * sc} role="img" aria-label="흐름도 전체 — 누르면 그곳으로"
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); go(e); }} onPointerMove={(e) => { if (e.buttons) go(e); }}>
      {nodes.map((n) => <rect key={n.key} x={n.x * sc} y={n.y * sc} width={Math.max(2, NODE_W * sc)} height={Math.max(2, NODE_H * sc)} className={`mm-node k-${n.kind}${n.key === sel ? ' sel' : ''}`} />)}
      <rect className="mm-view" x={(view.sl / zoom) * sc} y={(view.st / zoom) * sc} width={(view.cw / zoom) * sc} height={(view.ch / zoom) * sc} />
    </svg>
  );
}

// ---------------------------------------------------------------- 전투 (v0.159: 적 구성·결과까지 바로 고친다)

function EncounterEditor({ w, set, id }: { w: WorldPackage; set: SetW; id: string }) {
  const e = w.encounters?.find((x) => x.id === id); if (!e) return null;
  const up = (p: Partial<Encounter>) => set({ encounters: (w.encounters ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const table = monsterTable(w);
  const mons = Object.values(table).sort((a, b) => Number(!(w.monsters ?? []).some((m) => m.id === a.id)) - Number(!(w.monsters ?? []).some((m) => m.id === b.id)) || a.name.localeCompare(b.name));
  const retry = e.retry ?? 3;
  return (
    <>
      <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
      <label>장소<select value={e.locationId} onChange={(ev) => up({ locationId: ev.target.value })}>{w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <Area label="GM에게: 언제 일어나는가" value={e.trigger} onChange={(trigger) => up({ trigger })} rows={2} />
      <Text label="전투 직전 한 줄 (플레이어에게 보임, 선택)" value={e.intro ?? ''} onChange={(intro) => up({ intro: intro || undefined })} />
      <fieldset className="flow-stage"><legend>적 {e.enemies.length}</legend>
        {e.enemies.map((en, i) => (
          <div key={i} className="row flow-nums">
            <label>누구<select value={en.monsterId} onChange={(ev) => up({ enemies: e.enemies.map((x, j) => (j === i ? { ...x, monsterId: ev.target.value } : x)) })}>
              {!table[en.monsterId] && <option value={en.monsterId}>(없는 적: {en.monsterId})</option>}
              {mons.map((m) => <option key={m.id} value={m.id}>{(w.monsters ?? []).some((x) => x.id === m.id) ? '★ ' : ''}{m.name}</option>)}
            </select></label>
            <label>자리<select value={en.zone} onChange={(ev) => up({ enemies: e.enemies.map((x, j) => (j === i ? { ...x, zone: Number(ev.target.value) as 2 | 3 } : x)) })}><option value={2}>전열</option><option value={3}>후열</option></select></label>
            {e.enemies.length > 1 && <button type="button" className="small" aria-label={`적 ${i + 1} 빼기`} onClick={() => up({ enemies: e.enemies.filter((_, j) => j !== i) })}>빼기</button>}
          </div>
        ))}
        <button type="button" className="small" onClick={() => up({ enemies: [...e.enemies, { monsterId: e.enemies.at(-1)?.monsterId ?? mons[0]?.id ?? '', zone: 2 }] })}>＋ 적 더하기</button>
        <p className="small muted">★ = 이 세계만의 적. 능력치는 적 상자나 「조우」 탭에서 고칩니다.</p>
      </fieldset>
      <ConditionField label="일어날 수 있는 조건 (선택)" value={e.when} world={w} optional onChange={(when) => up({ when })} />
      <ConditionField label="반드시 바로 일어나는 조건 (선택 — 매복·결전)" value={e.force} world={w} optional onChange={(force) => up({ force })} />
      <EffectsEditor label="이기면" value={e.onVictory} w={w} onChange={(onVictory) => up({ onVictory })} />
      <EffectsEditor label="지면" value={e.onDefeat} w={w} onChange={(onDefeat) => up({ onDefeat })} />
      <EffectsEditor label="달아나면" value={e.onFlee} w={w} onChange={(onFlee) => up({ onFlee })} />
      <div className="row flow-nums">
        <label>이기면 얻는 돈 (비우면 적에 비례)<input type="number" min={0} value={e.loot?.money ?? ''} placeholder="자동" onChange={(ev) => { const v = ev.target.value; const loot = { ...e.loot }; if (v === '') delete loot.money; else loot.money = Math.max(0, Number(v) || 0); up({ loot: Object.keys(loot).length ? loot : undefined }); }} /></label>
        <label>지거나 달아난 뒤<select value={retry === 'gone' ? 'gone' : retry === 0 ? 'now' : 'wait'} onChange={(ev) => up({ retry: ev.target.value === 'gone' ? 'gone' : ev.target.value === 'now' ? 0 : 3 })}>
          <option value="wait">몇 턴 쉬었다가 다시</option><option value="now">바로 다시</option><option value="gone">다시 일어나지 않음</option>
        </select></label>
        {typeof retry === 'number' && retry > 0 && <label>쉬는 턴<input type="number" min={1} value={retry} onChange={(ev) => up({ retry: Math.max(1, Number(ev.target.value) || 1) })} /></label>}
      </div>
      <p className="small muted">전리품 아이템·밸런스 시험은 「조우」 탭에서 합니다.</p>
    </>
  );
}

// ---------------------------------------------------------------- 성향·관계·평판·수치 정하기 (v0.161)

function SimSettings({ w, state, path, onSet, onReset }: { w: WorldPackage; state: GameState; path: string[]; onSet: (st: SimSetting) => void; onReset: () => void }) {
  const [npc, setNpc] = useState(w.characters[0]?.id ?? '');
  const traits = traitsFor(w);
  const set = path.filter((x) => x.startsWith('set|'));
  const nSet = new globalThis.Set(set.map((x) => settingKey(x))).size;
  const touched = (st: Omit<SimSetting, 'value'>) => set.some((x) => settingKey(x) === settingKey(settingStep({ ...st, value: 0 })));
  // 함수로 부른다 (안에서 컴포넌트를 만들면 그릴 때마다 새로 만들어져 끄는 중에 끊긴다)
  const slider = (key: string, label: string, st: Omit<SimSetting, 'value'>, min = -100, max = 100) => {
    const v = settingValue(w, state, st);
    return (
      <label key={key} className={`flow-slider${touched(st) ? ' set' : ''}`}>
        <span className="small"><span>{label}</span><b>{v}</b></span>
        <input type="range" min={min} max={max} step={5} value={v} onChange={(e) => onSet({ ...st, value: Number(e.target.value) })} />
      </label>
    );
  };
  return (
    <details className="flow-sim-set">
      <summary className="small">🎚 성향·관계·평판·수치 정하기{nSet ? ` — ${nSet}개 정함` : ''}</summary>
      <p className="small muted">이 값에서 무엇이 열리는지 바로 보이고, 「🎲 자동 탐색」도 이 값에서 시작합니다. 정한 것은 걸음으로 남아 되돌리기·처음부터와 함께 움직입니다.</p>
      {traits.length > 0 && <fieldset className="flow-stage"><legend>주인공 성향</legend>
        {traits.map((t) => slider(t.id, `${t.name} (${t.low} ↔ ${t.high})`, { kind: 'trait', id: t.id }))}
      </fieldset>}
      {w.characters.length > 0 && <fieldset className="flow-stage"><legend>인물과의 관계</legend>
        <label>누구와<select value={npc} onChange={(e) => setNpc(e.target.value)}>{w.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {npc && AXES.map((a) => slider(a, AXIS_NAMES[a], { kind: 'rel', id: npc, axis: a }))}
      </fieldset>}
      {(w.factions ?? []).length > 0 && <fieldset className="flow-stage"><legend>세력 평판</legend>
        {w.factions!.map((f) => slider(f.id, f.name, { kind: 'rep', id: f.id }))}
      </fieldset>}
      {(w.vars ?? []).length > 0 && <fieldset className="flow-stage"><legend>세계 수치</legend>
        {w.vars!.map((v) => slider(v.id, v.name, { kind: 'var', id: v.id }, v.min ?? 0, v.max ?? 100))}
      </fieldset>}
      {nSet > 0 && <button type="button" className="small" onClick={onReset}>정한 값 모두 되돌리기</button>}
    </details>
  );
}

// ---------------------------------------------------------------- 시작 · 주인공 (v0.162: ▶ 시작 상자에서 바로)

function StartEditor({ w, set }: { w: WorldPackage; set: SetW }) {
  const st = w.start;
  const up = (p: Partial<WorldPackage['start']>) => set({ start: { ...st, ...p } });
  const items = [...(w.items ?? []), ...STD_ITEMS.filter((i) => !(w.items ?? []).some((x) => x.id === i.id))];
  const bag = st.items ?? [];
  const starts = w.starts ?? [];
  const upS = (i: number, p: Partial<StartOption>) => set({ starts: starts.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const locOpts = w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>);
  return (
    <div className="flow-start-edit">
      <label>시작 장소<select value={st.locationId} onChange={(e) => up({ locationId: e.target.value })}>{locOpts}</select></label>
      <Area label="첫 장면 (플레이어가 눈을 떴을 때)" value={st.openingScene} onChange={(openingScene) => up({ openingScene })} rows={3} />
      <fieldset className="flow-stage"><legend>처음 가진 것</legend>
        <label>소지금<input type="number" min={0} value={st.money ?? ''} placeholder="기본 15" onChange={(e) => up({ money: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })} /></label>
        {bag.map((b, i) => (
          <div key={i} className="row flow-nums">
            <label>물건<select value={b.itemId} onChange={(e) => up({ items: bag.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)) })}>
              {!items.some((x) => x.id === b.itemId) && <option value={b.itemId}>{b.itemId}</option>}
              {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
            <label>개수<input type="number" min={1} value={b.n ?? 1} onChange={(e) => up({ items: bag.map((x, j) => (j === i ? { ...x, n: Math.max(1, Number(e.target.value) || 1) } : x)) })} /></label>
            <button type="button" className="small" aria-label={`물건 ${i + 1} 빼기`} onClick={() => up({ items: bag.filter((_, j) => j !== i).length ? bag.filter((_, j) => j !== i) : undefined })}>빼기</button>
          </div>
        ))}
        <button type="button" className="small" onClick={() => up({ items: [...bag, { itemId: items[0]?.id ?? '', n: 1 }] })}>＋ 물건 더하기</button>
        {!bag.length && <span className="small muted">비우면 치유 물약 1개로 시작합니다.</span>}
      </fieldset>
      <fieldset className="flow-stage"><legend>시작 방식 고르기 (선택 — 새 게임에서 고른다)</legend>
        {starts.map((o, i) => (
          <details key={o.id} className="flow-stage-card">
            <summary><span className="flow-stage-no">{i + 1}</span> {o.name || '(이름 없음)'}</summary>
            <div className="flow-stage-body">
              <Text label="이름" value={o.name} onChange={(name) => upS(i, { name })} />
              <Area label="설명 (플레이어에게 보임)" value={o.description} onChange={(description) => upS(i, { description })} rows={2} />
              <label>시작 장소<select value={o.locationId} onChange={(e) => upS(i, { locationId: e.target.value })}>{locOpts}</select></label>
              <Area label="첫 장면" value={o.openingScene} onChange={(openingScene) => upS(i, { openingScene })} rows={2} />
              <button type="button" className="small" onClick={() => set({ starts: starts.filter((_, j) => j !== i).length ? starts.filter((_, j) => j !== i) : undefined })}>🗑 이 방식 지우기</button>
            </div>
          </details>
        ))}
        <button type="button" className="small" onClick={() => { let n = starts.length + 1; while (starts.some((x) => x.id === `start/${n}`)) n++; set({ starts: [...starts, { id: `start/${n}`, name: `시작 ${n}`, description: '', locationId: st.locationId, openingScene: st.openingScene }] }); }}>＋ 시작 방식 더하기</button>
        <span className="small muted">{starts.length ? '시작 방식이 있으면 새 게임에서 그중 하나를 고르고, 위의 시작 장소·첫 장면 대신 그것을 쓴다.' : '비우면 위의 시작 장소·첫 장면 하나로 시작한다.'}</span>
      </fieldset>
      <details className="flow-sim-edit flow-profile">
        <summary className="small"><b>🧑 주인공 설정</b> — 정보 양식·성향 축 (「세계 설정 › 주인공」과 같다)</summary>
        <ProfileEditor world={w} onChange={(playerProfile) => set({ playerProfile })} onTraits={(traits) => set({ traits })} />
      </details>
      <details className="flow-sim-edit flow-profile">
        <summary className="small"><b>🎓 직업</b> — 주인공이 고르는 직업 ({(w.classes ?? []).length ? `이 세계만의 직업 ${(w.classes ?? []).length}` : '기본 직업'} · 「세계 설정 › 직업」과 같다)</summary>
        <ClassEditor world={w} onChange={(classes) => set({ classes })} />
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- 세력 · 인물 관계 (v0.163)

function FactionEditor({ w, set, id }: { w: WorldPackage; set: SetW; id: string }) {
  const f = w.factions?.find((x) => x.id === id); if (!f) return null;
  const up = (p: Partial<Faction>) => set({ factions: (w.factions ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const members = w.characters.filter((c) => c.faction === id);
  const others = w.characters.filter((c) => c.faction !== id);
  const setMember = (cid: string, on: boolean) => set({ characters: w.characters.map((c) => (c.id === cid ? (on ? { ...c, faction: id } : (({ faction: _f, ...r }) => r)(c)) : c)) });
  return (
    <>
      <Text label="이름" value={f.name} onChange={(name) => up({ name })} />
      <Area label="설명 (소속 인물 연기에 쓰임)" value={f.description} onChange={(description) => up({ description })} rows={2} />
      <label>처음 평판 (-100~100)<input type="number" min={-100} max={100} value={f.reputation ?? 0} onChange={(e) => { const v = Math.max(-100, Math.min(100, Number(e.target.value) || 0)); up({ reputation: v || undefined }); }} /></label>
      <fieldset className="flow-stage"><legend>소속 인물 {members.length}</legend>
        {members.map((c) => <div key={c.id} className="row flow-nums"><span className="flow-holder">👤 {c.name}</span><button type="button" className="small" aria-label={`${c.name} 소속 빼기`} onClick={() => setMember(c.id, false)}>빼기</button></div>)}
        {others.length > 0 && <label>더하기<select value="" onChange={(e) => { if (e.target.value) setMember(e.target.value, true); }}><option value="">인물 고르기…</option>{others.map((c) => <option key={c.id} value={c.id}>{c.name}{c.faction ? ` (지금 ${(w.factions ?? []).find((x) => x.id === c.faction)?.name ?? c.faction})` : ''}</option>)}</select></label>}
        <span className="small muted">소속 인물과 가까워지면 평판이 오르고, 원한을 사면 떨어진다.</span>
      </fieldset>
      <StructField w={w} spec={{ list: SPEC.factionActions }} label="세력 행동 (며칠마다 일어나는 일 — 시간이 흐르면 세계가 움직인다)" value={f.actions ?? []} onChange={(actions) => up({ actions: Array.isArray(actions) && actions.length ? actions as Faction['actions'] : undefined })} rows={6} />
    </>
  );
}

/** 인물 상자 안: 다른 인물과의 관계 · 이 인물의 관계 사건 */
function CharacterRelations({ w, set, id }: { w: WorldPackage; set: SetW; id: string }) {
  const rels = (w.relations ?? []).map((r, i) => [r, i] as const).filter(([r]) => r.a === id || r.b === id);
  const others = w.characters.filter((c) => c.id !== id);
  const beats = (w.relationBeats ?? []).map((b, i) => [b, i] as const).filter(([b]) => b.npcId === id);
  const upRel = (i: number, p: Partial<NonNullable<WorldPackage['relations']>[number]>) => set({ relations: (w.relations ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const upBeat = (i: number, p: Partial<RelationBeat>) => set({ relationBeats: (w.relationBeats ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <>
      <fieldset className="flow-stage"><legend>다른 인물과의 관계 {rels.length}</legend>
        {rels.map(([r, i]) => {
          const other = r.a === id ? r.b : r.a;
          return (
            <div key={i} className="flow-rel">
              <div className="row flow-nums">
                <label>누구와<select value={other} onChange={(e) => upRel(i, r.a === id ? { b: e.target.value } : { a: e.target.value })}>{others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label>관계<select value={r.kind} onChange={(e) => upRel(i, { kind: e.target.value as NpcRelationKind })}>{(Object.entries(RELATION_KIND_LABEL) as [NpcRelationKind, string][]).map(([k, l]) => <option key={k} value={k}>{r.kind === 'master' && k === 'master' && r.b === id ? '제자·부하 (상대가 스승)' : l}</option>)}</select></label>
              </div>
              <div className="row flow-nums">
                <label>한 줄 설명<input value={r.note ?? ''} placeholder="예: 어릴 적 같은 마을" onChange={(e) => upRel(i, { note: e.target.value || undefined })} /></label>
                <button type="button" className="small" aria-label="이 관계 지우기" onClick={() => set({ relations: (w.relations ?? []).filter((_, j) => j !== i) })}>🗑</button>
              </div>
            </div>
          );
        })}
        {others.length > 0 && <button type="button" className="small" onClick={() => set({ relations: [...(w.relations ?? []), { a: id, b: others[0]!.id, kind: 'ally' }] })}>＋ 관계 더하기</button>}
        <span className="small muted">플레이어가 이 인물과 가까워지면 라이벌·원수는 원한이, 가족·동지·연인·스승은 호감이 오른다. 인물 상자를 다른 인물로 끌어도 잇는다.</span>
      </fieldset>
      <fieldset className="flow-stage"><legend>관계 사건 {beats.length} — 조건이 맞으면 열리는 이 인물의 결정적 장면</legend>
        {beats.map(([b, i]) => (
          <details key={b.id} className="flow-stage-card">
            <summary><span className="flow-stage-no">{beats.findIndex(([x]) => x.id === b.id) + 1}</span> {b.name || '(이름 없음)'}</summary>
            <div className="flow-stage-body">
              <Text label="이름" value={b.name} onChange={(name) => upBeat(i, { name })} />
              <ConditionField label="열리는 조건" value={b.condition} world={w} onChange={(condition) => upBeat(i, { condition: condition ?? { all: [] } })} />
              <Area label="GM·인물에게: 장면 방향" value={b.hint} onChange={(hint) => upBeat(i, { hint })} rows={2} />
              <label>다른 곳에 있으면<select value={b.approach ?? 'visit'} onChange={(e) => upBeat(i, { approach: e.target.value === 'visit' ? undefined : e.target.value as RelationBeat['approach'] })}><option value="visit">찾아온다</option><option value="message">전갈을 보낸다</option><option value="none">기다린다</option></select></label>
              <button type="button" className="small" onClick={() => set({ relationBeats: (w.relationBeats ?? []).filter((_, j) => j !== i).length ? (w.relationBeats ?? []).filter((_, j) => j !== i) : undefined })}>🗑 이 사건 지우기</button>
            </div>
          </details>
        ))}
        <button type="button" className="small" onClick={() => { let n = (w.relationBeats ?? []).length + 1; while ((w.relationBeats ?? []).some((x) => x.id === `beat/new-${n}`)) n++; set({ relationBeats: [...(w.relationBeats ?? []), { id: `beat/new-${n}`, npcId: id, name: '새 관계 사건', condition: { relationship: id, axis: 'affinity', gte: 40 }, hint: '' }] }); }}>＋ 관계 사건 더하기</button>
      </fieldset>
    </>
  );
}

