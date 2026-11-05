import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import {
  applyDelta, canShareSecret, clampDelta, initialRelationship, joinBlocker, loyaltyOf, MAX_DELTA_PER_TURN, type Relationship, relationshipOf, stageOf,
  wantsToLeave, ZERO_RELATIONSHIP,
} from './relationship';

describe('관계', () => {
  it('패키지 초기값을 쓰고, 세이브 값이 있으면 그것을 쓴다', () => {
    expect(initialRelationship(sampleWorld, 'npc/bran')).toEqual({ affinity: -10, trust: -10, respect: 0, fear: 0, intimacy: 0, grudge: 0 });
    expect(relationshipOf(sampleWorld, { 'npc/bran': { affinity: 5, trust: 5, respect: 0, fear: 0 } }, 'npc/bran').affinity).toBe(5);
    expect(initialRelationship(sampleWorld, 'npc/unknown')).toEqual(ZERO_RELATIONSHIP);
  });
  it('변화량은 턴당 한도로 잘리고 0은 버린다', () => {
    expect(clampDelta({ affinity: 50, trust: -3.4, respect: 0 })).toEqual({ affinity: MAX_DELTA_PER_TURN, trust: -3 });
    expect(clampDelta({ affinity: 0 })).toBeNull();
    expect(clampDelta({ affinity: Number.NaN })).toBeNull();
  });
  it('값은 -100~100', () => {
    expect(applyDelta({ affinity: 95, trust: -95, respect: 0, fear: 0 }, { affinity: 10, trust: -10, intimacy: 3 })).toEqual({ affinity: 100, trust: -100, respect: 0, fear: 0, intimacy: 3, grudge: 0 });
  });
  it('관계 단계 (설계 v3 4.2)', () => {
    const r = (x: Partial<Relationship>) => ({ ...ZERO_RELATIONSHIP, ...x });
    expect(stageOf(r({ affinity: -50 }))).toBe('적대');
    expect(stageOf(r({ grudge: 70, affinity: 20 }))).toBe('숙적');
    expect(stageOf(r({ affinity: -10, trust: -20 }))).toBe('경계');
    expect(stageOf(r({}))).toBe('낯섦');
    expect(stageOf(r({ affinity: 15 }))).toBe('아는 사이');
    expect(stageOf(r({ affinity: 10, trust: 35 }))).toBe('믿는 사이');
    expect(stageOf(r({ affinity: 40, trust: 30 }))).toBe('친구');
    expect(stageOf(r({ affinity: 60, trust: 50, intimacy: 65 }))).toBe('절친');
    expect(stageOf(r({ affinity: 60, trust: 10, intimacy: 65 }), true)).toBe('연인');
    expect(stageOf(r({ affinity: 60, trust: 10, intimacy: 65 }), false)).toBe('친구');
  });
  it('충성도와 떠남', () => {
    expect(loyaltyOf(ZERO_RELATIONSHIP)).toBe(50);
    expect(loyaltyOf({ affinity: 40, trust: 40, intimacy: 20 })).toBe(75);
    expect(loyaltyOf({ grudge: 60 })).toBe(20);
    expect(wantsToLeave({ grudge: 50 })).toBe(true);
    expect(wantsToLeave({ affinity: -30 })).toBe(false);
  });
  it('비밀 공개와 동행에는 관계 기준이 필요하다', () => {
    const ilse = sampleWorld.characters.find((c) => c.id === 'npc/ilse')!;
    expect(canShareSecret(sampleWorld, 'npc/ilse', { affinity: 0, trust: 49, respect: 0, fear: 0 })).toBe(false);
    expect(canShareSecret(sampleWorld, 'npc/ilse', { affinity: 0, trust: 50, respect: 0, fear: 0 })).toBe(true);
    expect(joinBlocker(ilse.companion!, { affinity: 10, trust: 10, respect: 0, fear: 0 })).not.toBeNull();
    expect(joinBlocker(ilse.companion!, { affinity: 10, trust: 25, respect: 0, fear: 0 })).toBeNull();
  });
});
