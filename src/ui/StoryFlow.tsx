/**
 * 이야기 흐름도 (v0.142): 임무·분기·조건으로 열리는 것을 한 장의 그림으로. 누르면 옆(휴대폰은 아래)에서 자세히 보고 바로 고친다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Condition, Ending, Quest, StoryEffect, WorldPackage } from '../engine/schema';
import { buildStoryGraph, layoutGraph, neighbors, NODE_H, NODE_ICON, NODE_LABEL, NODE_W, type GEdge, type GNode, type NodeKind, type StoryGraph } from '../gm/storyGraph';
import { ConditionField } from './ConditionEditor';
import { Area, Text } from './form';
import { EffectsEditor } from './WorldForms';

type SetW = (patch: Partial<WorldPackage>) => void;
/** 전체 편집 탭 */
export type FlowTab = 'quests' | 'story' | 'scenes' | 'gimmicks' | 'encounters' | 'rules' | 'knowledge';
const TAB_OF: Partial<Record<NodeKind, FlowTab>> = { quest: 'quests', ending: 'quests', flag: 'quests', card: 'story', choice: 'story', arc: 'story', event: 'story', clock: 'story', phase: 'story', scene: 'scenes', gimmick: 'gimmicks', encounter: 'encounters', rule: 'rules', claim: 'knowledge' };
const TAB_NAME: Record<FlowTab, string> = { quests: '임무·플래그·결말', story: '이야기 흐름', scenes: '장면', gimmicks: '함정·퍼즐', encounters: '조우', rules: '세계 규칙', knowledge: '지식' };
const MAIN_KINDS: NodeKind[] = ['quest', 'ending', 'card', 'scene', 'gimmick', 'encounter', 'choice', 'arc', 'event', 'clock', 'rule', 'flag', 'claim', 'phase'];
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function StoryFlow({ w, set, onTab }: { w: WorldPackage; set: SetW; onTab: (t: FlowTab) => void }) {
  const graph = useMemo(() => buildStoryGraph(w), [w]);
  const counts = useMemo(() => { const m = new Map<NodeKind, number>(); for (const n of graph.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1); return m; }, [graph]);
  const [hidden, setHidden] = useState<globalThis.Set<NodeKind>>(() => new globalThis.Set<NodeKind>(['claim', 'phase']));
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [zoom, setZoom] = useState(1);
  const selNode = sel ? graph.nodes.find((n) => n.key === sel) ?? null : null;
  useEffect(() => { if (sel && !selNode) setSel(null); }, [selNode]);

  // 보이는 것: 종류 거르기 · (고른 것의 이웃만) — 거른 뒤 다시 배치해 빈칸 없이
  const shown: StoryGraph = useMemo(() => {
    const near = focus && sel ? neighbors(graph, sel, 2) : null;
    const nodes = graph.nodes.filter((n) => (!hidden.has(n.kind) || n.key === sel) && (!near || near.has(n.key)));
    const keys = new globalThis.Set(nodes.map((n) => n.key));
    return { nodes, edges: graph.edges.filter((e) => keys.has(e.from) && keys.has(e.to)) };
  }, [graph, hidden, focus, sel]);
  const lay = useMemo(() => layoutGraph(shown), [shown]);
  const pos = useMemo(() => new Map(lay.nodes.map((n) => [n.key, n])), [lay]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (n: GNode) => !words.length || words.every((t) => `${n.name} ${n.id} ${n.sub ?? ''} ${NODE_LABEL[n.kind]}`.toLowerCase().includes(t));
  const near1 = sel ? neighbors(shown, sel, 1) : null;
  const warns = graph.nodes.filter((n) => n.warn).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="story-flow">
      <p className="muted small">세계의 <b>임무·결말·갈래 카드·장면·함정·전투·결정적 선택·사건</b>이 어떤 조건으로 이어지는지 그린 지도입니다. 화살표 <b>A → B</b>는 "A가 끝나거나(고르거나 · 세우면) B가 열린다(시작 · 끝 · 실패)"는 뜻입니다. 상자를 누르면 자세히 보고 바로 고칠 수 있습니다.</p>
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
          <span className="row flow-zoom">
            <button type="button" className="small" aria-label="작게" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}>−</button>
            <button type="button" className="small" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button type="button" className="small" aria-label="크게" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}>＋</button>
          </span>
        </div>
        <p className="small muted flow-legend">
          <span className="lg start">— 시작·열림</span> <span className="lg complete">— 끝·결말</span> <span className="lg fail">- - 실패·막힘</span> <span className="lg effect">··· 일으킴(플래그·장면·카드)</span>
          {warns > 0 && <span className="warn-text"> · ⚠ 살펴볼 곳 {warns}</span>}
        </p>
      </div>

      {!shown.nodes.length ? <p className="muted">그릴 것이 없습니다. 임무·결말·갈래 카드 등을 만들면 여기에 이어진 모습이 나타납니다.</p> : (
        <div className={`flow-wrap${selNode ? ' with-panel' : ''}`}>
          <div className="flow-canvas" role="region" aria-label="이야기 흐름도">
            <svg width={lay.width * zoom} height={lay.height * zoom} viewBox={`0 0 ${lay.width} ${lay.height}`} role="img" aria-label={`노드 ${shown.nodes.length}개, 화살표 ${shown.edges.length}개`}>
              <defs>
                {(['start', 'complete', 'fail', 'effect'] as const).map((k) => (
                  <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className={`flow-arrow ${k}`} /></marker>
                ))}
              </defs>
              {lay.nodes.some((n) => n.layer === -1) && <text x={20} y={Math.min(...lay.nodes.filter((n) => n.layer === -1).map((n) => n.y)) - 12} className="flow-lane">따로 있는 것 (이어진 조건이 없다)</text>}
              {shown.edges.map((e, i) => <Edge key={i} e={e} a={pos.get(e.from)} b={pos.get(e.to)} active={!!sel && (e.from === sel || e.to === sel)} dim={!!sel && !(e.from === sel || e.to === sel)} />)}
              {lay.nodes.map((n) => (
                <g key={n.key} className={`flow-node k-${n.kind}${n.key === sel ? ' sel' : ''}${n.warn ? ' warn' : ''}${(near1 && !near1.has(n.key)) || !hit(n) ? ' dim' : ''}`} transform={`translate(${n.x},${n.y})`}
                  role="button" tabIndex={0} aria-label={`${NODE_LABEL[n.kind]} ${n.name}${n.warn ? ` — ${n.warn}` : ''}`} aria-pressed={n.key === sel}
                  onClick={() => setSel(n.key === sel ? null : n.key)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSel(n.key === sel ? null : n.key); } }}>
                  <rect width={NODE_W} height={NODE_H} rx={n.kind === 'flag' || n.kind === 'claim' || n.kind === 'phase' ? 28 : 8} />
                  <text x={10} y={22} className="flow-title">{NODE_ICON[n.kind]} {short(n.name, 13)}{n.warn ? ' ⚠' : ''}</text>
                  <text x={10} y={42} className="flow-sub">{short(`${NODE_LABEL[n.kind]}${n.sub ? ` · ${n.sub}` : ''}`, 22)}</text>
                  <title>{`${n.name}\n${n.id}${n.warn ? `\n⚠ ${n.warn}` : ''}`}</title>
                </g>
              ))}
            </svg>
          </div>
          {selNode && <NodePanel w={w} set={set} g={graph} n={selNode} onPick={setSel} onClose={() => setSel(null)} onTab={onTab} />}
        </div>
      )}
    </div>
  );
}

function Edge({ e, a, b, active, dim }: { e: GEdge; a?: { x: number; y: number }; b?: { x: number; y: number }; active: boolean; dim: boolean }) {
  if (!a || !b) return null;
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
  // 뒤로 가는 화살표(같은 단·앞 단)는 위로 크게 돌아간다
  const backward = x2 <= x1;
  const d = backward
    ? `M${x1},${y1} C${x1 + 60},${y1 - 70} ${x2 - 60},${y2 - 70} ${x2},${y2}`
    : `M${x1},${y1} C${x1 + (x2 - x1) / 2},${y1} ${x1 + (x2 - x1) / 2},${y2} ${x2},${y2}`;
  const cls = e.kind === 'fail' ? 'fail' : e.kind === 'effect' ? 'effect' : e.kind === 'start' ? 'start' : 'complete';
  return (
    <g className={`flow-edge ${cls}${active ? ' active' : ''}${dim ? ' dim' : ''}`}>
      <path d={d} markerEnd={`url(#arrow-${cls})`} />
      {active && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - (backward ? 52 : 6)} className="flow-label" textAnchor="middle">{short(e.label.replace(/^→ /, ''), 26)}</text>}
    </g>
  );
}

/** 고른 노드: 이어진 것 · 바로 고치기 · 다음 것 만들기 */
function NodePanel({ w, set, g, n, onPick, onClose, onTab }: { w: WorldPackage; set: SetW; g: StoryGraph; n: GNode; onPick: (k: string) => void; onClose: () => void; onTab: (t: FlowTab) => void }) {
  const ins = g.edges.filter((e) => e.to === n.key), outs = g.edges.filter((e) => e.from === n.key);
  const nameOf = (k: string) => { const x = g.nodes.find((y) => y.key === k); return x ? `${NODE_ICON[x.kind]} ${x.name}` : k; };
  const tab = TAB_OF[n.kind];
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
        {ins.length ? <ul className="flow-links">{ins.map((e, i) => <li key={i}><button type="button" className="small" onClick={() => onPick(e.from)}>{nameOf(e.from)}</button> <span className="small muted">{e.label.replace(/^→ /, '')}</span></li>)}</ul> : <p className="small muted">없음 — 처음부터 열려 있거나 조건이 다른 것(장소·관계·날짜 등)이다.</p>}
      </details>
      <details open><summary className="small"><b>이것이 여는 것 {outs.length}</b></summary>
        {outs.length ? <ul className="flow-links">{outs.map((e, i) => <li key={i}><button type="button" className="small" onClick={() => onPick(e.to)}>{nameOf(e.to)}</button> <span className="small muted">{e.label.replace(/^→ /, '')}</span></li>)}</ul> : <p className="small muted">없음</p>}
      </details>

      <div className="flow-edit">
        <NodeEditor w={w} set={set} n={n} />
      </div>

      <div className="flow-actions">
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
    case 'flag': return <p className="small muted">플래그는 효과(「세움」)로 세우고 조건(「섬」)으로 읽는 표시입니다. 위의 「여는 것 · 열리는 것」에서 세우는 곳과 읽는 곳을 보고, 그 상자를 눌러 고치세요.</p>;
    case 'claim': return <p className="small">{w.claims.find((c) => c.id === n.id)?.statement ?? n.id}</p>;
    default: return <p className="small muted">이 종류는 전체 편집 탭에서 고칩니다.</p>;
  }
}
