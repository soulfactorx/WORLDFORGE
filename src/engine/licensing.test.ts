import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { borrow } from './borrow';
import { credits, lockState, personalCount, setLicense, stripPersonal } from './licensing';
import type { WorldPackage } from './schema';
import { addSource } from './sources';

const PRIV = { source: '남의 카드', note: '개인용' };
// 인물 탭에서 카드 하나를 넣은 세계: 그 카드에서 온 인물 하나 + 그림 하나
function withImported(): WorldPackage {
  const c = { ...sampleWorld.characters[0]!, id: 'npc/card-girl', name: '카드 소녀' };
  let w: WorldPackage = { ...sampleWorld, characters: [...sampleWorld.characters, c], assets: [{ id: 'a1', name: 'g', kind: 'character', characterId: c.id, tags: [], mime: 'image/png', size: 1 }] };
  w = addSource(w, { hash: 'h1', name: '카드 소녀', creator: '누군가', importedAt: '', via: 'import', ids: { characters: [c.id], facts: [], claims: [], assets: ['a1'] } });
  return { ...w, manifest: { ...w.manifest, private: { ...PRIV, cardHash: 'h1' } } };
}

describe('리소스별 출처·라이선스 (v0.157)', () => {
  it('넣은 카드만 개인용 — 빼고 내보내면 그것만 빠지고 잠금이 풀린다', () => {
    const w = withImported();
    expect(lockState(w)).toBe('parts');
    expect(personalCount(w)).toBe(2);
    const r = stripPersonal(w);
    expect(r.world.characters.some((c) => c.id === 'npc/card-girl')).toBe(false);
    expect(r.world.assets).toEqual([]);
    expect(r.world.manifest.private).toBeUndefined();
    expect(lockState(r.world)).toBe('free');
    expect(r.world.characters.length).toBe(sampleWorld.characters.length);
  });
  it('라이선스를 표시하면 잠금이 풀리고 출처 표시가 남는다 · 지우면 다시 잠긴다', () => {
    const w = setLicense(withImported(), 'h1', { spdx: 'CC-BY-4.0', attribution: '원작: 누군가', confirmedAt: 'x' });
    expect(lockState(w)).toBe('free');
    expect(w.manifest.private).toBeUndefined();
    expect(credits(w)[0]).toContain('CC-BY-4.0');
    const back = setLicense(w, 'h1', undefined);
    expect(lockState(back)).toBe('parts');
    expect(back.manifest.private).toBeTruthy();
  });
  it('세계 전체를 카드로 만들었으면 뺄 수 없다 · 목록이 빈 예전 기록도 안전하게 세계 전체로', () => {
    const whole = { ...addSource(sampleWorld, { hash: 'h2', name: '카드', importedAt: '', via: 'world' }), manifest: { ...sampleWorld.manifest, private: PRIV, sources: [{ hash: 'h2', name: '카드', importedAt: '', via: 'world' as const }] } };
    expect(lockState(whole)).toBe('world');
    expect(() => stripPersonal(whole)).toThrow();
    const legacy = { ...sampleWorld, manifest: { ...sampleWorld.manifest, private: PRIV, sources: [{ hash: 'h3', name: '옛', importedAt: '', via: 'import' as const, ids: { characters: [], facts: [], claims: [], assets: [] } }] } };
    expect(lockState(legacy)).toBe('world');
  });
  it('만계서고: 카드에서 온 것을 가져오지 않으면 잠기지 않고, 가져오면 그것만 개인용', () => {
    const src = { ...withImported(), manifest: { ...withImported().manifest, id: 'src.world', name: '원래 세계' } };
    const target: WorldPackage = { ...sampleWorld, manifest: { ...sampleWorld.manifest, id: 'target.world' }, characters: [], assets: [] };
    const plain = sampleWorld.characters[1]!;
    const a = borrow(target, src, [{ kind: 'character', id: plain.id }]).world;
    expect(a.manifest.private).toBeUndefined();
    expect(lockState(a)).toBe('free');
    const b = borrow(target, src, [{ kind: 'character', id: 'npc/card-girl' }]).world;
    expect(lockState(b)).toBe('parts');
    expect(stripPersonal(b).world.characters.some((c) => c.name === '카드 소녀')).toBe(false);
  });
});
