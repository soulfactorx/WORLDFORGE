import { describe, expect, it } from 'vitest';
import { romanceSample } from '../../data/sample-genres';
import type { LlmClient } from '../../llm/types';
import { generateScenario } from './generate';
import { scanWorld } from './audit';

describe('조우만 만들기 (v0.79.4)', () => {
  const w = { ...structuredClone(romanceSample), encounters: [] };
  const loc = w.locations[0]!;
  it('장소를 이름·접두사 없는 ID로 적어도 찾고, 임무·결말은 건드리지 않으며, 추가된 수를 알린다', async () => {
    let system = '';
    const llm: LlmClient = { stream: async () => '', json: async <T,>(r: { system: string }) => { system = r.system; return {
      quests: [{ key: 'q', name: '딴 임무', kind: 'side', stages: [{ objective: 'x', hint: 'x', complete: { all: [] } }] }], endings: [], flags: [],
      encounters: [
        { key: 'thugs', name: '골목 불량배', location: loc.name, enemies: [{ monster: Object.keys(w.monsters ?? {}).length ? 'x' : 'bandit', zone: 2 }], trigger: '밤에 혼자 걸으면' },
        { key: 'thief', name: '소매치기', location: loc.id.replace('loc/', ''), enemies: [{ monster: 'bandit', zone: 2 }], trigger: '장터에서' },
        { key: 'bad', name: '없는 곳', location: 'loc/nowhere', enemies: [{ monster: 'bandit', zone: 2 }], trigger: '' },
      ] } as T; } };
    const before = (w.quests ?? []).length;
    const r = await generateScenario(llm, w, () => {}, undefined, '', 'encounters');
    expect(system).toContain('이번 요청은 조우만이다');
    expect(system).toContain('현실적인 위기'); // 전투가 드문 장르
    expect(r.world.encounters!.map((e) => e.name)).toEqual(['골목 불량배', '소매치기']);
    expect(r.world.encounters!.every((e) => e.locationId === loc.id)).toBe(true);
    expect((r.world.quests ?? []).length).toBe(before);
    expect(r.notes[0]).toBe('추가됨 — 임무 0 · 조우 2 · 결말 0 · 플래그 0');
    expect(r.notes.some((n) => n.includes('없는 곳'))).toBe(true);
    expect(scanWorld(r.world).some((g) => g.key === 'structure.encounters')).toBe(false);
  });

  it('하나도 못 만들면 경고가 맨 앞에', async () => {
    const llm: LlmClient = { stream: async () => '', json: async <T,>() => ({ quests: [], endings: [], flags: [], encounters: [] }) as T };
    const r = await generateScenario(llm, w, () => {}, undefined, '', 'encounters');
    expect(r.notes[0]).toMatch(/^⚠ 조우가 하나도 추가되지 않았습니다/);
  });
});
