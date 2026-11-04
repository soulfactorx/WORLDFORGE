import { describe, expect, it } from 'vitest';
import { makeCharx } from '../test/charx';
import { parseToggles, readCharxBundle } from './bundle';

describe('readCharxBundle', () => {
  it('카드·모듈·Lua·모든 이미지를 모은다 (표지 JPEG가 붙어 있어도)', async () => {
    const b = await readCharxBundle(makeCharx(5000), 'w.charx');
    expect(b.card.name).toBe('세계');
    expect(b.extraLore.map((e) => e.name)).toEqual(['모듈 전용']);
    expect(b.extraLore[0]!.keys).toEqual(['x', 'y']);
    expect(b.lua.data.RUIN_YEAR).toBe(429);
    expect(b.lua.data.EVENTS).toEqual([{ id: 'E1', day: 3 }]);
    expect(b.lua.data.x).toBeUndefined();
    expect(b.regexComments).toEqual(['상태창']);
    expect(b.cover?.size).toBe(5000);
    // icon 1 + 카드 목록 15 + 모듈 1 + 목록에 없는 zip 이미지 15
    expect(b.assets.length).toBe(32);
    expect(b.assets.filter((a) => a.source === 'zip').length).toBe(15);
    const h = b.assets.find((a) => a.name === 'Hedwig_4(F)')!;
    expect(h.cardType).toBe('x-risu-asset');
    const blob = await h.read();
    expect(blob.type).toBe('image/webp');
    expect(new Uint8Array(await blob.arrayBuffer())[0]).toBe(4);
    expect(new Uint8Array(await (await b.assets.find((a) => a.source === 'module')!.read()).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('토글 해석', () => {
    expect(parseToggles('kc_lang=언어=select=한국어,English\n=설명 문구=caption\nkc_img=이미지=checkbox')).toEqual([
      { key: 'kc_lang', label: '언어', kind: 'select', options: ['한국어', 'English'], caption: '설명 문구' },
      { key: 'kc_img', label: '이미지', kind: 'checkbox', options: [] },
    ]);
  });
});
