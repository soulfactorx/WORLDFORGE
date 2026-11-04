import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import { STOCK_ART, stockDataUrl, stockSvg } from '../../data/stockart';
import { validateWorld } from '../../engine/package/validate';
import type { LlmClient } from '../../llm/types';
import { assignStockImages, guessGender, ruleArtForCharacter, ruleArtForLocation } from './stock';

const base = { id: 'npc/x', appearance: '', personality: '', speech: '', locationId: 'l', improvisation: 'minor' as const };

describe('기본 이미지', () => {
  it('모든 그림이 그려지고 데이터 URL이 된다', () => {
    for (const a of STOCK_ART) expect(stockSvg(a.id)).toMatch(/^<svg/);
    expect(STOCK_ART.filter((a) => a.kind === 'character').length).toBeGreaterThanOrEqual(30);
    expect(STOCK_ART.filter((a) => a.kind === 'scene').length).toBeGreaterThanOrEqual(20);
    expect(stockDataUrl('stock.knight-f--3')).toMatch(/^data:image\/svg\+xml/);
    expect(stockDataUrl('a12')).toBeUndefined();
  });
  it('낱말 규칙: 신분·성별·장소', () => {
    expect(ruleArtForCharacter({ ...base, name: '헤드비히', background: '직함: 시녀장', gender: 'F' }).id).toBe('servant-f');
    expect(ruleArtForCharacter({ ...base, name: '라우젠트', background: '황궁 기사단장. 그는 냉정하다.' }).id).toBe('knight-m');
    expect(guessGender({ ...base, name: '셀레니아', appearance: '그녀는 은발의 여성이다' })).toBe('F');
    expect(ruleArtForLocation({ id: 'l', name: '황제의 집무실', description: '서류가 쌓인 책상', connections: [] }).id).toBe('study');
    expect(ruleArtForLocation({ id: 'l', name: '장미 정원', description: '', connections: [] }).id).toBe('garden');
  });
  it('이미지 없는 인물·장소에만 붙이고, AI가 고른 성별이 틀리면 고친다', async () => {
    const w = structuredClone(sampleWorld);
    w.characters[0]!.gender = 'F';
    const llm: LlmClient = { stream: async () => '', json: async <T,>() => ({ characters: [{ id: w.characters[0]!.id, art: 'mage-m' }], locations: [] }) as T };
    const r = await assignStockImages(w, llm);
    expect(r.added).toBe(w.characters.length + w.locations.length);
    expect(r.assets.find((a) => a.characterId === w.characters[0]!.id)!.id).toMatch(/^stock\.mage-f--/);
    const again = await assignStockImages({ ...w, assets: r.assets });
    expect(again.added).toBe(0);
    expect(validateWorld({ ...w, assets: r.assets }).filter((i) => i.path.startsWith('assets'))).toEqual([]);
  });
});
