import { describe, expect, it } from 'vitest';
import type { WorldPackage } from '../engine/schema';
import { assetRefs, ownFiles } from './assetRefs';

describe('이미지를 쓰는 곳 (v0.136)', () => {
  it('장면 등에서 가리키는 ID만 센다 (이미지 목록 자체는 빼고)', () => {
    const w = { assets: [{ id: 'a1' }, { id: 'a2' }], scenes: [{ id: 's', image: 'a1', phases: [{ id: 'p', image: 'a1' }] }] } as unknown as WorldPackage;
    expect([...assetRefs(w, ['a1', 'a2'])]).toEqual([['a1', 2]]);
    expect(ownFiles(['a1', 'stock.x--0', 'user.y--1'])).toEqual(['a1']);
  });
});
