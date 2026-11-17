import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { edgeSlots, getCond, linkOptions, replaceLeaf, setCond, sourceWays, unlink } from './flowLink';
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

  it('손으로 옮긴 자리를 따른다 (v0.144)', () => {
    const g = buildStoryGraph(base);
    const lay = layoutGraph(g, 'right', { 'quest:quest/a': [900, 700], 'quest:없음': [1, 1] });
    const a = lay.nodes.find((n) => n.key === 'quest:quest/a')!;
    expect([a.x, a.y]).toEqual([900, 700]);
    expect(lay.width).toBeGreaterThanOrEqual(900 + 176);
    expect(layoutGraph(g, 'down', { 'quest:quest/a': [-50, 10] }).nodes.find((n) => n.key === 'quest:quest/a')!.x).toBe(0);
  });

  it('▶ 시작에서 잇기: 열리는 조건을 비운다 (v0.145)', () => {
    const start = node(base, START_KEY), c = node(base, 'choice:choice/c');
    const opt = linkOptions(base, start, c)[0]!;
    expect(opt.group).toBe('start');
    const w2 = { ...base, ...opt.apply(base) };
    expect(w2.choices![0]!.when).toEqual({ all: [] });
    expect(buildStoryGraph(w2).edges.some((e) => e.from === START_KEY && e.to === 'choice:choice/c')).toBe(true);
  });
  it('화살표 고치기: 그 연결이 적힌 칸을 찾고, 「완료」를 「실패」로 바꾼다 (v0.145)', () => {
    const g = buildStoryGraph(base);
    const e = g.edges.find((x) => x.from === 'quest:quest/a' && x.to === 'choice:choice/c')!;
    const a = node(base, 'quest:quest/a'), c = node(base, 'choice:choice/c');
    const slots = edgeSlots(base, e, a, c);
    expect(slots.map((x) => x.slot.key)).toEqual(['when']);
    const failWay = sourceWays(base, a).find((x) => x.label === '실패하면')!;
    const w2 = { ...base, ...setCond(base, c, 'when', replaceLeaf(base, getCond(base, c, 'when')!, a, failWay.cond)) };
    expect(w2.choices![0]!.when).toEqual({ questFailed: 'quest/a' });
    expect(buildStoryGraph(w2).edges.find((x) => x.from === 'quest:quest/a' && x.to === 'choice:choice/c')!.kind).toBe('start');
  });

  it('장소·인물 (v0.147): 아래 띠에 놓이고, 끌어 이으면 「여기 있으면」 「여기서 일어나게」 「길」', () => {
    const loc = sampleWorld.locations[0]!, other = sampleWorld.locations[1]!;
    const w: WorldPackage = { ...base, scenes: [] };
    const g = buildStoryGraph(w);
    const lay = layoutGraph(g);
    const L = lay.nodes.find((n) => n.key === `location:${loc.id}`)!;
    expect(L.layer).toBe(-2);
    const bodyBottom = Math.max(...lay.nodes.filter((n) => n.layer >= 0).map((n) => n.y));
    expect(L.y).toBeGreaterThan(bodyBottom);
    // 장소 조건이 있는 임무도 여전히 ▶ 시작에서 열린다
    expect(g.edges.some((e) => e.from === START_KEY && e.to === 'quest:quest/b')).toBe(true);
    const ln = node(w, `location:${loc.id}`), qb = node(w, 'quest:quest/b');
    const opt = linkOptions(w, ln, qb).find((o) => o.label.includes('이곳에 있으면') && o.label.includes('시작 조건'))!;
    const w2 = { ...w, ...opt.apply(w) };
    expect(w2.quests!.find((q) => q.id === 'quest/b')!.start).toEqual({ all: [{ at: 'loc/y' }, { at: loc.id }] });
    const road = linkOptions(w, ln, node(w, `location:${other.id}`)).find((o) => o.group === 'place')!;
    const w3 = { ...w, ...road.apply(w) };
    expect(w3.locations.find((l) => l.id === loc.id)!.connections).toContain(other.id);
    expect(w3.locations.find((l) => l.id === other.id)!.connections).toContain(loc.id);
    const ch = sampleWorld.characters[0]!;
    expect(sourceWays(w, node(w, `character:${ch.id}`)).map((x) => x.label)).toContain('동료로 함께면');
  });
});
