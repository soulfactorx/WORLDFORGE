import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from './schema';
import { addSource, removeSource, sourceHashes, sourcesOf } from './sources';

const ids = (c: string[], cl: string[] = [], a: string[] = []) => ({ characters: c, facts: [], claims: cl, assets: a });
const world = (): WorldPackage => {
  const w = structuredClone(sampleWorld);
  w.characters.push({ id: 'npc/card-a', name: '카드A', appearance: '', personality: '', speech: '', locationId: 'loc/inn', improvisation: 'minor' });
  w.claims.push({ id: 'claim/card-a', statement: '카드A의 비밀', truth: 'true' });
  w.beliefs.push({ holder: 'npc/card-a', claim: 'claim/card-a', state: 'secret' }, { holder: 'npc/bran', claim: 'claim/card-a', state: 'rumor' });
  w.relations = [{ a: 'npc/card-a', b: 'npc/bran', kind: 'ally' }];
  w.quests![0]!.giver = 'npc/card-a';
  w.assets = [{ id: 'card.aaa.0', name: 'a.png', kind: 'character', characterId: 'npc/card-a', tags: ['default'], mime: 'image/png', size: 1 }];
  w.manifest = { ...w.manifest, private: { source: 'A', note: 'n' } };
  return addSource(w, { hash: 'aaa', name: 'A', importedAt: 'x', via: 'import', ids: ids(['npc/card-a'], ['claim/card-a'], ['card.aaa.0']) });
};

describe('출처 카드 관리 (v0.53)', () => {
  it('같은 카드를 다시 가져오면 하나로 합치고, 지문 목록은 정렬된다', () => {
    let w = world();
    w = addSource(w, { hash: 'bbb', name: 'B', importedAt: 'y', via: 'import', ids: ids(['npc/x']) });
    w = addSource(w, { hash: 'aaa', name: 'A', importedAt: 'z', via: 'import', ids: ids(['npc/y']) });
    expect(sourcesOf(w).map((s) => [s.name, s.ids!.characters])).toEqual([['A', ['npc/card-a', 'npc/y']], ['B', ['npc/x']]]);
    expect(sourceHashes(w)).toEqual(['aaa', 'bbb']);
  });
  it('예전 세계는 private.cardHash로 출처 하나를 보여 준다 (뺄 수 없다)', () => {
    const w = { ...sampleWorld, manifest: { ...sampleWorld.manifest, private: { source: '옛 카드', note: 'n', cardHash: 'old' } } };
    expect(sourcesOf(w)).toEqual([{ hash: 'old', name: '옛 카드', importedAt: '', via: 'world' }]);
    expect(() => removeSource(w, 'old')).toThrow('세계 전체');
  });
  it('빼기: 인물·명제·믿음·관계·이미지와 임무의 의뢰인 자리까지 정리, 마지막 출처면 개인용 잠금을 푼다', () => {
    const w = world();
    const r = removeSource(w, 'aaa');
    expect(r.world.characters.some((c) => c.id === 'npc/card-a')).toBe(false);
    expect(r.world.claims.some((c) => c.id === 'claim/card-a')).toBe(false);
    expect(r.world.beliefs.some((b) => b.claim === 'claim/card-a' || b.holder === 'npc/card-a')).toBe(false);
    expect(r.world.relations).toEqual([]);
    expect(r.world.quests![0]!.giver).toBeUndefined();
    expect(r.world.assets).toEqual([]);
    expect(r.removed).toMatchObject({ characters: 1, claims: 1, beliefs: 2, assets: 1 });
    expect(r.unlocked).toBe(true);
    expect(r.world.manifest.private).toBeUndefined();
    expect(r.world.manifest.sources).toEqual([]);
  });
  it('다른 출처가 남으면 잠금은 유지되고, 대표 지문을 남은 카드로 바꾼다', () => {
    const w = addSource(world(), { hash: 'bbb', name: 'B', importedAt: 'y', via: 'import', ids: ids([]) });
    const r = removeSource(w, 'aaa');
    expect(r.unlocked).toBe(false);
    expect(r.world.manifest.private).toMatchObject({ source: 'B', cardHash: 'bbb' });
    expect(r.world.manifest.sources!.map((s) => s.hash)).toEqual(['bbb']);
  });
});
