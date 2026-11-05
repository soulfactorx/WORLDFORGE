import { useEffect, useState } from 'react';

/**
 * 이미지 크게 보기 (v0.37.11). 화면 어디서든 zoomImage(src, 설명)를 부르면 전체 화면에 크게 띄운다.
 * 닫기: 아무 곳이나 누르기 · ✕ · Esc · 뒤로 가기는 쓰지 않는다 (게임 화면이 바뀌지 않게).
 */
const EVENT = 'worldforge:zoom';

export function zoomImage(src: string, caption = '') {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { src, caption } }));
}

/** 누르면 크게 보이는 img */
export function ZoomImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <img className={`${className ?? ''} zoomable`.trim()} src={src} alt={alt} title={alt ? `${alt} — 눌러서 크게 보기` : '눌러서 크게 보기'}
      role="button" tabIndex={0}
      onClick={(e) => { e.stopPropagation(); zoomImage(src, alt); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomImage(src, alt); } }} />
  );
}

export function Lightbox() {
  const [shown, setShown] = useState<{ src: string; caption: string } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setShown((e as CustomEvent<{ src: string; caption: string }>).detail);
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);
  useEffect(() => {
    if (!shown) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(null); };
    document.addEventListener('keydown', esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [shown]);
  if (!shown) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={shown.caption || '이미지 크게 보기'} onClick={() => setShown(null)}>
      <button type="button" className="lightbox-close" aria-label="닫기" onClick={() => setShown(null)}>✕</button>
      <img src={shown.src} alt={shown.caption} />
      {shown.caption && <p className="lightbox-caption">{shown.caption}</p>}
    </div>
  );
}
