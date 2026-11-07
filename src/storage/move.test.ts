import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { makeCharx } from '../test/charx';
import { readCharxBundle } from '../importers/bundle';
import { blankWorld } from './packages';
import { db } from './db';
import { assetBlob, storeAssets } from './assets';
import { exportMove, importMove, readMoveHeader } from './move';
import type { WorldPackage } from '../engine/schema';

describe('개인 세계 기기 간 이동 (.wfmove)', () => {
  it('같은 카드가 있어야 열리고, 세계·카드 이미지·세이브·내 이미지를 옮긴다', async () => {
    const card = makeCharx(300, 6);
    const b = await readCharxBundle(card, 'w.charx');
    const world: WorldPackage = {
      ...blankWorld(),
      manifest: { ...blankWorld().manifest, id: 'card.move', private: { source: '세계 / 작가 (w.charx)', note: 'x', cardHash: b.fingerprint } },
      assets: [
        { id: 'a1', name: b.assets[1]!.name, kind: 'character', tags: ['default'], mime: b.assets[1]!.mime, size: b.assets[1]!.size },
        { id: 'a9', name: 'cover', kind: 'cover', tags: [], mime: 'image/jpeg', size: 300 },
        { id: 'stock.knight-m--0', name: 's', kind: 'character', tags: ['default'], mime: 'image/svg+xml', size: 0 },
        { id: 'user.me1--1', name: 'm', kind: 'scene', tags: [], mime: 'image/webp', size: 0 },
      ],
    };
    await db.userArt.put({ id: 'me1', kind: 'scene', label: '내 정원', tags: ['정원'], blob: new Blob([new Uint8Array([5, 5])], { type: 'image/webp' }), createdAt: 1 });
    await db.saves.put({ id: 's1', name: '세이브', packageId: 'card.move', packageVersion: '0.1.0', createdAt: 1, updatedAt: 2 });
    await db.events.bulkPut([{ saveId: 's1', seq: 0, turn: 0, event: { type: 'narration', text: '시작' } }, { saveId: 's1', seq: 1, turn: 1, event: { type: 'narration', text: '다음' } }]);
    await storeAssets('card.move', [{ id: 'a1', read: () => b.assets[1]!.read() }]);

    const file = await exportMove(world);
    expect((await readMoveHeader(file)).worldName).toBe(world.manifest.name);
    // 다른 기기라고 치고 비운다
    await Promise.all([db.packages.clear(), db.saves.clear(), db.events.clear(), db.assets.clear(), db.userArt.clear()]);

    await expect(importMove(file, makeCharx(0, 2, { lore: [{ comment: '다른', content: '다른 카드' }] }), 'other.charx')).rejects.toThrow('다른 카드');
    const r = await importMove(file, card, 'w.charx');
    expect(r).toMatchObject({ saves: 1, images: 2 });
    expect((await db.packages.get('card.move@0.1.0'))!.world.manifest.private!.cardHash).toBe(b.fingerprint);
    expect((await assetBlob('card.move', 'a1'))!.size).toBe(b.assets[1]!.size);
    expect((await assetBlob('card.move', 'a9'))!.size).toBe(300);
    expect((await db.events.where('saveId').equals('s1').count())).toBe(2);
    expect((await db.userArt.get('me1'))!.label).toBe('내 정원');
    // 일반 세계는 이 방식으로 옮기지 않는다
    await expect(exportMove(blankWorld())).rejects.toThrow('개인용');
  });
});

describe('직접 만든 성인 등급 세계 (암호로 옮기기)', () => {
  it('암호로 잠그고, 저장된 이미지도 담아 옮긴다. 공유(.wpk)는 막힌다', async () => {
    const { exportWpk } = await import('./packages');
    const world: WorldPackage = { ...blankWorld(), manifest: { ...blankWorld().manifest, id: 'me.adult', contentRating: 'mature' },
      assets: [{ id: 'img1', name: 'x', kind: 'scene', tags: [], mime: 'image/png', size: 3 }] };
    expect(() => exportWpk(world)).toThrow('성인 등급');
    await expect(exportMove({ ...world, manifest: { ...world.manifest, contentRating: 'teen' } }, undefined, 'abcd')).rejects.toThrow('개인용·성인');
    await expect(exportMove(world)).rejects.toThrow('암호');
    await storeAssets('me.adult', [{ id: 'img1', read: async () => new Blob([new Uint8Array([7, 7, 7])], { type: 'image/png' }) }]);
    const file = await exportMove(world, undefined, 'secret-1');
    expect((await readMoveHeader(file)).lock).toBe('pass');
    await db.assets.clear(); await db.packages.clear();
    await expect(importMove(file, null, '', undefined, 'wrong')).rejects.toThrow('암호가 맞지 않습니다');
    const r = await importMove(file, null, '', undefined, 'secret-1');
    expect(r.images).toBe(1);
    expect((await assetBlob('me.adult', 'img1'))!.size).toBe(3);
  });
});

describe('여러 카드로 만든 세계 옮기기 (v0.53)', () => {
  it('기록된 모든 카드 파일이 있어야 열리고, 이미지는 각 카드에서 다시 읽는다', async () => {
    const c1 = makeCharx(200, 3);
    const c2 = makeCharx(400, 3, { lore: [{ comment: '둘째', content: '두 번째 카드' }] });
    const b1 = await readCharxBundle(c1, 'one.charx');
    const b2 = await readCharxBundle(c2, 'two.charx');
    expect(b1.fingerprint).not.toBe(b2.fingerprint);
    const world: WorldPackage = {
      ...blankWorld(),
      manifest: { ...blankWorld().manifest, id: 'multi.move', private: { source: '하나 · 둘', note: 'x', cardHash: b1.fingerprint },
        sources: [
          { hash: b1.fingerprint, name: '하나', fileName: 'one.charx', importedAt: '2026-01-01', via: 'import', ids: { characters: [], facts: [], claims: [], assets: ['x1'] } },
          { hash: b2.fingerprint, name: '둘', fileName: 'two.charx', importedAt: '2026-01-02', via: 'import', ids: { characters: [], facts: [], claims: [], assets: ['x2'] } },
        ] },
      assets: [
        { id: 'x1', name: b1.assets[1]!.name, kind: 'other', tags: [], mime: b1.assets[1]!.mime, size: b1.assets[1]!.size },
        { id: 'x2', name: b2.assets[1]!.name, kind: 'other', tags: [], mime: b2.assets[1]!.mime, size: b2.assets[1]!.size },
      ],
    };
    const file = await exportMove(world);
    const h = await readMoveHeader(file);
    expect(h.cards?.map((c) => c.name)).toEqual(['하나', '둘']);
    await Promise.all([db.packages.clear(), db.assets.clear()]);
    // 한 장만 있으면 빠진 카드를 알려 준다
    await expect(importMove(file, [{ blob: c1, name: 'one.charx' }], '')).rejects.toThrow('"둘"');
    const r = await importMove(file, [{ blob: c2, name: 'two.charx' }, { blob: c1, name: 'one.charx' }], '');
    expect(r.images).toBe(2);
    expect((await assetBlob('multi.move', 'x1'))!.size).toBe(b1.assets[1]!.size);
    expect((await assetBlob('multi.move', 'x2'))!.size).toBe(b2.assets[1]!.size);
  });
});
