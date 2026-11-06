/**
 * 경험치와 레벨업 — SRD 5.2.1 (CC-BY-4.0) 기반. 1~10레벨 지원 (세계마다 상한을 더 낮게 둘 수 있다).
 * 4·8레벨(파이터 6, 로그 10 추가): 능력치 향상 또는 특성 (build.ts). 3레벨: 하위 직업.
 * 레벨업 HP는 고정값(생명 주사위 평균 = 주사위/2 + 1) + 건강 수정치 (최소 1).
 */
import { abilityModifier } from '../dice/dice';
import { CLASS_KITS } from '../combat/cards';
import { CLASSES } from './rules';
import { autoBuild, needsSubclass, subclassFeatures } from './build';
import { type CharacterSheet, classResources, resourcesOf } from './sheet';

export const MAX_LEVEL = 10;
export const XP_FOR_LEVEL: Record<number, number> = { 1: 0, 2: 300, 3: 900, 4: 2700, 5: 6500, 6: 14000, 7: 23000, 8: 34000, 9: 48000, 10: 64000 };
/** 능력치 향상을 받는 레벨 (SRD 5.2.1: 파이터는 6레벨, 로그는 10레벨에 한 번 더) */
export const ASI_LEVELS = [4, 8];
export const asiLevels = (classId: string) => (classId === 'fighter' ? [4, 6, 8] : classId === 'rogue' ? [4, 8, 10] : ASI_LEVELS);
/** 플레이어가 새로운 사실을 알게 됐을 때의 경험치 (1~2레벨 기준 — 실제 값은 discoveryXp) */
export const DISCOVERY_XP = 25;

/**
 * 성장 곡선 (설계 v4 P1). SRD 경험치 표는 "한 레벨에 조우 6~12번"을 가정해, 대화·조사 중심 플레이에서는
 * 고정 보상(75~200)이 4레벨부터 의미가 없어진다. 그래서 보상을 "다음 레벨까지 필요한 양"의 비율로 정한다.
 */
export const levelSpan = (level: number) => (level >= MAX_LEVEL ? XP_FOR_LEVEL[MAX_LEVEL]! - XP_FOR_LEVEL[MAX_LEVEL - 1]! : XP_FOR_LEVEL[level + 1]! - XP_FOR_LEVEL[level]!);
/** 퀘스트·의뢰 경험치: 숫자(고정) 또는 레벨 비율 — minor 10% · major 25% · chapter 다음 레벨까지 채움 */
export type XpReward = number | 'minor' | 'major' | 'chapter';
export const XP_SHARE = { minor: 0.1, major: 0.25, floor: 0.08, relation: 0.04, check: 0.02, hardCheck: 0.04 } as const;

/** 초반 가속: 1레벨 ×2.5, 2레벨 ×2 (첫 레벨업이 10~15턴 안에 오도록) */
export const earlyBoost = (level: number) => (level <= 1 ? 2.5 : level === 2 ? 2 : 1);

export function rewardXp(sheet: CharacterSheet, r: XpReward | undefined, levelCap = MAX_LEVEL): number {
  if (r === undefined || r === 0) return 0;
  const span = levelSpan(sheet.level);
  if (r === 'chapter') return sheet.level >= Math.min(MAX_LEVEL, levelCap) ? 0 : Math.max(0, XP_FOR_LEVEL[sheet.level + 1]! - (sheet.xp ?? 0));
  if (r === 'minor' || r === 'major') return Math.round(span * XP_SHARE[r] * earlyBoost(sheet.level));
  // 고정 숫자도 레벨이 오를수록 무의미해지지 않게 하한(8%)을 둔다
  return Math.max(Math.round(r), Math.round(span * XP_SHARE.floor));
}
/** 새 사실 발견: 1레벨 62·2레벨 50(초반 가속), 5레벨 75 (다음 레벨까지 필요한 양의 1%, 최소 25) */
export const discoveryXp = (level: number) => Math.max(Math.round(DISCOVERY_XP * earlyBoost(level)), Math.round(levelSpan(level) / 100));
/** 관계 단계가 처음으로 가까워졌을 때 */
export const relationStageXp = (level: number) => Math.round(levelSpan(level) * XP_SHARE.relation * earlyBoost(level));
/** 어려운 판정 성공 (DC 15 이상 2%, DC 20 이상 4%) */
export const hardCheckXp = (level: number, dc: number) => Math.round(levelSpan(level) * (dc >= 20 ? XP_SHARE.hardCheck : dc >= 15 ? XP_SHARE.check : 0) * earlyBoost(level));

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

/**
 * 한 레벨 올린 시트. 자원은 늘어난 최대치만큼 현재치도 늘린다 (이미 쓴 것은 유지).
 * defer(플레이어): 하위 직업·능력치 향상/특성을 '선택 대기'로 남긴다. 아니면(동료) 자동으로 고른다.
 */
export function levelUp(sheet: CharacterSheet, opts: { defer?: boolean } = {}): LevelUpResult {
  const cls = CLASSES[sheet.classId];
  const level = sheet.level + 1;
  const before = resourcesOf(sheet);
  const after = classResources(sheet.classId, level, sheet.subclass);
  const resources: CharacterSheet['resources'] = {};
  for (const [k, v] of Object.entries(after)) {
    const old = before[k];
    resources[k] = old ? { max: v.max, cur: Math.min(v.max, old.cur + Math.max(0, v.max - old.max)) } : { ...v };
  }
  const tough = sheet.feats?.includes('tough') ? 2 : 0;
  const hpGain = (cls ? Math.max(1, cls.hitDie / 2 + 1 + abilityModifier(sheet.abilities.con)) : Math.max(1, 5 + abilityModifier(sheet.abilities.con))) + tough;
  let next: CharacterSheet = { ...sheet, level, maxHp: sheet.maxHp + hpGain, hp: sheet.hp + hpGain, resources };
  const asi = !!cls && asiLevels(sheet.classId).includes(level);
  if (asi) next = { ...next, pending: [...(next.pending ?? []), level] };
  const base = CLASS_KITS[sheet.classId]?.features?.[level] ?? [];
  let features = [...base, ...subclassFeatures(sheet.subclass, level)];
  if (opts.defer) {
    features = features.map((f) => (f === '능력치 향상' ? '능력치 향상 또는 특성 (캐릭터 창에서 고르기)' : f));
    if (needsSubclass(next) && !needsSubclass(sheet)) features.push('하위 직업 (캐릭터 창에서 고르기)');
  } else {
    const r = autoBuild(next);
    next = r.sheet;
    const asiText = r.texts.find((t) => t.startsWith('능력치 향상'));
    features = [...features.map((f) => (asiText && f === '능력치 향상' ? asiText : f)), ...r.texts.filter((t) => t !== asiText)];
  }
  return { sheet: next, hpGain: next.maxHp - sheet.maxHp, features };
}
