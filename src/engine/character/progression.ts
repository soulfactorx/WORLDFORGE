/**
 * 경험치와 레벨업 — SRD 5.2.1 (CC-BY-4.0) 기반. 1~5레벨 지원 (세계마다 상한을 더 낮게 둘 수 있다).
 * 4레벨: 능력치 향상 — 직업 주능력치 +2 (최대 20, 넘치는 만큼 두 번째 능력치에).
 * 레벨업 HP는 고정값(생명 주사위 평균 = 주사위/2 + 1) + 건강 수정치 (최소 1).
 */
import { abilityModifier } from '../dice/dice';
import { CLASS_KITS } from '../combat/cards';
import { ABILITY_NAMES, CLASSES } from './rules';
import { type CharacterSheet, classResources, resourcesOf } from './sheet';

export const MAX_LEVEL = 5;
export const XP_FOR_LEVEL: Record<number, number> = { 1: 0, 2: 300, 3: 900, 4: 2700, 5: 6500 };
/** 능력치 향상을 받는 레벨 */
export const ASI_LEVELS = [4];
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
  // 능력치 향상: 주능력치 +2 (최대 20). 건강이 오르면 HP 최대치도 소급해서 오른다.
  let abilities = sheet.abilities;
  const asi: string[] = [];
  if (cls && ASI_LEVELS.includes(level)) {
    abilities = { ...abilities };
    let pts = 2;
    for (const a of cls.priority) {
      if (pts <= 0) break;
      const add = Math.min(pts, 20 - abilities[a]);
      if (add <= 0) continue;
      abilities[a] += add;
      pts -= add;
      asi.push(`${ABILITY_NAMES[a]} +${add} (${abilities[a]})`);
    }
  }
  const conGain = (abilityModifier(abilities.con) - abilityModifier(sheet.abilities.con)) * sheet.level;
  const before = resourcesOf(sheet);
  const after = classResources(sheet.classId, level);
  const resources: CharacterSheet['resources'] = {};
  for (const [k, v] of Object.entries(after)) {
    const old = before[k];
    resources[k] = old ? { max: v.max, cur: Math.min(v.max, old.cur + Math.max(0, v.max - old.max)) } : { ...v };
  }
  const hpGain = (cls ? Math.max(1, cls.hitDie / 2 + 1 + abilityModifier(abilities.con)) : Math.max(1, 5 + abilityModifier(abilities.con))) + conGain;
  const features = CLASS_KITS[sheet.classId]?.features?.[level] ?? [];
  return {
    sheet: { ...sheet, level, abilities, maxHp: sheet.maxHp + hpGain, hp: sheet.hp + hpGain, resources },
    hpGain,
    features: asi.length ? features.map((f) => (f === '능력치 향상' ? `능력치 향상: ${asi.join(', ')}` : f)) : features,
  };
}
