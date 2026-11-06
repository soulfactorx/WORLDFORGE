import { describe, expect, it } from 'vitest';
import { createCharacter, suggestedStandardArray, type CharacterSheet } from './sheet';
import { discoveryXp, hardCheckXp, levelForXp, levelSpan, relationStageXp, rewardXp, XP_FOR_LEVEL } from './progression';

const make = (): CharacterSheet => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
/** SRD 5.2.1 조우 예산 "보통" (캐릭터 1인당) */
const MODERATE: Record<number, number> = { 1: 75, 2: 150, 3: 225, 4: 375, 5: 750, 6: 1000, 7: 1300, 8: 1700, 9: 2000, 10: 2300 };
const at = (level: number): CharacterSheet => ({ ...make(), level, xp: XP_FOR_LEVEL[level] });

describe('성장 곡선 (설계 v4 P1)', () => {
  it('레벨 비율 보상: 작은 10% · 큰 25% · 고정 숫자는 최소 8% · 장 완료는 다음 레벨까지 채움', () => {
    expect(levelSpan(1)).toBe(300);
    expect(levelSpan(5)).toBe(7500);
    expect(rewardXp(at(1), 'minor')).toBe(75);           // 1레벨은 초반 가속 ×2.5
    expect(rewardXp(at(5), 'major')).toBe(1875);
    expect(rewardXp(at(1), 150)).toBe(150);          // 1레벨에서는 제작자가 정한 값 그대로
    expect(rewardXp(at(5), 150)).toBe(600);          // 5레벨에서는 하한 8%
    expect(rewardXp({ ...at(4), xp: 3000 }, 'chapter')).toBe(XP_FOR_LEVEL[5]! - 3000);
    expect(rewardXp(at(3), 'chapter', 3)).toBe(0);   // 세계 상한이면 장 완료 이정표 없음
  });
  it('발견·관계 단계·어려운 판정 경험치는 레벨에 따라 커진다', () => {
    expect(discoveryXp(1)).toBe(63);
    expect(discoveryXp(3)).toBe(25);
    expect(discoveryXp(5)).toBe(75);
    expect(relationStageXp(5)).toBe(300);
    expect(hardCheckXp(3, 10)).toBe(0);
    expect(hardCheckXp(3, 15)).toBe(36);
    expect(hardCheckXp(3, 20)).toBe(72);
  });

  it('100턴 시뮬레이션: 이야기 중심 플레이에서도 레벨이 꾸준히 오른다 (첫 레벨업 15턴 이내, 정체 없음)', () => {
    // 전형적인 플레이를 엔진 규칙만으로 굴린다: 5턴마다 발견, 8턴마다 어려운 판정 성공, 15턴마다 작은 퀘스트,
    // 12턴째부터 20턴마다 레벨에 맞는 보통 조우(SRD 5.2.1 "보통" 예산의 1인 몫), 25턴마다 관계 단계, 40턴마다 큰 퀘스트, 100턴마다 장 완료
    let s = at(1);
    const levelAt: number[] = [];
    let firstUp = 0;
    const gain = (n: number) => { s = { ...s, xp: (s.xp ?? 0) + n }; const lv = Math.min(10, levelForXp(s.xp!)); if (lv > s.level) { if (!firstUp) firstUp = turn; s = { ...s, level: lv }; } };
    let turn = 0;
    for (turn = 1; turn <= 300; turn++) {
      if (turn % 5 === 0) gain(discoveryXp(s.level));
      if (turn % 8 === 0) gain(hardCheckXp(s.level, 15));
      if (turn % 15 === 0) gain(rewardXp(s, 'minor'));
      if (turn % 20 === 12) gain(MODERATE[s.level]!);
      if (turn % 25 === 0) gain(relationStageXp(s.level));
      if (turn % 40 === 0) gain(rewardXp(s, 'major'));
      if (turn % 100 === 0) gain(rewardXp(s, 'chapter'));
      if (turn % 50 === 0) levelAt.push(s.level);
    }
    // 지금 곡선: 50턴마다 [3, 5, 6, 8, 9, 10]레벨, 첫 레벨업 15턴
    expect(firstUp).toBeGreaterThan(0);
    expect(firstUp).toBeLessThanOrEqual(15);
    // 50턴마다 적어도 1레벨씩 (최고 레벨 전까지), 너무 빠르지도 않게 (300턴 전에 10레벨이 되지 않음)
    for (let i = 1; i < levelAt.length; i++) if (levelAt[i - 1]! < 10) expect(levelAt[i]!).toBeGreaterThan(levelAt[i - 1]!);
    expect(levelAt[4]!).toBeLessThan(10);
    expect(levelAt.at(-1)!).toBeGreaterThanOrEqual(7);
  });
});
