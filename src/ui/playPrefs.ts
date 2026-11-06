/** 플레이 설정 (이 브라우저에 기억): 적응 난이도 (설계 v4 E5, 기본 켬) · 표시 수준 (설계 v4 E8, 기본 "기본") */
const KEY = 'worldforge.play';
/** immersive = 숫자·알림 최소 (기록에만), standard = 지금처럼, game = 경험치 막대까지 */
export type DisplayLevel = 'immersive' | 'standard' | 'game';
export interface PlayPrefs { adaptive: boolean; display: DisplayLevel }
const DEFAULTS: PlayPrefs = { adaptive: true, display: 'standard' };
export function loadPlayPrefs(): PlayPrefs {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PlayPrefs>) }; } catch { return { ...DEFAULTS }; }
}
export function savePlayPrefs(p: PlayPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 무시 */ } }
