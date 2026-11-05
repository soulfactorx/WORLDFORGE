/**
 * 화면 방향 (설치한 웹앱용, v0.37.9).
 * 기본은 "시스템 설정 따름" — 웹앱 설정(manifest)에 방향을 정하지 않아 브라우저가 휴대폰의 회전 고정을 따른다.
 * 그런데 일부 브라우저(예: 삼성 인터넷)로 설치한 앱은 회전 고정을 무시하고 센서대로 돌아간다.
 * 웹 페이지는 휴대폰의 회전 고정 상태를 읽을 수 없으므로, 그런 경우를 위해 세로·가로 고정을 직접 고를 수 있게 한다.
 */
export type OrientationPref = 'system' | 'portrait' | 'landscape';

const KEY = 'worldforge.orientation';

export function loadOrientation(): OrientationPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'portrait' || v === 'landscape' ? v : 'system';
  } catch { return 'system'; }
}

/** 설치한 앱(독립 창)으로 실행 중인가 — 브라우저 탭에서는 방향을 고정할 수 없다 */
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true);

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

/** 선호 방향 적용. 결과: 'ok' | 'unsupported' (브라우저가 고정을 지원하지 않거나 탭에서 실행 중) */
export async function applyOrientation(pref: OrientationPref): Promise<'ok' | 'unsupported'> {
  const so = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
  if (!so) return 'unsupported';
  try {
    if (pref === 'system') { so.unlock?.(); return 'ok'; }
    if (!so.lock) return 'unsupported';
    await so.lock(pref);
    return 'ok';
  } catch { return 'unsupported'; }
}

export async function saveOrientation(pref: OrientationPref): Promise<'ok' | 'unsupported'> {
  try { localStorage.setItem(KEY, pref); } catch { /* 무시 */ }
  return applyOrientation(pref);
}
