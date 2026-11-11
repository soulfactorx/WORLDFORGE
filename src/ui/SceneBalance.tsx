import { useMemo, useRef, useState } from 'react';
import type { CharacterSheet } from '../engine/character/sheet';
import type { SceneDef, WorldPackage } from '../engine/schema';
import { BALANCE_KNOBS, type BalanceKnob, type BalanceResult, balanceScene, normalizeTargets } from '../gm/sceneBalance';
import { type SimPolicy, type SimResult, simulateScene } from '../gm/sceneTest';
import { SceneDiagnosis } from './SceneDiagnosis';

const OUTCOME = { success: '성공', failure: '실패', neutral: '중립' } as const;
const pctOf = (sim: SimResult, id: string) => Math.round(((sim.ends[id] ?? 0) / sim.runs) * 100);

/**
 * 결과 비율 맞추기 (v0.104): 끝마다 원하는 비율을 적으면, 자동 시험을 되풀이하며 장면의 숫자를 조금씩 움직여 맞춘다.
 * 제안을 보여 주고, 제작자가 적용을 눌러야 장면이 바뀐다.
 */
export function SceneBalance({ w, def, sheet, onApply }: { w: WorldPackage; def: SceneDef; sheet: CharacterSheet; onApply?: (d: SceneDef) => void }) {
  const even = () => Object.fromEntries(def.ends.map((e) => [e.id, Math.round(100 / def.ends.length)]));
  const [targets, setTargets] = useState<Record<string, number>>(even);
  const [knobs, setKnobs] = useState<BalanceKnob[]>(['dc', 'ends', 'start']);
  const [policy, setPolicy] = useState<SimPolicy>('random');
  const [busy, setBusy] = useState<{ evals: number; maxEvals: number; gap: number } | null>(null);
  const [result, setResult] = useState<BalanceResult | null>(null);
  const [err, setErr] = useState('');
  const stop = useRef(false);
  // 맞춘 설정을 넣은 세계 (안 나오는 끝 안내용) — 결과가 바뀔 때만 다시 만든다
  const tuned = useMemo(() => (result ? { ...w, scenes: (w.scenes ?? []).map((x) => (x.id === def.id ? result.scene : x)) } : w), [w, def.id, result]);
  const sum = def.ends.reduce((s, e) => s + (Number(targets[e.id]) || 0), 0);
  const norm = normalizeTargets(def, targets);

  function fromCurrent() {
    const sim = simulateScene(w, def.id, sheet, 400, 7, policy);
    setTargets(Object.fromEntries(def.ends.map((e) => [e.id, pctOf(sim, e.id)])));
  }
  async function run() {
    setErr(''); setResult(null); stop.current = false;
    setBusy({ evals: 0, maxEvals: 260, gap: 0 });
    try {
      const r = await balanceScene(w, def.id, sheet, {
        targets, knobs, policy,
        // 시험 사이마다 화면에 양보해 진행 표시와 중단 버튼이 살아 있게 한다
        onStep: async (info) => { setBusy(info); await new Promise((res) => setTimeout(res, 0)); return !stop.current; },
      });
      setResult(r);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <details className="scene-balance">
      <summary>⚖ 결과 비율 맞추기 — 끝마다 원하는 비율을 정하면 숫자를 대신 맞춰 줍니다</summary>
      <p className="small muted">아래에 끝마다 원하는 비율을 적고 "맞추기"를 누르면, 자동 시험을 수십 번 되풀이하며 고른 손잡이의 숫자를 한두 칸씩 움직여 목표에 가장 가까운 설정을 찾습니다. 글·그림·행동의 종류·효과는 건드리지 않고, 찾은 설정은 "적용"을 눌러야 장면에 들어갑니다.</p>

      <div className="balance-targets">
        {def.ends.map((e) => (
          <label key={e.id} className="balance-target">
            <span className="balance-name">{e.name} <span className="muted small">({OUTCOME[e.outcome]})</span></span>
            <span className="balance-input"><input type="number" min={0} max={100} value={targets[e.id] ?? 0} disabled={!!busy} aria-label={`끝 ${e.name}의 목표 비율`}
              onChange={(ev) => { setResult(null); setTargets((t) => ({ ...t, [e.id]: Math.max(0, Math.min(100, Number(ev.target.value) || 0)) })); }} /> %</span>
          </label>
        ))}
      </div>
      <div className="row balance-presets">
        <button type="button" disabled={!!busy} onClick={() => { setResult(null); setTargets(even()); }}>골고루</button>
        <button type="button" disabled={!!busy} onClick={() => { setResult(null); fromCurrent(); }} title="지금 설정으로 400번 돌린 비율을 채웁니다 — 여기서 조금씩 고쳐 쓰세요">지금 비율 불러오기</button>
      </div>
      {Math.abs(sum - 100) > 2 && <p className="small muted">합이 {sum}%입니다. 합이 100이 되게 나눠서 맞춥니다 → {def.ends.map((e) => `${e.name} ${Math.round(norm[e.id] ?? 0)}%`).join(' · ')}</p>}

      <label className="balance-policy">시험 플레이어
        <select value={policy} disabled={!!busy} onChange={(e) => { setResult(null); setPolicy(e.target.value as SimPolicy); }}>
          <option value="random">아무 행동이나 고른다</option>
          <option value="careful">성공 확률이 높은 행동을 주로 고른다</option>
        </select>
      </label>
      <p className="small muted">{policy === 'random' ? '할 수 있는 행동 중 무작위로 고릅니다. 장면을 처음 보는 플레이어에 가깝습니다.' : '열에 일곱 번은 성공 확률이 가장 높은 행동을, 나머지는 아무 행동이나 고릅니다. 판정을 따져 보는 플레이어에 가깝습니다.'} 실제 플레이어는 이 둘 사이 어디쯤이므로, 한쪽으로 맞춘 뒤 다른 쪽으로도 돌려 보면 좋습니다.</p>

      <fieldset className="balance-knobs">
        <legend>움직여도 되는 숫자</legend>
        {(Object.keys(BALANCE_KNOBS) as BalanceKnob[]).map((k) => (
          <label key={k} className="check balance-knob">
            <input type="checkbox" checked={knobs.includes(k)} disabled={!!busy} onChange={(e) => { setResult(null); setKnobs((ks) => (e.target.checked ? [...ks, k] : ks.filter((x) => x !== k))); }} />
            <span><b>{BALANCE_KNOBS[k].name}</b><br /><span className="small muted">{BALANCE_KNOBS[k].detail}</span></span>
          </label>
        ))}
      </fieldset>

      <div className="row">
        {!busy && <button type="button" className="primary" disabled={!knobs.length} onClick={run}>⚖ 맞추기</button>}
        {busy && <button type="button" onClick={() => { stop.current = true; }}>■ 멈추기</button>}
        {busy && <span className="small" role="status"><span className="spinner" /> 시험 {busy.evals} / 최대 {busy.maxEvals}번째 · 지금 목표와의 차이 {busy.gap}%p</span>}
      </div>
      {err && <p className="small err" role="alert">{err}</p>}

      {result && (
        <section className="balance-result" aria-label="맞춘 결과">
          <b>{result.changes.length ? '찾은 설정' : '바꿀 것이 없습니다'}</b>
          <span className="small muted"> — 목표와의 차이 {result.gapBefore}%p → {result.gapAfter}%p (끝마다 벌어진 만큼을 더한 값, 다른 주사위로 600번 다시 잰 것)</span>
          <ul className="small balance-compare">
            {def.ends.map((e) => (
              <li key={e.id}>
                <span className="balance-name">{e.name}</span>
                <span>지금 {pctOf(result.before, e.id)}% → <b>{pctOf(result.after, e.id)}%</b> <span className="muted">(목표 {Math.round(norm[e.id] ?? 0)}%)</span></span>
              </li>
            ))}
            <li><span className="balance-name muted">평균 차례</span><span>{result.before.avgRounds} → {result.after.avgRounds}</span></li>
          </ul>
          {result.note && <p className="small warn">⚠ {result.note}</p>}
          {/* 맞춘 뒤에도 안 나오는 끝: 숫자로는 안 되는 까닭을 짚어 준다 (맞춘 설정 기준) */}
          {def.ends.some((e) => !(result.after.ends[e.id] ?? 0)) && <SceneDiagnosis w={tuned} sceneId={def.id} sheet={sheet} policy={policy} {...(onApply ? { onApply: (d: SceneDef) => { onApply(d); setResult(null); } } : {})} />}
          {result.changes.length > 0 && (
            <>
              <p className="small"><b>바뀌는 숫자 {result.changes.length}개</b></p>
              <ul className="small balance-changes">{result.changes.map((c) => <li key={c}>{c}</li>)}</ul>
              <div className="row">
                {onApply && <button type="button" className="primary" onClick={() => { onApply(result.scene); setResult(null); }}>✔ 이 설정 적용</button>}
                <button type="button" onClick={() => setResult(null)}>버리기</button>
              </div>
              <p className="small muted">적용한 뒤에는 위의 "🎲 자동 200회"나 직접 플레이로 느낌을 확인하세요. 숫자는 맞아도 장면이 너무 빨리·늦게 끝나면 차례 한도 손잡이를 켜고 다시 맞추면 됩니다.</p>
            </>
          )}
        </section>
      )}
    </details>
  );
}
