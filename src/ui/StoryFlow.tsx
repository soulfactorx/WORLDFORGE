/**
 * 이야기 흐름도 (v0.142): 임무·분기·조건으로 열리는 것을 한 장의 그림으로. 누르면 옆(휴대폰은 아래)에서 자세히 보고 바로 고친다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Condition, Ending, Quest, StoryEffect, WorldPackage } from '../engine/schema';
import { buildStoryGraph, type FlowDir, START_KEY, layoutGraph, neighbors, NODE_H, NODE_ICON, NODE_LABEL, NODE_W, type GEdge, type GNode, type NodeKind, type StoryGraph } from '../gm/storyGraph';
import { type LinkOption, linkOptions, unlink } from '../gm/flowLink';
import { ConditionField } from './ConditionEditor';
import { Area, Text } from './form';
import { EffectsEditor } from './WorldForms';

type SetW = (patch: Partial<WorldPackage>) => void;
/** 전체 편집 탭 */
export type FlowTab = 'quests' | 'story' | 'scenes' | 'gimmicks' | 'encounters' | 'rules' | 'knowledge';
const TAB_OF: Partial<Record<NodeKind, FlowTab>> = { quest: 'quests', ending: 'quests', flag: 'quests', card: 'story', choice: 'story', arc: 'story', event: 'story', clock: 'story', phase: 'story', scene: 'scenes', gimmick: 'gimmicks', encounter: 'encounters', rule: 'rules', claim: 'knowledge' };
const TAB_NAME: Record<FlowTab, string> = { quests: '임무·플래그·결말', story: '이야기 흐름', scenes: '장면', gimmicks: '함정·퍼즐', encounters: '조우', rules: '세계 규칙', knowledge: '지식' };
const MAIN_KINDS: NodeKind[] = ['quest', 'ending', 'card', 'scene', 'gimmick', 'encounter', 'choice', 'arc', 'event', 'clock', 'rule', 'flag', 'claim', 'phase'];
const DIR_KEY = 'worldforge.flow.dir';
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function StoryFlow({ w, set, onTab }: { w: WorldPackage; set: SetW; onTab: (t: FlowTab) => void }) {
  const graph = useMemo(() => buildStoryGraph(w), [w]);
  const counts = useMemo(() => { const m = new Map<NodeKind, number>(); for (const n of graph.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1); return m; }, [graph]);
  const [hidden, setHidden] = useState<globalThis.Set<NodeKind>>(() => new globalThis.Set<NodeKind>(['claim', 'phase']));
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dir, setDir] = useState<FlowDir>(() => { try { return localStorage.getItem(DIR_KEY) === 'down' ? 'down' : 'right'; } catch { return 'right'; } });
  /** 잇기: 끄는 중 · 누를 상자를 기다리는 중 · 방법 고르기 */
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const [note, setNote] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const selNode = sel ? graph.nodes.find((n) => n.key === sel) ?? null : null;
  useEffect(() => { if (sel && !selNode) setSel(null); }, [selNode]);
  useEffect(() => { try { localStorage.setItem(DIR_KEY, dir); } catch { /* 저장 못 해도 괜찮다 */ } }, [dir]);

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
      if (e.key !== 'Escape' || pending) return; // 방법 고르기 창은 스스로 닫는다
      if (linking || drag) { setLinking(null); setDrag(null); } else setSel(null);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [linking, drag, pending]);

  const toSvg = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };
  const nodeAt = (x: number, y: number) => lay.nodes.find((n) => x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H);
  const dropTarget = drag ? nodeAt(drag.x, drag.y) : undefined;
  const fit = () => { const c = canvasRef.current; if (c) setZoom(Math.max(0.3, Math.min(1, +((c.clientWidth - 4) / lay.width).toFixed(2)))); };
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
          {pins && Object.keys(pins).length > 0 && <button type="button" className="small" onClick={() => { if (confirm(`옮긴 상자 ${Object.keys(pins).length}개를 자동 배치 자리로 되돌릴까요? (${down ? '세로' : '가로'} 방향만)`)) savePins(undefined); }} title="손으로 옮긴 자리를 지우고 자동으로 다시 놓는다">↺ 자동 배치로</button>}
        </div>
        <p className="small muted flow-legend">
          <span className="lg start">— 시작·열림</span> <span className="lg complete">— 끝·결말</span> <span className="lg fail">- - 실패·막힘</span> <span className="lg effect">··· 일으킴(플래그·장면·카드)</span>
          {warns > 0 && <span className="warn-text"> · ⚠ 살펴볼 곳 {warns}</span>}
        </p>
        {linking && <p className="flow-linking small" role="status">🔗 「{byKey(linking)?.name}」과(와) 이을 상자를 누르세요 <button type="button" className="small" onClick={() => setLinking(null)}>그만두기</button></p>}
        {note && <p className="small status" role="status">{note} <button type="button" className="small" onClick={() => setNote('')} aria-label="알림 닫기">✕</button></p>}
      </div>

      {!shown.nodes.length ? <p className="muted">그릴 것이 없습니다. 임무·결말·갈래 카드 등을 만들면 여기에 이어진 모습이 나타납니다.</p> : (
        <div className={`flow-wrap${selNode ? ' with-panel' : ''}${linking ? ' linking' : ''}`}>
          <div ref={canvasRef} className={`flow-canvas${drag ? ' dragging' : ''}${linking ? ' linking' : ''}`} role="region" aria-label="이야기 흐름도">
            <svg ref={svgRef} width={lay.width * zoom} height={lay.height * zoom} viewBox={`0 0 ${lay.width} ${lay.height}`} role="img" aria-label={`노드 ${shown.nodes.length}개, 화살표 ${shown.edges.length}개`}
              onPointerMove={(e) => {
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
                // 가장자리로 끌면 그쪽으로 굴린다
                const c = canvasRef.current; if (!c) return;
                const r = c.getBoundingClientRect(), edge = 36;
                if (e.clientX > r.right - edge) c.scrollLeft += 14; else if (e.clientX < r.left + edge) c.scrollLeft -= 14;
                if (e.clientY > r.bottom - edge) c.scrollTop += 14; else if (e.clientY < r.top + edge) c.scrollTop -= 14;
              }}
              onPointerUp={(e) => {
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
              onPointerCancel={() => { setDrag(null); endMove(); }}
              onContextMenu={(e) => { if (moveRef.current) e.preventDefault(); }}>
              <defs>
                {(['start', 'complete', 'fail', 'effect'] as const).map((k) => (
                  <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className={`flow-arrow ${k}`} /></marker>
                ))}
              </defs>
              {lay.nodes.some((n) => n.layer === -1) && <text x={20} y={Math.min(...lay.nodes.filter((n) => n.layer === -1).map((n) => n.y)) - 12} className="flow-lane">따로 있는 것 (이어진 조건이 없다)</text>}
              {shown.edges.map((e, i) => <Edge key={i} e={e} a={pos.get(e.from)} b={pos.get(e.to)} down={down} active={!!sel && (e.from === sel || e.to === sel)} dim={!!sel && !(e.from === sel || e.to === sel)} />)}
              {/* 겹치면 위에: 옮긴 것 < 고른 것 < 끄는 것 */}
              {[...lay.nodes].sort((x, y) => onTop(x.key) - onTop(y.key)).map((n0) => {
                const at = pos.get(n0.key)!, n = { ...n0, x: at.x, y: at.y };
                const canFrom = n.kind !== 'start';
                const hx = down ? NODE_W / 2 : NODE_W, hy = down ? NODE_H : NODE_H / 2;
                return (
                  <g key={n.key} className={`flow-node k-${n.kind}${n.key === sel ? ' sel' : ''}${n.warn ? ' warn' : ''}${dropTarget?.key === n.key && drag?.from !== n.key ? ' drop' : ''}${linking === n.key || drag?.from === n.key ? ' src' : ''}${(near1 && !near1.has(n.key)) || !hit(n) ? ' dim' : ''}${moving?.key === n.key ? ' moving' : ''}${pins?.[n.key] ? ' pinned' : ''}`} transform={`translate(${n.x},${n.y})`}>
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
                      <text x={10} y={42} className="flow-sub">{short(`${NODE_LABEL[n.kind]}${n.sub ? ` · ${n.sub}` : ''}`, 22)}</text>
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
          {selNode && <NodePanel w={w} set={set} g={graph} n={selNode} onPick={setSel} onClose={() => setSel(null)} onTab={onTab} onLink={() => { setLinking(selNode.key); setNote(''); }} onNote={setNote} />}
        </div>
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
                {conds.length > 0 && <optgroup label={`「${b.name}」의 조건에 넣기`}>{conds.map(([o, k]) => <option key={k} value={k}>{o.label}</option>)}</optgroup>}
                {fxs.length > 0 && <optgroup label={`「${a.name}」의 효과로 일으키기`}>{fxs.map(([o, k]) => <option key={k} value={k}>{o.label}</option>)}</optgroup>}
              </select>
            </label>
            <p className="small muted">{opts[i]?.group === 'effect' ? '앞 상자의 효과에 더합니다 — 그 일이 일어나면 바로 뒤 상자가 일어납니다.' : '뒤 상자의 조건에 「그리고」로 더합니다 — 원래 있던 조건도 함께 맞아야 합니다. 「또는」로 바꾸려면 상자를 눌러 조건 칸에서 고치세요.'}</p>
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

function Edge({ e, a, b, active, dim, down }: { e: GEdge; a?: { x: number; y: number }; b?: { x: number; y: number }; active: boolean; dim: boolean; down: boolean }) {
  if (!a || !b) return null;
  let d: string, lx: number, ly: number;
  if (down) {
    const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
    const backward = y2 <= y1;
    d = backward ? `M${x1},${y1} C${x1 - 90},${y1 + 60} ${x2 - 90},${y2 - 60} ${x2},${y2}` : `M${x1},${y1} C${x1},${y1 + (y2 - y1) / 2} ${x2},${y1 + (y2 - y1) / 2} ${x2},${y2}`;
    lx = (x1 + x2) / 2 - (backward ? 60 : 0); ly = (y1 + y2) / 2;
  } else {
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
    // 뒤로 가는 화살표(같은 단·앞 단)는 위로 크게 돌아간다
    const backward = x2 <= x1;
    d = backward ? `M${x1},${y1} C${x1 + 60},${y1 - 70} ${x2 - 60},${y2 - 70} ${x2},${y2}` : `M${x1},${y1} C${x1 + (x2 - x1) / 2},${y1} ${x1 + (x2 - x1) / 2},${y2} ${x2},${y2}`;
    lx = (x1 + x2) / 2; ly = (y1 + y2) / 2 - (backward ? 52 : 6);
  }
  const cls = e.kind === 'fail' ? 'fail' : e.kind === 'effect' ? 'effect' : e.kind === 'start' ? 'start' : 'complete';
  return (
    <g className={`flow-edge ${cls}${active ? ' active' : ''}${dim ? ' dim' : ''}`}>
      <path d={d} markerEnd={`url(#arrow-${cls})`} />
      {active && <text x={lx} y={ly} className="flow-label" textAnchor="middle">{short(e.label.replace(/^→ /, ''), 26)}</text>}
    </g>
  );
}

/** 고른 노드: 이어진 것 · 바로 고치기 · 다음 것 만들기 */
function NodePanel({ w, set, g, n, onPick, onClose, onTab, onLink, onNote }: { w: WorldPackage; set: SetW; g: StoryGraph; n: GNode; onPick: (k: string) => void; onClose: () => void; onTab: (t: FlowTab) => void; onLink: () => void; onNote: (s: string) => void }) {
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
  const after: Condition | null = n.kind === 'quest' ? { questDone: n.id } : n.kind === 'scene' || n.kind === 'gimmick' ? { sceneEnd: n.id, outcome: 'success' } : n.kind === 'encounter' ? { cleared: n.id } : n.kind === 'card' ? { storylet: n.id } : n.kind === 'choice' ? { choice: n.id } : n.kind === 'flag' ? { flag: n.id } : n.kind === 'claim' ? { knows: n.id } : null;
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
        {ins.length ? <ul className="flow-links">{ins.map((e, i) => <li key={i}><button type="button" className="small" onClick={() => onPick(e.from)}>{nameOf(e.from)}</button> <span className="small muted">{e.label.replace(/^→ /, '')}</span>{cutBtn(e)}</li>)}</ul> : <p className="small muted">없음 — 처음부터 열려 있거나 조건이 다른 것(장소·관계·날짜 등)이다.</p>}
      </details>
      <details open><summary className="small"><b>이것이 여는 것 {outs.length}</b></summary>
        {outs.length ? <ul className="flow-links">{outs.map((e, i) => <li key={i}><button type="button" className="small" onClick={() => onPick(e.to)}>{nameOf(e.to)}</button> <span className="small muted">{e.label.replace(/^→ /, '')}</span>{cutBtn(e)}</li>)}</ul> : <p className="small muted">없음</p>}
      </details>

      <div className="flow-edit">
        <NodeEditor w={w} set={set} n={n} />
      </div>

      <div className="flow-actions">
        {n.kind !== 'start' && <button type="button" onClick={onLink} title="상자의 ● 손잡이를 다른 상자로 끌어도 됩니다">🔗 다른 상자와 잇기</button>}
        {after && <button type="button" onClick={() => {
          const id = newId('quest/next-', w.quests ?? []);
          const q: Quest = { id, name: `${n.name} 다음`, kind: 'side', start: after, stages: [{ objective: '할 일을 적어 주세요', hint: '', complete: { all: [] } }] };
          set({ quests: [...(w.quests ?? []), q] }); onPick(`quest:${id}`);
        }}>＋ 이것 다음에 열리는 임무</button>}
        {after && <button type="button" onClick={() => {
          const id = newId('ending/', w.endings ?? []);
          const e: Ending = { id, name: `${n.name}의 끝`, condition: after, epilogue: '' };
          set({ endings: [...(w.endings ?? []), e] }); onPick(`ending:${id}`);
        }}>＋ 이것으로 이르는 결말</button>}
        {tab && <button type="button" className="small" onClick={() => onTab(tab)}>전체 편집 — 「{TAB_NAME[tab]}」 탭</button>}
      </div>
    </aside>
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
          <Text label="이름" value={s.name} onChange={(name) => up({ name })} />
          <ConditionField label="열리는 조건 (선택)" value={s.start} world={w} optional onChange={(start) => up({ start })} />
          {n.kind === 'scene' && s.ends.map((e, i) => (
            <EffectsEditor key={e.id} label={`끝 「${e.name}」에 일어나는 일`} value={e.effects} w={w} onChange={(effects) => up({ ends: s.ends.map((x, j) => (j === i ? { ...x, effects } : x)) })} />
          ))}
          {n.kind === 'gimmick' && <p className="small muted">함정·퍼즐의 판정·보상은 「함정·퍼즐」 탭에서 고칩니다.</p>}
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
    case 'start': return <p className="small muted">플레이어가 게임을 시작할 때의 자리입니다. 여기서 이어지는 상자는 다른 상자에 걸린 조건이 없어 처음부터 열려 있거나(장소·관계·날짜 같은 조건만 있는 것 포함) 그런 것들입니다. 순서를 만들려면 그 상자의 ● 손잡이를 끌거나, 앞 상자를 골라 「🔗 다른 상자와 잇기」를 누르세요.</p>;
    case 'flag': return <p className="small muted">플래그는 효과(「세움」)로 세우고 조건(「섬」)으로 읽는 표시입니다. 위의 「여는 것 · 열리는 것」에서 세우는 곳과 읽는 곳을 보고, 그 상자를 눌러 고치세요.</p>;
    case 'claim': return <p className="small">{w.claims.find((c) => c.id === n.id)?.statement ?? n.id}</p>;
    default: return <p className="small muted">이 종류는 전체 편집 탭에서 고칩니다.</p>;
  }
}
