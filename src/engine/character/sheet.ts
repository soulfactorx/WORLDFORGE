import { abilityModifier } from '../dice/dice';
import {
  ABILITIES, ABILITY_NAMES, type Ability, CLASSES, POINT_BUY_BUDGET, POINT_BUY_COST, SKILLS, type SkillId,
  STANDARD_ARRAY, proficiencyBonus,
} from './rules';

export type Abilities = Record<Ability, number>;

export interface CharacterSheet {
  name: string;
  classId: string;
  level: number;
  abilities: Abilities;
  skillProficiencies: SkillId[];
  saveProficiencies: Ability[];
  maxHp: number;
  hp: number;
  /** 사용 횟수 자원 (주문 슬롯, 재기의 바람 등). v0.4부터. 없으면 직업 기본값으로 채운다. */
  resources?: Record<string, { cur: number; max: number }>;
  /** 경험치 (v0.7) */
  xp?: number;
}

export type CheckSpec =
  | { kind: 'skill'; skill: SkillId }
  | { kind: 'ability'; ability: Ability }
  | { kind: 'save'; ability: Ability };

export interface ModifierBreakdown {
  label: string;
  total: number;
  parts: { label: string; value: number }[];
}

/** 판정 수정치 계산 — 수정치는 항상 엔진이 결정한다 (AI는 판정 종류만 고른다). */
export function checkModifier(sheet: CharacterSheet, spec: CheckSpec): ModifierBreakdown {
  const pb = proficiencyBonus(sheet.level);
  const ability: Ability = spec.kind === 'skill' ? SKILLS[spec.skill].ability : spec.ability;
  const parts = [{ label: ABILITY_NAMES[ability], value: abilityModifier(sheet.abilities[ability]) }];
  let label: string;
  if (spec.kind === 'skill') {
    label = `${SKILLS[spec.skill].name}(${ABILITY_NAMES[ability]})`;
    if (sheet.skillProficiencies.includes(spec.skill)) parts.push({ label: '숙련', value: pb });
  } else if (spec.kind === 'save') {
    label = `${ABILITY_NAMES[ability]} 내성`;
    if (sheet.saveProficiencies.includes(ability)) parts.push({ label: '숙련', value: pb });
  } else {
    label = `${ABILITY_NAMES[ability]} 판정`;
  }
  return { label, total: parts.reduce((a, p) => a + p.value, 0), parts };
}

export type AbilityMethod = 'standard' | 'pointbuy';

export interface CreationInput {
  name: string;
  classId: string;
  method: AbilityMethod;
  abilities: Abilities;
  skills: SkillId[];
}

/** 캐릭터 생성 규칙 검증. 오류 메시지 목록을 반환한다 (빈 배열 = 유효). */
export function validateCreation(input: CreationInput): string[] {
  const errors: string[] = [];
  const cls = CLASSES[input.classId];
  if (!cls) return ['알 수 없는 직업입니다.'];
  const values = ABILITIES.map((a) => input.abilities[a]);
  if (input.method === 'standard') {
    const sorted = [...values].sort((a, b) => b - a);
    if (sorted.join() !== [...STANDARD_ARRAY].join()) errors.push('표준 배열(15, 14, 13, 12, 10, 8)을 각 능력치에 한 번씩 배정해야 합니다.');
  } else {
    if (values.some((v) => !(v in POINT_BUY_COST))) errors.push('포인트 바이 능력치는 8~15 사이여야 합니다.');
    else {
      const spent = values.reduce((a, v) => a + POINT_BUY_COST[v]!, 0);
      if (spent > POINT_BUY_BUDGET) errors.push(`포인트를 ${spent - POINT_BUY_BUDGET}점 초과했습니다.`);
    }
  }
  const uniq = new Set(input.skills);
  if (uniq.size !== input.skills.length) errors.push('같은 기술을 중복 선택했습니다.');
  if (input.skills.length !== cls.skillChoices) errors.push(`${cls.name}는 기술을 ${cls.skillChoices}개 선택해야 합니다.`);
  if (input.skills.some((s) => !cls.skillOptions.includes(s))) errors.push(`${cls.name}가 선택할 수 없는 기술이 포함되어 있습니다.`);
  return errors;
}

export const pointBuySpent = (a: Abilities) => ABILITIES.reduce((s, k) => s + (POINT_BUY_COST[a[k]] ?? 99), 0);

/** 검증된 입력으로 1레벨 캐릭터 시트 생성. 1레벨 HP = 생명 주사위 최대값 + 건강 수정치. */
export function createCharacter(input: CreationInput): CharacterSheet {
  const errors = validateCreation(input);
  if (errors.length) throw new Error(errors.join('\n'));
  const cls = CLASSES[input.classId]!;
  const maxHp = Math.max(1, cls.hitDie + abilityModifier(input.abilities.con));
  return {
    name: input.name, classId: cls.id, level: 1, abilities: { ...input.abilities },
    skillProficiencies: [...input.skills], saveProficiencies: [...cls.saves], maxHp, hp: maxHp,
    resources: classResources(cls.id, 1),
  };
}

/** 전업 시전자 주문 슬롯 (SRD 5.2.1): [1레벨, 2레벨, 3레벨 슬롯] */
const FULL_CASTER_SLOTS: Record<number, [number, number, number]> = { 1: [2, 0, 0], 2: [3, 0, 0], 3: [4, 2, 0], 4: [4, 3, 0], 5: [4, 3, 2] };

/** 레벨별 직업 자원 (SRD 5.2.1). 긴 휴식에 모두 회복된다. */
export function classResources(classId: string, level: number): Record<string, { cur: number; max: number }> {
  const lv = Math.max(1, Math.min(5, level));
  const r = (n: number) => ({ cur: n, max: n });
  const out: Record<string, { cur: number; max: number }> = {};
  if (classId === 'fighter') {
    out.second_wind = r(lv >= 4 ? 3 : 2);
    if (lv >= 2) out.action_surge = r(1);
  }
  if (classId === 'cleric' || classId === 'wizard') {
    const [s1, s2, s3] = FULL_CASTER_SLOTS[lv]!;
    out.slot1 = r(s1);
    if (s2) out.slot2 = r(s2);
    if (s3) out.slot3 = r(s3);
  }
  if (classId === 'cleric' && lv >= 2) out.channel_divinity = r(2);
  if (classId === 'wizard') out.arcane_recovery = r(1);
  return out;
}

export function resourcesOf(sheet: CharacterSheet): Record<string, { cur: number; max: number }> {
  return sheet.resources ?? classResources(sheet.classId, sheet.level);
}

/** 표준 배열을 직업 우선순위대로 자동 배치 */
export function suggestedStandardArray(classId: string): Abilities {
  const cls = CLASSES[classId] ?? CLASSES.fighter!;
  const out = {} as Abilities;
  cls.priority.forEach((a, i) => { out[a] = STANDARD_ARRAY[i]!; });
  return out;
}

/** v0.1 세이브처럼 캐릭터 시트가 없는 경우의 기본값 (모든 능력치 10, 숙련 없음) */
export function legacyCharacter(name: string): CharacterSheet {
  return {
    name, classId: 'none', level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skillProficiencies: [], saveProficiencies: [], maxHp: 8, hp: 8,
  };
}

/** 동료 NPC의 1레벨 시트 (직업 기본 내성·HP·자원, 기술 숙련 없음) */
export function companionSheet(name: string, classId: string, abilities: Abilities): CharacterSheet {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`unknown class: ${classId}`);
  const maxHp = Math.max(1, cls.hitDie + abilityModifier(abilities.con));
  return {
    name, classId, level: 1, abilities: { ...abilities }, skillProficiencies: [], saveProficiencies: [...cls.saves],
    maxHp, hp: maxHp, resources: classResources(classId, 1),
  };
}
