/**
 * AI 사용량 기록 (v0.76): 호출마다 세계관·세이브·화면·기능·모델·토큰·시간을 IndexedDB에 남긴다.
 * 이전 계측(localStorage 최근 500건)은 품질 패널용으로 그대로 두고, 이 기록은 오래 남겨 세계관별·일자별·기능별로 본다.
 */
import { db } from '../storage/db';
import type { CallRecord, Role } from './metrics';

export type UsageArea = 'play' | 'editor' | 'worldgen' | 'card' | 'settings' | 'other';
export const AREA_LABEL: Record<UsageArea, string> = { play: '플레이', editor: '세계관 편집', worldgen: 'AI 세계 만들기', card: '카드 세계 만들기', settings: '설정·점검', other: '기타' };

export interface UsageScope { world?: string; worldName?: string; saveId?: string; area?: UsageArea; /** 한 번의 작업 (v0.93): 세계 만들기·카드 변환·편집기의 AI 버튼 한 번 */ run?: string; runName?: string }
export interface UsageRow extends CallRecord, UsageScope { id?: number; label?: string }

let scope: UsageScope = {};
/** 지금 화면이 어떤 세계관·세이브·영역에서 AI를 쓰는지 (화면이 바뀔 때 설정) */
export function setUsageScope(s: UsageScope) { scope = { ...s, ...(scope.run ? { run: scope.run, runName: scope.runName } : {}) }; }
export const usageScope = () => scope;
/** 작업 하나를 시작한다 — 끝날 때까지의 AI 호출이 한 묶음으로 기록된다 (사용량 화면 "작업별") */
export function beginRun(name: string): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  scope = { ...scope, run: id, runName: name };
  return id;
}
export function endRun(id: string) { if (scope.run === id) { const { run: _r, runName: _n, ...rest } = scope; scope = rest; } }

export async function recordUsage(r: CallRecord & { label?: string }) {
  try { await db.usage.add({ ...r, ...scope, area: scope.area ?? 'other' }); } catch { /* 저장 실패는 플레이를 막지 않는다 */ }
}

export interface UsageFilter { from?: number; to?: number; world?: string }
export async function loadUsage(f: UsageFilter = {}): Promise<UsageRow[]> {
  const rows = await db.usage.where('at').between(f.from ?? 0, f.to ?? Number.MAX_SAFE_INTEGER, true, true).toArray();
  return f.world === undefined ? rows : rows.filter((r) => (r.world ?? '') === f.world);
}
export async function clearUsage(f: UsageFilter = {}) {
  if (f.from === undefined && f.to === undefined && f.world === undefined) return db.usage.clear();
  const ids = (await loadUsage(f)).map((r) => r.id!).filter((x) => x !== undefined);
  await db.usage.bulkDelete(ids);
}

/** 이전 기록(localStorage) 옮기기 — 한 번만 */
export async function migrateOldUsage(calls: CallRecord[]) {
  const KEY = 'worldforge.usage.migrated';
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  if (calls.length && (await db.usage.count()) === 0) await db.usage.bulkAdd(calls.map((c) => ({ ...c, area: 'other' as const })));
  try { localStorage.setItem(KEY, '1'); } catch { /* 무시 */ }
}

export interface Bucket { key: string; label: string; n: number; fail: number; input: number; output: number; ms: number; rows: UsageRow[] }
export function groupUsage(rows: UsageRow[], keyOf: (r: UsageRow) => string, labelOf: (k: string, r: UsageRow) => string = (k) => k): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const r of rows) {
    const k = keyOf(r);
    const b = m.get(k) ?? { key: k, label: labelOf(k, r), n: 0, fail: 0, input: 0, output: 0, ms: 0, rows: [] };
    b.n++; if (!r.ok) b.fail++; b.input += r.input; b.output += r.output; b.ms += r.ms; b.rows.push(r);
    m.set(k, b);
  }
  return [...m.values()];
}

export const dayKey = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export type { Role };

// ---------------------------------------------------------------- 작업 타임라인 (v0.93)
export interface RunStep { label: string; role: Role; model: string; startMs: number; ms: number; waitMs: number; input: number; output: number; calls: number; ok: boolean; maxTokens?: number; effort?: string; error?: string; tps: number }
export interface RunTimeline { wallMs: number; sumMs: number; steps: RunStep[]; /** 동시에 돌던 요청의 최대 수 */ peak: number }

/** 한 작업의 호출들을 시작 순서로 — 어느 단계가 얼마나 걸렸고, 순서대로였는지 동시에였는지 본다 */
export function runTimeline(rows: UsageRow[], roleLabel: (r: Role) => string = (r) => r): RunTimeline {
  if (!rows.length) return { wallMs: 0, sumMs: 0, steps: [], peak: 0 };
  const t0 = Math.min(...rows.map((r) => r.at - r.ms));
  const steps = rows.map((r): RunStep => {
    const work = Math.max(1, r.ms - (r.waitMs ?? 0));
    return { label: r.label ?? roleLabel(r.role), role: r.role, model: r.model, startMs: r.at - r.ms - t0, ms: r.ms, waitMs: r.waitMs ?? 0, input: r.input, output: r.output, calls: r.calls, ok: r.ok,
      ...(r.maxTokens ? { maxTokens: r.maxTokens } : {}), ...(r.effort ? { effort: r.effort } : {}), ...(r.error ? { error: r.error } : {}), tps: Math.round((r.output / work) * 1000) };
  }).sort((a, b) => a.startMs - b.startMs);
  const marks = steps.flatMap((s) => [[s.startMs + s.waitMs, 1], [s.startMs + s.ms, -1]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0, peak = 0;
  for (const [, d] of marks) { live += d; peak = Math.max(peak, live); }
  return { wallMs: Math.max(...steps.map((s) => s.startMs + s.ms)), sumMs: steps.reduce((n, s) => n + s.ms, 0), steps, peak };
}

/** 진단용 글 (붙여 넣어 공유) */
export function timelineText(name: string, t: RunTimeline): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return [
    `# ${name} — 전체 ${s(t.wallMs)} · 호출 ${t.steps.length}건 (합계 ${s(t.sumMs)}) · 동시 최대 ${t.peak}`,
    '시작 | 걸림 | 대기 | 단계 | 모델 | 입력→출력 토큰 | 속도 | 출력 한도·노력 | 재시도',
    ...t.steps.map((x) => `+${s(x.startMs)} | ${s(x.ms)} | ${x.waitMs ? s(x.waitMs) : '-'} | ${x.label} | ${x.model} | ${x.input}→${x.output} | ${x.tps}tok/s | ${x.maxTokens ?? '?'}${x.effort ? `·${x.effort}` : ''} | ${x.calls > 1 ? `${x.calls - 1}회` : '-'}${x.ok ? '' : ` | 실패: ${x.error ?? ''}`}`),
  ].join('\n');
}
