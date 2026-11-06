/** 결말 수집 (설계 v4 E8): 세이브를 넘어 세계별로 본 결말을 이 브라우저에 기억한다 */
const KEY = 'worldforge.endings';
function load(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string[]>; } catch { return {}; }
}
export const endingsSeen = (pkgId: string): string[] => load()[pkgId] ?? [];
/** 새로 본 결말이면 true */
export function recordEnding(pkgId: string, endingId: string): boolean {
  const all = load();
  const list = all[pkgId] ?? [];
  if (list.includes(endingId)) return false;
  try { localStorage.setItem(KEY, JSON.stringify({ ...all, [pkgId]: [...list, endingId] })); } catch { /* 무시 */ }
  return true;
}
