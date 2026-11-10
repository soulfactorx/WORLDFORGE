import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import type { WorldPackage } from '../../engine/schema';
import type { LlmClient } from '../../llm/types';
import { aiFill, applyPatches, scanWorld } from './audit';

describe('세계관 점검·마무리 (v0.78)', () => {
  const broken = (): WorldPackage => {
    const w = structuredClone(sampleWorld);
    w.characters[0]!.appearance = '원문에 없음';
    w.characters[1]!.speech = '';
    delete w.characters[0]!.gender;
    w.locations[0]!.description = '';
    w.overview = '';
    w.quests = []; w.endings = [];
    return w;
  };

  it('규칙 점검: 자리표시·빈칸·빠진 구조·검사기 문제를 찾는다', () => {
    const gaps = scanWorld(broken());
    const keys = gaps.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining([
      `character.appearance:${sampleWorld.characters[0]!.id}`, `character.speech:${sampleWorld.characters[1]!.id}`,
      `character.gender:${sampleWorld.characters[0]!.id}`, `location.description:${sampleWorld.locations[0]!.id}`,
      'world.overview', 'structure.quests', 'structure.endings',
    ]));
    // 자리표시 경고는 채울 칸과 겹치게 두 번 나오지 않는다
    expect(gaps.filter((g) => g.key.startsWith('check:') && g.key.includes('appearance'))).toHaveLength(0);
    expect(gaps.find((g) => g.key === 'structure.quests')?.action).toBe('scenario');
  });

  it('AI 제안: 목록에 없는 칸·자리표시·잘못된 성별은 버리고, 고른 것만 적용한다', async () => {
    const w = broken();
    const c0 = w.characters[0]!.id;
    let sent = '';
    const llm: LlmClient = { stream: async () => '', json: async <T,>(r: { user: string }) => { sent = r.user; return {
      fills: [
        { key: `character.appearance:${c0}`, value: '희끗한 수염의 노인. 지팡이를 짚는다.', reason: '마을 장로 설정' },
        { key: `character.gender:${c0}`, value: 'm', reason: '할아버지' },
        { key: `character.speech:${w.characters[1]!.id}`, value: '원문에 없음', reason: 'x' },
        { key: 'character.appearance:npc/nobody', value: '유령', reason: 'x' },
        { key: 'world.overview', value: '안개가 걷히지 않는 골짜기 마을.', reason: '장소들' },
      ], notes: ['결말로 가는 길이 없다'] } as T; } };
    const r = await aiFill(llm, w, scanWorld(w));
    expect(sent).toContain('원문에 없음'); // 지금 값이 함께 간다
    expect(r.patches.map((p) => p.key).sort()).toEqual([`character.appearance:${c0}`, `character.gender:${c0}`, 'world.overview'].sort());
    expect(r.notes).toEqual(['결말로 가는 길이 없다']);
    const next = applyPatches(w, r.patches.filter((p) => p.field !== 'world.overview'));
    expect(next.characters[0]!.appearance).toContain('희끗한');
    expect(next.characters[0]!.gender).toBe('M');
    expect(next.overview).toBe('');
    expect(w.characters[0]!.appearance).toBe('원문에 없음'); // 원본은 그대로
  });
});

describe('AI 채우기: 여러 묶음 (v0.86)', () => {
  it('묶음을 동시에 보내고, 한 묶음이 실패해도 나머지 제안은 살린다', async () => {
    const gaps = Array.from({ length: 70 }, (_, i) => ({ key: `location.description:loc/x${i}`, area: 'location' as const, level: 'warning' as const, label: `장소 ${i}`, detail: '', fill: { field: 'location.description' as const, id: `loc/x${i}` } }));
    let live = 0, peak = 0, call = 0;
    const llm: LlmClient = { stream: async () => '', json: async <T,>(r: { user: string }) => {
      const n = call++;
      live++; peak = Math.max(peak, live);
      await new Promise((res) => setTimeout(res, 5));
      live--;
      if (n === 1) throw new Error('과부하');
      const keys = [...r.user.matchAll(/- (location\.description:\S+) ·/g)].map((m) => m[1]!);
      return { fills: keys.map((key) => ({ key, value: '돌담이 낮게 둘러선 마당.', reason: '' })), notes: n === 0 ? ['메모'] : [] } as T;
    } };
    const r = await aiFill(llm, { ...structuredClone(sampleWorld) }, gaps as never);
    expect(peak).toBeGreaterThan(1);
    expect(r.patches.length).toBe(40); // 30 + 10 (가운데 30개 묶음은 실패)
    expect(r.notes.some((n) => n.includes('1묶음'))).toBe(true);
  });
});
