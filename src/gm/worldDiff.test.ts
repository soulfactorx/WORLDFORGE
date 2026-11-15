import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { defaultPicks, diffWorlds, mergeWorlds } from './worldDiff';
import { validateWorld } from '../engine/package/validate';

describe('초안 ↔ 저장본 비교·합치기 (v0.131)', () => {
  const saved = { ...sampleWorld, overview: '저장본 개요', locations: [...sampleWorld.locations, { id: 'loc/after', name: '나중에 더한 곳', description: '조용한 곳', connections: [] }] };
  const draft = {
    ...sampleWorld, overview: '초안 개요',
    characters: [...sampleWorld.characters.map((c, i) => (i === 0 ? { ...c, personality: '초안에서 고침' } : c)), { ...sampleWorld.characters[0]!, id: 'npc/new', name: '새 인물' }],
  };
  it('초안에만 있는 것·바뀐 것만 (저장본에만 있는 것은 보지 않는다)', () => {
    const d = diffWorlds(saved, draft);
    expect(d.map((x) => `${x.kind}:${x.key}`)).toEqual(expect.arrayContaining(['conflict:overview', `conflict:characters|${sampleWorld.characters[0]!.id}`, 'added:characters|npc/new']));
    expect(d.some((x) => x.key.includes('loc/after'))).toBe(false);
    expect([...defaultPicks(d)]).toEqual(['characters|npc/new']);
  });
  it('고른 것만 합치고, 저장본의 나머지는 그대로', () => {
    const d = diffWorlds(saved, draft);
    const m = mergeWorlds(saved, draft, new Set([...defaultPicks(d), 'overview']));
    expect(m.overview).toBe('초안 개요');
    expect(m.characters.find((c) => c.id === 'npc/new')?.name).toBe('새 인물');
    expect(m.characters[0]!.personality).toBe(sampleWorld.characters[0]!.personality);
    expect(m.locations.some((l) => l.id === 'loc/after')).toBe(true);
    expect(validateWorld(m).filter((i) => i.level === 'error')).toEqual([]);
    expect(diffWorlds(m, m)).toEqual([]);
  });
  it('시작점이 있으면 세 갈래로: 저장본만 고친 것은 내놓지 않고, 초안만 고친 것은 기본으로 가져온다', () => {
    const origin = sampleWorld;
    const saved2 = { ...sampleWorld, style: '저장본에서 고친 문체', overview: '저장본 개요' };
    const draft2 = { ...sampleWorld, overview: '초안 개요', gmNotes: '초안 메모', locations: [...sampleWorld.locations, { id: 'loc/d', name: '초안 장소', description: '새로', connections: [] }] };
    const d = diffWorlds(saved2, draft2, origin);
    const by = Object.fromEntries(d.map((x) => [x.key, x.kind]));
    expect(by.style).toBeUndefined();
    expect(by.overview).toBe('conflict');
    expect(by.gmNotes).toBe('added');
    expect(by['locations|loc/d']).toBe('added');
    expect([...defaultPicks(d)].sort()).toEqual(['gmNotes', 'locations|loc/d']);
    const m = mergeWorlds(saved2, draft2, defaultPicks(d), origin);
    expect(m.style).toBe('저장본에서 고친 문체');
    expect(m.overview).toBe('저장본 개요');
    expect(m.gmNotes).toBe('초안 메모');
    // 초안이 아무것도 바꾸지 않았으면 다른 곳이 없다 (정리해도 잃는 것이 없다)
    expect(diffWorlds(saved2, origin, origin)).toEqual([]);
  });
});
