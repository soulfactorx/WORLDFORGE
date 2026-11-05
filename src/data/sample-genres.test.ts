import { describe, expect, it } from 'vitest';
import { validateWorld } from '../engine/package/validate';
import { reskinner, genreGuide, levelCapOf } from '../engine/genre';
import { romanceSample, wuxiaSample } from './sample-genres';
import { sampleWorld } from './sample-world';
import { stockDataUrl } from './stockart';
import { assignStockImages } from '../gm/worldgen/stock';

describe('장르 코어 (설계 v3 R1)', () => {
  it('샘플 세계는 오류·경고 없이 검사를 통과하고, 이미지가 모두 그려진다', () => {
    for (const w of [wuxiaSample, romanceSample]) {
      expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
      for (const a of w.assets!) expect(stockDataUrl(a.id)).toBeTruthy();
    }
  });
  it('무협은 직업·카드·적·자원 이름을 바꾸고, 하이 판타지는 그대로 둔다', () => {
    const rs = reskinner(wuxiaSample);
    expect(rs('파이터 2레벨 · 1레벨 슬롯 2/2 · 롱소드로 고블린 전사를 공격')).toBe('검객 2레벨 · 내공 1성 2/2 · 장검으로 산적 졸개를 공격');
    expect(reskinner(sampleWorld)('파이터의 롱소드')).toBe('파이터의 롱소드');
    expect(genreGuide(wuxiaSample)).toContain('무협');
    expect(genreGuide(romanceSample)).toContain('로맨스');
  });
  it('세계마다 최대 레벨 (엔진 상한 이하)', () => {
    expect(levelCapOf(romanceSample)).toBe(3);
    expect(levelCapOf({ genre: { id: 'wuxia', levelCap: 1 } })).toBe(1);
    expect(levelCapOf({ genre: { id: 'wuxia', levelCap: 99 } })).toBeLessThanOrEqual(5);
  });
  it('기본 이미지 배정은 장르에 맞는 그림을 고른다', async () => {
    const w = { ...wuxiaSample, assets: [] };
    const r = await assignStockImages(w, undefined, undefined, []);
    expect(r.assets.every((a) => /^stock\.wx-/.test(a.id))).toBe(true);
    const f = await assignStockImages({ ...romanceSample, assets: [] }, undefined, undefined, []);
    expect(f.assets.some((a) => /^stock\.wx-/.test(a.id))).toBe(false);
  });
});
