import type { LlmSettings } from '../llm/types';

const KEY = 'worldforge.llm';

/**
 * API 키는 사용자 브라우저의 localStorage에만 저장된다 (서버로 전송되지 않음).
 * remember=false면 sessionStorage에 두어 탭을 닫으면 사라진다.
 */
export function loadSettings(): LlmSettings | null {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LlmSettings) : null;
  } catch {
    return null;
  }
}

export function saveSettings(s: LlmSettings, remember: boolean): void {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장소 차단 환경: 메모리에서만 사용 */
  }
}
