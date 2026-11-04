/**
 * 경험치와 레벨업 — SRD 5.2.1 (CC-BY-4.0) 기반. 현재 1~3레벨까지 지원.
 * 레벨업 HP는 고정값(생명 주사위 평균 = 주사위/2 + 1) + 건강 수정치 (최소 1).
 */
import { abilityModifier } from '../dice/dice';
import { CLASS_KITS } from '../combat/cards';
import { CLASSES } from './rules';
import { type CharacterSheet, classResources, resourcesOf } from './sheet';

export const MAX_LEVEL = 3;
export const XP_FOR_LEVEL: Record<number, number> = { 1: 0, 2: 300, 3: 900 };
/** 플레이어가 새로운 사실을 알게 됐을 때의 경험치 (탐험·대화 보상) */
export const DISCOVERY_XP = 25;

export function levelForXp(xp: number): number {
  let lv = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) if (xp >= XP_FOR_LEVEL[l]!) lv = l;
  return lv;
}

export function xpToNext(sheet: CharacterSheet): number | null {
  if (sheet.level >= MAX_LEVEL) return null;
  return XP_FOR_LEVEL[sheet.level + 1]! - (sheet.xp ?? 0);
}

export interface LevelUpResult {
  sheet: CharacterSheet;
  hpGain: number;
  features: string[];
}

/** 한 레벨 올린 시트. 자원은 늘어난 최대치만큼 현재치도 늘린다 (이미 쓴 것은 유지). */
export function levelUp(sheet: CharacterSheet): LevelUpResult {
  const cls = CLASSES[sheet.classId];
  const level = sheet.level + 1;
  const hpGain = cls ? Math.max(1, cls.hitDie / 2 + 1 + abilityModifier(sheet.abilities.con)) : Math.max(1, 5 + abilityModifier(sheet.abilities.con));
  const before = resourcesOf(sheet);
  const after = classResources(sheet.classId, level);
  const resources: CharacterSheet['resources'] = {};
  for (const [k, v] of Object.entries(after)) {
    const old = before[k];
    resources[k] = old ? { max: v.max, cur: Math.min(v.max, old.cur + Math.max(0, v.max - old.max)) } : { ...v };
  }
  return {
    sheet: { ...sheet, level, maxHp: sheet.maxHp + hpGain, hp: sheet.hp + hpGain, resources },
    hpGain,
    features: CLASS_KITS[sheet.classId]?.features?.[level] ?? [],
  };
}
