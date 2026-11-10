/**
 * AI 사용량 화면 (v0.76): 기간·세계관으로 거르고, 일자별·세계관별·기능별·화면별·모델별로 묶어 본다.
 * 비용은 설정 화면에서 넣은 모델 단가로 계산한다 (단가가 없으면 토큰만).
 */
import { useEffect, useMemo, useState } from 'react';
import { costOf, metrics, ROLE_LABEL, type Role } from '../llm/metrics';
import { AREA_LABEL, clearUsage, dayKey, groupUsage, loadUsage, migrateOldUsage, runTimeline, timelineText, type Bucket, type UsageArea, type UsageRow } from '../llm/usage';
import { loadPrice } from './QualityPanel';

type Period = 'today' | '7' | '30' | 'month' | 'all';
const PERIOD_LABEL: Record<Period, string> = { today: '오늘', '7': '최근 7일', '30': '최근 30일', month: '이번 달', all: '전체' };
type GroupBy = 'day' | 'world' | 'role' | 'area' | 'model' | 'run' | 'label';
const GROUP_LABEL: Record<GroupBy, string> = { day: '일자별', world: '세계관별', role: '기능별', area: '화면별', model: '모델별', run: '작업별 (타임라인)', label: '단계별' };

const startOf = (p: Period) => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (p === 'today') return d.getTime();
  if (p === 'month') { d.setDate(1); return d.getTime(); }
  if (p === 'all') return 0;
  return d.getTime() - (Number(p) - 1) * 86400000;
};
const tok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString());
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const time = (at: number) => new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 기록마다 그 모델 단가로 — 단가 없는 모델이 섞이면 아는 부분만 더하고 표시한다 */
function costOfRows(rows: UsageRow[]): { usd: number; unknown: number } {
  let usd = 0; let unknown = 0;
  for (const r of rows) { const p = loadPrice(r.model); if (!p || (!p.input && !p.output)) { unknown++; continue; } usd += costOf(r.input, r.output, p); }
  return { usd, unknown };
}
const usd = (c: { usd: number; unknown: number }, n: number) => (c.unknown === n ? '—' : `$${c.usd.toFixed(c.usd >= 1 ? 2 : 4)}${c.unknown ? '+' : ''}`);

export function UsagePanel({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('30');
  const [world, setWorld] = useState<string | undefined>(undefined);
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [all, setAll] = useState<UsageRow[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { void migrateOldUsage(metrics.get().calls).then(() => setTick((n) => n + 1)); }, []);
  useEffect(() => metrics.subscribe(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    void loadUsage({ from: startOf(period) }).then((r) => { if (!live) return; setAll(r); setRows(world === undefined ? r : r.filter((x) => (x.world ?? '') === world)); });
    return () => { live = false; };
  }, [period, world, tick]);

  const worlds = useMemo(() => groupUsage(all, (r) => r.world ?? '', (k, r) => (k ? r.worldName || k : '(세계관 밖 — 설정·홈 등)')).sort((a, b) => b.input + b.output - (a.input + a.output)), [all]);
  const buckets: Bucket[] = useMemo(() => {
    if (!rows) return [];
    const by: Record<GroupBy, [(r: UsageRow) => string, (k: string, r: UsageRow) => string]> = {
      day: [(r) => dayKey(r.at), (k) => k],
      world: [(r) => r.world ?? '', (k, r) => (k ? r.worldName || k : '(세계관 밖)')],
      role: [(r) => r.role, (k) => ROLE_LABEL[k as Role] ?? k],
      area: [(r) => r.area ?? 'other', (k) => AREA_LABEL[k as UsageArea] ?? k],
      model: [(r) => r.model, (k) => k],
      // v0.93: 작업 한 번(세계 만들기·카드 변환·편집기 AI 버튼)과 단계 이름으로 묶어 어디서 시간이 드는지 본다
      run: [(r) => r.run ?? '', (k, r) => (k ? `${r.runName ?? '작업'} · ${time(r.at)}` : '(작업으로 묶이지 않은 호출 — 플레이 등)')],
      label: [(r) => (r.label ?? ROLE_LABEL[r.role] ?? r.role).replace(/\s*\d+\/\d+\s*(묶음)?$/, ''), (k) => k],
    };
    const b = groupUsage(rows, ...by[groupBy]);
    if (groupBy === 'run') return b.sort((x, y) => Math.max(...y.rows.map((r) => r.at)) - Math.max(...x.rows.map((r) => r.at)));
    if (groupBy === 'label') return b.sort((x, y) => y.ms - x.ms);
    return groupBy === 'day' ? b.sort((x, y) => y.key.localeCompare(x.key)) : b.sort((x, y) => y.input + y.output - (x.input + x.output));
  }, [rows, groupBy]);
  const maxTok = Math.max(1, ...buckets.map((b) => b.input + b.output));
  const maxMs = Math.max(1, ...buckets.map((b) => b.ms));
  const total = rows ? { n: rows.length, fail: rows.filter((r) => !r.ok).length, input: rows.reduce((s, r) => s + r.input, 0), output: rows.reduce((s, r) => s + r.output, 0), ms: rows.reduce((s, r) => s + r.ms, 0), est: rows.some((r) => r.estimated) } : null;
  const totalCost = rows ? costOfRows(rows) : { usd: 0, unknown: 0 };

  function exportCsv() {
    if (!rows) return;
    const head = ['시각', '세계관', '세이브', '화면', '기능', '요청 이름', '모델', '입력 토큰', '출력 토큰', '추정', '걸린 ms', 'API 호출', '성공', '오류'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [new Date(r.at).toISOString(), r.worldName ?? r.world ?? '', r.saveId ?? '', AREA_LABEL[r.area ?? 'other'], ROLE_LABEL[r.role] ?? r.role, r.label ?? '', r.model, r.input, r.output, r.estimated ? 'Y' : '', r.ms, r.calls, r.ok ? 'Y' : 'N', r.error ?? ''].map(esc).join(','));
    const url = URL.createObjectURL(new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `worldforge-ai-usage-${dayKey(Date.now())}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function clear() {
    const what = `${PERIOD_LABEL[period]}${world !== undefined ? ` · ${worlds.find((w) => w.key === world)?.label ?? world}` : ''}`;
    if (!confirm(`${what}의 사용량 기록 ${rows?.length ?? 0}건을 지울까요? 되돌릴 수 없습니다.`)) return;
    await clearUsage({ from: startOf(period), ...(world !== undefined ? { world } : {}) });
    setTick((n) => n + 1);
  }

  return (
    <section className="panel usage">
      <div className="row"><h2>📊 AI 사용량</h2><span className="spacer" /><button type="button" onClick={onClose}>닫기</button></div>
      <p className="small muted">이 브라우저에서 한 모든 AI 호출 기록입니다 (서버로 보내지 않음). 토큰은 제공자가 알려 준 값이고, 알려 주지 않으면 글자 수로 추정합니다(≈). 비용은 <b>AI 설정</b> 화면에서 모델 단가를 넣으면 계산됩니다.</p>
      <div className="row usage-filters">
        <label>기간 <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select></label>
        <label>세계관 <select value={world ?? '*'} onChange={(e) => setWorld(e.target.value === '*' ? undefined : e.target.value)}>
          <option value="*">전체 ({all.length}건)</option>
          {worlds.map((w) => <option key={w.key} value={w.key}>{w.label} ({w.n}건)</option>)}
        </select></label>
      </div>
      {rows === null ? <p className="muted small">불러오는 중…</p> : rows.length === 0 ? <p className="muted">이 범위에는 기록이 없습니다.</p> : (
        <>
          <div className="usage-tiles">
            <div><span className="small muted">요청</span><b>{total!.n.toLocaleString()}</b>{total!.fail > 0 && <span className="small err">실패 {total!.fail}</span>}</div>
            <div><span className="small muted">입력 토큰</span><b>{total!.est ? '≈' : ''}{tok(total!.input)}</b></div>
            <div><span className="small muted">출력 토큰</span><b>{total!.est ? '≈' : ''}{tok(total!.output)}</b></div>
            <div><span className="small muted">비용</span><b>{usd(totalCost, rows.length)}</b>{totalCost.unknown > 0 && totalCost.unknown < rows.length && <span className="small muted">단가 없는 {totalCost.unknown}건 제외</span>}</div>
            <div><span className="small muted">평균 응답</span><b>{sec(total!.ms / total!.n)}</b></div>
          </div>
          <div className="row usage-groups" role="tablist">
            {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => <button key={g} type="button" role="tab" aria-selected={groupBy === g} className={groupBy === g ? 'primary' : ''} onClick={() => setGroupBy(g)}>{GROUP_LABEL[g]}</button>)}
          </div>
          <ul className="usage-list">
            {buckets.map((b) => { const c = costOfRows(b.rows); return (
              <li key={b.key}>
                <div className="usage-line">
                  {groupBy === 'world' && world === undefined
                    ? <button type="button" className="linklike" onClick={() => setWorld(b.key)} title="이 세계관만 보기">{b.label}</button>
                    : <span className="usage-name">{b.label}</span>}
                  <span className="small muted">요청 {b.n}{b.fail ? ` · 실패 ${b.fail}` : ''} · {tok(b.input)} / {tok(b.output)} · {usd(c, b.n)}{groupBy === 'label' ? ` · 합계 ${sec(b.ms)} · 평균 ${sec(b.ms / b.n)}` : ''}</span>
                </div>
                {groupBy === 'run' && b.key ? <RunTimelineView name={b.label} rows={b.rows} />
                  : <span className="usage-bar" aria-hidden><span style={{ width: `${Math.max(1, Math.round(((groupBy === 'label' ? b.ms : b.input + b.output) / (groupBy === 'label' ? maxMs : maxTok)) * 100))}%` }} /></span>}
              </li>
            ); })}
          </ul>
          <details className="usage-recent"><summary>최근 호출 {Math.min(100, rows.length)}건</summary>
            <ul className="small">
              {[...rows].sort((a, b) => b.at - a.at).slice(0, 100).map((r) => (
                <li key={r.id} className={r.ok ? '' : 'err'}>
                  <span className="muted">{time(r.at)}</span> · {r.worldName ?? '—'} · {ROLE_LABEL[r.role] ?? r.role}{r.label ? ` (${r.label})` : ''} · {r.model} · {tok(r.input)}/{tok(r.output)} · {sec(r.ms)}{!r.ok && ` · ❌ ${r.error ?? ''}`}
                </li>
              ))}
            </ul>
          </details>
          <div className="row">
            <button type="button" onClick={exportCsv}>CSV로 받기 ({rows.length}건)</button>
            <button type="button" onClick={() => void clear()}>이 범위 기록 지우기</button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 작업 타임라인 (v0.93): 한 번의 작업에서 AI 호출이 언제 시작해 얼마나 걸렸는지.
 * 막대의 옅은 부분은 동시 요청 제한 때문에 차례를 기다린 시간, 진한 부분은 실제 응답 시간이다.
 */
function RunTimelineView({ name, rows }: { name: string; rows: UsageRow[] }) {
  const [copied, setCopied] = useState(false);
  const t = useMemo(() => runTimeline(rows, (r) => ROLE_LABEL[r] ?? r), [rows]);
  const span = Math.max(1, t.wallMs);
  const slow = [...t.steps].sort((a, b) => b.ms - a.ms)[0];
  async function copy() {
    const text = timelineText(name, t);
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { prompt('아래 글을 복사하세요', text); }
  }
  return (
    <details className="run-timeline">
      <summary className="small">전체 <b>{sec(t.wallMs)}</b> · 호출 {t.steps.length}건 (합계 {sec(t.sumMs)}) · 동시 최대 {t.peak}{slow ? ` · 가장 오래: ${slow.label} ${sec(slow.ms)}` : ''}</summary>
      <ul className="run-steps">
        {t.steps.map((s, i) => (
          <li key={i} className={s.ok ? '' : 'err'}>
            <div className="run-step-line">
              <span className="usage-name">{s.label}</span>
              <span className="small muted">+{sec(s.startMs)} 시작 · <b>{sec(s.ms)}</b>{s.waitMs > 500 ? ` (대기 ${sec(s.waitMs)})` : ''} · {tok(s.input)}→{tok(s.output)}{s.reasoning ? ` (생각 ${tok(s.reasoning)})` : ''} · {s.tps}tok/s · 한도 {s.maxTokens ? tok(s.maxTokens) : '?'}{s.effort ? ` · ${s.effort}` : ''}{s.calls > 1 ? ` · 재시도 ${s.calls - 1}` : ''} · {s.model}{!s.ok ? ` · ❌ ${s.error ?? ''}` : ''}</span>
            </div>
            <span className="run-bar" aria-hidden>
              <span className="run-wait" style={{ left: `${(s.startMs / span) * 100}%`, width: `${(s.waitMs / span) * 100}%` }} />
              <span className="run-work" style={{ left: `${((s.startMs + s.waitMs) / span) * 100}%`, width: `${Math.max(0.5, ((s.ms - s.waitMs) / span) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <div className="row"><button type="button" onClick={() => void copy()}>{copied ? '복사했습니다' : '진단용으로 복사 (글)'}</button><span className="small muted">프롬프트·응답 내용은 들어가지 않고, 단계 이름·시간·토큰 수만 복사합니다.</span></div>
    </details>
  );
}
