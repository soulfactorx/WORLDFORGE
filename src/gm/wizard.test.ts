import { describe, expect, it } from 'vitest';
import { hasErrors, validateWorld } from '../engine/package/validate';
import { blankDraft, buildWorld, checkDraft, sampleDraft, suggestStep, type WizDraft } from './wizard';
import type { LlmClient } from '../llm/types';

describe('세계관 마법사 (v0.125)', () => {
  it('예시 초안은 오류 없는 세계가 된다', () => {
    const w = buildWorld(sampleDraft(), 1);
    const issues = validateWorld(w);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(w.locations.find((l) => l.id === 'loc/p2')!.connections).toEqual(['loc/p1']); // 길은 양쪽으로
    expect(w.locations.find((l) => l.id === 'loc/p3')!.discoveries![0]!.claim).toBe('claim/s1');
    expect(w.beliefs).toContainEqual({ holder: 'npc/c1', claim: 'claim/s1', state: 'secret' });
    expect(w.beliefs).toContainEqual({ holder: 'group:사람들', claim: 'claim/s2', state: 'rumor' });
    expect(validateWorld(w).filter((i) => i.level === 'warning')).toEqual([]);
    expect(w.quests![0]!.stages.map((s) => s.complete)).toEqual([{ relationship: 'npc/c2', axis: 'affinity', gte: 30 }, { knows: 'claim/s1', min: 'partial' }]);
    expect(w.endings!.map((e) => e.condition)).toEqual([{ questDone: 'quest/main' }, { questFailed: 'quest/main' }]);
    expect(w.start.openingScene.startsWith('당신은 약초를 구하러 올라온 떠돌이.')).toBe(true);
    expect(w.characters[0]!.relationship).toEqual({ affinity: 20, trust: 15 });
  });
  it('빈 초안: 꼭 필요한 것을 알려 주고, 그래도 세계는 만들어진다', () => {
    const d = blankDraft();
    const needs = checkDraft(d).filter((n) => n.level === 'need').map((n) => n.step);
    expect(needs).toEqual(expect.arrayContaining(['basics', 'places', 'start']));
    expect(hasErrors(validateWorld(buildWorld(d)))).toBe(false);
  });
  it('이름 없는 칸·끊어진 연결은 버린다', () => {
    const d: WizDraft = { ...sampleDraft(), people: [...sampleDraft().people, { ...sampleDraft().people[0]!, key: 'c9', name: '' }] };
    d.goal.stages.push({ key: 'g9', objective: '없는 곳', kind: 'at', ref: 'p99' });
    const w = buildWorld(d);
    expect(w.characters).toHaveLength(2);
    expect(w.quests![0]!.stages).toHaveLength(2);
    expect(hasErrors(validateWorld(w))).toBe(false);
  });
  it('AI 제안: 줄 꼴을 읽어 더하고, 이름으로 연결한다', async () => {
    const llm = { stream: async () => '', json: async <T,>(r: { label?: string }) => {
      if (r.label?.includes('장소')) return { items: ['종탑|높은 탑|수도원 마당', '약초밭|흙 냄새|종탑'] } as T;
      if (r.label?.includes('인물')) return { items: ['미라|F|약초꾼|녹색 망토|수다스럽다|빠른 말|약초밭|wary|마을 출신'] } as T;
      return { items: [] } as T;
    } } as unknown as LlmClient;
    let d = sampleDraft();
    d = await suggestStep(llm, 'places', d);
    const herb = d.places.find((p) => p.name === '약초밭')!;
    expect(d.places.filter((p) => p.name === '종탑')).toHaveLength(1); // 이미 있는 이름은 건너뛴다
    expect(herb.links).toEqual(['p2']);
    d = await suggestStep(llm, 'people', d);
    expect(d.people.find((c) => c.name === '미라')).toMatchObject({ place: herb.key, attitude: 'wary', gender: 'F' });
    expect(hasErrors(validateWorld(buildWorld(d)))).toBe(false);
  });
});
