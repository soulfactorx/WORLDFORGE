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
  /** 원본 크기(1:1)로 보기 (v0.66): 큰 그림은 스크롤해서 본다 */
  const [actual, setActual] = useState(false);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const open = (e: Event) => { setShown((e as CustomEvent<{ src: string; caption: string }>).detail); setActual(false); setDim(null); };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);
  useEffect(() => {
    if (!shown) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(null); if (e.key === '1' || e.key === 'o') setActual((a) => !a); };
    document.addEventListener('keydown', esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [shown]);
  if (!shown) return null;
  return (
    <div className={`lightbox${actual ? ' actual' : ''}`} role="dialog" aria-modal="true" aria-label={shown.caption || '이미지 크게 보기'} onClick={() => setShown(null)}>
      <div className="lightbox-tools" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setActual((a) => !a)} title="원본 크기 ↔ 화면에 맞추기 (단축키 1)">{actual ? '⤡ 화면에 맞추기' : '⤢ 원본 크기 (1:1)'}</button>
        {dim && <span className="lightbox-dim">{dim.w.toLocaleString()} × {dim.h.toLocaleString()}px</span>}
        <a className="lightbox-open" href={shown.src} target="_blank" rel="noreferrer" download={shown.caption ? `${shown.caption.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)}` : undefined} title="새 탭에서 열기·저장">⤓</a>
        <button type="button" className="lightbox-close" aria-label="닫기" onClick={() => setShown(null)}>✕</button>
      </div>
      <div className="lightbox-stage" onClick={(e) => { if (actual) e.stopPropagation(); }}>
        <img src={shown.src} alt={shown.caption} className={shown.src.startsWith('data:image/svg') || /\.svg($|\?)/i.test(shown.src) ? 'vector' : undefined} style={actual && dim ? { width: dim.w, height: dim.h } : undefined} onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth) setDim({ w: im.naturalWidth, h: im.naturalHeight }); }}
          onClick={(e) => { e.stopPropagation(); setActual((a) => !a); }} />
      </div>
      {shown.caption && <p className="lightbox-caption">{shown.caption}</p>}
    </div>
  );
}
