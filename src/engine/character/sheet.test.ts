import { describe, expect, it } from 'vitest';
import { checkModifier, createCharacter, suggestedStandardArray, validateCreation, type CreationInput } from './sheet';
import { proficiencyBonus } from './rules';

const base = (o: Partial<CreationInput> = {}): CreationInput => ({
  name: '테스터', classId: 'rogue', method: 'standard', abilities: suggestedStandardArray('rogue'),
  skills: ['stealth', 'perception', 'investigation', 'acrobatics'], ...o,
});

describe('캐릭터 생성', () => {
  it('유효한 표준 배열 로그', () => {
    expect(validateCreation(base())).toEqual([]);
    const c = createCharacter(base());
    expect(c.abilities.dex).toBe(15);
    expect(c.maxHp).toBe(8 + 2); // d8 + 건강 14(+2)
    expect(c.saveProficiencies).toEqual(['dex', 'int']);
  });
  it('표준 배열 위반 거부', () => {
    expect(validateCreation(base({ abilities: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 } }))).not.toEqual([]);
  });
  it('포인트 바이 27점', () => {
    const ok = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }; // 9*3 = 27
    expect(validateCreation(base({ method: 'pointbuy', abilities: ok }))).toEqual([]);
    const over = { str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 };
    expect(validateCreation(base({ method: 'pointbuy', abilities: over })).join()).toContain('초과');
    const high = { str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    expect(validateCreation(base({ method: 'pointbuy', abilities: high }))).not.toEqual([]);
  });
  it('직업 기술 목록·개수 검증', () => {
    expect(validateCreation(base({ skills: ['stealth', 'perception', 'investigation'] }))).not.toEqual([]);
    expect(validateCreation(base({ skills: ['stealth', 'perception', 'investigation', 'arcana'] }))).not.toEqual([]);
    expect(validateCreation(base({ skills: ['stealth', 'stealth', 'investigation', 'perception'] }))).not.toEqual([]);
  });
});

describe('판정 수정치', () => {
  const rogue = createCharacter(base());
  it('숙련 기술 = 능력 수정치 + 숙련 보너스', () => {
    const m = checkModifier(rogue, { kind: 'skill', skill: 'stealth' });
    expect(m.total).toBe(2 + 2); // 민첩 15(+2) + 숙련 2
    expect(m.label).toBe('은신(민첩)');
  });
  it('비숙련 기술은 능력 수정치만', () => {
    expect(checkModifier(rogue, { kind: 'skill', skill: 'arcana' }).total).toBe(1); // 지능 12(+1)
  });
  it('내성 숙련', () => {
    expect(checkModifier(rogue, { kind: 'save', ability: 'dex' }).total).toBe(4);
    expect(checkModifier(rogue, { kind: 'save', ability: 'str' }).total).toBe(-1); // 근력 8
  });
  it('숙련 보너스 레벨 테이블', () => {
    expect([1, 4, 5, 8, 9, 13, 17, 20].map(proficiencyBonus)).toEqual([2, 2, 3, 3, 4, 5, 6, 6]);
  });
});
