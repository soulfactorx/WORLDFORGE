import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { fightingSample } from '../data/sample-fighting';
import { romanceSample } from '../data/sample-genres';
import { sampleWorld } from '../data/sample-world';
import { borrow, catalogOf } from './borrow';
import { validateWorld } from './package/validate';
import type { WorldPackage } from './schema';
import { sourcesOf } from './sources';

const errors = (w: WorldPackage) => validateWorld(w).filter((i) => i.level === 'error');

describe('세계 간 재사용 (v0.63)', () => {
  it('목록: 인물·장소·지식·이미지 등을 검색할 수 있게 만든다', () => {
    const cat = catalogOf(romanceSample);
    expect(cat.some((e) => e.kind === 'character' && e.name === '카시안')).toBe(true);
    expect(cat.some((e) => e.kind === 'image')).toBe(true);
    expect(cat.every((e) => e.hay === e.hay.toLowerCase())).toBe(true);
  });

  it('인물을 가져오면 이미지·아는 지식·세력이 딸려 오고, 검사기 오류가 없다', () => {
    const c = romanceSample.characters.find((x) => x.name === '카시안')!;
    const r = borrow(sampleWorld, romanceSample, [{ kind: 'character', id: c.id }]);
    const got = r.world.characters.find((x) => x.name === '카시안')!;
    expect(got.locationId).toBe(sampleWorld.start.locationId); // 장소를 함께 안 가져오면 시작 장소에
    expect(r.world.assets!.some((a) => a.characterId === got.id)).toBe(true);
    if (c.faction) expect(r.world.factions!.some((f) => f.id === got.faction)).toBe(true);
    const held = romanceSample.beliefs.filter((b) => b.holder === c.id).length;
    expect(r.world.beliefs.filter((b) => b.holder === got.id).length).toBe(held);
    expect(errors(r.world)).toEqual([]);
    expect(r.added.character).toBe(1);
  });

  it('여러 세계에서 차례로 가져와 새 세계를 만들 수 있고, 겹치는 ID는 바꾼다', () => {
    const r1 = borrow(sampleWorld, sampleWorld, [{ kind: 'character', id: sampleWorld.characters[0]!.id }, { kind: 'location', id: sampleWorld.locations[1]!.id }], { linkTo: sampleWorld.start.locationId });
    const dupe = r1.world.characters.at(-1)!;
    expect(dupe.id).not.toBe(sampleWorld.characters[0]!.id);
    expect(dupe.id.startsWith(sampleWorld.characters[0]!.id)).toBe(true);
    expect(r1.notes.join(' ')).toContain('새 ID');
    const newLoc = r1.world.locations.at(-1)!;
    expect(newLoc.connections).toContain(sampleWorld.start.locationId);
    const fx = fightingSample.scenes![0]!;
    const r2 = borrow(r1.world, fightingSample, [{ kind: 'scene', id: fx.id }, { kind: 'location', id: aetheriaWorld.locations[0]!.id }]);
    expect(r2.world.scenes!.some((s) => s.name === fx.name && !s.start)).toBe(true);
    const r3 = borrow(r2.world, aetheriaWorld, [{ kind: 'location', id: aetheriaWorld.locations[0]!.id }]);
    expect(r3.world.locations.some((l) => l.name === aetheriaWorld.locations[0]!.name)).toBe(true);
    expect(errors(r3.world)).toEqual([]);
  });

  it('저장소 이미지는 복사 목록에, 내장 이미지는 복사하지 않는다', () => {
    const src: WorldPackage = { ...structuredClone(sampleWorld), manifest: { ...sampleWorld.manifest, id: 'me.src' },
      assets: [{ id: 'card.abc.1', name: 'x', kind: 'character', characterId: sampleWorld.characters[0]!.id, tags: ['default'], mime: 'image/png', size: 1 }, { id: 'stock.knight-m--0', name: 'k', kind: 'character', characterId: sampleWorld.characters[0]!.id, tags: [], mime: 'image/svg+xml', size: 0 }] };
    const r = borrow({ ...structuredClone(sampleWorld), characters: [] , beliefs: [] }, src, [{ kind: 'character', id: sampleWorld.characters[0]!.id }]);
    expect(r.copies).toEqual([{ fromPkg: 'me.src', fromId: 'card.abc.1', toId: 'card.abc.1' }]);
  });

  it('성인 등급 세계의 것은 성인 등급 세계로만', () => {
    const adult: WorldPackage = { ...structuredClone(romanceSample), manifest: { ...romanceSample.manifest, contentRating: 'mature' } };
    expect(() => borrow(sampleWorld, adult, [{ kind: 'character', id: adult.characters[0]!.id }])).toThrow(/성인 등급/);
    const target: WorldPackage = { ...structuredClone(sampleWorld), manifest: { ...sampleWorld.manifest, contentRating: 'mature' } };
    expect(() => borrow(target, adult, [{ kind: 'character', id: adult.characters[0]!.id }])).not.toThrow();
  });

  it('개인용 세계에서 가져오면 대상도 개인용이 되고 출처 카드가 기록된다', () => {
    const priv: WorldPackage = { ...structuredClone(romanceSample), manifest: { ...romanceSample.manifest, private: { note: 'n', source: '남의 카드', cardHash: 'h1' },
      sources: [{ hash: 'h1', name: '남의 카드', importedAt: '', via: 'world', ids: { characters: [romanceSample.characters[0]!.id], facts: [], claims: [], assets: [] } }] } };
    const r = borrow(sampleWorld, priv, [{ kind: 'character', id: priv.characters[0]!.id }]);
    expect(r.world.manifest.private?.cardHash).toBe('h1');
    expect(sourcesOf(r.world).map((s) => s.hash)).toEqual(['h1']);
    expect(sourcesOf(r.world)[0]!.via).toBe('import');
    expect(r.notes.join(' ')).toContain('개인용');
  });
});

describe('모든 내장 세계에서 전부 가져오기', () => {
  it('빈 세계에 모든 내장 세계의 모든 것(임무·이야기 줄기·결말 포함)을 가져와도 검사기 오류가 없다', async () => {
    const { BUILTIN, blankWorld } = await import('../storage/packages');
    let w = blankWorld();
    w.manifest.contentRating = 'mature';
    for (const src of BUILTIN) {
      const picks = catalogOf(src).filter((e) => e.kind !== 'image').map((e) => ({ kind: e.kind, id: e.id }));
      w = borrow(w, src, picks, { linkTo: w.start.locationId }).world;
    }
    expect(errors(w).slice(0, 5)).toEqual([]);
    expect(w.characters.length).toBe(BUILTIN.reduce((n, s) => n + s.characters.length, 0));
  });
});

describe('임무·이야기 흐름 (v0.64)', () => {
  it('이야기 줄기 하나를 고르면 가리키는 임무·인물·장소·플래그를 끝까지 함께 가져온다', async () => {
    const { blankWorld } = await import('../storage/packages');
    const { dependencies } = await import('./borrow');
    const arc = aetheriaWorld.arcs![0]!;
    const deps = dependencies(aetheriaWorld, [{ kind: 'arc', id: arc.id }]);
    expect(deps.length).toBeGreaterThan(0);
    const r = borrow(blankWorld(), aetheriaWorld, [{ kind: 'arc', id: arc.id }]);
    expect(r.world.arcs!.map((a) => a.name)).toContain(arc.name);
    expect(r.world.arcs!.find((a) => a.name === arc.name)!.chapters.length).toBe(arc.chapters.length);
    expect(r.notes.join(' ')).toContain('함께 가져온 것');
    expect(errors(r.world)).toEqual([]);
    expect(r.world.manifest.crossover).toEqual([{ id: aetheriaWorld.manifest.id, name: aetheriaWorld.manifest.name }]);
  });
  it('임무를 같은 세계에 또 가져오면 ID를 바꾸고 안의 참조도 새 ID로', () => {
    const q = aetheriaWorld.quests![0]!;
    const r = borrow(aetheriaWorld, aetheriaWorld, [{ kind: 'quest', id: q.id }]);
    const copy = r.world.quests!.at(-1)!;
    expect(copy.id).not.toBe(q.id);
    expect(errors(r.world)).toEqual([]);
  });
});
