import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { nodeSim, simActs, simExplore, simReplay, simStart } from './flowSim';
import { buildStoryGraph } from './storyGraph';

const w: WorldPackage = { ...sampleWorld,
  quests: [
    { id: 'quest/a', name: 'A', kind: 'main', start: { all: [] }, stages: [{ objective: 'x', hint: '', complete: { flag: 'never' } }, { objective: 'x2', hint: '', complete: { flag: 'never' } }] },
    { id: 'quest/b', name: 'B', kind: 'side', start: { questDone: 'quest/a' }, stages: [{ objective: 'y', hint: '', complete: { flag: 'never' } }] },
    { id: 'quest/orphan', name: '외톨이', kind: 'side', start: { flag: 'nobody' }, stages: [{ objective: 'z', hint: '', complete: { flag: 'never' } }] },
  ],
  endings: [{ id: 'ending/good', name: '좋은 끝', condition: { questDone: 'quest/b' }, epilogue: '' }, { id: 'ending/bad', name: '나쁜 끝', condition: { questFailed: 'quest/a' }, epilogue: '' }],
  choices: [], storylets: [], scenes: [], encounters: [], events: [], arcs: [], clocks: [], rules: [],
};

describe('흐름도 시뮬레이션 (v0.145)', () => {
  it('열린 상자를 진행하면 다음이 열리고 결말에 이른다', () => {
    const g = buildStoryGraph(w);
    const n = (k: string) => g.nodes.find((x) => x.key === k)!;
    let s = simStart(w).state;
    expect(nodeSim(w, s, n('quest:quest/a')).st).toBe('active'); // 처음부터 열린 임무는 저절로 시작
    expect(nodeSim(w, s, n('quest:quest/b')).st).toBe('locked');
    const stage = simActs(w, s, n('quest:quest/a')).find((a) => a.id === 'stage')!;
    s = stage.run(w, s).state;
    expect(nodeSim(w, s, n('quest:quest/a')).text).toBe('2/2단계');
    s = simActs(w, s, n('quest:quest/a')).find((a) => a.id === 'done')!.run(w, s).state;
    expect(nodeSim(w, s, n('quest:quest/b')).st).toBe('active');
    s = simActs(w, s, n('quest:quest/b')).find((a) => a.id === 'done')!.run(w, s).state;
    expect(nodeSim(w, s, n('ending:ending/good')).st).toBe('reached');
    expect(simActs(w, s, n('quest:quest/orphan'))).toEqual([]); // 결말 뒤에는 할 일이 없다
    const re = simReplay(w, g, ['quest:quest/a|fail']);
    expect(re.state.ending).toBe('ending/bad');
  });
  it('자동 탐색: 결말 분포 · 한 번도 안 열리는 상자', async () => {
    const g = buildStoryGraph(w);
    const r = await simExplore(w, g, { runs: 40, seed: 3 });
    expect(r.runs).toBe(40);
    expect(Object.keys(r.endings).sort()).toEqual(['ending:ending/bad', 'ending:ending/good']);
    expect(r.never).toContain('quest:quest/orphan');
    expect(r.pathTo['ending:ending/good']!.length).toBeGreaterThan(0);
  });
  it('큰 세계도 돌아간다', async () => {
    const g = buildStoryGraph(aetheriaWorld);
    const t = Date.now();
    const r = await simExplore(aetheriaWorld, g, { runs: 20, seed: 1 });
    expect(r.runs).toBe(20);
    console.log('aetheria 20 runs ms', Date.now() - t, JSON.stringify({ endings: r.endings, dead: r.deadEnds, long: r.tooLong, never: r.never.length, avg: r.avgSteps }));
  }, 60000);
});
