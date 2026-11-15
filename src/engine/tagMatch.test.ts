import { describe, expect, it } from 'vitest';
import type { AssetMeta, WorldPackage } from './schema';
import { pickCharacterImage, pickSceneImage, tagCombos } from './assets';
import { marksToImages, imageMenu } from '../gm/imageMarks';
import type { GameState } from './state/state';

const a = (id: string, tags: string[], extra: Partial<AssetMeta> = {}): AssetMeta => ({ id, name: id, kind: 'character', characterId: 'npc/lia', tags, mime: 'image/png', size: 1, ...extra });
const world = {
  characters: [{ id: 'npc/lia', name: '리아' }, { id: 'npc/wang', name: '왕 주모' }],
  locations: [{ id: 'loc/inn', name: '객잔', connections: [] }],
  assets: [
    a('def', ['default']), a('smile-swim', ['smile', 'swimsuit']), a('smile', ['smile']), a('smile-uni', ['smile', 'uniform']),
    a('angry-uni', ['angry', 'uniform']), a('blush02', ['blush02']), a('sulk', ['삐짐']),
    a('wang', ['웃음'], { characterId: 'npc/wang' }),
    { id: 'bg-night', name: 'n', kind: 'scene', locationId: 'loc/inn', tags: ['night', 'rain'], mime: 'image/png', size: 1 },
    { id: 'bg-day', name: 'd', kind: 'scene', locationId: 'loc/inn', tags: ['day'], mime: 'image/png', size: 1 },
  ],
} as unknown as WorldPackage;
const pick = (tag: string) => pickCharacterImage(world, 'npc/lia', tag, 't1')?.id;

describe('태그로 그림 찾기 (v0.138)', () => {
  it('여러 낱말: 둘 다 맞는 그림을 고른다', () => {
    expect(pick('웃음 교복')).toBe('smile-uni'); // 웃음=smile, 교복=uniform (같은 뜻 무리)
    expect(pick('smile uniform')).toBe('smile-uni');
    expect(pick('angry+uniform')).toBe('angry-uni');
  });
  it('같은 점수면 군더더기 태그가 적은 그림 (수영복 차림 웃음보다 그냥 웃음)', () => {
    expect(pick('smile')).toBe('smile');
    expect(pick('happy')).toBe('smile');
  });
  it('비슷한 꼴 · 늘어난 같은 뜻 무리', () => {
    expect(pick('blush')).toBe('blush02');
    expect(pick('pouting')).toBe('sulk');
    expect(pick('웃는')).toBe('smile');
  });
  it('맞는 것이 없으면 기본 모습', () => {
    expect(pick('swimming pool party')).not.toBe(undefined);
    expect(pick('zzz')).toBe('def');
  });
  it('장면도 여러 낱말·비슷한 꼴로', () => {
    expect(pickSceneImage(world, 'loc/inn', 'rainy night', 's')?.id).toBe('bg-night');
    expect(pickSceneImage(world, 'loc/inn', '비 오는 밤', 's')?.id).toBe('bg-night');
  });
  it('AI 표시: 띄어쓰기가 있는 이름도 · 여러 태그도', () => {
    const s = { player: { locationId: 'loc/inn' }, namesKnown: undefined } as unknown as GameState;
    const imgs = marksToImages(world, s, '[[그림 왕 주모 웃음]]\n주모가 웃는다.\n\n[[그림 npc/lia smile uniform]]\n리아가 웃는다.', 't');
    expect(imgs.map((i) => i.id)).toEqual(['wang', 'smile-uni']);
  });
  it('AI에게 주는 목록은 그림마다의 태그 조합', () => {
    expect(tagCombos(world, 'npc/lia')).toEqual(expect.arrayContaining(['smile swimsuit', 'smile uniform', 'angry uniform']));
    const s = { player: { locationId: 'loc/inn' } } as unknown as GameState;
    expect(imageMenu(world, s, [world.characters[0]!])).toContain('smile+uniform');
  });
});
