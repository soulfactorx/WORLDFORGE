/**
 * AI 호출 안정화 (v0.19.1): 재시도 · 잘린 응답 처리 · 결과 저장(이어서 처리).
 *
 * - 네트워크 오류·서버 과부하(429·5xx)·해석할 수 없는 응답 → 잠시 뒤 다시 시도 (최대 3번)
 * - 응답이 길이 제한에 걸려 잘리면 → 더 긴 한도와 "더 짧게" 지시로 다시 요청, 마지막에는 잘린 JSON을 복구해 쓴다
 * - cached(): 같은 요청(시스템·사용자 글·스키마)의 결과를 저장해 두고 다시 쓴다 → 중간에 멈춰도 끝난 단계는 다시 하지 않는다
 */
import { announceResume, hiddenMark, hiddenSince, whenVisible } from './visibility';
import { LlmHttpError, LlmJsonError, LlmRefusalError, LlmTruncatedError, type LlmClient, type LlmRequest } from './types';

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
});

/** 잘린 JSON 복구: 닫히지 않은 문자열·배열·객체를 닫고, 마지막의 불완전한 항목은 버린다 */
export function repairJson(text: string): unknown {
  const s = text.slice(Math.max(0, text.indexOf('{')));
  try { return JSON.parse(s); } catch { /* 아래에서 복구 */ }
  const stack: string[] = [];
  let inStr = false, esc = false, lastSafe = -1, safeStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); lastSafe = i; safeStack = [...stack]; }
    else if (c === ',') { lastSafe = i - 1; safeStack = [...stack]; }
  }
  if (lastSafe < 0) throw new LlmJsonError(text, '복구할 수 없습니다');
  const body = s.slice(0, lastSafe + 1).replace(/,\s*$/, '');
  const fixed = body + [...safeStack].reverse().join('');
  try { return JSON.parse(fixed); } catch (e) { throw new LlmJsonError(text, `복구 실패: ${(e as Error).message}`); }
}

const retryable = (e: unknown) => e instanceof LlmJsonError || e instanceof LlmTruncatedError || (e instanceof LlmHttpError && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500))
  || (e instanceof TypeError) /* fetch 네트워크 오류 */ || /overloaded|rate.?limit|timeout|network|ECONN|529|503|502/i.test(String((e as Error)?.message ?? ''));

/** 요청 한도·과부하 (429·529·overloaded): 잠깐이 아니라 넉넉히 기다려야 풀린다 */
export const rateLimited = (e: unknown) => { const st = (e as { status?: number })?.status; return st === 429 || st === 529 || /rate.?limit|overloaded|too many requests/i.test(String((e as Error)?.message ?? '')); };
/** 서버가 알려 준 대기 시간 (초) — 없으면 undefined */
function retryAfterSec(e: unknown): number | undefined {
  const h = (e as { headers?: unknown })?.headers as { get?: (k: string) => string | null } | Record<string, string> | undefined;
  const v = typeof h?.get === 'function' ? h.get('retry-after') : (h as Record<string, string> | undefined)?.['retry-after'];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(120, n) : undefined;
}
/**
 * 연결이 끊긴 오류인가 (서버가 답한 오류가 아니다). 앱을 벗어나 끊긴 것은 이런 오류로만 나타난다.
 * v0.92: 전에는 요청 중에 화면이 한 번이라도 가려졌으면 서버 오류(429 등)까지 "앱을 벗어나 끊겼다"로 보고 바로 다시 보냈다.
 */
export const connectionDropped = (e: unknown) => {
  const st = (e as { status?: number })?.status;
  if (typeof st === 'number' && st > 0) return false;
  return e instanceof TypeError || (e as Error)?.name === 'AbortError' || (e instanceof LlmHttpError && e.status === 0) || /network|failed to fetch|load failed|connection|ECONN|socket|terminated/i.test(String((e as Error)?.message ?? ''));
};
/** 다시 보내기 전에 기다릴 시간 */
function backoffMs(e: unknown, attempt: number, base: number): number {
  if (!rateLimited(e)) return base * attempt;
  // 한도 초과: 서버가 알려 준 시간, 없으면 15초·30초·45초 (짧게 기다리면 또 걸려 요청만 낭비한다). 테스트처럼 base가 작으면 그에 맞춘다
  return Math.round((retryAfterSec(e) ?? 15 * attempt) * 1000 * Math.min(1, base / 2000));
}

export interface RobustOptions {
  attempts?: number; baseDelayMs?: number; maxTokensCap?: number; onRetry?: (attempt: number, reason: string, label?: string) => void;
  /** 요청 한도에 걸렸을 때 알린다 (동시 요청 수를 줄이는 데 쓴다) */
  onRateLimit?: () => void;
  /** 늘린 한도를 기억할 이름 (보통 모델 이름). 같은 이름이면 클라이언트를 새로 만들어도 이어서 쓴다 */
  learnKey?: string;
}

/**
 * 배운 출력 한도 배율 (v0.83.1): 잘려서 한도를 늘려 성공하면 그 배율을 기억해 이후 요청에 처음부터 쓴다.
 * 같은 모델로 이어지는 단계(카드 변환의 세계 구조 → 임무 → 장면 → 규칙…)가 매번 잘렸다가 다시 하지 않게.
 * max_tokens는 상한일 뿐이라 늘려도 실제로 쓴 만큼만 든다.
 */
const BOOST_KEY = 'wf.llm.tokenBoost';
const MAX_BOOST = 4;
const boosts = new Map<string, number>();
let boostsLoaded = false;
function loadBoosts() {
  if (boostsLoaded) return;
  boostsLoaded = true;
  try { const raw = globalThis.localStorage?.getItem(BOOST_KEY); if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, number>)) if (Number.isFinite(v) && v > 1) boosts.set(k, Math.min(MAX_BOOST, v)); } catch { /* 저장소 없음 */ }
}
function saveBoosts() {
  try { globalThis.localStorage?.setItem(BOOST_KEY, JSON.stringify(Object.fromEntries(boosts))); } catch { /* 저장소 없음 */ }
}
export function tokenBoost(key: string): number { loadBoosts(); return boosts.get(key) ?? 1; }
export function learnTokenBoost(key: string, factor: number) {
  loadBoosts();
  const f = Math.min(MAX_BOOST, Math.round(factor * 100) / 100);
  if (f > (boosts.get(key) ?? 1)) { boosts.set(key, f); saveBoosts(); }
}
export function resetTokenBoost(key?: string) { loadBoosts(); if (key) boosts.delete(key); else boosts.clear(); saveBoosts(); }
/** 모델이 받을 수 없는 한도라는 오류 */
const tooManyTokens = (e: unknown) => (e as { status?: number })?.status === 400 && /max_?tokens|max_completion|maximum.*tokens|output.*tokens/i.test(String((e as Error)?.message ?? ''));

export function robust(llm: LlmClient, o: RobustOptions = {}): LlmClient {
  const attempts = o.attempts ?? 3, base = o.baseDelayMs ?? 2000, cap = o.maxTokensCap ?? 32000;
  return {
    async stream(req, onText, signal) {
      let quiet = false; // 백그라운드로 끊겨 다시 할 때는 화면에 이미 일부가 나갔으므로 새 글은 내보내지 않고 다 받은 뒤 결과로만 돌려준다
      let resumes = 0;
      for (let i = 1; ; i++) {
        let sent = false;
        const mark = hiddenMark();
        try { return await llm.stream(req, (d) => { sent = true; if (!quiet) onText(d); }, signal); } catch (e) {
          if (signal?.aborted || e instanceof LlmRefusalError) throw e;
          // 모바일에서 앱을 벗어나 연결이 끊김 → 돌아온 뒤 다시 (재시도 횟수와 따로, 최대 3번)
          if (hiddenSince(mark) && resumes < 3 && connectionDropped(e)) {
            resumes++; i--;
            o.onRetry?.(resumes, '앱을 벗어나 연결이 끊겨 돌아온 뒤 다시 요청합니다', req.label);
            await whenVisible(signal);
            announceResume(req.label);
            if (sent) quiet = true;
            continue;
          }
          // 글이 이미 나가기 시작했으면 다시 하지 않는다 (화면에 중복이 생긴다)
          if (sent || i >= attempts || !retryable(e)) throw e;
          if (rateLimited(e)) o.onRateLimit?.();
          o.onRetry?.(i, rateLimited(e) ? `요청 한도에 걸려 ${Math.round(backoffMs(e, i, base) / 1000)}초 기다렸다가 다시 보냅니다` : (e as Error).message, req.label);
          await sleep(backoffMs(e, i, base), signal);
        }
      }
    },
    async json<T>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
      const key = o.learnKey;
      let boost = key ? tokenBoost(key) : 1;
      let r = boost > 1 ? { ...req, maxTokens: Math.min(cap, Math.round(req.maxTokens * boost)) } : req;
      let lastTruncated = '';
      let resumes = 0;
      for (let i = 1; ; i++) {
        const mark = hiddenMark();
        try {
          const out = await llm.json<T>(r, schema, signal);
          if (key && r.maxTokens > req.maxTokens) learnTokenBoost(key, r.maxTokens / req.maxTokens);
          return out;
        } catch (e) {
          if (signal?.aborted || e instanceof LlmRefusalError) throw e;
          // 늘린 한도를 모델이 받지 못함 → 배운 배율을 버리고 원래 한도로 (재시도 횟수에 넣지 않는다)
          if (boost > 1 && tooManyTokens(e) && key) {
            resetTokenBoost(key); boost = 1; i--;
            r = { ...r, maxTokens: req.maxTokens };
            continue;
          }
          // 모바일에서 앱을 벗어나 연결이 끊김 → 돌아온 뒤 다시 (재시도 횟수와 따로)
          if (hiddenSince(mark) && resumes < 3 && connectionDropped(e)) {
            resumes++; i--;
            o.onRetry?.(resumes, '앱을 벗어나 연결이 끊겨 돌아온 뒤 다시 요청합니다', req.label);
            await whenVisible(signal);
            announceResume(req.label);
            continue;
          }
          if (req.meter) (req.meter.retryNotes ??= []).push(e instanceof LlmTruncatedError ? '길이 제한' : e instanceof LlmJsonError ? 'JSON 오류' : (e as { status?: number })?.status ? `HTTP ${(e as { status?: number }).status}` : String((e as Error)?.message ?? e).slice(0, 40));
          if (e instanceof LlmTruncatedError) {
            lastTruncated = e.text;
            r = { ...r, maxTokens: Math.min(cap, Math.round(r.maxTokens * 1.5)), system: `${req.system}\n- (중요) 앞선 응답이 길이 제한에 걸려 잘렸다. 각 설명을 짧게 줄이고 항목 수를 줄여, 같은 형식의 완전한 JSON을 출력한다.` };
          }
          if (i >= attempts || !retryable(e)) {
            // 마지막 수단: 잘린 응답을 복구해 쓴다 (뒤쪽 항목 일부가 빠질 수 있다)
            const partial = lastTruncated || (e instanceof LlmJsonError ? e.text : '');
            if (partial) { try { return repairJson(partial) as T; } catch { /* 원래 오류를 알린다 */ } }
            throw e;
          }
          if (rateLimited(e)) o.onRateLimit?.();
          o.onRetry?.(i, rateLimited(e) ? `요청 한도에 걸려 ${Math.round(backoffMs(e, i, base) / 1000)}초 기다렸다가 다시 보냅니다` : (e as Error).message, req.label);
          // 길이 제한으로 잘린 것은 서버 문제가 아니므로 기다리지 않고 바로 다시 요청한다
          if (!(e instanceof LlmTruncatedError)) await sleep(backoffMs(e, i, base), signal);
        }
      }
    },
  };
}

export interface ResultCache { get(key: string): Promise<unknown | undefined>; set(key: string, value: unknown): Promise<void> }

async function hashKey(parts: string[]): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u0000')));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 같은 요청의 구조화 응답을 저장해 두고 다시 쓴다 (스트리밍 글은 저장하지 않는다) */
export function cached(llm: LlmClient, cache: ResultCache, onHit?: () => void): LlmClient {
  return {
    stream: (req, onText, signal) => llm.stream(req, onText, signal),
    async json<T>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
      const key = await hashKey([req.system, req.user, JSON.stringify(schema)]);
      try { const hit = await cache.get(key); if (hit !== undefined) { onHit?.(); return hit as T; } } catch { /* 저장소가 없으면 그냥 호출 */ }
      const out = await llm.json<T>(req, schema, signal);
      try { await cache.set(key, out); } catch { /* 저장 실패는 무시 */ }
      return out;
    },
  };
}
