import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import type { WorldPackage } from '../../engine/schema';
import { applyUserArt, imageNeeds, needsText, targetTag } from './imageNeeds';
import { assignStockImages } from './stock';

function world(): WorldPackage {
  const w = structuredClone(sampleWorld);
  w.characters = [
    { ...w.characters[0]!, id: 'npc/yun', name: '윤', background: '직함: 윤 사무소 대표', gender: 'M' },
    { ...w.characters[0]!, id: 'npc/hedwig', name: '헤드비히', background: '직함: 시녀장', gender: 'F' },
    { ...w.characters[0]!, id: 'npc/rauzent', name: '라우젠트', background: '직함: 황궁 기사단장. 그는 과묵하다.', gender: 'M' },
  ];
  w.assets = [{ id: 'a0', name: 'Hedwig(F)', kind: 'character', characterId: 'npc/hedwig', tags: ['default'], mime: 'image/webp', size: 1 }];
  return w;
}

describe('부족한 이미지 · 내 이미지 자동 적용', () => {
  it('진짜 이미지가 없는 인물·장소를 알려주고, 만들 그림 목록을 준다', async () => {
    const w = world();
    w.assets = (await assignStockImages(w, undefined, undefined, [])).assets;
    const needs = imageNeeds(w);
    expect(needs.filter((n) => n.kind === 'character').map((n) => [n.name, n.status, n.fileName])).toEqual([['윤', 'stock', 'yun.png'], ['라우젠트', 'stock', 'rauzent.png']]);
    expect(needs.filter((n) => n.kind === 'location').length).toBe(w.locations.length);
    expect(needsText(w)).toContain('윤 → yun.png');
  });
  it('파일 이름·대상 지정·태그로 붙이고, 앱 내장 그림을 뺀다', async () => {
    const w = world();
    w.assets = (await assignStockImages(w, undefined, undefined, [])).assets;
    const loc = w.locations[0]!;
    const r = applyUserArt(w, [
      { id: 'y1', kind: 'character', label: 'yun_smile', tags: [] },
      { id: 'y2', kind: 'character', label: '윤', tags: [] },
      { id: 'k1', kind: 'character', label: '멋진 기사 그림', tags: ['기사', 'knight'], gender: 'M' },
      { id: 'p1', kind: 'scene', label: '아무 이름', tags: [targetTag(w.manifest.id, loc.id)] },
      { id: 'x', kind: 'scene', label: '다른 세계용', tags: [targetTag('other.world', loc.id)] },
    ]);
    const of = (id: string) => r.assets.filter((a) => a.characterId === id || a.locationId === id).map((a) => `${a.id.replace(/--\d+$/, '')}:${a.tags.join(',')}`);
    expect(of('npc/yun')).toEqual(['user.y1:smile', 'user.y2:default']);
    expect(of('npc/rauzent')).toEqual(['user.k1:default']);
    expect(of('npc/hedwig')).toEqual(['a0:default']); // 진짜 이미지가 있으면 태그 규칙으로는 붙이지 않는다
    expect(of(loc.id)).toEqual(['user.p1:']);
    expect(r.applied.length).toBe(4);
    // 다시 적용해도 중복되지 않는다
    expect(applyUserArt({ ...w, assets: r.assets }, [{ id: 'y1', kind: 'character', label: 'yun_smile', tags: [] }]).applied).toEqual([]);
    expect(imageNeeds({ ...w, assets: r.assets }).filter((n) => n.kind === 'character')).toEqual([]);
  });
});
