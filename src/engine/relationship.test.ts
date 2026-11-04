import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import {
  applyDelta, canShareSecret, clampDelta, initialRelationship, joinBlocker, MAX_DELTA_PER_TURN, relationshipOf, stageOf,
} from './relationship';

describe('관계', () => {
  it('패키지 초기값을 쓰고, 세이브 값이 있으면 그것을 쓴다', () => {
    expect(initialRelationship(sampleWorld, 'npc/bran')).toEqual({ affinity: -10, trust: -10, respect: 0, fear: 0 });
    expect(relationshipOf(sampleWorld, { 'npc/bran': { affinity: 5, trust: 5, respect: 0, fear: 0 } }, 'npc/bran').affinity).toBe(5);
    expect(initialRelationship(sampleWorld, 'npc/unknown')).toEqual({ affinity: 0, trust: 0, respect: 0, fear: 0 });
  });
  it('변화량은 턴당 한도로 잘리고 0은 버린다', () => {
    expect(clampDelta({ affinity: 50, trust: -3.4, respect: 0 })).toEqual({ affinity: MAX_DELTA_PER_TURN, trust: -3 });
    expect(clampDelta({ affinity: 0 })).toBeNull();
    expect(clampDelta({ affinity: Number.NaN })).toBeNull();
  });
  it('값은 -100~100', () => {
    expect(applyDelta({ affinity: 95, trust: -95, respect: 0, fear: 0 }, { affinity: 10, trust: -10 })).toEqual({ affinity: 100, trust: -100, respect: 0, fear: 0 });
  });
  it('관계 단계', () => {
    expect(stageOf({ affinity: -50, trust: 0, respect: 0, fear: 0 })).toBe('적대');
    expect(stageOf({ affinity: -10, trust: -20, respect: 0, fear: 0 })).toBe('경계');
    expect(stageOf({ affinity: 0, trust: 0, respect: 0, fear: 0 })).toBe('낯섦');
    expect(stageOf({ affinity: 25, trust: 10, respect: 0, fear: 0 })).toBe('호의');
    expect(stageOf({ affinity: 10, trust: 35, respect: 0, fear: 0 })).toBe('신뢰');
    expect(stageOf({ affinity: 60, trust: 70, respect: 0, fear: 0 })).toBe('깊은 유대');
  });
  it('비밀 공개와 동행에는 관계 기준이 필요하다', () => {
    const ilse = sampleWorld.characters.find((c) => c.id === 'npc/ilse')!;
    expect(canShareSecret(sampleWorld, 'npc/ilse', { affinity: 0, trust: 49, respect: 0, fear: 0 })).toBe(false);
    expect(canShareSecret(sampleWorld, 'npc/ilse', { affinity: 0, trust: 50, respect: 0, fear: 0 })).toBe(true);
    expect(joinBlocker(ilse.companion!, { affinity: 10, trust: 10, respect: 0, fear: 0 })).not.toBeNull();
    expect(joinBlocker(ilse.companion!, { affinity: 10, trust: 25, respect: 0, fear: 0 })).toBeNull();
  });
});
