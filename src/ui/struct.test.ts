import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import type { SceneDef } from '../engine/schema';
import { describeSceneCond } from './SceneForms';
import { refOptions, SPEC } from './Struct';

/** v0.107: 선택형 편집기 */
describe('장면 조건을 한 문장으로', () => {
  const def = { gauges: [{ id: 'deal', name: '합의', start: 0 }, { id: 'p', name: '인내심', start: 5 }], states: [{ id: 'warm', name: '호의' }], phases: [{ id: 'talk', name: '담판' }] } as unknown as SceneDef;
  it('잎과 묶음', () => {
    expect(describeSceneCond(undefined, def)).toBe('항상');
    expect(describeSceneCond({ gauge: 'deal', gte: 8 }, def)).toBe('합의 8 이상');
    expect(describeSceneCond({ gauge: 'p', lte: 0 }, def)).toBe('인내심 0 이하');
    expect(describeSceneCond({ all: [{ gauge: 'deal', gte: 8 }, { any: [{ state: 'warm' }, { round: 5 }] }] }, def)).toBe('합의 8 이상 그리고 (상태 「호의」 또는 5차례 이상)');
    expect(describeSceneCond({ not: { phase: 'talk' } }, def)).toBe('(단계 「담판」)이 아님');
    expect(describeSceneCond({ all: [] }, def)).toContain('항상');
    expect(describeSceneCond({ any: [] }, def)).toContain('절대 아님');
  });
});

describe('선택형 편집기의 명세', () => {
  it('고를 목록은 세계에서 온다', () => {
    expect(refOptions(sampleWorld, 'locations').length).toBe(sampleWorld.locations.length);
    expect(refOptions(sampleWorld, 'claims')[0]![0]).toBe(sampleWorld.claims[0]!.id);
    expect(refOptions(sampleWorld, 'skills').some(([v]) => v === 'persuasion')).toBe(true);
  });
  it('새 항목은 세계의 실제 ID로 채워진다', () => {
    expect(SPEC.schedule.make(sampleWorld, 1)).toMatchObject({ locationId: sampleWorld.locations[0]!.id });
    expect(SPEC.starts.make(sampleWorld, 2)).toMatchObject({ id: 'start-2', locationId: sampleWorld.start.locationId });
    expect(SPEC.discoveries.title({ claim: sampleWorld.claims[0]!.id }, sampleWorld)).toContain(sampleWorld.claims[0]!.statement.slice(0, 10));
  });
  it('돌발 사건·ID로 묶인 표의 명세', () => {
    expect(SPEC.randomEvents.title({ name: '늑대 떼', kind: 'ambush' }, sampleWorld)).toBe('늑대 떼 · 기습');
    expect(SPEC.shops.make()).toEqual({ name: '상점', items: [] });
    expect(SPEC.pickups.of).toBe('locations');
    expect(SPEC.gives.of).toBe('characters');
  });
});
