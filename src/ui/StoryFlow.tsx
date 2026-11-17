/**
 * 이야기 흐름도 (v0.142): 임무·분기·조건으로 열리는 것을 한 장의 그림으로. 누르면 옆(휴대폰은 아래)에서 자세히 보고 바로 고친다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Character, Condition, CustomMonster, Ending, ItemDef, Location, Quest, StoryEffect, WorldPackage } from '../engine/schema';
import { setLink } from '../engine/locationLinks';
import { buildStoryGraph, type FlowDir, isLane, openCondition, START_KEY, layoutGraph, neighbors, NODE_H, NODE_ICON, NODE_LABEL, NODE_W, type GEdge, type GNode, type NodeKind, type StoryGraph } from '../gm/storyGraph';
import { edgeSlots, firstLeaf, getCond, getEffects, type LinkOption, linkOptions, replaceLeaf, setCond, setEffects, sourceWays, unlink } from '../gm/flowLink';
import { type ExploreReport, nodeSim, type NodeSim, simActs, simExplore, simIcon, simMove, type SimPath, simReplay, simStart, wantedPlaces } from '../gm/flowSim';
import { condTrace } from '../gm/lab';
import type { GameState } from '../engine/state/state';
import { TraceView } from './WorldLab';
import { GIMMICK_DEFAULTS, GimmickForm } from './GimmickForms';
import { newSceneDef } from './SceneForms';
import { GIMMICK_KINDS, gimmickScene } from '../engine/gimmick';
import type { Gimmick, SceneDef } from '../engine/schema';
import { ConditionField } from './ConditionEditor';
import { Area, Text } from './form';
import { EffectsEditor } from './WorldForms';

type SetW = (patch: Partial<WorldPackage>) => void;
/** 전체 편집 탭 */
export type FlowTab = 'quests' | 'story' | 'scenes' | 'gimmicks' | 'encounters' | 'rules' | 'knowledge' | 'locations' | 'characters' | 'items';
const TAB_OF: Partial<Record<NodeKind, FlowTab>> = { quest: 'quests', ending: 'quests', flag: 'quests', card: 'story', choice: 'story', arc: 'story', event: 'story', clock: 'story', phase: 'story', scene: 'scenes', gimmick: 'gimmicks', encounter: 'encounters', rule: 'rules', claim: 'knowledge', location: 'locations', character: 'characters', item: 'items', monster: 'encounters' };
const TAB_NAME: Record<FlowTab, string> = { quests: '임무·플래그·결말', story: '이야기 흐름', scenes: '장면', gimmicks: '함정·퍼즐', encounters: '조우', rules: '세계 규칙', knowledge: '지식', locations: '장소', characters: '인물', items: '아이템·상점' };
const MAIN_KINDS: NodeKind[] = ['quest', 'ending', 'card', 'scene', 'gimmick', 'encounter', 'choice', 'arc', 'event', 'clock', 'rule', 'flag', 'claim', 'phase', 'location', 'character', 'item', 'monster'];
const DIR_KEY = 'worldforge.flow.dir';
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function StoryFlow({ w, set, onTab }: { w: WorldPackage; set: SetW; onTab: (t: FlowTab) => void }) {
  const graph = useMemo(() => buildStoryGraph(w), [w]);
  const counts = useMemo(() => { const m = new Map<NodeKind, number>(); for (const n of graph.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1); return m; }, [graph]);
  const [hidden, setHidden] = useState<globalThis.Set<NodeKind>>(() => new globalThis.Set<NodeKind>(graph.nodes.length > 40 ? ['claim', 'phase', 'location', 'character', 'item', 'monster'] : ['claim', 'phase'])); // 큰 세계는 장소·인물을 처음엔 숨긴다
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
      if (linking || drag) { setLinking(null); setDrag(null); } else setSel(null);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [linking, drag, pending, edgeSel]);

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
    <div className="story-flow">
      <p className="muted small">세계의 <b>임무·결말·갈래 카드·장면·함정·전투·결정적 선택·사건</b>이 어떤 조건으로 이어지는지 그린 지도입니다. <b>▶ 플레이 시작</b>에서 출발해 {down ? '아래로' : '오른쪽으로'} 흘러가 맨 끝의 <b>◆ 결말</b>에 이릅니다. 화살표 <b>A → B</b>는 "A가 끝나거나(고르거나 · 세우면) B가 열린다"는 뜻입니다. 상자를 누르면 자세히 보고 고치며, 상자의 <b>●</b> 손잡이를 다른 상자로 끌면 둘을 잇습니다. 상자를 끌면(휴대폰은 길게 누른 뒤 끌면) 자리를 옮기고, 옮긴 자리는 세계와 함께 저장됩니다.</p>
      <div className="flow-toolbar">
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
          <span className="row flow-zoom">
            <button type="button" className="small" aria-label="작게" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)))}>−</button>
            <button type="button" className="small" onClick={() => setZoom(1)} title="100%로">{Math.round(zoom * 100)}%</button>
            <button type="button" className="small" aria-label="크게" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}>＋</button>
            <button type="button" className="small" onClick={fit} title="화면 폭에 맞추기">⤢ 맞춤</button>
          </span>
          <button type="button" className={`small${sim ? ' on' : ''}`} aria-pressed={!!sim} onClick={() => { if (sim) { setSim(null); cancelExplore.current = true; } else { simGo([]); setLinking(null); } }} title="흐름도 위에서 이야기를 직접 진행해 보고, 자동으로 여러 번 끝까지 해 본다">{sim ? '■ 시뮬레이션 끝내기' : '🧪 시뮬레이션'}</button>
          {pins && Object.keys(pins).length > 0 && <button type="button" className="small" onClick={() => { if (confirm(`옮긴 상자 ${Object.keys(pins).length}개를 자동 배치 자리로 되돌릴까요? (${down ? '세로' : '가로'} 방향만)`)) savePins(undefined); }} title="손으로 옮긴 자리를 지우고 자동으로 다시 놓는다">↺ 자동 배치로</button>}
        </div>
        <p className="small muted flow-legend">
          <span className="lg start">— 시작·열림</span> <span className="lg complete">— 끝·결말</span> <span className="lg fail">- - 실패·막힘</span> <span className="lg effect">··· 일으킴(플래그·장면·카드)</span>
          {warns > 0 && <span className="warn-text"> · ⚠ 살펴볼 곳 {warns}</span>}
        </p>
        {empty && (
          <div className="flow-empty" role="note">
            <b>🗺 흐름도에서 이야기 만들기</b>
            <ol className="small">
              <li><b>▶ 플레이 시작</b>에서 처음 열릴 것을 만드세요 — 첫 임무·갈래 카드·결정적 선택.</li>
              <li>만든 상자를 고르고 <b>「＋ 이것 다음에 열리는 임무」</b>로 이야기를 이어 가고, 갈라지는 곳은 선택지·카드의 갈림길로 만드세요.</li>
              <li>끝에는 <b>「＋ 이것으로 이르는 결말」</b>. 상자의 ● 손잡이를 끌어 잇고, 화살표를 눌러 조건을 고칩니다.</li>
              <li><b>＋ 장면 · ＋ 함정·퍼즐</b>은 판정으로 풀어 가는 고비입니다 — 성공·실패에 따라 다음이 갈라집니다.</li>
              <li><b>＋ 장소 · ＋ 인물 · ＋ 아이템 · ＋ 적</b>은 흐름 아래 띠에 놓입니다. 장소를 이야기 상자로 끌면 「여기 있으면 열림」 「여기서 일어남」이 됩니다.</li>
              <li>다 되면 <b>🧪 시뮬레이션</b>으로 끝까지 가 보세요.</li>
            </ol>
            <div className="row flow-empty-actions">{startCreators(w, set, setSel).map((c) => <button key={c.label} type="button" onClick={c.run}>{c.label}</button>)}
              <SceneAdd w={w} set={set} onPick={setSel} scene="＋ 장면" gimmick="＋ 함정·퍼즐" /></div>
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
                  void simExplore(w, graph, { runs: 100, seed: Date.now() % 100000, onProgress: (d, t) => setExploring(`${Math.round((d / t) * 100)}%`), cancelled: () => cancelExplore.current })
                    .then((r) => { setReport(r); setExploring(''); });
                }} title="무작위로 100번 끝까지 해 본다 (AI 없이 엔진만)">🎲 자동 탐색 100번</button>}
            </div>
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
        <div className={`flow-wrap${selNode ? ' with-panel' : ''}${linking ? ' linking' : ''}`}>
          <div ref={canvasRef} className={`flow-canvas${drag ? ' dragging' : ''}${linking ? ' linking' : ''}`} role="region" aria-label="이야기 흐름도">
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
              {lay.nodes.some((n) => n.layer === -2) && <text x={20} y={Math.min(...lay.nodes.filter((n) => n.layer === -2).map((n) => n.y)) - 12} className="flow-lane">📍 장소 · 👤 인물 · 🎒 아이템 · 👾 적 — 눌러서 고치고, 끌어서 이야기 상자와 이으면 「여기 있으면」 「가지고 있으면」 「쓰러뜨리면」이 됩니다</text>}
              {lay.nodes.some((n) => n.layer === -1) && <text x={20} y={Math.min(...lay.nodes.filter((n) => n.layer === -1).map((n) => n.y)) - 12} className="flow-lane">따로 있는 것 (이어진 조건이 없다)</text>}
              {shown.edges.map((e, i) => ((isLane(e.from) || isLane(e.to)) && !(sel && (e.from === sel || e.to === sel)) && !(edgeSel?.from === e.from && edgeSel.to === e.to)) ? null : <Edge key={i} e={e} a={pos.get(e.from)} b={pos.get(e.to)} down={down} active={(!!sel && (e.from === sel || e.to === sel)) || (edgeSel?.from === e.from && edgeSel.to === e.to)} dim={!!sel && !(e.from === sel || e.to === sel)} onPick={() => { if (!drag && !moveRef.current) setEdgeSel(e); }} />)}
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
                      <text x={10} y={42} className="flow-sub">{simMap?.get(n.key)?.st && simMap.get(n.key)!.st !== 'none' ? short(`${simIcon(simMap.get(n.key)!.st)} ${simMap.get(n.key)!.text}`, 22) : short(`${NODE_LABEL[n.kind]}${n.sub ? ` · ${n.sub}` : ''}`, 22)}</text>
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
              {drag && (() => {
                const a = pos.get(drag.from); if (!a) return null;
                const x1 = down ? a.x + NODE_W / 2 : a.x + NODE_W, y1 = down ? a.y + NODE_H : a.y + NODE_H / 2;
                return <line x1={x1} y1={y1} x2={drag.x} y2={drag.y} className="flow-drag-line" markerEnd="url(#arrow-start)" />;
              })()}
            </svg>
          </div>
          {selNode && (sim ? <SimPanel w={w} set={set} n={selNode} state={sim.state} info={simMap?.get(selNode.key)} never={neverSet.has(selNode.key)} onClose={() => setSel(null)}
            onAct={(id, label) => {
              const act = simActs(w, sim.state, selNode).find((a) => a.id === id); if (!act) return;
              const r = act.run(w, sim.state);
              if (r.error) { setNote(`❌ ${r.error}`); return; }
              setSim({ path: [...sim.path, `${selNode.key}|${id}`], state: r.state, lines: [...sim.lines, `▸ ${selNode.name}: ${label}`, ...r.lines.map((x) => `   ${x}`)] });
            }} />
            : <NodePanel w={w} set={set} g={graph} n={selNode} onPick={setSel} onClose={() => setSel(null)} onTab={onTab} onLink={() => { setLinking(selNode.key); setNote(''); }} onNote={setNote} onEdge={setEdgeSel} />)}
        </div>
      )}
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

function Edge({ e, a, b, active, dim, down, onPick }: { e: GEdge; a?: { x: number; y: number }; b?: { x: number; y: number }; active: boolean; dim: boolean; down: boolean; onPick: () => void }) {
  if (!a || !b) return null;
  let d: string, lx: number, ly: number;
  if (down) {
    const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
    const backward = y2 <= y1;
    // 여러 단을 건너는 화살표는 옆으로 휘어 사이의 상자를 비켜 간다
    const bow = backward ? 0 : Math.min(150, Math.max(0, Math.round((y2 - y1) / (NODE_H + 56))) * 120);
    d = backward ? `M${x1},${y1} C${x1 - 90},${y1 + 60} ${x2 - 90},${y2 - 60} ${x2},${y2}` : `M${x1},${y1} C${x1 - bow},${y1 + (y2 - y1) / 2} ${x2 - bow},${y1 + (y2 - y1) / 2} ${x2},${y2}`;
    lx = (x1 + x2) / 2 - (backward ? 60 : 0); ly = (y1 + y2) / 2;
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
    lx = (x1 + x2) / 2; ly = bow ? top + 10 : (y1 + y2) / 2 - (backward ? 52 : 6);
  }
  const cls = e.kind === 'place' ? 'place' : e.kind === 'fail' ? 'fail' : e.kind === 'effect' ? 'effect' : e.kind === 'start' ? 'start' : 'complete';
  return (
    <g className={`flow-edge ${cls}${active ? ' active' : ''}${dim ? ' dim' : ''}`}>
      <path d={d} markerEnd={`url(#arrow-${cls})`} />
      {/* 누르기 쉽게 넓은 투명 선 (v0.145): 누르면 연결 조건을 고친다 */}
      <path d={d} className="flow-edge-hit" onClick={onPick}><title>{`${e.label.replace(/^→ /, '')}\n누르면 이 연결을 고칩니다`}</title></path>
      {active && <text x={lx} y={ly} className="flow-label" textAnchor="middle">{short(e.label.replace(/^→ /, ''), 26)}</text>}
    </g>
  );
}

/** 고른 노드: 이어진 것 · 바로 고치기 · 다음 것 만들기 */
function NodePanel({ w, set, g, n, onPick, onClose, onTab, onLink, onNote, onEdge }: { w: WorldPackage; set: SetW; g: StoryGraph; n: GNode; onPick: (k: string) => void; onClose: () => void; onTab: (t: FlowTab) => void; onLink: () => void; onNote: (s: string) => void; onEdge: (e: GEdge) => void }) {
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
  const after: Condition | null = n.kind === 'quest' ? { questDone: n.id } : n.kind === 'scene' || n.kind === 'gimmick' ? { sceneEnd: n.id, outcome: 'success' } : n.kind === 'encounter' ? { cleared: n.id } : n.kind === 'card' ? { storylet: n.id } : n.kind === 'choice' ? { choice: n.id } : n.kind === 'flag' ? { flag: n.id } : n.kind === 'claim' ? { knows: n.id } : n.kind === 'location' ? { at: n.id } : null;
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
        <NodeEditor w={w} set={set} n={n} />
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
          return <button type="button" onClick={() => { const id = newId('quest/next-', w.quests ?? []); set(newQuest(w, id, `${n.name} ${n.kind === 'item' ? '얻은 뒤' : '쓰러뜨린 뒤'}`, 'side', cond)); onPick(`quest:${id}`); }}>{n.kind === 'item' ? '＋ 이것을 가지면 열리는 임무' : '＋ 이것을 쓰러뜨리면 열리는 임무'}</button>;
        })()}
        {n.kind === 'start' && startCreators(w, set, onPick).map((c) => <button key={c.label} type="button" onClick={c.run}>{c.label}</button>)}
        {n.kind === 'start' && <SceneAdd w={w} set={set} onPick={onPick} scene="＋ 처음부터 열리는 장면" gimmick="＋ 함정·퍼즐" />}
        {n.kind === 'location' && <SceneAdd w={w} set={set} onPick={onPick} at={n.id} scene="＋ 이곳에서 일어나는 장면" gimmick="＋ 이곳의 함정·퍼즐" />}
        {after && n.kind !== 'location' && n.kind !== 'start' && <SceneAdd w={w} set={set} onPick={onPick} start={after} scene="＋ 이것 다음에 열리는 장면" gimmick="＋ 다음에 나오는 함정·퍼즐" />}
        {after && <button type="button" onClick={() => {
          const id = newId('quest/next-', w.quests ?? []);
          set(newQuest(w, id, `${n.name} 다음`, 'side', after)); onPick(`quest:${id}`);
        }}>{n.kind === 'location' ? '＋ 이곳에 오면 열리는 임무' : '＋ 이것 다음에 열리는 임무'}</button>}
        {after && n.kind !== 'location' && <button type="button" onClick={() => {
          const id = newId('ending/', w.endings ?? []);
          const e: Ending = { id, name: `${n.name}의 끝`, condition: after, epilogue: '' };
          set({ endings: [...(w.endings ?? []), e] }); onPick(`ending:${id}`);
        }}>＋ 이것으로 이르는 결말</button>}
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
    { label: '＋ 장소', run: () => { const l = newPlace(w); set({ locations: l.locations }); onPick(`location:${l.id}`); } },
    { label: '＋ 인물', run: () => { const c = newPerson(w, w.start.locationId); set({ characters: [...w.characters, c] }); onPick(`character:${c.id}`); } },
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
function SimPanel({ w, set, n, state, info, never, onAct, onClose }: { w: WorldPackage; set: SetW; n: GNode; state: GameState; info?: NodeSim; never: boolean; onAct: (id: string, label: string) => void; onClose: () => void }) {
  const acts = simActs(w, state, n);
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
      {acts.length > 0 ? (
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
      </ul>
      <p className="small muted">무작위로 고른 길이라 매번 조금 다릅니다. GM이 세우는 플래그는 가끔만 세우고, 조건을 무시하는 「억지로」 일은 하지 않습니다. 잠긴 상자가 바라는 장소(★)로는 옮겨 가 보지만, 관계·성향·날짜 조건은 시작 상태 그대로 봅니다.</p>
    </div>
  );
}

/** 종류마다 자주 고치는 칸 (나머지는 전체 편집 탭에서) */
function NodeEditor({ w, set, n }: { w: WorldPackage; set: SetW; n: GNode }) {
  const upd = <T extends { id: string }>(list: T[] | undefined, patch: Partial<T>) => (list ?? []).map((x) => (x.id === n.id ? { ...x, ...patch } : x));
  switch (n.kind) {
    case 'quest': {
      const q = w.quests?.find((x) => x.id === n.id); if (!q) return null;
      const up = (p: Partial<Quest>) => set({ quests: upd(w.quests, p) });
      return (
        <>
          <Text label="이름" value={q.name} onChange={(name) => up({ name })} />
          <label>종류<select value={q.kind} onChange={(e) => up({ kind: e.target.value as Quest['kind'] })}><option value="main">메인</option><option value="side">사이드</option></select></label>
          <Area label="왜 해야 하나" value={q.motive} onChange={(motive) => up({ motive: motive || undefined })} rows={2} />
          <ConditionField label="시작 조건" value={q.start} world={w} onChange={(start) => up({ start: start ?? { all: [] } })} />
          {q.stages.map((st, i) => (
            <fieldset key={i} className="flow-stage"><legend>{i + 1}단계</legend>
              <Text label="할 일" value={st.objective} onChange={(objective) => up({ stages: q.stages.map((x, j) => (j === i ? { ...x, objective } : x)) })} />
              <ConditionField label="끝나는 조건" value={st.complete} world={w} completion onChange={(complete) => up({ stages: q.stages.map((x, j) => (j === i ? { ...x, complete: complete ?? { all: [] } } : x)) })} />
              {q.stages.length > 1 && <button type="button" className="small" onClick={() => up({ stages: q.stages.filter((_, j) => j !== i) })}>🗑 이 단계 지우기</button>}
            </fieldset>
          ))}
          <button type="button" className="small" onClick={() => up({ stages: [...q.stages, { objective: '새 단계', hint: '', complete: { all: [] } }] })}>＋ 단계 더하기</button>
          <ConditionField label="실패 조건 (선택)" value={q.fail} world={w} optional onChange={(fail) => up({ fail })} />
        </>
      );
    }
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
    case 'card': {
      const c = w.storylets?.find((x) => x.id === n.id); if (!c) return null;
      const up = (p: Partial<typeof c>) => set({ storylets: upd(w.storylets, p) });
      return (
        <>
          <Text label="제목" value={c.title} onChange={(title) => up({ title })} />
          <Area label="상황" value={c.situation} onChange={(situation) => up({ situation })} rows={3} />
          <ConditionField label="덱에 들어오는 조건 (선택)" value={c.when} world={w} optional onChange={(when) => up({ when })} />
          {c.options.map((o, i) => (
            <fieldset key={o.id} className="flow-stage"><legend>갈림길 {i + 1}</legend>
              <Text label="선택지" value={o.label} onChange={(label) => up({ options: c.options.map((x, j) => (j === i ? { ...x, label } : x)) })} />
              <EffectsEditor label="고르면 (성공)" value={o.success} w={w} onChange={(success) => up({ options: c.options.map((x, j) => (j === i ? { ...x, success } : x)) })} />
            </fieldset>
          ))}
        </>
      );
    }
    case 'choice': {
      const c = w.choices?.find((x) => x.id === n.id); if (!c) return null;
      const up = (p: Partial<typeof c>) => set({ choices: upd(w.choices, p) });
      return (
        <>
          <Text label="이름" value={c.name} onChange={(name) => up({ name })} />
          <ConditionField label="열리는 조건" value={c.when} world={w} onChange={(when) => up({ when: when ?? { all: [] } })} />
          {c.options.map((o, i) => (
            <fieldset key={o.id} className="flow-stage"><legend>선택 {i + 1}</legend>
              <Text label="선택지" value={o.text} onChange={(text) => up({ options: c.options.map((x, j) => (j === i ? { ...x, text } : x)) })} />
              <EffectsEditor label="고르면" value={o.effects} w={w} onChange={(effects: StoryEffect[]) => up({ options: c.options.map((x, j) => (j === i ? { ...x, effects } : x)) })} />
            </fieldset>
          ))}
        </>
      );
    }
    case 'scene': case 'gimmick': {
      const s = w.scenes?.find((x) => x.id === n.id); if (!s) return null;
      const up = (p: Partial<typeof s>) => set({ scenes: upd(w.scenes, p) });
      return (
        <>
          <ConditionField label="열리는 조건 (선택)" value={s.start} world={w} optional onChange={(start) => up({ start })} />
          {n.kind === 'gimmick' ? (
            // 함정·퍼즐: 탭과 같은 양식 (바꿀 때마다 장면을 다시 만든다 — 열리는 조건은 지킨다)
            <div className="flow-gimmick-form"><GimmickForm w={w} d={s} onChange={(nd) => set({ scenes: (w.scenes ?? []).map((x) => (x.id === s.id ? nd : x)) })} /></div>
          ) : (
            <>
              <Text label="이름" value={s.name} onChange={(name) => up({ name })} />
              <Area label="설명 (GM용 — 어떤 장면인가)" value={s.description} onChange={(description) => up({ description })} rows={2} />
              <label>장소<select value={s.locationId ?? ''} onChange={(e) => up({ locationId: e.target.value || undefined })}>
                <option value="">어디서나</option>
                {w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
              {s.ends.map((e, i) => (
                <EffectsEditor key={e.id} label={`끝 「${e.name}」(${{ success: '성공', failure: '실패', neutral: '보통' }[e.outcome]})에 일어나는 일`} value={e.effects} w={w} onChange={(effects) => up({ ends: s.ends.map((x, j) => (j === i ? { ...x, effects } : x)) })} />
              ))}
              <p className="small muted">수치·행동·끝나는 때는 「장면」 탭에서 고치고 바로 테스트할 수 있습니다.</p>
            </>
          )}
        </>
      );
    }
    case 'encounter': {
      const e = w.encounters?.find((x) => x.id === n.id); if (!e) return null;
      const up = (p: Partial<typeof e>) => set({ encounters: upd(w.encounters, p) });
      return (
        <>
          <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
          <Area label="GM에게: 언제 일어나는가" value={e.trigger} onChange={(trigger) => up({ trigger })} rows={2} />
          <ConditionField label="일어날 수 있는 조건 (선택)" value={e.when} world={w} optional onChange={(when) => up({ when })} />
        </>
      );
    }
    case 'event': {
      const e = w.events?.find((x) => x.id === n.id); if (!e) return null;
      const up = (p: Partial<typeof e>) => set({ events: upd(w.events, p) });
      return (
        <>
          <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
          <ConditionField label="일어나는 조건 (선택)" value={e.when.condition} world={w} optional onChange={(condition) => up({ when: { ...e.when, ...(condition ? { condition } : { condition: undefined }) } })} />
          <EffectsEditor label="일어나는 일" value={e.effects} w={w} onChange={(effects) => up({ effects })} />
        </>
      );
    }
    case 'start': return <p className="small muted">플레이어가 게임을 시작할 때의 자리입니다. 여기서 이어지는 상자는 다른 상자에 걸린 조건이 없어 처음부터 열려 있는 것들입니다(장소·관계·날짜 같은 조건만 있는 것 포함). 이 상자의 ● 손잡이를 다른 상자로 끌면 그 상자를 처음부터 열리게 하고(열리는 조건을 비운다), 아래 버튼으로 처음부터 열리는 새 임무·카드·선택을 만듭니다.</p>;
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
        </>
      );
    }
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
    case 'flag': return <p className="small muted">플래그는 효과(「세움」)로 세우고 조건(「섬」)으로 읽는 표시입니다. 위의 「여는 것 · 열리는 것」에서 세우는 곳과 읽는 곳을 보고, 그 상자를 눌러 고치세요.</p>;
    case 'claim': return <p className="small">{w.claims.find((c) => c.id === n.id)?.statement ?? n.id}</p>;
    default: return <p className="small muted">이 종류는 전체 편집 탭에서 고칩니다.</p>;
  }
}
