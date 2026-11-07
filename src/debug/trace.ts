/**
 * 디버그 모드 (v0.57): 턴마다 시스템이 무엇을 어떻게 처리했는지 기록한다.
 * - AI 호출: 역할·모델·파라미터·시스템/사용자 프롬프트·스키마·실제 요청 본문(재시도마다)·응답 원문·사용량·오류
 * - 엔진: 입력·진행 단계·만들어진 이벤트·거부한 AI 제안·상태 변화
 * 기록은 이 브라우저(IndexedDB)에만 남는다. API 키·헤더는 기록하지 않는다.
 */
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';
import type { ImagePick } from '../engine/assets';

export interface DebugAttempt {
  at: number;
  /** 요청한 곳 (키 없음) */
  endpoint: string;
  /** 실제로 보낸 본문 */
  request: unknown;
  ms?: number;
  status?: number | string;
  /** 응답의 메타 정보 (stop_reason·usage·finish_reason 등) */
  meta?: Record<string, unknown>;
  /** 응답 원문 */
  raw?: string;
  error?: string;
}

export interface DebugCall {
  id: string;
  at: number;
  role: string;
  model: string;
  provider: string;
  kind: 'stream' | 'json';
  label?: string;
  params: { maxTokens: number; effort?: string };
  system: string;
  user: string;
  schema?: Record<string, unknown>;
  attempts: DebugAttempt[];
  output?: string;
  parsed?: unknown;
  error?: string;
  ms?: number;
  usage?: { input: number; output: number; calls: number; estimated?: boolean };
}

export interface DebugDiff { path: string; before: unknown; after: unknown }

export interface DebugEntry {
  id: string;
  saveId?: string;
  at: number;
  kind: 'turn' | 'combat' | 'scene' | 'items' | 'other';
  title: string;
  turn?: number;
  input?: string;
  use?: string;
  decision?: unknown;
  stages: { at: number; text: string }[];
  calls: DebugCall[];
  notes: { label: string; data: unknown }[];
  events?: GameEvent[];
  rejected?: string[];
  diff?: DebugDiff[];
  newLog?: { kind: string; text: string; images?: { id: string; caption: string; para?: number; bg?: string }[] }[];
  ms?: number;
  error?: string;
  done?: boolean;
}

const KEY = 'worldforge.debug';
const MAX_ENTRIES = 150;
export function debugOn(): boolean { try { return globalThis.localStorage?.getItem(KEY) === '1'; } catch { return false; } }
export function setDebugOn(on: boolean) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* 무시 */ } listeners.forEach((f) => f()); }

let current: DebugEntry | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
export const subscribeDebug = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const currentEntry = () => current;

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

async function persist(e: DebugEntry) {
  try {
    const { db } = await import('../storage/db');
    await db.debug.put(structuredClone(e));
    const n = await db.debug.count();
    if (n > MAX_ENTRIES) {
      const old = await db.debug.orderBy('at').limit(n - MAX_ENTRIES).primaryKeys();
      await db.debug.bulkDelete(old);
    }
  } catch { /* 저장 공간 부족 등 — 기록만 못 남긴다 */ }
  notify();
}

/** 턴(또는 동작) 기록 시작. 디버그 모드가 꺼져 있으면 null */
export function beginDebug(kind: DebugEntry['kind'], title: string, extra: Partial<DebugEntry> = {}): DebugEntry | null {
  if (!debugOn()) return null;
  current = { id: uid(), at: Date.now(), kind, title, stages: [], calls: [], notes: [], ...extra };
  notify();
  return current;
}
export function debugStage(text: string) { if (current) { current.stages.push({ at: Date.now(), text }); notify(); } }
export function debugNote(label: string, data: unknown) { if (current) { current.notes.push({ label, data: safeClone(data) }); notify(); } }

/** 기록 끝: 이벤트·상태 변화를 붙여 저장한다 */
export async function endDebug(e: DebugEntry | null, r: { events?: GameEvent[]; before?: GameState; after?: GameState; rejected?: string[]; error?: string } = {}) {
  if (!e) return;
  e.ms = Date.now() - e.at;
  e.done = true;
  if (r.events) e.events = safeClone(r.events);
  if (r.rejected) e.rejected = [...r.rejected];
  if (r.error) e.error = r.error;
  if (r.before && r.after) {
    e.turn = r.after.turn;
    e.diff = diffState(r.before, r.after);
    e.newLog = r.after.log.slice(r.before.log.length).map((l) => ({ kind: l.kind, text: l.text, ...(l.images?.length ? { images: l.images } : {}) }));
  }
  if (current === e) current = null;
  await persist(e);
}

/** AI 호출 기록 시작 (진행 중인 턴이 없으면 따로 한 건으로 남긴다 — 세계 만들기 등) */
export function traceCall(c: Omit<DebugCall, 'id' | 'at' | 'attempts'>): DebugCall | null {
  if (!debugOn()) return null;
  const call: DebugCall = { id: uid(), at: Date.now(), attempts: [], ...c };
  if (current) { current.calls.push(call); notify(); }
  else {
    const solo: DebugEntry = { id: uid(), at: call.at, kind: 'other', title: `AI 호출 — ${c.label ?? c.role}`, stages: [], calls: [call], notes: [] };
    (call as DebugCall & { solo?: DebugEntry }).solo = solo;
  }
  return call;
}
export function finishCall(call: DebugCall | null, r: { output?: string; parsed?: unknown; error?: string; ms: number; usage?: DebugCall['usage'] }) {
  if (!call) return;
  if (r.output !== undefined) call.output = r.output;
  if (r.parsed !== undefined) call.parsed = safeClone(r.parsed);
  if (r.error) call.error = r.error;
  call.ms = r.ms;
  if (r.usage) call.usage = { ...r.usage };
  const solo = (call as DebugCall & { solo?: DebugEntry }).solo;
  if (solo) { delete (call as DebugCall & { solo?: DebugEntry }).solo; solo.ms = r.ms; solo.done = true; if (r.error) solo.error = r.error; void persist(solo); }
  else notify();
}

/** 어댑터가 실제 요청을 보낼 때 */
export function traceAttempt(call: DebugCall | undefined, endpoint: string, request: unknown): DebugAttempt | undefined {
  if (!call) return undefined;
  const a: DebugAttempt = { at: Date.now(), endpoint, request: safeClone(request) };
  call.attempts.push(a);
  notify();
  return a;
}
export function finishAttempt(a: DebugAttempt | undefined, r: { status?: number | string; meta?: Record<string, unknown>; raw?: string; error?: string }) {
  if (!a) return;
  a.ms = Date.now() - a.at;
  const meta = r.meta ? Object.fromEntries(Object.entries(r.meta).filter(([, v]) => v !== undefined && v !== null)) : undefined;
  Object.assign(a, meta && Object.keys(meta).length ? { ...r, meta: safeClone(meta) } : { ...r, meta: undefined });
  notify();
}

function safeClone<T>(v: T): T {
  try { return structuredClone(v); } catch { try { return JSON.parse(JSON.stringify(v)) as T; } catch { return String(v) as T; } }
}

// ---------------------------------------------------------------- 상태 변화

const SKIP = new Set(['log']);
/** 두 상태의 차이 (기록 로그는 따로) */
export function diffState(a: GameState, b: GameState, limit = 400): DebugDiff[] {
  const out: DebugDiff[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (out.length >= limit) return;
    if (x === y) return;
    const ox = x !== null && typeof x === 'object', oy = y !== null && typeof y === 'object';
    if (!ox || !oy || Array.isArray(x) !== Array.isArray(y)) { if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ path, before: x, after: y }); return; }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      // 같은 길이면 칸마다, 아니면 늘어난/줄어든 것
      if (x.length === y.length) { x.forEach((v, i) => walk(v, y[i], `${path}[${i}]`)); return; }
      const xs = new Set(x.map((v) => JSON.stringify(v))), ys = new Set(y.map((v) => JSON.stringify(v)));
      const added = y.filter((v) => !xs.has(JSON.stringify(v))), removed = x.filter((v) => !ys.has(JSON.stringify(v)));
      if (added.length) out.push({ path: `${path} (+${added.length})`, before: undefined, after: added });
      if (removed.length) out.push({ path: `${path} (-${removed.length})`, before: removed, after: undefined });
      if (!added.length && !removed.length) out.push({ path, before: x, after: y });
      return;
    }
    const keys = new Set([...Object.keys(x as object), ...Object.keys(y as object)]);
    for (const k of keys) {
      if (!path && SKIP.has(k)) continue;
      walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    }
  };
  walk(a, b, '');
  return out;
}

export async function loadDebug(saveId?: string): Promise<DebugEntry[]> {
  const { db } = await import('../storage/db');
  // 지운 세이브의 기록은 정리한다 (v0.57.2 이전에 지운 세이브 포함)
  const live = new Set(await db.saves.toCollection().primaryKeys());
  const orphan = (await db.debug.toArray()).filter((e) => e.saveId && !live.has(e.saveId)).map((e) => e.id);
  if (orphan.length) await db.debug.bulkDelete(orphan);
  const all = await db.debug.orderBy('at').reverse().toArray();
  return saveId ? all.filter((e) => e.saveId === saveId || (!e.saveId && e.kind === 'other')) : all;
}
export async function clearDebug(saveId?: string) {
  const { db } = await import('../storage/db');
  if (saveId) await db.debug.where('saveId').equals(saveId).delete(); else await db.debug.clear();
  notify();
}

/** 이미지 선택 기록: 고른 이미지마다 근거와 세부 과정 (v0.57.4) */
export interface ImageNote { kind: 'images'; inputs?: Record<string, string>; chosen: { id: string; caption: string; why: string; detail?: string }[]; skipped: string[]; steps: ImagePick[] }
export function imageNote(images: { id: string; caption: string }[], why: string[], picks: ImagePick[], inputs?: Record<string, string>): ImageNote {
  const reasons = why.filter((w) => !w.startsWith('('));
  return {
    kind: 'images', ...(inputs ? { inputs } : {}),
    chosen: images.map((im, i) => {
      const p = picks.find((x) => x.step !== '서술 언급' && x.chosen === im.id);
      return { id: im.id, caption: im.caption, why: reasons[i] ?? '', ...(p ? { detail: `${p.rule}${p.wanted && !p.rule.includes(`"${p.wanted}"`) ? ` · 원한 태그 "${p.wanted}"` : ''}${p.resolved && p.resolved !== p.wanted && !p.rule.includes(`"${p.resolved}"`) ? ` → 맞춘 태그 "${p.resolved}"` : ''}` } : {}) };
    }),
    skipped: why.filter((w) => w.startsWith('(')),
    steps: picks,
  };
}
