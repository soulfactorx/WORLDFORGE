import { describe, expect, it } from 'vitest';
import { createCharacter, suggestedStandardArray } from './sheet';
import { levelForXp, levelUp, xpToNext } from './progression';

const make = (classId: string, skills: string[]) =>
  createCharacter({ name: '나', classId, method: 'standard', abilities: suggestedStandardArray(classId), skills: skills as never });

describe('레벨업', () => {
  it('경험치 표 (SRD: 2레벨 300, 3레벨 900)', () => {
    expect([0, 299, 300, 899, 900, 5000].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(xpToNext({ ...make('fighter', ['athletics', 'perception']), xp: 100 })).toBe(200);
  });
  it('HP는 고정값 + 건강 수정치, 새 능력 안내', () => {
    const f = make('fighter', ['athletics', 'perception']); // 건강 14 (+2), d10
    const r = levelUp(f);
    expect(r.hpGain).toBe(6 + 2);
    expect(r.sheet.level).toBe(2);
    expect(r.sheet.maxHp).toBe(f.maxHp + 8);
    expect(r.features).toEqual(['행동 연쇄']);
    expect(r.sheet.resources?.action_surge).toEqual({ cur: 1, max: 1 });
  });
  it('쓴 자원은 유지하고 늘어난 만큼만 채운다', () => {
    const w = make('wizard', ['arcana', 'history']);
    const spent = { ...w, resources: { ...w.resources, slot1: { cur: 0, max: 2 } } };
    const r2 = levelUp(spent);
    expect(r2.sheet.resources?.slot1).toEqual({ cur: 1, max: 3 });
    const r3 = levelUp(r2.sheet);
    expect(r3.sheet.resources?.slot1).toEqual({ cur: 2, max: 4 });
    expect(r3.sheet.resources?.slot2).toEqual({ cur: 2, max: 2 });
  });
});
