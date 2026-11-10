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

describe('AI 이미지 분류 속도 (v0.65)', () => {
  it('12,829장: 이름 패턴으로 묶어 AI 호출을 크게 줄이고, 동시에 보내고, 묶음 결과를 모든 이미지에 붙인다', async () => {
    const { classifyAssetsAI, nameKey } = await import('./assetmatch');
    const moods = ['smile', 'angry', 'sad', 'blush', 'normal'];
    const assets: import('../engine/schema').AssetMeta[] = [];
    // 인물 40명 × 300장 = 12,000 · 장소 9곳 × 70장 = 630 · 의미 없는 이름 199장
    for (let c = 0; c < 40; c++) for (let n = 0; n < 300; n++) assets.push({ id: `a${assets.length}`, name: `Hero${c}_${moods[n % 5]}_${String(n).padStart(3, '0')}.png`, kind: 'other', tags: [], mime: 'image/png', size: 1 });
    for (let l = 0; l < 9; l++) for (let n = 0; n < 70; n++) assets.push({ id: `a${assets.length}`, name: `bg_place${l}_${n}.webp`, kind: 'other', tags: [], mime: 'image/webp', size: 1 });
    for (let n = 0; n < 199; n++) assets.push({ id: `a${assets.length}`, name: `${(n * 2654435761 >>> 0).toString(16)}a1.png`, kind: 'other', tags: [], mime: 'image/png', size: 1 });
    expect(assets.length).toBe(12829);
    expect(nameKey('Hero3_smile_042.png')).toBe('hero3');
    expect(nameKey('9f3a1c22b0.png')).toBe('');
    let calls = 0, inFlight = 0, peak = 0;
    const llm = { stream: async () => '', json: async <T,>(r: { user: string }) => {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      const lines = r.user.split('## 이미지 이름 패턴')[1]!.split('\n').filter((l) => /^\d+: /.test(l));
      const items = lines.map((l) => { const [i, rest] = l.split(': '); const key = rest!.split(' — ')[0]!; const m = /^hero(\d+)/.exec(key); const p = /place(\d+)/.exec(key);
        return m ? `${i}|c|npc/h${m[1]}||` // v0.94 한 줄 꼴 (장면은 예전 객체 꼴로도 받는지 함께 본다)
           : p ? { index: Number(i), kind: 'scene', character: '', location: `loc/p${p[1]}`, tags: ['inside'] } : null; }).filter(Boolean);
      return { items } as T;
    } };
    const chars = Array.from({ length: 40 }, (_, c) => ({ id: `npc/h${c}`, name: `Hero${c}`, aliases: [] }));
    const locs = Array.from({ length: 9 }, (_, l) => ({ id: `loc/p${l}`, name: `place${l}` }));
    const t0 = Date.now();
    const out = await classifyAssetsAI(llm, assets, chars, locs);
    expect(calls).toBe(1); // 이름 패턴 49개 → 한 번 (예전: 250장씩 52번)
    expect(out.filter((a) => a.kind === 'character').length).toBe(12000);
    expect(out.find((a) => a.name === 'Hero7_angry_001.png')).toMatchObject({ characterId: 'npc/h7', tags: ['angry'] });
    expect(out.filter((a) => a.kind === 'scene' && a.locationId).length).toBe(630);
    expect(out.filter((a) => a.kind === 'other').length).toBe(199);
    expect(Date.now() - t0).toBeLessThan(2000);
    // 패턴이 아주 많아도 동시에 보낸다
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `b${i}`, name: `unique_name_${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26) % 26)}x${Math.floor(i / 676)}y.png`, kind: 'other' as const, tags: [], mime: 'image/png', size: 1 }));
    calls = 0; peak = 0;
    await classifyAssetsAI(llm, many, chars, locs);
    expect(calls).toBe(10);
    expect(peak).toBe(6);
  });
});
