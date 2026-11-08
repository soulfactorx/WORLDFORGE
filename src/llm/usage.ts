/**
 * AI 사용량 기록 (v0.76): 호출마다 세계관·세이브·화면·기능·모델·토큰·시간을 IndexedDB에 남긴다.
 * 이전 계측(localStorage 최근 500건)은 품질 패널용으로 그대로 두고, 이 기록은 오래 남겨 세계관별·일자별·기능별로 본다.
 */
import { db } from '../storage/db';
import type { CallRecord, Role } from './metrics';

export type UsageArea = 'play' | 'editor' | 'worldgen' | 'card' | 'settings' | 'other';
export const AREA_LABEL: Record<UsageArea, string> = { play: '플레이', editor: '세계관 편집', worldgen: 'AI 세계 만들기', card: '카드 세계 만들기', settings: '설정·점검', other: '기타' };

export interface UsageScope { world?: string; worldName?: string; saveId?: string; area?: UsageArea }
export interface UsageRow extends CallRecord, UsageScope { id?: number; label?: string }

let scope: UsageScope = {};
/** 지금 화면이 어떤 세계관·세이브·영역에서 AI를 쓰는지 (화면이 바뀔 때 설정) */
export function setUsageScope(s: UsageScope) { scope = { ...s }; }
export const usageScope = () => scope;

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
