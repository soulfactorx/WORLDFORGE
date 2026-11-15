import { describe, expect, it } from 'vitest';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { attachImages, detachImage, imagesOf, newImageIds, previewPick, tagSummary, toggleTag, uploadedMeta } from './entityImages';

const a = (id: string, extra: Partial<AssetMeta>): AssetMeta => ({ id, name: id, kind: 'other', tags: [], mime: 'image/png', size: 1, ...extra });
const lia = { kind: 'character' as const, id: 'npc/lia', name: '리아' };
const town = { kind: 'location' as const, id: 'loc/town', name: '마을' };

describe('인물·장소 이미지 (v0.127)', () => {
  it('올린 파일: 이름의 표정 낱말은 태그로, 첫 그림은 기본 모습', () => {
    const ids = newImageIds([], 3, 1);
    expect(new Set(ids).size).toBe(3);
    const m = uploadedMeta([{ name: 'lia_front.png', mime: 'image/png', size: 1 }, { name: '리아_웃음_02.webp', mime: 'image/webp', size: 1 }, { name: 'night-angry.jpg', mime: '', size: 1 }], lia, [], ids);
    expect(m.map((x) => x.tags)).toEqual([['front', 'default'], ['웃음'], ['night', 'angry']]);
    expect(m[0]).toMatchObject({ kind: 'character', characterId: 'npc/lia', name: 'lia_front' });
    const s = uploadedMeta([{ name: 'square.png', mime: 'image/png', size: 1 }], town, [], ['x']);
    expect(s[0]).toMatchObject({ kind: 'scene', locationId: 'loc/town', tags: ['square', 'default'] });
  });
  it('붙이기·떼기·태그', () => {
    let list = [a('o1', {}), a('stock.x--0', { kind: 'character', characterId: 'npc/lia', tags: ['default'] })];
    list = attachImages(list, ['o1'], lia);
    expect(imagesOf(list, lia).map((x) => x.id)).toEqual(['o1', 'stock.x--0']);
    list = toggleTag(list, 'o1', ' Smile ');
    list = toggleTag(list, 'o1', 'night');
    expect(list[0]!.tags).toEqual(['smile', 'night']);
    expect(tagSummary(imagesOf(list, lia))).toEqual([['default', 1], ['night', 1], ['smile', 1]]);
    list = toggleTag(list, 'o1', 'night');
    list = detachImage(list, 'o1');
    expect(list[0]).toMatchObject({ kind: 'other' });
    expect(list[0]!.characterId).toBeUndefined();
    expect(detachImage(list, 'stock.x--0').map((x) => x.id)).toEqual(['o1']);
  });
  it('시험: 같은 뜻 태그 → 없으면 기본', () => {
    const w = { characters: [{ id: 'npc/lia', name: '리아' }], locations: [], assets: [
      a('d', { kind: 'character', characterId: 'npc/lia', tags: ['default'] }),
      a('h', { kind: 'character', characterId: 'npc/lia', tags: ['happy'] }),
    ] } as unknown as WorldPackage;
    expect(previewPick(w, lia, '웃음')!.id).toBe('h');
    expect(previewPick(w, lia, 'angry')!.id).toBe('d');
  });
});
