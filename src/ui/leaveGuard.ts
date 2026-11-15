/**
 * 뒤로 가기 지킴이 (v0.126): 브라우저·휴대폰의 뒤로 가기가 앱을 떠나지 않고 홈으로 돌아오게 하고,
 * 지금 화면이 떠나도 되는지 묻는다 (예: AI로 만드는 중이면 확인).
 * 화면마다 하나 — 마지막으로 등록한 것이 쓰인다.
 */
import { useEffect, useRef } from 'react';

let current: (() => boolean) | null = null;

/** 지금 화면을 떠나도 되나 (false면 머문다) */
export function mayLeave(): boolean {
  try { return current ? current() : true; } catch { return true; }
}

export function useLeaveGuard(fn: () => boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const g = () => ref.current();
    current = g;
    return () => { if (current === g) current = null; };
  }, []);
}
