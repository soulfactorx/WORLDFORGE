import { useEffect, useState } from 'react';
import { assetUrl } from '../storage/assets';
import { ZoomImg } from './Lightbox';

/** 세계관 이미지 한 장 (IndexedDB에서 읽어 object URL로 보여준다) */
/** zoom: 누르면 크게 보기 (누르는 동작이 따로 있는 곳 — 전투 토큰, "눌러서 붙이기" — 에서는 끈다) */
export function AssetImage({ pkg, id, alt, className, zoom }: { pkg: string; id: string; alt: string; className?: string; zoom?: boolean }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    assetUrl(pkg, id).then((u) => { if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [pkg, id]);
  if (!url) return <span className={`asset-ph ${className ?? ''}`} aria-label={alt} />;
  if (zoom) return <ZoomImg className={className} src={url} alt={alt} />;
  return <img className={className} src={url} alt={alt} title={alt} loading="lazy" />;
}
