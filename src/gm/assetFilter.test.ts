import { describe, expect, it } from 'vitest';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { activeCount, EMPTY_FILTER, filterAssets, tagCounts } from './assetFilter';

const a = (id: string, kind: AssetMeta['kind'], extra: Partial<AssetMeta> = {}): AssetMeta => ({ id, name: `${id}.png`, kind, tags: [], mime: 'image/png', size: 1, ...extra });
const assets = [
  a('lia_smile', 'character', { characterId: 'npc/lia', tags: ['smile', 'blush'] }),
  a('lia_angry', 'character', { characterId: 'npc/lia', tags: ['angry'] }),
  a('bo_default', 'character', { characterId: 'npc/bo', tags: ['default'] }),
  a('orphan', 'character'),
  a('town_night', 'scene', { locationId: 'loc/town', tags: ['night'] }),
  a('stock.forest', 'scene', { tags: ['day'] }),
  a('123', 'other'),
];
const world = { characters: [{ id: 'npc/lia', name: '리아', gender: 'F' }, { id: 'npc/bo', name: '보', gender: 'M' }], locations: [{ id: 'loc/town', name: '마을' }] } as unknown as WorldPackage;
const ids = (f: Partial<typeof EMPTY_FILTER>, sel?: Set<string>) => filterAssets(world, assets, { ...EMPTY_FILTER, ...f }, sel).map((x) => x.id);

describe('이미지 필터', () => {
  it('조건 없으면 전부', () => expect(ids({})).toHaveLength(assets.length));
  it('종류·인물·장소', () => {
    expect(ids({ kind: 'other' })).toEqual(['123']);
    expect(ids({ character: 'npc/lia' })).toEqual(['lia_smile', 'lia_angry']);
    expect(ids({ kind: 'character', character: '-' })).toEqual(['orphan']);
    expect(ids({ kind: 'scene', location: '-' })).toEqual(['stock.forest']);
  });
  it('태그는 모두 가져야', () => {
    expect(ids({ tags: ['smile'] })).toEqual(['lia_smile']);
    expect(ids({ tags: ['smile', 'angry'] })).toEqual([]);
  });
  it('상태', () => {
    expect(ids({ state: 'untagged' })).toEqual(['bo_default', 'orphan', '123']);
    expect(ids({ state: 'unlinked' })).toEqual(['orphan', 'stock.forest', '123']);
    expect(ids({ state: 'stock' })).toEqual(['stock.forest']);
    expect(ids({ state: 'selected' }, new Set(['123']))).toEqual(['123']);
  });
  it('검색어: 이름·인물 이름·성별, -로 빼기', () => {
    expect(ids({ q: '리아' })).toEqual(['lia_smile', 'lia_angry']);
    expect(ids({ q: '리아 -angry' })).toEqual(['lia_smile']);
    expect(ids({ q: '남성' })).toEqual(['bo_default']);
  });
  it('정렬과 조건 수', () => {
    expect(ids({ kind: 'character', sort: 'name' })[0]).toBe('bo_default');
    expect(activeCount({ ...EMPTY_FILTER, kind: 'scene', tags: ['a', 'b'] })).toBe(3);
  });
  it('태그 수는 다른 조건 안에서 센다', () => {
    const t = tagCounts(world, assets, { ...EMPTY_FILTER, character: 'npc/lia' });
    expect(t.map(([k]) => k).sort()).toEqual(['angry', 'blush', 'smile']);
    expect(tagCounts(world, assets, { ...EMPTY_FILTER, kind: 'map', tags: ['x'] })).toEqual([['x', 0]]);
  });
});
