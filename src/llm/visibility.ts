/**
 * 모바일 백그라운드 대응 (v0.79.8)
 * 모바일 브라우저·설치한 앱은 다른 앱으로 가거나 홈 화면으로 나가면 페이지를 멈추고 진행 중인 연결을 끊는다 (PC는 그렇지 않다).
 * - 숨겨진 적이 있는지 세어 두고, 그 사이에 끊긴 호출은 화면으로 돌아온 뒤 다시 시도한다
 * - AI 처리 중에는 화면이 꺼지지 않게 Wake Lock을 건다 (지원하는 브라우저에서만)
 */
let hiddenCount = 0;
const waiters = new Set<() => void>();
const doc = (globalThis as { document?: Document }).document;
if (doc) {
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') hiddenCount++;
    else { for (const w of waiters) w(); waiters.clear(); void reacquire(); }
  });
}

let forced: boolean | null = null;
export const isHidden = () => (forced ?? doc?.visibilityState === 'hidden');
/** 테스트용: 앱을 벗어남/돌아옴 흉내 */
export function simulateVisibility(hidden: boolean) {
  forced = hidden;
  if (hidden) hiddenCount++;
  else { for (const w of waiters) w(); waiters.clear(); forced = null; }
}
/** 지금까지 숨겨진 횟수 — 호출 시작 때 값과 비교해 그 사이 숨겨졌는지 안다 */
export const hiddenMark = () => hiddenCount;
export const hiddenSince = (mark: number) => hiddenCount !== mark || isHidden();

/** 화면이 다시 보일 때까지 기다린다 */
export function whenVisible(signal?: AbortSignal): Promise<void> {
  if (!isHidden()) return Promise.resolve();
  return new Promise((res, rej) => {
    const done = () => res();
    waiters.add(done);
    signal?.addEventListener('abort', () => { waiters.delete(done); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
  });
}

// ---------------------------------------------------------------- Wake Lock
interface WakeLockSentinelLike { release(): Promise<void>; released?: boolean }
let active = 0;
let lock: WakeLockSentinelLike | null = null;
async function reacquire() {
  if (active <= 0 || isHidden() || (lock && !lock.released)) return;
  try { lock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock?.request('screen') ?? null; } catch { lock = null; }
}
/** AI 처리 동안 화면 켜짐 유지 (끝나면 놓는다) */
export async function holdAwake<T>(run: () => Promise<T>): Promise<T> {
  active++;
  void reacquire();
  try { return await run(); }
  finally {
    active--;
    if (active <= 0 && lock) { const l = lock; lock = null; void l.release().catch(() => {}); }
  }
}

/** 끊긴 요청을 다시 보낼 때 화면에 알리기 */
export const resumeEvents = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
export const announceResume = (label?: string) => resumeEvents?.dispatchEvent(new CustomEvent('resume', { detail: label ?? '' }));
