/**
 * 그림 파일 고르기 (v0.134).
 * 모바일 브라우저는 "사진"에서 고르면 원래 파일 이름을 넘겨주지 않는 경우가 많다
 * (안드로이드 사진 선택기는 1000012345.jpg 같은 숫자, 아이폰 사진은 image.jpg).
 * 그래서 휴대폰에서는 "파일 앱에서 고르기"를 함께 둔다 — 종류를 정하지 않고(accept 없음) 열면 파일 선택기가 열려 이름이 남는다.
 */
import { useEffect, useState } from 'react';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml';
const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' };

/** 그림 파일만 (종류가 비어 있으면 확장자로 알아본다) */
export function imageFilesOf(files: File[]): File[] {
  return files.flatMap((f) => {
    if (IMAGE_ACCEPT.split(',').includes(f.type)) return [f];
    const mime = EXT_MIME[(f.name.split('.').pop() ?? '').toLowerCase()];
    return mime && (!f.type || f.type === 'application/octet-stream') ? [new File([f], f.name, { type: mime, lastModified: f.lastModified })] : [];
  });
}

/** 사진 앱이 붙인 뜻 없는 이름인가 (숫자 · image · IMG_날짜 · PXL_ · DSC · 스크린샷 · 긴 영숫자) */
export function meaninglessName(name: string): boolean {
  const b = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  return !b || /^\d+$/.test(b) || /^(image|img|photo|pic|picture|pxl|dsc|dcim|mvimg|screenshot|스크린샷|사진|이미지)([\s_\-.()\d]*|[\s_\-.]?\d[\w\s\-.()]*)$/i.test(b) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(b) || /^[0-9a-z]{20,}$/i.test(b);
}

const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };

/** 그림 고르기 버튼: PC는 하나, 휴대폰은 "사진에서" + "파일 앱에서 (이름 유지)" */
export function ImageFileButtons({ onFiles, multiple = true, disabled, label = '📁 이미지 파일 고르기', className = 'file' }: {
  onFiles: (files: File[]) => void; multiple?: boolean; disabled?: boolean; label?: string; className?: string;
}) {
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(coarse()), []);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const fs = imageFilesOf([...(e.target.files ?? [])]); e.target.value = ''; if (fs.length) onFiles(fs); };
  if (!touch) return <label className={className}>{label}<input type="file" multiple={multiple} accept={IMAGE_ACCEPT} disabled={disabled} onChange={pick} /></label>;
  return (
    <span className="image-pick-pair">
      <label className={className}>🖼 사진에서 고르기<input type="file" multiple={multiple} accept={IMAGE_ACCEPT} disabled={disabled} onChange={pick} /></label>
      <label className={className} title="파일 앱(내 파일·파일)에서 고르면 원래 파일 이름이 남아 태그로 쓸 수 있습니다">📁 파일 앱에서 (이름 유지)<input type="file" multiple={multiple} disabled={disabled} onChange={pick} /></label>
    </span>
  );
}
