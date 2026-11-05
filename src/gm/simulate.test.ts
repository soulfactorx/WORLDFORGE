import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { wuxiaSample } from '../data/sample-genres';
import { flagFlows, flowWarnings } from '../engine/package/flow';
import { describeCondition } from '../ui/ConditionEditor';
import { simulateWorld } from './simulate';

describe('이야기 보드 (R8)', () => {
  it('플래그를 누가 세우고 누가 읽는지', () => {
    const f = flagFlows(sampleWorld).find((x) => x.id === 'chose_stay')!;
    expect(f.setBy).toEqual(expect.arrayContaining(['GM (플레이어의 행동)', '결정 "돌아갈 것인가" → 이 세계에 남아 마을을 지킨다']));
    expect(f.readBy.some((r) => r.includes('결말'))).toBe(true);
  });
  it('세울 곳 없이 읽기만 하는 플래그를 경고한다', () => {
    const w = { ...structuredClone(sampleWorld), endings: [...(sampleWorld.endings ?? []), { id: 'ending/x', name: 'X', condition: { flag: 'ghost_flag' }, epilogue: '' }] };
    expect(flowWarnings(w).some((x) => x.includes('ghost_flag') && x.includes('세우는 곳이 없습니다'))).toBe(true);
  });
  it('조건을 사람이 읽는 말로', () => {
    expect(describeCondition({ all: [{ at: 'loc/inn' }, { not: { flag: 'x' } }] }, sampleWorld)).toBe('젖은 장화 여관에 있다 그리고 아님: 플래그 x');
    expect(describeCondition({ all: [] }, sampleWorld)).toBe('항상');
  });
});

describe('세계 시뮬레이터 (R8)', () => {
  it('AI 없이 날마다 시계·사건·세력 행동이 일어난다 (청운객잔: 7일째 장문인이 죽는다)', () => {
    const r = simulateWorld(wuxiaSample, 8);
    expect(r.days).toHaveLength(9);
    const all = r.days.flatMap((d) => d.lines.map((l) => `${d.day}:${l}`));
    expect(all.some((l) => l.startsWith('3:') && l.includes('병세'))).toBe(true);
    expect(all.some((l) => l.startsWith('7:') && l.includes('운학 진인'))).toBe(true);
    expect(r.state.deadNpcs).toContain('npc/unhak');
    expect(all.some((l) => l.includes('흑풍채'))).toBe(true);
  });
  it('미리 세운 플래그로 다른 미래를 본다', () => {
    const r = simulateWorld(sampleWorld, 7);
    expect(r.state.clocks['clock/altar']!.value).toBe(6);
    expect(r.days.some((d) => d.lines.some((l) => l.includes('문양이 저절로 빛나기')))).toBe(true);
    const same = simulateWorld(sampleWorld, 7);
    expect(same.days).toEqual(r.days);
  });
});
