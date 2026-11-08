/**
 * AI 사용량·속도 계측 (설계 v3 R9). 호출마다 역할·걸린 시간·토큰·재시도·실패를 기록한다.
 * 기록은 이 브라우저에만 남는다 (최근 500건). 비용은 사용자가 정한 단가로 계산한다 — 단가를 앱이 지어내지 않는다.
 */
import type { LlmClient, LlmRequest, Meter } from './types';
import { recordUsage } from './usage';

export type Role = 'director' | 'actor' | 'narrator' | 'recorder' | 'guide' | 'combat' | 'worldgen' | 'card' | 'translate' | 'image' | 'other';

export const ROLE_LABEL: Record<Role, string> = {
  director: 'GM 판단', actor: 'NPC 연기', narrator: '서술', recorder: '기록관', guide: 'GM 안내', combat: '전투 서술',
  worldgen: '세계 생성', card: '카드 세계', translate: '번역', image: '이미지 고르기', other: '기타',
};

export interface CallRecord {
  at: number;
  role: Role;
  model: string;
  ms: number;
  input: number;
  output: number;
  /** API 호출 수 (재시도 포함) */
  calls: number;
  estimated?: boolean;
  ok: boolean;
  error?: string;
  /** 요청 이름 (예: "인물 찾기 2/5 묶음") */
  label?: string;
}

/** 턴 감사: 엔진이 AI 제안을 거부한 일 */
export interface TurnRecord {
  at: number;
  ms: number;
  rejected: string[];
}

/** 시스템 프롬프트로 역할을 알아낸다 (프롬프트는 이 앱이 쓴 것) */
export function roleOf(fullSystem: string): Role {
  // 역할은 프롬프트 첫머리의 정체성 문장으로 정한다 (v0.80: 뒤에 붙는 GM 스타일·사용자 글에 낱말이 섞여도 흔들리지 않게)
  const system = fullSystem.slice(0, 400);
  if (system.includes('판단 모듈')) return 'director';
  if (system.includes('한 명의 NPC')) return 'actor';
  if (system.includes('기록관')) return 'recorder';
  if (system.includes('안내자')) return 'guide';
  if (system.includes('방금 끝난 전투')) return 'combat';
  if (system.includes('서술자')) return 'narrator';
  if (system.includes('캐릭터 카드') || system.includes('로어북')) return 'card';
  if (system.includes('번역') || system.includes('한국어로 옮')) return 'translate';
  if (system.includes('이미지')) return 'image';
  if (system.includes('세계관 설계자') || system.includes('시나리오 설계자')) return 'worldgen';
  return 'other';
}

const KEY = 'worldforge.metrics.v1';
const LIMIT = 500;

interface Store { calls: CallRecord[]; turns: TurnRecord[] }

function load(): Store {
  try {
    const s = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '') as Store;
    return { calls: s.calls ?? [], turns: s.turns ?? [] };
  } catch { return { calls: [], turns: [] }; }
}
let store: Store | null = null;
const listeners = new Set<() => void>();
function save() {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(store)); } catch { /* 저장 공간 부족 등 — 기록만 못 남긴다 */ }
  listeners.forEach((f) => f());
}

export const metrics = {
  get(): Store { return (store ??= load()); },
  addCall(r: CallRecord) { const s = this.get(); s.calls = [...s.calls, r].slice(-LIMIT); save(); void recordUsage(r); },
  addTurn(r: TurnRecord) { const s = this.get(); s.turns = [...s.turns, r].slice(-LIMIT); save(); },
  clear() { store = { calls: [], turns: [] }; save(); },
  subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
};

/** 계측 래퍼: 재시도까지 포함한 한 번의 요청을 기록한다 (sink를 주면 거기에도) */
export function metered(llm: LlmClient, model: string, sink: (r: CallRecord) => void = (r) => metrics.addCall(r)): LlmClient {
  const wrap = async <T>(req: LlmRequest, run: (r: LlmRequest) => Promise<T>, outLen: (t: T) => number): Promise<T> => {
    const meter: Meter = req.meter ?? { input: 0, output: 0, calls: 0 };
    const t0 = performance.now();
    const role = roleOf(req.system);
    try {
      const out = await run({ ...req, meter });
      if (meter.calls === 0) { meter.calls = 1; meter.estimated = true; meter.input = Math.ceil((req.system.length + req.user.length) / 2); meter.output = Math.ceil(outLen(out) / 2); }
      sink({ at: Date.now(), role, model, ms: Math.round(performance.now() - t0), input: meter.input, output: meter.output, calls: meter.calls, ...(meter.estimated ? { estimated: true } : {}), ok: true, ...(req.label ? { label: req.label } : {}) });
      return out;
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') sink({ at: Date.now(), role, model, ms: Math.round(performance.now() - t0), input: meter.input, output: meter.output, calls: Math.max(1, meter.calls), ok: false, error: String((e as Error)?.message ?? e).slice(0, 160), ...(req.label ? { label: req.label } : {}) });
      throw e;
    }
  };
  return {
    stream: (req, onText, signal) => wrap(req, (r) => llm.stream(r, onText, signal), (t) => t.length),
    json: <T,>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal) => wrap(req, (r) => llm.json<T>(r, schema, signal), (t) => JSON.stringify(t).length),
  };
}

export interface RoleSummary { role: Role; n: number; fail: number; p50: number; p90: number; input: number; output: number; calls: number; estimated: boolean }

const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]!; };

export function summarize(calls: CallRecord[]): RoleSummary[] {
  const by = new Map<Role, CallRecord[]>();
  for (const c of calls) by.set(c.role, [...(by.get(c.role) ?? []), c]);
  return [...by.entries()].map(([role, cs]) => ({
    role, n: cs.length, fail: cs.filter((c) => !c.ok).length,
    p50: pct(cs.map((c) => c.ms), 0.5), p90: pct(cs.map((c) => c.ms), 0.9),
    input: cs.reduce((s, c) => s + c.input, 0), output: cs.reduce((s, c) => s + c.output, 0),
    calls: cs.reduce((s, c) => s + c.calls, 0), estimated: cs.some((c) => c.estimated),
  })).sort((a, b) => b.n - a.n);
}

/** 사용자 단가($/100만 토큰)로 비용 */
export const costOf = (input: number, output: number, price: { input: number; output: number }) => (input * price.input + output * price.output) / 1_000_000;
