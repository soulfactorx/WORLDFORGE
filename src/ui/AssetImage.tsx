import { useEffect, useState } from 'react';
import { assetUrl } from '../storage/assets';

/** 세계관 이미지 한 장 (IndexedDB에서 읽어 object URL로 보여준다) */
export function AssetImage({ pkg, id, alt, className }: { pkg: string; id: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    assetUrl(pkg, id).then((u) => { if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [pkg, id]);
  if (!url) return <span className={`asset-ph ${className ?? ''}`} aria-label={alt} />;
  return <img className={className} src={url} alt={alt} title={alt} loading="lazy" />;
}
