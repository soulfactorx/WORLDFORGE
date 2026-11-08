/**
 * AI 생성 진행률 (v0.79.1): 단계마다 지금 위치(at)와 다음 단계(next)를 받아, 긴 AI 응답을 기다리는 동안
 * 다음 단계 쪽으로 천천히 차오른다. 걸린 시간·단계 목록·중단 버튼.
 */
import { useEffect, useRef, useState } from 'react';

export type OnStage = (stage: string, at?: number, next?: number) => void;

export function useGenProgress() {
  const [stage, setStage] = useState('');
  const [pct, setPct] = useState({ at: 0, next: 0, since: 0, start: 0 });
  const [, tick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { if (!stage) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, [stage !== '']);
  const onStage: OnStage = (st, at, next) => {
    setStage(st);
    if (at !== undefined) setPct((p) => ({ at: Math.max(p.at, at), next: Math.max(next ?? at, at), since: Date.now(), start: p.start || Date.now() }));
  };
  /** 작업 하나를 진행률과 함께 돌린다 (중단하면 null) */
  async function run<T>(first: string, job: (onStage: OnStage, signal: AbortSignal) => Promise<T>): Promise<T | null> {
    abort.current = new AbortController();
    setPct({ at: 0, next: 3, since: Date.now(), start: Date.now() });
    setStage(first);
    try { return await job(onStage, abort.current.signal); }
    catch (e) { if (abort.current.signal.aborted) return null; throw e; }
    finally { setStage(''); setPct({ at: 0, next: 0, since: 0, start: 0 }); }
  }
  return { stage, busy: stage !== '', pct, run, cancel: () => abort.current?.abort() };
}

export function GenProgress({ stage, pct, steps, onCancel, halfLife = 45000 }: {
  stage: string; pct: { at: number; next: number; since: number; start: number }; steps?: string[]; onCancel?: () => void; halfLife?: number;
}) {
  if (!stage) return null;
  const creep = pct.at + (pct.next - pct.at) * (1 - Math.exp(-(Date.now() - pct.since) / halfLife)) * 0.9;
  const shown = Math.min(100, Math.round(creep));
  const sec = Math.floor((Date.now() - (pct.start || Date.now())) / 1000);
  return (
    <div className="gen-progress" role="status" aria-live="polite">
      <div className="row"><span className="spinner" /> <b>{shown}%</b> <span className="small">{stage}</span><span className="spacer" /><span className="small muted">{Math.floor(sec / 60)}분 {sec % 60}초</span>
        {onCancel && <button type="button" className="small" onClick={onCancel}>중단</button>}</div>
      <div className="progress-bar"><span style={{ width: `${shown}%` }} /></div>
      {steps && <span className="small muted">{steps.map((x, i) => `${i + 1}) ${x}`).join(' → ')} · 큰 응답이라 1~3분 걸릴 수 있습니다.</span>}
    </div>
  );
}
