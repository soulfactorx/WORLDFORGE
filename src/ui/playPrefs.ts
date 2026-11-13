/** 플레이 설정 (이 브라우저에 기억): 표시 수준 (설계 v4 E8, 기본 "기본") 등. 난이도는 세이브마다 따로 기억한다 (engine/difficulty) */
const KEY = 'worldforge.play';
/** immersive = 숫자·알림 최소 (기록에만), standard = 지금처럼, game = 경험치 막대까지 */
export type DisplayLevel = 'immersive' | 'standard' | 'game';
/** 대화 속 이미지 크기 (v0.46.1): 숨김 · 접기(눌러서 펼침) · 작게 · 보통 · 크게 · 화면 폭 */
export type ImageSize = 'hidden' | 'collapsed' | 'small' | 'medium' | 'large' | 'full';
export const IMAGE_SIZES: [ImageSize, string][] = [['full', '화면 폭에 맞게'], ['large', '크게'], ['medium', '보통'], ['small', '작게'], ['collapsed', '접기 (눌러서 펼침)'], ['hidden', '숨기기 (글만)']];
/** 장면 서술 (v0.50): scene = 장면 설정을 따름 · fixed = 정해진 글만 · end = 끝날 때만 AI · ai = 매 차례 AI */
export type SceneNarration = 'scene' | 'fixed' | 'end' | 'ai';
export const SCENE_NARRATIONS: [SceneNarration, string][] = [['scene', '장면 설정을 따름'], ['fixed', '정해진 글만 (AI 없이 빠르게)'], ['end', '끝날 때만 AI 서술'], ['ai', '매 차례 AI가 장면 서술']];
/** 배경 이미지 (v0.59): every = 매 턴 서술 맨 앞, change = 장소·장면이 바뀔 때만 */
export type BackgroundMode = 'every' | 'change';
export interface PlayPrefs { display: DisplayLevel; images: ImageSize; sceneNarration: SceneNarration; background: BackgroundMode; /** GM 스타일 덮어쓰기 ('world' = 세계 설정 따름, v0.80) */ gmStyle: string; /** 판정 기술을 SRD 18종으로 자세히 (v0.112, 끄면 접근법 6가지) */ skillDetail: boolean }
const DEFAULTS: PlayPrefs = { display: 'standard', images: 'large', sceneNarration: 'scene', background: 'every', gmStyle: 'world', skillDetail: false };
export function loadPlayPrefs(): PlayPrefs {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PlayPrefs>) }; } catch { return { ...DEFAULTS }; }
}
export function savePlayPrefs(p: PlayPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 무시 */ } }
