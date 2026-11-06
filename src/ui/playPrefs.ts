/** 플레이 설정 (이 브라우저에 기억): 적응 난이도 (설계 v4 E5, 기본 켬) */
const KEY = 'worldforge.play';
export interface PlayPrefs { adaptive: boolean }
export function loadPlayPrefs(): PlayPrefs {
  try { return { adaptive: true, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PlayPrefs>) }; } catch { return { adaptive: true }; }
}
export function savePlayPrefs(p: PlayPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 무시 */ } }
