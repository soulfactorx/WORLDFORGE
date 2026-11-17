import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { edgeSlots, getCond, linkOptions, renameFlag, replaceLeaf, restageQuest, setCond, sourceWays, unlink } from './flowLink';
import { buildStoryGraph, layoutGraph, START_KEY } from './storyGraph';
import { gimmickScene } from '../engine/gimmick';

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

  it('아이템·적 (v0.148): 가지고 있으면 · 쓰러뜨리면 · 전투에 나오게 · 줍기', () => {
    const w: WorldPackage = { ...base, items: [{ id: 'item/key', name: '열쇠', description: '', kind: 'key' }], monsters: [],
      encounters: [{ id: 'enc/x', name: '싸움', locationId: sampleWorld.locations[0]!.id, enemies: [{ monsterId: 'goblin_warrior', zone: 2 }], trigger: '' }] };
    const g = buildStoryGraph(w);
    const it = g.nodes.find((n) => n.key === 'item:item/key')!;
    expect(it.kind).toBe('item');
    expect(layoutGraph(g).nodes.find((n) => n.key === 'item:item/key')!.layer).toBe(-2);
    const qa = node(w, 'quest:quest/a');
    const w2 = { ...w, ...linkOptions(w, it, node(w, 'quest:quest/b')).find((o) => o.label.includes('가지고 있으면') && o.label.includes('시작 조건'))!.apply(w) };
    expect(w2.quests!.find((q) => q.id === 'quest/b')!.start).toEqual({ all: [{ at: 'loc/y' }, { hasItem: 'item/key' }] });
    // 선택지 → 아이템: 얻음 효과
    expect(linkOptions(w, node(w, 'choice:choice/c'), it).some((o) => o.label.includes('얻음'))).toBe(true);
    // 장소 → 아이템: 줍기
    const loc = node(w, `location:${sampleWorld.locations[0]!.id}`);
    const w3 = { ...w, ...linkOptions(w, loc, it).find((o) => o.label.includes('주울 수 있게'))!.apply(w) };
    expect(w3.locations[0]!.pickups?.some((p) => p.itemId === 'item/key')).toBe(true);
    // 기본 적도 상자로 (경고 없이) · 전투에 이어짐
    const gob = g.nodes.find((n) => n.key === 'monster:goblin_warrior');
    expect(gob?.warn).toBeUndefined();
    expect(g.edges.some((e) => e.from === 'monster:goblin_warrior' && e.to === 'encounter:enc/x')).toBe(true);
    expect(sourceWays(w, gob!).map((x) => x.label)).toContain('한 마리 쓰러뜨리면');
    expect(qa).toBeTruthy();
  });

  it('함정·퍼즐 (v0.149): 흐름도에서 끝에 더한 효과가 gimmick 설정에도 적혀, 다시 만들어도 남는다', () => {
    const trap = gimmickScene({ id: 'scene/gimmick-1', name: '함정', start: { questDone: 'quest/a' } }, { kind: 'device', intro: '문', check: { check: 'skill:arcana', dc: 12 }, goal: 2, mistakes: 2 });
    const w: WorldPackage = { ...base, endings: [{ id: 'ending/f', name: 'F', condition: { flag: 'opened' }, epilogue: '' }], scenes: [trap] };
    const g = node(w, 'gimmick:scene/gimmick-1'), f = node(w, 'flag:opened');
    const opt = linkOptions(w, g, f).find((o) => o.group === 'effect' && o.label.includes('성공'))!;
    const w2 = { ...w, ...opt.apply(w) };
    const d = w2.scenes![0]!;
    expect(d.gimmick!.onSuccess!.effects).toEqual([{ setFlag: 'opened' }]);
    // 「함정·퍼즐」 탭처럼 gimmick 설정으로 다시 만들어도 효과·열리는 조건이 남는다
    const again = gimmickScene({ id: d.id, name: d.name, start: d.start! }, d.gimmick!);
    expect(again.ends.find((e) => e.id === 'solved')!.effects).toEqual([{ setFlag: 'opened' }]);
    expect(again.start).toEqual({ questDone: 'quest/a' });
  });

  it('자리 표시 플래그 (v0.150): 혼자 있는 「…_reached」 플래그는 처음 잇는 조건으로 바뀌고, 선언도 빠진다', () => {
    const w: WorldPackage = { ...base, endings: [{ id: 'ending/new-1', name: '끝', condition: { flag: 'ending_new_1_reached' }, epilogue: '' }], flags: [{ id: 'ending_new_1_reached', when: '끝날 때' }] };
    const opt = linkOptions(w, node(w, 'quest:quest/a'), node(w, 'ending:ending/new-1'))[0]!;
    expect(opt.note).toContain('자리 표시 플래그');
    const w2 = { ...w, ...opt.apply(w) };
    expect(w2.endings![0]!.condition).toEqual({ questDone: 'quest/a' });
    expect(w2.flags).toEqual([]);
    // 다음 연결은 「그리고」로 더한다
    const w3 = { ...w2, ...linkOptions(w2, node(w2, 'choice:choice/c'), node(w2, 'ending:ending/new-1'))[0]!.apply(w2) };
    expect(w3.endings![0]!.condition).toEqual({ all: [{ questDone: 'quest/a' }, { choice: 'choice/c' }] });
  });

  it('줄기·규칙 (v0.152): 「아직 정하지 않음」 장 조건은 처음 잇는 조건으로 바뀌고, 이어진 것 없는 규칙도 그린다', () => {
    const w: WorldPackage = { ...base,
      arcs: [{ id: 'arc/a', name: '큰 줄기', kind: 'main', start: { all: [] }, chapters: [{ name: '1장', goal: '', complete: { any: [] } }] }],
      rules: [{ id: 'rule/r', name: '규칙', trigger: { kind: 'action', describe: '문을 두드리면' } }] };
    const g = buildStoryGraph(w);
    expect(g.nodes.some((n) => n.key === 'rule:rule/r')).toBe(true);
    const opt = linkOptions(w, node(w, 'quest:quest/a'), node(w, 'arc:arc/a')).find((o) => o.label.includes('1장'))!;
    const w2 = { ...w, ...opt.apply(w) };
    expect(w2.arcs![0]!.chapters[0]!.complete).toEqual({ questDone: 'quest/a' });
    // 규칙의 추가 조건 칸에도 잇는다
    const r = linkOptions(w, node(w, 'quest:quest/a'), node(w, 'rule:rule/r')).find((o) => o.label.includes('추가 조건'))!;
    expect(({ ...w, ...r.apply(w) }).rules![0]!.requires).toEqual({ questDone: 'quest/a' });
  });

  it('임무 단계 바꾸기 (v0.154): 순서·넣기·지우기에 「n단계 중이면」 조건 번호가 따라간다', () => {
    const st = (o: string) => ({ objective: o, hint: '', complete: { all: [] } });
    const w: WorldPackage = { ...base,
      quests: [{ id: 'quest/a', name: 'A', kind: 'main', start: { all: [] }, stages: [st('하나'), st('둘'), st('셋')] }],
      endings: [{ id: 'ending/x', name: 'x', condition: { all: [{ questStage: 'quest/a', is: 1 }, { questStage: 'quest/other', is: 1 }] }, epilogue: '' }] };
    const cond = (p: Partial<WorldPackage>) => (p.endings ?? w.endings)![0]!.condition;
    // 둘을 위로: 1 → 0
    const q = w.quests![0]!;
    const up = restageQuest(w, 'quest/a', [q.stages[1]!, q.stages[0]!, q.stages[2]!], (o) => (o === 1 ? 0 : o === 0 ? 1 : o));
    expect(cond(up)).toEqual({ all: [{ questStage: 'quest/a', is: 0 }, { questStage: 'quest/other', is: 1 }] });
    expect(up.quests![0]!.stages.map((x) => x.objective)).toEqual(['둘', '하나', '셋']);
    // 첫 단계 아래에 넣기: 1 → 2
    expect(cond(restageQuest(w, 'quest/a', [q.stages[0]!, st('새'), q.stages[1]!, q.stages[2]!], (o) => (o > 0 ? o + 1 : o)))).toEqual({ all: [{ questStage: 'quest/a', is: 2 }, { questStage: 'quest/other', is: 1 }] });
    // 둘을 지우기: 그 자리를 가리키던 것은 가장 가까운 남은 단계로
    expect(cond(restageQuest(w, 'quest/a', [q.stages[0]!, q.stages[2]!], (o) => (o > 1 ? o - 1 : o === 1 ? 1 : o)))).toEqual({ all: [{ questStage: 'quest/a', is: 1 }, { questStage: 'quest/other', is: 1 }] });
  });

  it('플래그·지식 (v0.155): 이름 바꾸기가 선언·조건·효과·상자 자리까지 따라가고, 선언된 플래그·모든 지식은 늘 그린다', () => {
    const w: WorldPackage = { ...base,
      flags: [{ id: 'old_flag', when: '문을 열면' }, { id: 'lonely', when: '언젠가' }],
      endings: [{ id: 'ending/x', name: 'x', condition: { all: [{ flag: 'old_flag' }, { flag: 'other' }] }, epilogue: '' }],
      choices: [{ id: 'choice/c', name: 'c', prompt: '?', when: { all: [] }, options: [{ id: 'o', text: 't', effects: [{ setFlag: 'old_flag' }] }] }],
      flowLayout: { right: { 'flag:old_flag': [100, 100] } },
      claims: [...sampleWorld.claims, { id: 'claim/solo', statement: '아무도 안 쓰는 지식', truth: 'true' }] };
    const r = { ...w, ...renameFlag(w, 'old_flag', 'door_open') };
    expect(r.flags!.map((f) => f.id)).toEqual(['door_open', 'lonely']);
    expect(r.endings![0]!.condition).toEqual({ all: [{ flag: 'door_open' }, { flag: 'other' }] });
    expect(r.choices![0]!.options[0]!.effects).toEqual([{ setFlag: 'door_open' }]);
    expect(r.flowLayout!.right!['flag:door_open']).toEqual([100, 100]);
    const g = buildStoryGraph(w);
    expect(g.nodes.some((n) => n.key === 'flag:lonely')).toBe(true);
    expect(g.nodes.some((n) => n.key === 'claim:claim/solo')).toBe(true);
  });

  it('세력·인물 관계 (v0.163): 평판 조건·효과·소속·관계가 상자와 화살표로, 끌어 이으면 소속·관계', () => {
    const [c1, c2] = sampleWorld.characters;
    const w: WorldPackage = { ...base, factions: [{ id: 'fac/g', name: '길드', description: '' }],
      characters: sampleWorld.characters.map((c, i) => (i === 0 ? { ...c, faction: 'fac/g' } : c)),
      relations: [{ a: c1!.id, b: c2!.id, kind: 'rival' }],
      endings: [{ id: 'ending/r', name: 'r', condition: { reputation: 'fac/g', gte: 40 }, epilogue: '' }],
      choices: [{ id: 'choice/c', name: 'c', prompt: '?', when: { all: [] }, options: [{ id: 'o', text: 't', effects: [{ reputation: 'fac/g', delta: 15 }] }] }] };
    const g = buildStoryGraph(w);
    const has = (a: string, b: string) => g.edges.some((e) => e.from === a && e.to === b);
    expect(g.nodes.find((n) => n.key === 'faction:fac/g')!.kind).toBe('faction');
    expect(has('faction:fac/g', 'ending:ending/r')).toBe(true);
    expect(has('choice:choice/c', 'faction:fac/g')).toBe(true);
    expect(has('faction:fac/g', `character:${c1!.id}`)).toBe(true);
    expect(has(`character:${c1!.id}`, `character:${c2!.id}`)).toBe(true);
    expect(layoutGraph(g).nodes.find((n) => n.key === 'faction:fac/g')!.layer).toBe(-2);
    const f = node(w, 'faction:fac/g'), n2 = node(w, `character:${c2!.id}`);
    const w2 = { ...w, ...linkOptions(w, f, n2).find((o) => o.label.includes('소속'))!.apply(w) };
    expect(w2.characters.find((c) => c.id === c2!.id)!.faction).toBe('fac/g');
    const w3 = { ...w, ...linkOptions(w, n2, node(w, `character:${c1!.id}`)).find((o) => o.label.includes('동지'))!.apply(w) };
    expect(w3.relations).toEqual([{ a: c2!.id, b: c1!.id, kind: 'ally' }]);
    expect(sourceWays(w, f)[0]!.cond).toEqual({ reputation: 'fac/g', gte: 50 });
  });
});

