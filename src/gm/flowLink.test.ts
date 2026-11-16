import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { linkOptions, unlink } from './flowLink';
import { buildStoryGraph, layoutGraph, START_KEY } from './storyGraph';

const base: WorldPackage = { ...sampleWorld,
  quests: [
    { id: 'quest/a', name: 'A', kind: 'main', start: { all: [] }, stages: [{ objective: 'x', hint: '', complete: { at: 'loc/x' } }] },
    { id: 'quest/b', name: 'B', kind: 'side', start: { at: 'loc/y' }, stages: [{ objective: 'y', hint: '', complete: { at: 'loc/x' } }] },
  ],
  endings: [{ id: 'ending/e', name: '끝', condition: { questDone: 'quest/b' }, epilogue: '' }],
  choices: [{ id: 'choice/c', name: '선택', prompt: '고르라', when: { questDone: 'quest/a' }, options: [{ id: 'o', text: '연다', effects: [] }] }],
};
const node = (w: WorldPackage, k: string) => buildStoryGraph(w).nodes.find((n) => n.key === k)!;

describe('흐름도 배치 · 잇기 (v0.143)', () => {
  it('▶ 시작이 맨 앞, 결말은 맨 끝 단 (가로·세로)', () => {
    const g = buildStoryGraph(base);
    expect(g.edges.some((e) => e.from === START_KEY && e.to === 'quest:quest/a' && e.label === '처음부터 열림')).toBe(true);
    expect(g.edges.find((e) => e.from === START_KEY && e.to === 'quest:quest/b')?.label).toContain('다른 조건');
    for (const dir of ['right', 'down'] as const) {
      const lay = layoutGraph(g, dir);
      const L = (k: string) => lay.nodes.find((n) => n.key === k)!.layer;
      expect(L(START_KEY)).toBe(0);
      const max = Math.max(...lay.nodes.map((n) => n.layer));
      expect(L('ending:ending/e')).toBe(max);
      const at = (k: string) => { const n = lay.nodes.find((x) => x.key === k)!; return dir === 'right' ? n.x : n.y; };
      expect(at(START_KEY)).toBeLessThan(at('quest:quest/a'));
      expect(at('choice:choice/c')).toBeLessThan(at('ending:ending/e'));
    }
    const big = layoutGraph(buildStoryGraph(aetheriaWorld), 'down');
    expect(new Set(big.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(big.nodes.length);
  });

  it('끌어 잇기: B의 조건에 「그리고」로 더하고, 끊으면 뺀다', () => {
    const a = node(base, 'quest:quest/a'), b = node(base, 'quest:quest/b');
    const opts = linkOptions(base, a, b);
    expect(opts[0]!.label).toContain('완료하면');
    const w2 = { ...base, ...opts[0]!.apply(base) };
    expect(w2.quests!.find((q) => q.id === 'quest/b')!.start).toEqual({ all: [{ at: 'loc/y' }, { questDone: 'quest/a' }] });
    const g2 = buildStoryGraph(w2);
    const e = g2.edges.find((x) => x.from === 'quest:quest/a' && x.to === 'quest:quest/b')!;
    expect(e).toBeTruthy();
    expect(g2.edges.some((x) => x.from === START_KEY && x.to === 'quest:quest/b')).toBe(false);
    const r = unlink(w2, e, node(w2, 'quest:quest/a'), node(w2, 'quest:quest/b'));
    const w3 = { ...w2, ...r.patch };
    expect(w3.quests!.find((q) => q.id === 'quest/b')!.start).toEqual({ all: [{ at: 'loc/y' }] });
    // 결말 조건을 끊으면 비었다고 알린다
    const ee = buildStoryGraph(base).edges.find((x) => x.to === 'ending:ending/e')!;
    expect(unlink(base, ee, node(base, 'quest:quest/b'), node(base, 'ending:ending/e')).note).toContain('비었습니다');
  });

  it('효과로 잇기: 선택지 → 플래그 세움, 끊으면 효과에서 뺀다', () => {
    const w: WorldPackage = { ...base, endings: [{ id: 'ending/f', name: 'F', condition: { flag: 'f_x' }, epilogue: '' }] };
    const c = node(w, 'choice:choice/c'), f = node(w, 'flag:f_x');
    const opt = linkOptions(w, c, f).find((o) => o.group === 'effect')!;
    expect(opt.label).toContain('플래그를 세움');
    const w2 = { ...w, ...opt.apply(w) };
    expect(w2.choices![0]!.options[0]!.effects).toEqual([{ setFlag: 'f_x' }]);
    const e = buildStoryGraph(w2).edges.find((x) => x.from === 'choice:choice/c' && x.to === 'flag:f_x')!;
    const w3 = { ...w2, ...unlink(w2, e, c, f).patch };
    expect(w3.choices![0]!.options[0]!.effects).toEqual([]);
    // 결말에서는 이어지지 않는다 · 시작은 잇지 않는다
    expect(linkOptions(w, node(w, 'ending:ending/f'), c)).toEqual([]);
  });
});
