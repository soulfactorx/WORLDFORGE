import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { sampleWorld } from '../data/sample-world';
import { buildStoryGraph, layoutGraph, neighbors } from './storyGraph';
import type { WorldPackage } from '../engine/schema';

describe('이야기 흐름도 (v0.142)', () => {
  it('조건·효과로 이어진다: 임무 끝 → 다음 임무 · 결말, 효과의 플래그 → 읽는 쪽', () => {
    const w: WorldPackage = { ...sampleWorld,
      quests: [
        { id: 'quest/a', name: 'A', kind: 'main', start: { all: [] }, stages: [{ objective: 'x', hint: '', complete: { flag: 'f_key' } }] },
        { id: 'quest/b', name: 'B', kind: 'side', start: { questDone: 'quest/a' }, stages: [{ objective: 'y', hint: '', complete: { at: 'loc/x' } }] },
      ],
      endings: [{ id: 'ending/e', name: '끝', condition: { questDone: 'quest/b' }, epilogue: '' }],
      choices: [{ id: 'choice/c', name: '선택', prompt: '고르라', when: { all: [] }, options: [{ id: 'o', text: '연다', effects: [{ setFlag: 'f_key' }] }] }],
      flags: [{ id: 'f_key', when: '' } as never],
    };
    const g = buildStoryGraph(w);
    const has = (from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);
    expect(has('quest:quest/a', 'quest:quest/b')).toBe(true);
    expect(has('quest:quest/b', 'ending:ending/e')).toBe(true);
    expect(has('choice:choice/c', 'flag:f_key')).toBe(true);
    expect(has('flag:f_key', 'quest:quest/a')).toBe(true);
    const lay = layoutGraph(g);
    const x = (k: string) => lay.nodes.find((n) => n.key === k)!.x;
    expect(x('quest:quest/a')).toBeLessThan(x('quest:quest/b'));
    expect(x('quest:quest/b')).toBeLessThan(x('ending:ending/e'));
    expect([...neighbors(g, 'quest:quest/b')].sort()).toEqual(['ending:ending/e', 'location:loc/x', 'quest:quest/a', 'quest:quest/b']); // v0.147: 장소도 이어진다
  });
  it('세우는 곳 없는 플래그를 알린다 · 큰 세계도 그린다', () => {
    const g = buildStoryGraph({ ...sampleWorld, endings: [{ id: 'ending/x', name: 'x', condition: { flag: 'nobody_sets' }, epilogue: '' }] });
    expect(g.nodes.find((n) => n.key === 'flag:nobody_sets')?.warn).toContain('세우는 곳이 없다');
    const big = buildStoryGraph(aetheriaWorld);
    expect(big.nodes.length).toBeGreaterThan(30);
    expect(big.edges.length).toBeGreaterThan(20);
    const lay = layoutGraph(big);
    expect(new Set(lay.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(lay.nodes.length); // 겹치지 않는다
  });
});
