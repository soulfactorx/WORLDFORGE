import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { makeRisum } from '../test/risum';
import { parseRisum } from './risum';
import { BlobZip } from './blobzip';

describe('risum', () => {
  it('본문 JSON과 에셋을 정확히 해독한다', async () => {
    const module = { name: '모듈', lorebook: [{ comment: '세계관', content: '한글 내용 ✓' }], trigger: [{ type: 'start', effect: [{ type: 'triggerlua', code: 'EVENTS = { { id = "E1", day = 3 } }' }] }],
      assets: [['Hedwig_smile', '', 'webp'], ['map', '', 'png']] };
    const r = await parseRisum(new Blob([new Uint8Array(makeRisum(module, [new Uint8Array([1, 2, 3]), new Uint8Array([9, 9])]))]));
    expect(r.module.lorebook![0]!.content).toBe('한글 내용 ✓');
    expect(r.assets.map((a) => `${a.name}.${a.ext}:${a.size}`)).toEqual(['Hedwig_smile.webp:3', 'map.png:2']);
    expect(await r.assets[0]!.read()).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('잘못된 파일은 거부', async () => {
    await expect(parseRisum(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])]))).rejects.toThrow('매직');
  });
});

describe('BlobZip', () => {
  const zip = zipSync({ 'card.json': strToU8('{"a":1}'), 'assets/x.png': new Uint8Array(5000).fill(7), 'module.risum': new Uint8Array([111]) }, { level: 6 });
  it('일반 zip, 표지가 붙은 zip, 압축 항목 읽기', async () => {
    for (const prefix of [0, 180_305]) {
      const all = new Uint8Array(prefix + zip.length);
      all.fill(0xab, 0, prefix);
      all.set(zip, prefix);
      const z = (await BlobZip.open(new Blob([all])))!;
      expect(z.prefixBytes).toBe(prefix);
      expect(z.entries.map((e) => e.name)).toEqual(['card.json', 'assets/x.png', 'module.risum']);
      expect(new TextDecoder().decode(await z.readBytes(z.get('card.json')!))).toBe('{"a":1}');
      expect((await z.readBytes(z.get('assets/x.png')!)).length).toBe(5000);
      expect((await z.readBlob(z.get('module.risum')!)).size).toBe(1);
    }
  });
  it('zip이 아니면 null', async () => {
    expect(await BlobZip.open(new Blob([strToU8('hello world, this is not a zip file at all')]))).toBeNull();
  });
});

describe('.risum 단독 파일 (v0.61)', () => {
  it('모듈 이름·로어북·이미지 에셋을 카드 묶음처럼 읽는다 (이미지가 아닌 에셋은 뺀다)', async () => {
    const { readCharxBundle } = await import('./bundle');
    const { inferCandidates } = await import('./inferCharacters');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const module = { name: '왕궁 모듈', description: '왕궁 설정', lorebook: [{ comment: '세라', key: '세라', content: '이름: 세라\n나이: 19\n외모: 은발\n성격: 다정함\n말투: 존댓말' }, { comment: '폴더', mode: 'folder', content: 'x' }],
      assets: [['sera_smile', '', 'png'], ['bgm', '', 'mp3'], ['sera_angry', '', 'png']] };
    const file = new File([new Uint8Array(makeRisum(module, [png, new Uint8Array([7]), png]))], 'palace.risum');
    const b = await readCharxBundle(file, file.name);
    expect(b.card.format).toBe('risum');
    expect(b.card.name).toBe('왕궁 모듈');
    expect(b.card.lore.map((e) => e.name)).toEqual(['세라']);
    expect(b.assets.map((a) => a.name)).toEqual(['sera_smile', 'sera_angry']);
    expect((await b.assets[0]!.read()).type).toBe('image/png');
    expect(b.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.warnings[0]).toContain('이미지 2장');
    // 이름 없는 확장자라도 매직 번호로 알아본다
    const b2 = await readCharxBundle(new File([new Uint8Array(makeRisum(module, [png]))], 'module.bin'), 'module.bin');
    expect(b2.card.format).toBe('risum');
    expect(inferCandidates(b).candidates.some((c) => c.name === '세라')).toBe(true);
  });
});
