/**
 * 화면 아래쪽 알림 (v0.82.1): 화면 맨 위 상태 줄은 스크롤해 둔 위치에서 보이지 않으므로, 지금 보는 자리에 띄운다.
 * 몇 초 뒤 저절로 사라지고 ✕로 닫을 수 있다. 오류(❌)는 닫을 때까지 남는다.
 */
import { useEffect, useState } from 'react';

export function Toast({ message, onClose, ms = 5000 }: { message: string; onClose: () => void; ms?: number }) {
  const [shown, setShown] = useState(!!message);
  const isError = message.startsWith('❌');
  useEffect(() => {
    setShown(!!message);
    if (!message || isError) return;
    const t = setTimeout(() => { setShown(false); onClose(); }, ms);
    return () => clearTimeout(t);
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown || !message) return null;
  return (
    <div className={`toast${isError ? ' toast-error' : ''}`} role={isError ? 'alert' : 'status'} aria-live="polite">
      <span className="toast-text">{message}</span>
      <button type="button" className="toast-close" onClick={() => { setShown(false); onClose(); }} aria-label="알림 닫기">✕</button>
    </div>
  );
}
