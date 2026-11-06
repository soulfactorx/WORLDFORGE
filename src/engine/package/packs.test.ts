import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { romanceSample, wuxiaSample } from '../../data/sample-genres';
import { sampleWorld } from '../../data/sample-world';
import { parsePack } from '../../storage/packs';
import { validateWorld } from './validate';
import { applyPack, buildCharacterPack, buildRulesPack, planImport } from './packs';

const meta = { id: 'test.romance-cast', name: '장미 정원 사람들', version: '1.0.0', author: '나', license: 'CC-BY-4.0' };

describe('인물 패키지 (R7)', () => {
  const { pack, notes } = buildCharacterPack(romanceSample, ['npc/cassian', 'npc/eleanor'], meta);
  it('고른 인물·그들의 지식·그들 사이 관계·이미지를 담고, 세계의 것(세력·진실)은 뺀다', () => {
    expect(pack.characters.map((c) => c.id)).toEqual(['npc/cassian', 'npc/eleanor']);
    expect(pack.characters.every((c) => !c.faction)).toBe(true);
    expect(pack.claims.every((c) => !('relatesTo' in c))).toBe(true);
    expect(pack.beliefs.every((b) => ['npc/cassian', 'npc/eleanor'].includes(b.holder))).toBe(true);
    expect(pack.relations).toEqual([{ a: 'npc/eleanor', b: 'npc/cassian', kind: 'lover', note: '엘레노어의 오랜 연심 (카시안은 모른 척한다)' }]);
    expect(pack.assets.map((a) => a.characterId)).toEqual(['npc/cassian', 'npc/eleanor']);
    expect(notes.some((n) => n.includes('소속 세력'))).toBe(true);
  });
  it('다른 세계에 넣는다: 없는 장소는 고른 장소로, 충돌 없으면 그대로', () => {
    const plan = planImport(sampleWorld, pack);
    expect(plan.blockers).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unknownLocations).toEqual(['loc/ballroom', 'loc/garden']);
    const r = applyPack(sampleWorld, pack, { locationId: 'loc/inn' });
    const cassian = r.world.characters.find((c) => c.id === 'npc/cassian')!;
    expect(cassian.locationId).toBe('loc/inn');
    expect(cassian.schedule).toBeUndefined(); // 없는 정원 일정은 뺀다
    expect(r.world.relations).toContainEqual(expect.objectContaining({ a: 'npc/eleanor', b: 'npc/cassian' }));
    expect(r.world.manifest.includes).toEqual([{ id: 'test.romance-cast', version: '1.0.0', type: 'character', name: '장미 정원 사람들' }]);
    expect(validateWorld(r.world).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('ID가 겹치면 이름 바꿔 넣기(기본)·건너뛰기·바꾸기를 고른다', () => {
    const twice = applyPack(applyPack(sampleWorld, pack).world, pack);
    expect(twice.world.characters.filter((c) => c.name === '카시안').map((c) => c.id)).toEqual(['npc/cassian', 'npc/cassian-2']);
    expect(twice.world.beliefs.some((b) => b.holder === 'npc/cassian-2')).toBe(true);
    expect(twice.world.relations).toContainEqual(expect.objectContaining({ a: 'npc/eleanor-2', b: 'npc/cassian-2' }));
    expect(twice.notes.some((n) => n.includes('npc/cassian → npc/cassian-2'))).toBe(true);
    expect(validateWorld(twice.world).filter((i) => i.level === 'error')).toEqual([]);
    const once = applyPack(sampleWorld, pack).world;
    const skip = applyPack(once, pack, { resolve: { 'npc/cassian': 'skip', 'npc/eleanor': 'skip' } });
    expect(skip.world.characters.length).toBe(once.characters.length);
    const repl = applyPack(once, { ...pack, characters: pack.characters.map((c) => ({ ...c, personality: '바뀐 성격' })) }, { resolve: { 'npc/cassian': 'replace', 'npc/eleanor': 'replace' } });
    expect(repl.world.characters.find((c) => c.id === 'npc/cassian')!.personality).toBe('바뀐 성격');
  });
  it('세계보다 높은 등급의 패키지는 넣을 수 없다', () => {
    const allWorld = { ...sampleWorld, manifest: { ...sampleWorld.manifest, contentRating: 'all' as const } };
    expect(planImport(allWorld, pack).blockers.length).toBe(1);
    expect(() => applyPack(allWorld, pack)).toThrow(/등급/);
  });
});

describe('규칙 패키지 (R7)', () => {
  it('아이템·용어를 옮기고, 세계의 용어가 이기며, 화폐·레벨은 고를 때만', () => {
    const src = { ...wuxiaSample, items: [{ id: 'item/jade', name: '옥패', description: '문파의 증표', kind: 'key' as const }], genre: { ...wuxiaSample.genre!, terms: { 롱소드: '청강검', 메이스: '쇠도리깨' }, currency: '전', levelCap: 4 } };
    const pack = buildRulesPack(src, { ...meta, id: 'test.wuxia-rules' });
    const target = { ...sampleWorld, genre: { id: 'high_fantasy', terms: { 롱소드: '장검' } } };
    expect(planImport(target, pack).warnings.some((w) => w.includes('롱소드'))).toBe(true);
    const r = applyPack(target, pack);
    expect(r.world.items?.map((i) => i.id)).toEqual(['item/mist-charm', 'item/jade']); // 샘플 세계의 유물 + 옮겨 온 것
    expect(r.world.genre?.terms).toEqual({ 롱소드: '장검', 메이스: '쇠도리깨' });
    expect(r.world.genre?.currency).toBeUndefined();
    expect(applyPack(target, pack, { applyGenreSettings: true }).world.genre).toMatchObject({ currency: '전', levelCap: 4 });
  });
});

describe('패키지 파일 (R7)', () => {
  it('zip을 읽고 그림을 꺼내며, 이상한 파일은 거른다', () => {
    const { pack } = buildCharacterPack(romanceSample, ['npc/rina'], meta);
    const zip = zipSync({ 'pack.json': strToU8(JSON.stringify(pack)), 'images/x.png': new Uint8Array([1, 2, 3]), 'evil/../x.js': strToU8('alert(1)') });
    const r = parsePack('rina.chp', zip);
    expect(r.errors).toEqual([]);
    expect(r.pack?.manifest.type).toBe('character');
    expect(Object.keys(r.images)).toEqual(['x.png']);
    expect(parsePack('bad.chp', zipSync({ 'pack.json': strToU8('{"manifest":{"type":"weird"}}') })).errors.length).toBeGreaterThan(0);
    expect(parsePack('none.chp', zipSync({ 'a.txt': strToU8('x') })).errors[0]).toContain('pack.json');
  });
});
