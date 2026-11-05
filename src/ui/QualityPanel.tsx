/**
 * AI 사용량·품질 (설계 v3 R9): 역할별 속도·토큰·비용, 엔진이 거부한 AI 제안, 품질 점검 실행.
 */
import { useEffect, useRef, useState } from 'react';
import { type EvalReport, PROBES, runEval } from '../gm/eval';
import { createLlmClient } from '../llm';
import { costOf, metrics, ROLE_LABEL, summarize } from '../llm/metrics';
import type { LlmSettings } from '../llm/types';

const PRICE_KEY = 'worldforge.price.v1';
type Price = { input: number; output: number };

function loadPrice(model: string): Price | null {
  try { return (JSON.parse(localStorage.getItem(PRICE_KEY) ?? '{}') as Record<string, Price>)[model] ?? null; } catch { return null; }
}
function savePrice(model: string, p: Price | null) {
  try {
    const all = JSON.parse(localStorage.getItem(PRICE_KEY) ?? '{}') as Record<string, Price>;
    if (p) all[model] = p; else delete all[model];
    localStorage.setItem(PRICE_KEY, JSON.stringify(all));
  } catch { /* 저장 실패는 무시 */ }
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const tok = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString());

export function QualityPanel({ settings }: { settings: LlmSettings | null }) {
  const [, tick] = useState(0);
  useEffect(() => metrics.subscribe(() => tick((n) => n + 1)), []);
  const { calls, turns } = metrics.get();
  const model = settings?.model ?? '';
  const [price, setPrice] = useState<Price | null>(() => (model ? loadPrice(model) : null));
  const [report, setReport] = useState<EvalReport | null>(null);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const mine = calls.filter((c) => !model || c.model === model);
  const rows = summarize(mine);
  const totalIn = mine.reduce((s, c) => s + c.input, 0), totalOut = mine.reduce((s, c) => s + c.output, 0);
  const recentTurns = turns.slice(-50);
  const rejected = recentTurns.reduce((s, t) => s + t.rejected.length, 0);
  const reasons = new Map<string, number>();
  for (const t of recentTurns) for (const r of t.rejected) { const k = r.split(':')[0]!; reasons.set(k, (reasons.get(k) ?? 0) + 1); }

  async function evaluate() {
    if (!settings) return;
    if (!confirm(`품질 점검은 지금 AI 설정(${settings.model})으로 ${PROBES.length}턴을 실제로 진행합니다 (AI 호출 약 ${PROBES.length * 5}번, 비용이 듭니다). 진행할까요?`)) return;
    setError(''); setReport(null);
    abort.current = new AbortController();
    try {
      const r = await runEval((sink) => createLlmClient(settings, { sink: (rec) => { sink(rec); metrics.addCall(rec); } }), settings.model,
        (done, total, name) => setRunning(name ? `${done + 1}/${total} ${name} 점검 중…` : ''), abort.current.signal);
      setReport(r);
    } catch (e) {
      setError(abort.current.signal.aborted ? '중단했습니다.' : (e as Error).message);
    } finally { setRunning(''); }
  }

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `worldforge-eval-${report.model.replace(/[^a-z0-9.-]+/gi, '_')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="panel quality">
      <h2>AI 사용량 · 품질</h2>
      <p className="muted small">이 브라우저에서 한 AI 호출 기록입니다 (최근 500건, 서버로 보내지 않음). 토큰은 제공자가 알려준 값이고, 알려주지 않으면 글자 수로 추정합니다(≈).</p>
      {rows.length === 0 ? <p className="muted small">아직 기록이 없습니다.</p> : (
        <table className="small flow-table">
          <thead><tr><th>역할</th><th>요청</th><th>실패</th><th>보통 속도</th><th>느릴 때 (90%)</th><th>입력 토큰</th><th>출력 토큰</th><th>재시도</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.role}>
                <td>{ROLE_LABEL[r.role]}</td><td>{r.n}</td><td>{r.fail || ''}</td><td>{sec(r.p50)}</td><td>{sec(r.p90)}</td>
                <td>{r.estimated ? '≈' : ''}{tok(r.input)}</td><td>{r.estimated ? '≈' : ''}{tok(r.output)}</td><td>{r.calls - r.n || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {model && (
        <div className="row small">
          <span>단가 ({model}, 100만 토큰당 $)</span>
          <label>입력 <input type="number" className="num" step="0.01" value={price?.input ?? ''} onChange={(e) => { const p = { input: Number(e.target.value) || 0, output: price?.output ?? 0 }; setPrice(p); savePrice(model, p); }} /></label>
          <label>출력 <input type="number" className="num" step="0.01" value={price?.output ?? ''} onChange={(e) => { const p = { input: price?.input ?? 0, output: Number(e.target.value) || 0 }; setPrice(p); savePrice(model, p); }} /></label>
          {price && (price.input || price.output) ? <b>≈ ${costOf(totalIn, totalOut, price).toFixed(3)}{recentTurns.length ? ` · 턴당 ≈ $${(costOf(totalIn, totalOut, price) / Math.max(1, turns.length)).toFixed(4)}` : ''}</b> : <span className="muted">제공자 요금표의 값을 넣으면 비용을 계산합니다</span>}
        </div>
      )}
      {recentTurns.length > 0 && (
        <p className="small">
          최근 {recentTurns.length}턴: 턴당 평균 {sec(recentTurns.reduce((s, t) => s + t.ms, 0) / recentTurns.length)} · 엔진이 거부한 AI 제안 {rejected}건 (턴당 {(rejected / recentTurns.length).toFixed(2)})
          {reasons.size > 0 && <span className="muted"> — {[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(' · ')}</span>}
        </p>
      )}
      <div className="row">
        <button type="button" className="small" onClick={() => confirm('사용량 기록을 지울까요?') && metrics.clear()}>기록 지우기</button>
      </div>

      <h3>품질 점검</h3>
      <p className="small muted">샘플 세계에서 정해진 상황 {PROBES.length}가지를 지금 AI 설정으로 실제로 진행하고 규칙 준수를 자동 판정합니다: {PROBES.map((p) => p.name).join(' · ')}. 세이브에는 아무것도 남지 않습니다.</p>
      <div className="row">
        <button type="button" className="primary" disabled={!settings || !!running} onClick={evaluate}>{running || '▶ 품질 점검'}</button>
        {running && <button type="button" onClick={() => abort.current?.abort()}>중단</button>}
        {report && <button type="button" onClick={download}>결과 JSON 받기</button>}
      </div>
      {error && <p className="status">❌ {error}</p>}
      {report && (
        <>
          <p><b>{report.probes.filter((p) => p.pass).length} / {report.probes.length} 통과</b> · {report.model} · 엔진 거부 턴당 {report.rejectRate.toFixed(2)} · 총 {sec(report.probes.reduce((s, p) => s + p.ms, 0))}
            {' '}· 토큰 {tok(report.calls.reduce((s, c) => s + c.input, 0))} / {tok(report.calls.reduce((s, c) => s + c.output, 0))}
            {price && (price.input || price.output) ? ` · ≈ $${costOf(report.calls.reduce((s, c) => s + c.input, 0), report.calls.reduce((s, c) => s + c.output, 0), price).toFixed(3)}` : ''}</p>
          <ul className="eval-list">
            {report.probes.map((p) => (
              <li key={p.id} className={p.pass ? 'pass' : 'fail'}>
                <b>{p.pass ? '✅' : '❌'} {p.name}</b> <span className="small">{p.detail}</span> <span className="small muted">{sec(p.ms)}</span>
                {p.error && <div className="small reason">{p.error}</div>}
                {p.rejected.length > 0 && <div className="small muted">엔진이 막은 것: {p.rejected.join(' · ')}</div>}
                {p.narration && <details><summary className="small">서술 보기</summary><p className="small">{p.narration}</p></details>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
