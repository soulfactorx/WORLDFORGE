import { describe, expect, it } from 'vitest';
import { imageFilesOf, meaninglessName } from './ImageFiles';

describe('모바일 그림 파일 (v0.134)', () => {
  it('사진 앱이 붙인 이름을 알아본다', () => {
    for (const n of ['1000012345.jpg', 'image.jpg', 'IMG_20240101_123456.jpg', 'PXL_20240101_123456789.jpg', 'Screenshot_2024-01-01.png', 'IMG_1234.HEIC', '3f2a9c1e-12ab-4cde-9f00-112233445566.png', '사진.jpg'])
      expect(meaninglessName(n), n).toBe(true);
    for (const n of ['knight_female_smile.png', '엘라_웃음.webp', 'image_of_castle.png', 'bg_forest.jpg']) expect(meaninglessName(n), n).toBe(false);
  });
  it('종류가 비어 있으면 확장자로', () => {
    const out = imageFilesOf([new File(['x'], 'a.PNG', { type: '' }), new File(['x'], 'b.txt', { type: 'text/plain' }), new File(['x'], 'c.jpg', { type: 'image/jpeg' })]);
    expect(out.map((f) => `${f.name}:${f.type}`)).toEqual(['a.PNG:image/png', 'c.jpg:image/jpeg']);
  });
});
