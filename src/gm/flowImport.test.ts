import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { importFromLibrary } from './flowImport';
import { buildStoryGraph } from './storyGraph';

describe('흐름도 ＋ 만계서고에서 (v0.158)', () => {
  const target: WorldPackage = { ...sampleWorld, manifest: { ...sampleWorld.manifest, id: 't.flow' },
    quests: [{ id: 'quest/mine', name: '내 임무', kind: 'main', start: { all: [] }, stages: [{ objective: 'x', hint: '', complete: { flag: 'f' } }] }] };
  it('가져온 임무를 고른 상자 다음에 이어 붙인다', () => {
    const q = aetheriaWorld.quests![1]!;
    const r = importFromLibrary(target, aetheriaWorld, { kind: 'quest', id: q.id }, { questDone: 'quest/mine' });
    expect(r.newName).toBe(q.name);
    const nq = r.world.quests!.find((x) => `quest:${x.id}` === r.newKey)!;
    expect(JSON.stringify(nq.start)).toContain('"questDone":"quest/mine"');
    expect(buildStoryGraph(r.world).edges.some((e) => e.from === 'quest:quest/mine' && e.to === r.newKey)).toBe(true);
  });
  it('장면·함정을 구분하고, 인물은 잇지 않고 붙이기만', () => {
    const g = aetheriaWorld.scenes!.find((s) => s.gimmick);
    if (g) expect(importFromLibrary(target, aetheriaWorld, { kind: 'scene', id: g.id }).newKey).toMatch(/^gimmick:/);
    const c = aetheriaWorld.characters[0]!;
    const r = importFromLibrary(target, aetheriaWorld, { kind: 'character', id: c.id }, { questDone: 'quest/mine' });
    expect(r.newKey).toMatch(/^character:/);
    expect(r.world.characters.some((x) => x.name === c.name)).toBe(true);
  });
});
