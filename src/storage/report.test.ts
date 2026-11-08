import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { db } from './db';
import { deleteImageKeys, deleteOldVersions, storageReport } from './report';

describe('저장소 관리 (v0.77)', () => {
  it('세계관별 버전·이미지(안 쓰는 것)·세이브와 주인 없는 데이터를 센다', async () => {
    const w1 = { ...structuredClone(sampleWorld), manifest: { ...sampleWorld.manifest, id: 'my.world', name: '내 세계', version: '1.0.0' }, assets: [{ id: 'a1', name: 'a1', kind: 'character', tags: [] }] } as unknown as WorldPackage;
    const w2: WorldPackage = { ...w1, manifest: { ...w1.manifest, version: '1.1.0' } };
    await db.packages.bulkPut([
      { key: 'my.world@1.0.0', id: 'my.world', version: '1.0.0', name: '내 세계', world: w1, source: 'created', updatedAt: 1 },
      { key: 'my.world@1.1.0', id: 'my.world', version: '1.1.0', name: '내 세계', world: w2, source: 'created', updatedAt: 2 },
    ]);
    await db.assets.bulkPut([
      { key: 'my.world/a1', pkg: 'my.world', blob: new Blob(['x'.repeat(100)]) },
      { key: 'my.world/old', pkg: 'my.world', blob: new Blob(['x'.repeat(50)]) },
      { key: 'gone.world/z', pkg: 'gone.world', blob: new Blob(['x'.repeat(30)]) },
    ]);
    await db.saves.put({ id: 's1', name: '모험', packageId: 'my.world', packageVersion: '1.1.0', createdAt: 1, updatedAt: 3 });
    await db.events.bulkPut([{ saveId: 's1', seq: 0, turn: 0, event: { type: 'narration', text: '시작' } }, { saveId: 'ghost', seq: 0, turn: 0, event: { type: 'narration', text: '유령' } }] as never);

    const r = await storageReport();
    const mine = r.worlds.find((w) => w.id === 'my.world')!;
    expect(mine.versions).toHaveLength(2);
    expect(mine.images).toMatchObject({ count: 2, bytes: 150, unusedCount: 1, unusedBytes: 50 });
    expect(mine.saves).toHaveLength(1);
    expect(mine.saves[0]!.events).toBe(1);
    expect(r.orphans.images.keys).toEqual(['gone.world/z']);
    expect(r.orphans.saves.ids).toEqual(['ghost']);
    expect(r.categories.find((c) => c.key === 'assets')).toMatchObject({ count: 3, bytes: 180 });

    expect(await deleteOldVersions('my.world')).toBe(1);
    await deleteImageKeys(mine.images.unusedKeys);
    const r2 = await storageReport();
    expect(r2.worlds.find((w) => w.id === 'my.world')!.versions.map((v) => v.version)).toEqual(['1.1.0']);
    expect(r2.worlds.find((w) => w.id === 'my.world')!.images.unusedCount).toBe(0);
  });
});
