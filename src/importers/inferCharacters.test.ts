import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import type { CharxBundle } from './bundle';
import type { NormalizedCard } from './charx';
import { buildEntities, inferCandidates, matchCardImages } from './inferCharacters';

const card = (over: Partial<NormalizedCard> = {}): NormalizedCard => ({
  format: 'ccv3', name: '세라', nickname: '', description: '왕립 아카데미의 학생 세라.', personality: '밝다', scenario: '', firstMes: '안녕!', mesExample: '', creator: 'x', version: '1',
  tags: [], lore: [], ignoredPrompts: [], unsupported: [], images: [], ...over,
});
const asset = (name: string) => ({ name, ext: 'png', mime: 'image/png', size: 10, source: 'zip' as const, read: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) });
const bundle = (c: NormalizedCard, assets: string[] = []): CharxBundle => ({ fileName: 'c.charx', fileSize: 1, card: c, rawCard: {}, extraLore: [], lua: { code: '', data: {} }, regexComments: [], toggles: '', assets: assets.map(asset), warnings: [], fingerprint: 'abcdef1234' });

describe('카드에서 인물 추정 (AI 없음, v0.52)', () => {
  it('한 인물 카드: 카드 본인이 후보, 이름이 붙은 이미지는 그 인물에게', () => {
    const b = bundle(card(), ['sera_smile.png', 'sera_angry.png', 'bg_classroom.png']);
    const inf = inferCandidates(b);
    expect(inf.candidates.map((c) => [c.source, c.name])).toEqual([['card', '세라']]);
    const m = matchCardImages(b, [{ id: 'card', name: '세라', aliases: ['sera'] }], sampleWorld, 'p');
    expect(m.filter((x) => x.characterId === 'card')).toHaveLength(2);
    expect(m.map((x) => x.id)).toEqual(['p0', 'p1', 'p2']);
  });
  it('프로필 낱말이 3종류 이상인 로어북 항목도 인물 후보, 설정 항목은 아니다', () => {
    const lore = [
      { name: '민지', keys: [], content: '나이: 17\n성격: 조용하다\n말투: 존댓말\n외모: 단발', enabled: true, constant: false, comment: '' },
      { name: '왕국의 역사', keys: [], content: '나이: 천 년\n성격: 없음\n외모: 없음', enabled: true, constant: false, comment: '' },
      { name: '날씨', keys: [], content: '비가 자주 온다', enabled: true, constant: false, comment: '' },
    ];
    const inf = inferCandidates(bundle(card({ lore: lore as never })));
    expect(inf.candidates.find((c) => c.source === 'profile')?.name).toBe('민지');
    expect(inf.candidates.some((c) => c.name === '왕국의 역사')).toBe(false);
  });
  it('이미지 이름 묶음으로만 보이는 인물 (2장 이상, 흔한 이름 제외)', () => {
    const inf = inferCandidates(bundle(card(), ['sera_1.png', 'sera_2.png', 'sera_3.png', 'sera_4.png', 'kai_1.png', 'kai_2.png', 'kai_3.png', 'bg_1.png', 'bg_2.png', 'lone.png']));
    const img = inf.candidates.filter((c) => c.source === 'images');
    expect(img.map((c) => [c.name, c.pick])).toEqual([['kai', true]]);
    expect(inf.candidates.find((c) => c.source === 'card')?.latin).toBe('sera'); // 가장 큰 묶음은 카드 본인
  });
  it('고른 후보 → 인물 (key → 실제 ID), 나머지 로어북은 세계 지식', () => {
    const lore = [
      { name: '민지', keys: [], content: '나이: 17\n성격: 조용하다\n말투: 존댓말\n외모: 단발', enabled: true, constant: false, comment: '' },
      { name: '날씨', keys: [], content: '이 도시는 비가 자주 온다.', enabled: true, constant: false, comment: '' },
    ];
    const b = bundle(card({ lore: lore as never }), ['sera_1.png', 'sera_2.png', 'sera_3.png', 'kai_1.png', 'kai_2.png']);
    const inf = inferCandidates(b);
    const picked = inf.candidates.map((c) => ({ key: c.key, name: c.name }));
    const r = buildEntities(sampleWorld, b, { inference: inf, picked, loreAsKnowledge: true, locationId: 'loc/inn', mature: false });
    expect(r.characters.map((c) => c.name).sort()).toEqual(['kai', '민지', '세라'].sort());
    expect([...r.keyOf.keys()].sort()).toEqual(picked.map((p) => p.key).sort());
    for (const id of r.keyOf.values()) expect(r.characters.some((c) => c.id === id)).toBe(true);
    expect(r.claims.some((c) => c.statement.includes('비가'))).toBe(true);
    expect(r.characters.every((c) => c.locationId === 'loc/inn')).toBe(true);
  });
});
