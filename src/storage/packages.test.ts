import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { sampleWorld } from '../data/sample-world';
import { blankWorld, exportWpk, parsePackageFile } from './packages';
import { validateWorld } from '../engine/package/validate';

describe('패키지 파일', () => {
  it('.wpk 내보내기 → 가져오기 왕복', async () => {
    const blob = exportWpk(sampleWorld);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const r = parsePackageFile('x.wpk', bytes);
    expect(r.world?.manifest.id).toBe(sampleWorld.manifest.id);
    expect(r.issues).toEqual([]);
  });
  it('.json도 읽는다, 깨진 JSON은 거부', () => {
    expect(parsePackageFile('w.json', strToU8(JSON.stringify(sampleWorld))).world).not.toBeNull();
    expect(parsePackageFile('w.json', strToU8('{oops')).issues[0]!.message).toContain('world.json 형식이 아닙니다');
  });
  it('world.json이 없는 zip, 압축 폭탄은 거부', () => {
    expect(parsePackageFile('a.wpk', zipSync({ 'readme.txt': strToU8('hi') })).issues[0]!.message).toContain('world.json');
    const big = new Uint8Array(60 * 1024 * 1024); // 0으로 채운 60MB → 압축하면 작다
    const bomb = zipSync({ 'world.json': big }, { level: 9 });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(parsePackageFile('bomb.wpk', bomb).issues[0]!.message).toContain('너무 큽니다');
  });
  it('빈 템플릿은 오류 없이 시작할 수 있다', () => {
    expect(validateWorld(blankWorld()).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('패키지 가져오기에 넣은 캐릭터 카드', () => {
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '세렌', description: '여행자' } };
  it('CHARX · 표지 JPEG가 붙은 CHARX · JSON 카드는 카드로 알아본다', () => {
    const charx = zipSync({ 'card.json': strToU8(JSON.stringify(card)) });
    expect(parsePackageFile('a.charx', charx).isCard).toBe(true);
    const poly = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, ...charx]);
    expect(parsePackageFile('a.charx', poly).isCard).toBe(true);
    expect(parsePackageFile('a.json', strToU8(JSON.stringify(card))).isCard).toBe(true);
  });
  it('표지가 붙은 .wpk도 읽고, 둘 다 아니면 안내 문구를 준다', async () => {
    const wpk = new Uint8Array(await exportWpk(sampleWorld).arrayBuffer());
    const poly = new Uint8Array([0xff, 0xd8, 9, 9, ...wpk]);
    expect(parsePackageFile('a.wpk', poly).world?.manifest.id).toBe(sampleWorld.manifest.id);
    const r = parsePackageFile('x.bin', strToU8('not json'));
    expect(r.isCard).toBeFalsy();
    expect(r.issues[0]!.message).toContain('캐릭터 카드');
  });
});

describe('개인용 세계', () => {
  it('내보내기를 막고, 같은 ID로 다시 저장해도 개인용 표시가 남는다', async () => {
    const { savePackage: save } = await import('./packages');
    const { db } = await import('./db');
    const { storeAssets, assetBlob } = await import('./assets');
    const w = { ...blankWorld(), manifest: { ...blankWorld().manifest, id: 'card.test', private: { source: '카드', note: 'x' } } };
    expect(() => exportWpk(w)).toThrow('개인용');
    await save(w, 'created');
    const stripped = { ...w, manifest: { ...w.manifest, private: undefined, version: '0.2.0' } };
    await save(stripped, 'created');
    expect((await db.packages.get('card.test@0.2.0'))!.world.manifest.private?.source).toBe('카드');
    await storeAssets('card.test', [{ id: 'a0', read: async () => new Blob([new Uint8Array([1, 2])], { type: 'image/png' }) }, { id: 'a1', read: async () => { throw new Error('x'); } }]);
    expect((await assetBlob('card.test', 'a0'))?.size).toBe(2);
  });
});

describe('성인 등급 고정', () => {
  it('한 번 성인 등급으로 저장된 세계는 낮춰서 저장해도 성인 등급으로 남는다', async () => {
    const { savePackage: save } = await import('./packages');
    const { db } = await import('./db');
    const w = { ...blankWorld(), manifest: { ...blankWorld().manifest, id: 'me.lock', contentRating: 'mature' as const } };
    await save(w, 'created');
    await save({ ...w, manifest: { ...w.manifest, contentRating: 'teen', version: '0.2.0' } }, 'created');
    expect((await db.packages.get('me.lock@0.2.0'))!.world.manifest.contentRating).toBe('mature');
  });
});
