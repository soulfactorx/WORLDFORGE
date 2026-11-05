/** 성인 확인 (설계 v3 15.1): 성인 등급을 고르거나 플레이할 때 처음 한 번 묻고 이 브라우저에 기억한다 */
const KEY = 'worldforge-adult-confirmed';

export function isAdultConfirmed(): boolean {
  try { return localStorage.getItem(KEY) === 'yes'; } catch { return false; }
}

export function confirmAdult(): boolean {
  if (isAdultConfirmed()) return true;
  const ok = confirm('성인 등급 콘텐츠에는 잔혹하고 노골적인 묘사(폭력·성적 묘사)가 나올 수 있습니다.\n만 19세 이상 성인만 이용할 수 있습니다. 성인이십니까?');
  if (ok) { try { localStorage.setItem(KEY, 'yes'); } catch { /* 기억하지 못해도 이번에는 허용 */ } }
  return ok;
}
