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

describe('세계 통째로 (v0.67)', () => {
  it('빈 새 세계에 내장 세계를 통째로: 모든 것과 설정이 그대로, 자리 장소는 사라지고 검사기 오류가 없다', async () => {
    const { BUILTIN, blankWorld } = await import('../storage/packages');
    const { wholePicks } = await import('./borrow');
    for (const src of BUILTIN) {
      const blank = blankWorld();
      if (src.manifest.contentRating === 'mature') blank.manifest.contentRating = 'mature';
      const r = borrow(blank, src, wholePicks(src), { whole: true });
      const w = r.world;
      expect(errors(w).slice(0, 3), src.manifest.name).toEqual([]);
      expect(w.characters.length).toBe(src.characters.length);
      expect(w.locations.length).toBe(src.locations.length);
      expect(w.quests?.length ?? 0).toBe(src.quests?.length ?? 0);
      expect(w.arcs?.length ?? 0).toBe(src.arcs?.length ?? 0);
      expect(w.locations.some((l) => l.id === 'loc/start' && l.name === '시작 장소')).toBe(false);
      expect(w.locations.find((l) => l.id === w.start.locationId)!.name).toBe(src.locations.find((l) => l.id === src.start.locationId)!.name);
      expect(w.start.openingScene).toBe(src.start.openingScene);
      expect(w.genre?.id).toBe(src.genre?.id);
      expect(w.overview).toBe(src.overview);
      expect(w.starts?.length ?? 0).toBe(src.starts?.length ?? 0);
      const n = (ws: WorldPackage) => [(ws.factions ?? []).reduce((k, f) => k + (f.actions?.length ?? 0), 0), ws.characters.reduce((k, c) => k + (c.goals?.length ?? 0), 0), (ws.scenes ?? []).filter((x) => x.start).length];
      expect(n(w), `${src.manifest.name}: 세력 행동·인물 목표·장면 조건`).toEqual(n(src));
    }
  });
  it('기존 세계에 통째로 합치면 이 세계의 시작·장르는 그대로, 개요는 덧붙인다', async () => {
    const { wholePicks } = await import('./borrow');
    const r = borrow(sampleWorld, romanceSample, wholePicks(romanceSample), { whole: true });
    expect(r.world.start.locationId).toBe(sampleWorld.start.locationId);
    expect(r.world.overview).toContain(`[${romanceSample.manifest.name}]`);
    expect(errors(r.world)).toEqual([]);
  });
});

describe('하위 직업 관리 (v0.67)', () => {
  it('세계 직업의 하위 직업 이름·숨기기를 따르고, 프리셋에는 장르 이름이 있다', async () => {
    const { subclassOptions, subclassLabel, classesFor } = await import('./classes');
    const knight = classesFor(romanceSample).find((c) => c.id === 'knight')!;
    expect(knight.subclasses!.map((s) => s.name)).toEqual(['결투의 명수', '맹세한 호위']);
    const sheet = { classId: 'fighter', role: 'knight', subclass: 'guardian' };
    expect(subclassOptions(romanceSample, sheet).map((o) => o.name)).toEqual(['결투의 명수', '맹세한 호위']);
    expect(subclassLabel(romanceSample, sheet)).toBe('맹세한 호위');
    const w: WorldPackage = { ...structuredClone(sampleWorld), classes: [{ id: 'k', name: '기사', base: 'fighter', subclasses: [{ base: 'champion', name: '창기사', blurb: '돌격' }, { base: 'guardian', name: '', hidden: true }] }] };
    const opts = subclassOptions(w, { classId: 'fighter', role: 'k' });
    expect(opts.map((o) => [o.id, o.name, o.blurb])).toEqual([['champion', '창기사', '돌격']]);
    expect(subclassOptions(sampleWorld, { classId: 'fighter' }).map((o) => o.name)).toEqual(['챔피언', '수호자']);
    expect(errors(w)).toEqual([]);
    const bad: WorldPackage = { ...w, classes: [{ id: 'k', name: '기사', base: 'fighter', subclasses: [{ base: 'thief', name: 'x' }] }] };
    expect(validateWorld(bad).some((i) => i.path === 'classes[0].subclasses[0].base' && i.level === 'error')).toBe(true);
  });
});
