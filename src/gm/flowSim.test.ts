import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { nodeSim, parseSetting, previewActs, settingStep, settingValue, simActs, simExplore, simReplay, simSet, simStart } from './flowSim';
import { traitsFor } from '../engine/traits';
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

  it('결정적 선택: 고르면 어떻게 되나 미리 보기 · 잠긴 선택도 조건 무시하고 · 자동 탐색은 갈림길별 결말을 센다 (v0.160)', async () => {
    const cw: WorldPackage = { ...w,
      quests: [{ id: 'quest/a', name: 'A', kind: 'main', start: { all: [] }, stages: [{ objective: 'x', hint: '', complete: { flag: 'never' } }] }],
      choices: [{ id: 'choice/fate', name: '운명', prompt: '?', when: { all: [] }, options: [{ id: 'light', text: '빛', effects: [{ setFlag: 'went_light' }] }, { id: 'dark', text: '어둠', effects: [{ setFlag: 'went_dark' }] }] },
        { id: 'choice/later', name: '나중', prompt: '?', when: { questDone: 'quest/a' }, options: [{ id: 'x', text: 'x', effects: [] }] }],
      endings: [{ id: 'ending/light', name: '빛의 끝', condition: { flag: 'went_light' }, epilogue: '' }, { id: 'ending/dark', name: '어둠의 끝', condition: { flag: 'went_dark' }, epilogue: '' }],
      flags: [] };
    const g = buildStoryGraph(cw);
    const n = (k: string) => g.nodes.find((x) => x.key === k)!;
    const s = simStart(cw).state;
    const pv = previewActs(cw, s, g, n('choice:choice/fate'));
    expect(pv.map((p) => p.ending?.name)).toEqual(['빛의 끝', '어둠의 끝']);
    expect(pv[0]!.on.map((x) => x.id)).toContain('went_light');
    expect(nodeSim(cw, s, n('choice:choice/fate')).st).toBe('open'); // 미리 보기는 상태를 바꾸지 않는다
    const locked = simActs(cw, s, n('choice:choice/later'));
    expect(locked[0]!.label).toContain('조건 무시');
    expect(locked[0]!.weight).toBe(0);
    const r = await simExplore(cw, g, { runs: 30, seed: 2 });
    const t = r.byChoice['choice:choice/fate']!;
    expect(t['opt:light']!.endings['ending:ending/light']).toBe(t['opt:light']!.runs);
    expect(t['opt:dark']!.endings['ending:ending/dark']).toBe(t['opt:dark']!.runs);
    expect(t['opt:light']!.runs + t['opt:dark']!.runs).toBe(30);
  });

  it('성향·관계·평판·수치를 정해 시험한다 · 다시 돌려도 같고, 자동 탐색은 그 값에서 시작 (v0.161)', async () => {
    const ax = traitsFor(w)[0]!;
    const npc = w.characters[0]!;
    const tw: WorldPackage = { ...w, quests: [], choices: [], endings: [{ id: 'ending/saint', name: '성자', condition: { all: [{ trait: ax.id, gte: 60 }, { relationship: npc.id, axis: 'trust', gte: 50 }] }, epilogue: '' }] };
    const g = buildStoryGraph(tw);
    let s = simStart(tw).state;
    expect(s.ending).toBeUndefined();
    s = simSet(tw, s, { kind: 'trait', id: ax.id, value: 70 }).state;
    expect(settingValue(tw, s, { kind: 'trait', id: ax.id })).toBe(70);
    expect(s.ending).toBeUndefined(); // 관계가 아직
    const step = settingStep({ kind: 'rel', id: npc.id, axis: 'trust', value: 55 });
    expect(parseSetting(step)).toEqual({ kind: 'rel', id: npc.id, axis: 'trust', value: 55 });
    s = simSet(tw, s, parseSetting(step)!).state;
    expect(settingValue(tw, s, { kind: 'rel', id: npc.id, axis: 'trust' })).toBe(55);
    expect(s.ending).toBe('ending/saint');
    const prefix = [settingStep({ kind: 'trait', id: ax.id, value: 70 }), step];
    expect(simReplay(tw, g, prefix).state.ending).toBe('ending/saint');
    const r = await simExplore(tw, g, { runs: 5, seed: 1, prefix });
    expect(r.endings['ending:ending/saint']).toBe(5);
    expect(r.pathTo['ending:ending/saint']!.slice(0, 2)).toEqual(prefix);
  });
});

