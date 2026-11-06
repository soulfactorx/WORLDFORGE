/** 플레이 설정 (이 브라우저에 기억): 적응 난이도 (설계 v4 E5, 기본 켬) · 표시 수준 (설계 v4 E8, 기본 "기본") */
const KEY = 'worldforge.play';
/** immersive = 숫자·알림 최소 (기록에만), standard = 지금처럼, game = 경험치 막대까지 */
export type DisplayLevel = 'immersive' | 'standard' | 'game';
/** 대화 속 이미지 크기 (v0.46.1): 숨김 · 접기(눌러서 펼침) · 작게 · 보통 · 크게 · 화면 폭 */
export type ImageSize = 'hidden' | 'collapsed' | 'small' | 'medium' | 'large' | 'full';
export const IMAGE_SIZES: [ImageSize, string][] = [['full', '화면 폭에 맞게'], ['large', '크게'], ['medium', '보통'], ['small', '작게'], ['collapsed', '접기 (눌러서 펼침)'], ['hidden', '숨기기 (글만)']];
export interface PlayPrefs { adaptive: boolean; display: DisplayLevel; images: ImageSize }
const DEFAULTS: PlayPrefs = { adaptive: true, display: 'standard', images: 'large' };
export function loadPlayPrefs(): PlayPrefs {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PlayPrefs>) }; } catch { return { ...DEFAULTS }; }
}
export function savePlayPrefs(p: PlayPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 무시 */ } }
