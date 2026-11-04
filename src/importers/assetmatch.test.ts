import { describe, expect, it } from 'vitest';
import { matchAssets, tokenize } from './assetmatch';
import { pickCharacterImage, pickSceneImage, expressionTags } from '../engine/assets';
import { sampleWorld } from '../data/sample-world';

const chars = [{ id: 'npc/hedwig', aliases: ['Hedwig', '헤드비히'] }, { id: 'npc/karenya', aliases: ['Karenya Valkzephas', 'Karenya', '카르엔야'] }];
const locs = [{ id: 'loc/garden', aliases: ['garden', '정원'] }];
const inp = (name: string, cardType?: string) => ({ name, mime: 'image/webp', size: 1, cardType });

describe('matchAssets', () => {
  it('이름 규칙으로 인물·표정·성별·장소·지도를 연결한다', () => {
    const r = matchAssets([inp('Hedwig(F)'), inp('hedwig_smile_2'), inp('HedwigAngry'), inp('헤드비히-울음'), inp('karenya valkzephas night'),
      inp('palace_map'), inp('garden_rain'), inp('main', 'icon'), inp('random_thing')], chars, locs);
    expect(r.map((a) => [a.kind, a.characterId ?? a.locationId ?? '', a.tags.join(','), a.gender ?? ''])).toEqual([
      ['character', 'npc/hedwig', 'default', 'F'],
      ['character', 'npc/hedwig', 'smile', ''],
      ['character', 'npc/hedwig', 'angry', ''],
      ['character', 'npc/hedwig', '울음', ''],
      ['character', 'npc/karenya', 'night', ''],
      ['map', '', 'palace', ''],
      ['scene', 'loc/garden', 'rain', ''],
      ['cover', '', '', ''],
      ['other', '', 'random,thing', ''],
    ]);
  });
  it('토큰', () => {
    expect(tokenize('Runian(M).webp')).toEqual({ tokens: ['runian'], gender: 'M', compact: 'runian' });
  });
});

describe('이미지 고르기', () => {
  const w = structuredClone(sampleWorld);
  const npc = w.characters[0]!;
  npc.gender = 'F';
  w.assets = [
    { id: 'a0', name: 'x(F)', kind: 'character', characterId: npc.id, gender: 'F', tags: ['default'], mime: 'image/png', size: 1 },
    { id: 'a1', name: 'x(M)', kind: 'character', characterId: npc.id, gender: 'M', tags: ['default'], mime: 'image/png', size: 1 },
    { id: 'a2', name: 'x smile', kind: 'character', characterId: npc.id, tags: ['smile'], mime: 'image/png', size: 1 },
    { id: 'a3', name: 'x smile 2', kind: 'character', characterId: npc.id, tags: ['smile'], mime: 'image/png', size: 1 },
    { id: 's0', name: 'rain', kind: 'scene', locationId: w.start.locationId, tags: ['rain'], mime: 'image/png', size: 1 },
  ];
  it('표정 태그 → 그 표정, 없는 태그 → 같은 성별의 기본 모습', () => {
    expect(expressionTags(w, npc.id)).toEqual(['smile']);
    expect(['a2', 'a3']).toContain(pickCharacterImage(w, npc.id, 'smile', '1')!.id);
    const seen = new Set(Array.from({ length: 20 }, (_, i) => pickCharacterImage(w, npc.id, 'smile', String(i))!.id));
    expect(seen.size).toBe(2); // 돌려 가며 보여준다
    expect(pickCharacterImage(w, npc.id, 'unknown', '1')!.id).toBe('a0');
    expect(pickSceneImage(w, w.start.locationId, 'rain', '1')!.id).toBe('s0');
    expect(pickSceneImage(w, 'loc/none', '', '1')).toBeUndefined();
  });
});

describe('표정: 같은 뜻 · 문맥', () => {
  it('태그 이름이 달라도 같은 뜻이면 맞추고, 서술 속 문장으로 표정을 고른다', async () => {
    const { resolveTag, contextExpression, mentionedImages } = await import('../engine/assets');
    expect(resolveTag(['smiling', 'angry', 'standing', 'default'], 'smile')).toBe('smiling');
    expect(resolveTag(['웃음', '울음'], 'happy')).toBe('웃음');
    expect(resolveTag(['angry'], 'sleepy')).toBe('');
    const tags = ['angry', 'sad', 'smiling', 'worried', 'standing'];
    expect(contextExpression('윤은 서류를 넘긴다. 에리가 버럭 화를 냈다.', ['에리'], tags)).toBe('angry');
    expect(contextExpression('윤은 서류를 넘긴다. 에리가 버럭 화를 냈다.', ['윤'], tags)).toBe(''); // 다른 사람의 감정은 아니다
    expect(contextExpression('윤이 고개를 든다. 그는 불안한 눈빛으로 문을 본다.', ['윤'], tags)).toBe('worried');
    expect(contextExpression('윤은 창밖을 본다.\n\n먼 곳에서 누군가 웃는다.', ['윤'], tags)).toBe('');
    expect(contextExpression('핀이 눈물을 훔치며 고개를 숙인다.', ['핀'], tags)).toBe('sad');
    const w = structuredClone(sampleWorld);
    const npc = w.characters[0]!;
    w.assets = ['standing', 'smiling', 'angry'].map((t, i) => ({ id: `a${i}`, name: `x_${t}`, kind: 'character' as const, characterId: npc.id, tags: t === 'standing' ? ['standing', 'default'] : [t], mime: 'image/png', size: 1 }));
    expect(mentionedImages(w, `${npc.name}이(가) 활짝 웃었다.`, '1')[0]!.id).toBe('a1');
    expect(mentionedImages(w, `${npc.name}이(가) 노려본다.`, '1')[0]!.id).toBe('a2');
    expect(mentionedImages(w, `${npc.name}이(가) 서 있다.`, '1')[0]!.id).toBe('a0');
  });
});
