import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { abilityModifier, d20Test, roll } from './dice';

describe('rng', () => {
  it('같은 시드는 같은 수열을 만든다', () => {
    const a = createRng(42), b = createRng(42);
    expect(Array.from({ length: 10 }, () => a.next())).toEqual(Array.from({ length: 10 }, () => b.next()));
  });
  it('저장한 상태에서 이어서 굴릴 수 있다', () => {
    const a = createRng(7);
    a.next(); a.next();
    const resumed = createRng(a.state());
    expect(resumed.next()).toBe(a.next());
  });
});

describe('roll', () => {
  it('표기를 해석하고 범위 안의 값을 낸다', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      const r = roll(rng, '2d6+3');
      expect(r.rolls).toHaveLength(2);
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(15);
    }
  });
  it('잘못된 표기는 거부한다', () => {
    expect(() => roll(createRng(1), '2x6')).toThrow();
    expect(() => roll(createRng(1), '0d6')).toThrow();
  });
});

describe('d20Test', () => {
  it('이점은 높은 값, 불리점은 낮은 값을 쓴다', () => {
    for (let seed = 0; seed < 200; seed++) {
      const adv = d20Test(createRng(seed), 0, 10, 'advantage');
      expect(adv.kept).toBe(Math.max(...adv.rolls));
      const dis = d20Test(createRng(seed), 0, 10, 'disadvantage');
      expect(dis.kept).toBe(Math.min(...dis.rolls));
    }
  });
  it('능력치 수정치', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(15)).toBe(2);
    expect(abilityModifier(20)).toBe(5);
  });
});
