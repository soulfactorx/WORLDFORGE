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

describe('글과 함께 고르기 (v0.139)', () => {
  it('원한 태그가 없거나 안 맞아도 그 인물이 나온 문장으로 고른다', async () => {
    const { pickCharacterFor, aboutText } = await import('./assets');
    const text = '리아가 교복 차림으로 활짝 웃었다. 보리는 멀리서 지켜본다.';
    expect(pickCharacterFor(world, 'npc/lia', { text: aboutText(text, ['리아']) }, 't')?.id).toBe('smile-uni');
    expect(pickCharacterFor(world, 'npc/lia', { wanted: '대략난감', text: '리아가 화를 내며 노려봤다. 교복 소매를 걷는다.' }, 't')?.id).toBe('angry-uni');
    // 원한 태그가 맞으면 그것이 가장 무겁다
    expect(pickCharacterFor(world, 'npc/lia', { wanted: 'smile swimsuit', text: '리아가 교복 차림으로 웃었다.' }, 't')?.id).toBe('smile-swim');
    // 아무 단서도 없으면 기본 모습
    expect(pickCharacterFor(world, 'npc/lia', { text: '리아가 서 있다.' }, 't')?.id).toBe('def');
  });
  it('표시의 태그가 목록에 없어도 그 문단의 글로', async () => {
    const s = { player: { locationId: 'loc/inn' } } as unknown as GameState;
    const imgs = marksToImages(world, s, '[[그림 npc/lia 대충웃는얼굴]]\n리아가 교복을 여미며 웃었다.', 't');
    expect(imgs[0]?.id).toBe('smile-uni');
  });
  it('배경: 지금 때와 날씨 낱말', async () => {
    const { partOfDay, situationWords } = await import('./assets');
    expect(partOfDay(22 * 60)).toBe('night');
    expect(partOfDay(12 * 60)).toBe('day');
    expect(situationWords('창밖에 비가 내리는 밤이다.')).toEqual(expect.arrayContaining(['rain', 'night']));
    expect(pickSceneImage(world, 'loc/inn', ['night', ...situationWords('비가 온다')].join(' '), 's')?.id).toBe('bg-night');
  });
});
