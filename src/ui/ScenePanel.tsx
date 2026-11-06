import { SKILLS } from '../engine/character/rules';
import { ABILITY_NAMES } from '../engine/character/rules';
import { sceneActions } from '../engine/scene';
import type { SceneDef } from '../engine/schema';
import type { GameState, SceneRun } from '../engine/state/state';
import { useRs } from './reskin';

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** 장면 패널 (v0.47): 수치 막대 · 상태 · 단계 · 행동 카드 · 기록 */
export function ScenePanel({ def, run, sheet, busy, npcName, onAct, onQuit }: {
  def: SceneDef; run: SceneRun; sheet: GameState['player']['sheet']; busy: boolean; npcName?: string;
  onAct: (actionId: string) => void; onQuit: () => void;
}) {
  const rs = useRs();
  const phase = def.phases?.find((p) => p.id === run.phase);
  const acts = sceneActions(def, run, sheet).filter((a) => !a.action.phases?.length || a.ok || a.why !== '지금 단계에서는 못 한다');
  const checkName = (c?: string) => {
    const [k, id] = (c ?? '').split(':');
    return k === 'skill' ? SKILLS[id as keyof typeof SKILLS]?.name : k === 'ability' ? ABILITY_NAMES[id as keyof typeof ABILITY_NAMES] : undefined;
  };
  return (
    <section className="scene-panel" aria-label={`장면: ${def.name}`}>
      <div className="row"><b>🎭 {rs(def.name)}</b>{npcName && <span className="small muted">— {rs(npcName)}</span>}<span className="spacer" />
        <span className="small muted">{phase ? `${rs(phase.name)} · ` : ''}{run.round}차례{def.maxRounds ? ` / ${def.maxRounds}` : ''}</span></div>
      {phase?.text && <p className="small muted">{rs(phase.text)}</p>}
      <div className="scene-gauges">
        {def.gauges.filter((g) => g.visible !== false).map((g) => {
          const lo = g.min ?? 0; const hi = g.max ?? 100; const v = run.gauges[g.id] ?? 0;
          return (
            <div key={g.id} className="scene-gauge">
              <span className="small">{rs(g.name)} <b>{v}</b><span className="muted">/{hi}</span></span>
              <div className="progress-bar"><span style={{ width: `${Math.round(((v - lo) / Math.max(1, hi - lo)) * 100)}%` }} /></div>
            </div>
          );
        })}
      </div>
      {run.states.length > 0 && (
        <div className="row scene-states">{run.states.map((id) => { const st = def.states?.find((x) => x.id === id); return <span key={id} className={`tag ${st?.edge === 1 ? 'confirmed' : st?.edge === -1 ? 'stage-hostile' : ''}`} title={st?.text}>{rs(st?.name ?? id)}</span>; })}</div>
      )}
      <div className="scene-actions">
        {acts.map(({ action: a, ok, why, mode, mod, gaugeMod }) => (
          <button key={a.id} type="button" disabled={busy || !ok} onClick={() => onAct(a.id)} title={why || rs(a.text ?? '')}>
            <b>{rs(a.name)}</b>
            <span className="small muted">
              {a.check ? `${checkName(a.check)} ${mod !== undefined ? fmt(mod) : ''}${gaugeMod ? ` (수치 ${fmt(gaugeMod)})` : ''} vs ${a.dc ?? 12}` : '판정 없음'}
              {mode === 'advantage' && <span className="edge up"> ▲이점</span>}{mode === 'disadvantage' && <span className="edge down"> ▼불리</span>}
              {why && ` · ${why}`}
            </span>
            {a.text && <span className="small scene-act-text">{rs(a.text)}</span>}
          </button>
        ))}
      </div>
      {run.log.length > 0 && <ul className="small scene-log">{run.log.slice(-5).map((l, i) => <li key={i}>{rs(l)}</li>)}</ul>}
      <div className="row"><span className="spacer" /><button type="button" className="small" disabled={busy} onClick={() => confirm('장면을 그만둘까요? 결과 없이 끝납니다.') && onQuit()}>그만두기</button></div>
    </section>
  );
}
