import { describe, expect, it } from 'vitest';
import { createCharacter, suggestedStandardArray } from './sheet';
import { levelForXp, levelUp, xpToNext } from './progression';

const make = (classId: string, skills: string[]) =>
  createCharacter({ name: '나', classId, method: 'standard', abilities: suggestedStandardArray(classId), skills: skills as never });

describe('레벨업', () => {
  it('경험치 표 (SRD: 2레벨 300, 3레벨 900, 4레벨 2700, 5레벨 6500)', () => {
    expect([0, 299, 300, 899, 900, 2699, 2700, 6499, 6500, 14000, 63999, 64000, 999999].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 9, 10, 10]);
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
  it('4레벨 능력치 향상: 주능력치 +2 (최대 20)', () => {
    const f = make('fighter', ['athletics', 'perception']); // 근력 15
    let sh = f;
    for (let i = 0; i < 2; i++) sh = levelUp(sh).sheet;
    const r4 = levelUp(sh);
    expect(r4.sheet.level).toBe(4);
    expect(r4.sheet.abilities.str).toBe(17);
    expect(r4.features[0]).toBe('능력치 향상: 근력 +2 (17)');
    expect(r4.sheet.resources?.second_wind?.max).toBe(3);
    // 19에서는 +1만 주능력치에, 나머지는 두 번째 능력치(건강)에 → HP 소급
    const hi = { ...sh, abilities: { ...sh.abilities, str: 19, con: 15 } };
    const r = levelUp(hi);
    expect(r.sheet.abilities).toMatchObject({ str: 20, con: 16 });
    expect(r.hpGain).toBe(6 + 3 + 3); // 평균 6 + 새 건강 +3, 지난 3레벨분 +1씩 소급
  });
  it('5레벨: 3레벨 슬롯, 새 주문', () => {
    let w = make('wizard', ['arcana', 'history']);
    const feats: string[] = [];
    for (let i = 0; i < 4; i++) { const r = levelUp(w); w = r.sheet; feats.push(...r.features); }
    expect(w.level).toBe(5);
    expect(w.resources).toMatchObject({ slot1: { max: 4 }, slot2: { max: 3 }, slot3: { max: 2, cur: 2 } });
    expect(feats).toContain('화염구');
    expect(xpToNext({ ...w, xp: 7000 })).toBe(14000 - 7000);
  });
});
