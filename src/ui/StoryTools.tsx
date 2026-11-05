/**
 * 제작 도구 2.0 (R8): 이야기 보드 · 그래프 지도 · 세계 시뮬레이터.
 */
import { useMemo, useState } from 'react';
import { flagFlows, flowWarnings } from '../engine/package/flow';
import { QUEST_TYPE_LABEL } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import { simulateWorld, type SimResult } from '../gm/simulate';
import { describeCondition } from './ConditionEditor';

/** 이야기 보드: 줄기·임무·결정·시계·사건·결말과 플래그 흐름을 한눈에 */
export function StoryBoard({ w }: { w: WorldPackage }) {
  const flows = useMemo(() => flagFlows(w), [w]);
  const warnings = useMemo(() => flowWarnings(w), [w]);
  const d = (c: Parameters<typeof describeCondition>[0] | undefined) => (c ? describeCondition(c, w) : '');
  return (
    <div className="story-board">
      {warnings.length > 0 && <ul className="small issues">{warnings.map((x) => <li key={x} className="warning">⚠ {x}</li>)}</ul>}
      <div className="board-cols">
        <section>
          <h4>줄기</h4>
          {(w.arcs ?? []).length === 0 && <p className="small muted">(없음)</p>}
          {(w.arcs ?? []).map((a) => (
            <div key={a.id} className="board-card">
              <b>{a.name}</b> <span className="small muted">시작: {d(a.start)}</span>
              <ol className="small">{a.chapters.map((c, i) => <li key={i}><b>{c.name}</b> — 끝: {d(c.complete)}{c.fail ? <span className="warn-text"> / 실패: {d(c.fail)}</span> : null}</li>)}</ol>
            </div>
          ))}
          <h4>임무</h4>
          {(w.quests ?? []).map((q) => (
            <div key={q.id} className="board-card">
              <b>{q.name}</b> <span className="tag">{q.kind === 'main' ? '메인' : '사이드'}{q.type ? `·${QUEST_TYPE_LABEL[q.type]}` : ''}</span>
              <div className="small muted">시작: {d(q.start)}{q.timeLimit ? ` · 기한 ${q.timeLimit.days}일` : ''}{q.fail ? ` · 실패: ${d(q.fail)}` : ''}</div>
              <ol className="small">{q.stages.map((s, i) => <li key={i}>{s.objective} — <span className="muted">{d(s.complete)}</span></li>)}</ol>
            </div>
          ))}
          <h4>결말</h4>
          {(w.endings ?? []).map((e) => <div key={e.id} className="board-card"><b>◆ {e.name}</b> <span className="small muted">{d(e.condition)}</span></div>)}
        </section>
        <section>
          <h4>결정적 선택</h4>
          {(w.choices ?? []).length === 0 && <p className="small muted">(없음)</p>}
          {(w.choices ?? []).map((c) => (
            <div key={c.id} className="board-card"><b>{c.name}</b> <span className="small muted">열림: {d(c.when)}</span>
              <ul className="small">{c.options.map((o) => <li key={o.id}>{o.text} → {o.effects.map((e) => Object.entries(e).map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')).join(', ') || '(효과 없음)'}</li>)}</ul>
            </div>
          ))}
          <h4>진행 시계 · 연표 사건</h4>
          {(w.clocks ?? []).map((c) => <div key={c.id} className="board-card small"><b>⏳ {c.name}</b> {c.segments}칸 — {c.at.map((a) => `${a.segment}칸${a.omen ? '(징조)' : ''}${a.effects?.length ? '(효과)' : ''}`).join(', ')}</div>)}
          {(w.events ?? []).map((e) => <div key={e.id} className="board-card small"><b>📅 {e.name}</b> {e.when.day !== undefined ? `${e.when.day}일째` : ''}{e.when.date ? `${e.when.date.year}.${e.when.date.month}.${e.when.date.day}` : ''}{e.when.condition ? ` ${d(e.when.condition)}` : ''}{e.unless ? <span className="muted"> · 막힘: {d(e.unless)}</span> : null}</div>)}
          <h4>플래그 흐름</h4>
          <table className="small flow-table">
            <thead><tr><th>플래그</th><th>세우는 곳</th><th>읽는 곳</th></tr></thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id} className={!f.setBy.length && f.readBy.length ? 'bad' : ''}>
                  <td><code>{f.id}</code></td>
                  <td>{f.setBy.join(' · ') || '—'}</td>
                  <td>{f.readBy.join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/** 그래프 지도: 시작 장소에서 몇 걸음인지로 단을 나눠 그린다 */
export function WorldMap({ w, onPick }: { w: WorldPackage; onPick?: (locId: string) => void }) {
  const layout = useMemo(() => {
    const depth = new Map<string, number>([[w.start.locationId, 0]]);
    const queue = [w.start.locationId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of w.locations.find((l) => l.id === cur)?.connections ?? []) if (!depth.has(n)) { depth.set(n, depth.get(cur)! + 1); queue.push(n); }
    }
    const maxD = Math.max(0, ...depth.values());
    for (const l of w.locations) if (!depth.has(l.id)) depth.set(l.id, maxD + 1); // 갈 수 없는 장소
    const cols = new Map<number, string[]>();
    for (const l of w.locations) cols.set(depth.get(l.id)!, [...(cols.get(depth.get(l.id)!) ?? []), l.id]);
    const pos = new Map<string, { x: number; y: number }>();
    const colW = 170, rowH = 70;
    const tallest = Math.max(1, ...[...cols.values()].map((c) => c.length));
    for (const [dd, ids] of cols) ids.forEach((id, i) => pos.set(id, { x: 90 + dd * colW, y: 40 + (i + (tallest - ids.length) / 2) * rowH }));
    return { pos, width: 180 + Math.max(0, ...cols.keys()) * colW, height: 40 + tallest * rowH, unreachable: new Set(w.locations.filter((l) => depth.get(l.id)! > maxD).map((l) => l.id)) };
  }, [w]);
  const edges = w.locations.flatMap((l) => l.connections.filter((c) => c > l.id || !w.locations.find((x) => x.id === c)?.connections.includes(l.id)).map((c) => [l.id, c] as const));
  return (
    <div className="world-map">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" style={{ maxHeight: 480 }} role="img" aria-label="장소 연결 지도">
        {edges.map(([a, b]) => { const p = layout.pos.get(a), q = layout.pos.get(b); return p && q ? <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="map-edge" /> : null; })}
        {w.locations.map((l) => {
          const p = layout.pos.get(l.id)!;
          const npcs = w.characters.filter((c) => c.locationId === l.id).length;
          const enc = (w.encounters ?? []).filter((e) => e.locationId === l.id).length;
          const icons = `${l.id === w.start.locationId ? '★' : ''}${l.shop ? '🛒' : ''}${l.board ? '📜' : ''}${enc ? '⚔' : ''}${l.discoveries?.length ? '✦' : ''}`;
          return (
            <g key={l.id} className={`map-node ${layout.unreachable.has(l.id) ? 'unreachable' : ''}`} onClick={() => onPick?.(l.id)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
              <rect x={p.x - 75} y={p.y - 22} width={150} height={44} rx={8} />
              <text x={p.x} y={p.y - 4} textAnchor="middle" className="map-name">{l.name.length > 11 ? `${l.name.slice(0, 10)}…` : l.name}</text>
              <text x={p.x} y={p.y + 13} textAnchor="middle" className="map-sub">{icons}{npcs ? ` 인물 ${npcs}` : ''}</text>
            </g>
          );
        })}
      </svg>
      <p className="small muted">★ 시작 · 🛒 상점 · 📜 의뢰판 · ⚔ 조우 · ✦ 발견할 것 · 흐린 장소는 시작 장소에서 갈 수 없다</p>
    </div>
  );
}

/** 세계 시뮬레이터: 플레이어가 아무것도 하지 않을 때 며칠 동안 무슨 일이 일어나는가 */
export function Simulator({ w }: { w: WorldPackage }) {
  const [days, setDays] = useState(7);
  const [flags, setFlags] = useState<string[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState('');
  const run = () => {
    setError('');
    try { setResult(simulateWorld(w, days, { flags })); } catch (e) { setError((e as Error).message); setResult(null); }
  };
  const s = result?.state;
  return (
    <div className="simulator">
      <div className="row">
        <label>날 수 <input type="number" className="num" min={1} max={60} value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} /></label>
        <button type="button" className="primary" onClick={run}>▶ 시뮬레이션</button>
      </div>
      {(w.flags ?? []).length > 0 && (
        <details><summary className="small">처음부터 세운 것으로 칠 플래그 ({flags.length})</summary>
          <div className="stage-checks">{(w.flags ?? []).map((f) => (
            <label key={f.id} className="check small"><input type="checkbox" checked={flags.includes(f.id)} onChange={(e) => setFlags((x) => (e.target.checked ? [...x, f.id] : x.filter((y) => y !== f.id)))} />{f.id}</label>
          ))}</div>
        </details>
      )}
      {error && <p className="status">❌ {error}</p>}
      {result && s && (
        <>
          <ol className="sim-days small">
            {result.days.filter((dd) => dd.lines.length).map((dd) => (
              <li key={dd.day}><b>{dd.day === 0 ? '시작' : `${dd.day}일째`}</b><ul>{dd.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></li>
            ))}
          </ol>
          <div className="small board-card">
            <b>{days}일 뒤</b>
            <div>플래그: {s.flags.join(', ') || '없음'}</div>
            <div>시계: {(w.clocks ?? []).map((c) => `${c.name} ${s.clocks[c.id]?.value ?? c.start ?? 0}/${c.segments}`).join(' · ') || '없음'}</div>
            <div>임무: {(w.quests ?? []).filter((q) => s.quests[q.id]).map((q) => `${q.name}(${s.quests[q.id]!.failed ? '실패' : s.quests[q.id]!.done ? '완료' : `${s.quests[q.id]!.stage + 1}단계`})`).join(', ') || '없음'}</div>
            <div>죽은 인물: {s.deadNpcs.map((id) => w.characters.find((c) => c.id === id)?.name ?? id).join(', ') || '없음'}</div>
            <div>세력 평판: {(w.factions ?? []).map((f) => `${f.name} ${s.reputation[f.id] ?? f.reputation ?? 0}`).join(' · ') || '없음'}</div>
            <div>퍼진 소문: {s.beliefs.filter((b) => b.holder !== 'player').length}건{s.ending ? ` · 결말: ${w.endings?.find((e) => e.id === s.ending)?.name}` : ''}</div>
          </div>
        </>
      )}
      <p className="small muted">AI 없이 엔진만 돌린다: 시계·연표 사건·세력 행동·소문 전파·기한·줄기. 플레이어의 행동이 필요한 일은 일어나지 않는다.</p>
    </div>
  );
}
