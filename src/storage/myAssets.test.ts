import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { assetBlob, storeAssets } from './assets';
import { isMyAssets, keepAsAsset, loadMyAssets, MY_ASSETS_ID } from './myAssets';

describe('내 에셋 보관함 (v0.158)', () => {
  it('세계의 것을 그림과 함께 보관하고, 보관할수록 쌓인다 · 성인 등급은 따로', async () => {
    const c = sampleWorld.characters[0]!;
    const w: WorldPackage = { ...sampleWorld, manifest: { ...sampleWorld.manifest, id: 'src.keep' }, assets: [{ id: 'img1', name: 'p', kind: 'character', characterId: c.id, tags: ['default'], mime: 'image/png', size: 2 }] };
    await storeAssets('src.keep', [{ id: 'img1', read: async () => new Blob([new Uint8Array([1, 2])], { type: 'image/png' }) }]);
    await keepAsAsset(w, [{ kind: 'character', id: c.id }]);
    let mine = await loadMyAssets(false);
    expect(isMyAssets(mine)).toBe(true);
    expect(mine.manifest.id).toBe(MY_ASSETS_ID);
    const kept = mine.characters.find((x) => x.name === c.name)!;
    expect(kept).toBeTruthy();
    const img = mine.assets!.find((a) => a.characterId === kept.id)!;
    expect((await assetBlob(MY_ASSETS_ID, img.id))?.size).toBe(2);
    await keepAsAsset(w, [{ kind: 'location', id: sampleWorld.locations[1]!.id }]);
    mine = await loadMyAssets(false);
    expect(mine.characters.length).toBe(1);
    expect(mine.locations.some((l) => l.name === sampleWorld.locations[1]!.name)).toBe(true);
    await keepAsAsset({ ...w, manifest: { ...w.manifest, id: 'src.adult', contentRating: 'mature' } }, [{ kind: 'character', id: c.id }]);
    expect((await loadMyAssets(true)).characters.length).toBe(1);
    expect((await loadMyAssets(false)).manifest.contentRating).toBe('all');
  });
});
