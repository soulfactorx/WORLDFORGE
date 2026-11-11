import { useEffect, useMemo, useState } from 'react';
import { classesFor } from '../engine/classes';
import { sceneDef } from '../engine/scene';
import type { WorldPackage } from '../engine/schema';
import { validateWorld } from '../engine/package/validate';
import type { GameState } from '../engine/state/state';
import { sandboxAct, sandboxState, simulateScene, testSheet, type SimResult } from '../gm/sceneTest';
import { abandonSceneEvents, sceneOpponent } from '../gm/scene';
import { applyEvent } from '../engine/state/state';
import { AssetImage } from './AssetImage';
import { ScenePanel } from './ScenePanel';
import { SceneBalance } from './SceneBalance';
import type { SceneDef } from '../engine/schema';

/** 장면 시험 플레이 (v0.71): 편집 중인 장면을 저장 없이 바로 */
export function SceneTester({ w, sceneId, onClose, onApply }: { w: WorldPackage; sceneId: string; onClose: () => void; /** 결과 비율 맞추기가 찾은 설정을 장면에 넣는다 (v0.104) */ onApply?: (d: SceneDef) => void }) {
  const def = sceneDef(w, sceneId);
  const classes = classesFor(w);
  const [cls, setCls] = useState(0);
  const [level, setLevel] = useState(1);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [err, setErr] = useState('');
  const sheet = useMemo(() => testSheet(w, cls, level), [cls, level]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<GameState | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const idx = (w.scenes ?? []).findIndex((s) => s.id === sceneId);
  const issues = useMemo(() => validateWorld(w).filter((i) => i.path.startsWith(`scenes[${idx}]`)), [w, idx]);
  const restart = (nextSeed = Math.floor(Math.random() * 1e6)) => { setSeed(nextSeed); setErr(''); try { setState(sandboxState(w, sceneId, sheet, nextSeed)); } catch (e) { setErr((e as Error).message); } };
  // 주인공이 바뀌면 같은 주사위로 다시 시작
  useEffect(() => { restart(seed); }, [sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  if (!def) return null;
  const act = (id: string) => { if (!state) return; try { setState(sandboxAct(w, state, id)); } catch (e) { setErr((e as Error).message); } };
  const quit = () => { if (state) setState(abandonSceneEvents(w, state).reduce((s, e) => applyEvent(s, e, s.turn), state)); };
  const result = state?.sceneResults?.[def.id];
  const endDef = def.ends.find((e) => e.id === result?.endId);
  const endName = (id: string) => def.ends.find((e) => e.id === id)?.name ?? id;
  return (
    <div className="scene-tester" role="dialog" aria-modal="true" aria-label={`장면 시험: ${def.name}`}>
      <div className="scene-tester-box">
        <div className="row"><b>▶ 장면 시험 — {def.name}</b><span className="spacer" /><button type="button" onClick={onClose} aria-label="닫기">✕ 닫기</button></div>
        <p className="small muted">저장되지 않는 시험 플레이예요. 열리는 조건·장소·상대 위치는 무시하고 바로 시작하며, AI 서술 없이 엔진 판정만 돌립니다. 편집 중인 내용이 그대로 쓰여요.</p>
        <div className="row scene-tester-opts">
          <label className="small">시험 주인공 <select value={cls} onChange={(e) => { setCls(Number(e.target.value)); setSim(null); }}>{classes.map((c, i) => <option key={c.id} value={i}>{c.name}</option>)}</select></label>
          <label className="small">레벨 <select value={level} onChange={(e) => { setLevel(Number(e.target.value)); setSim(null); }}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
          <button type="button" className="small" onClick={() => restart()}>↻ 처음부터</button>
          <button type="button" className="small" onClick={() => restart(seed)} title="같은 주사위 흐름으로 다시">↺ 같은 주사위로</button>
          <button type="button" className="small" onClick={() => setSim(simulateScene(w, sceneId, sheet, 200, seed || 7))}>🎲 자동 200회</button>
        </div>
        {issues.length > 0 && (
          <ul className="small scene-tester-issues">{issues.map((i, k) => <li key={k} className={i.level === 'error' ? 'err' : 'warn'}>{i.level === 'error' ? '⛔' : '⚠'} {i.path.replace(`scenes[${idx}]`, '') || '(장면)'} — {i.message}</li>)}</ul>
        )}
        {err && <p className="small err" role="alert">{err}</p>}
        {state?.scene && <ScenePanel def={def} run={state.scene} sheet={state.player.sheet} opp={sceneOpponent(w, state, def)} busy={false} pkg={w.manifest.id}
          npcName={def.npcId ? w.characters.find((c) => c.id === def.npcId)?.name : undefined} onAct={act} onQuit={quit} />}
        {state && !state.scene && result && (
          <section className="scene-tester-result">
            <b>{result.outcome === 'abandoned' ? '그만둠' : `끝: ${endDef?.name ?? result.endId}`}</b>
            <span className="small muted"> ({{ success: '성공', failure: '실패', neutral: '중립', abandoned: '결과 없음' }[result.outcome]})</span>
            {endDef?.image && <AssetImage pkg={w.manifest.id} id={endDef.image} alt={endDef.name} className="scene-art" zoom />}
            <button type="button" className="small" onClick={() => restart()}>↻ 다시 해 보기</button>
          </section>
        )}
        {state && state.log.length > 0 && (
          <details open={!state.scene}><summary className="small">기록 전체 ({state.log.length}) — 끝의 효과·보상 포함</summary>
            <ul className="small scene-log">{state.log.map((l, i) => <li key={i}>{l.text}</li>)}</ul>
          </details>
        )}
        {sim && (
          <section className="scene-tester-sim" aria-label="자동 시뮬레이션 결과">
            <b>🎲 자동 {sim.runs}회</b> <span className="small muted">— 할 수 있는 행동을 무작위로 고른 결과 · 평균 {sim.avgRounds}차례 (최소 {sim.minRounds}, 최대 {sim.maxRounds})</span>
            <ul className="small">
              {def.ends.map((e) => { const n = sim.ends[e.id] ?? 0; const pct = Math.round((n / sim.runs) * 100); return (
                <li key={e.id}><span className="sim-name">{e.name}</span><span className="progress-bar sim-bar"><span style={{ width: `${pct}%` }} /></span> {pct}% <span className="muted">({n})</span></li>); })}
              {sim.stuck > 0 && <li className="warn">⚠ 할 수 있는 행동이 없어 멈춤: {sim.stuck}회 — 행동의 단계·조건을 확인하세요</li>}
              {sim.endless > 0 && <li className="warn">⚠ 200차례가 지나도 안 끝남: {sim.endless}회 — 차례 한도나 끝 조건을 확인하세요</li>}
              {sim.unreached.length > 0 && <li className="warn">⚠ 한 번도 안 나온 끝: {sim.unreached.map(endName).join(', ')}</li>}
              {sim.unusedActions.length > 0 && <li className="warn">⚠ 한 번도 못 쓴 행동: {sim.unusedActions.map((id) => def.actions.find((a) => a.id === id)?.name ?? id).join(', ')}</li>}
            </ul>
          </section>
        )}
        <SceneBalance key={sceneId} w={w} def={def} sheet={sheet} {...(onApply ? { onApply: (d: SceneDef) => { onApply(d); setSim(null); } } : {})} />
      </div>
    </div>
  );
}
