/**
 * 캐릭터 규칙 데이터 — SRD 5.2.1 (CC-BY-4.0) 기반.
 * This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1")
 * by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. Licensed under CC-BY-4.0.
 */

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_NAMES: Record<Ability, string> = {
  str: '근력', dex: '민첩', con: '건강', int: '지능', wis: '지혜', cha: '매력',
};

export const SKILLS = {
  acrobatics: { name: '곡예', ability: 'dex' },
  animal_handling: { name: '동물 조련', ability: 'wis' },
  arcana: { name: '비전학', ability: 'int' },
  athletics: { name: '운동', ability: 'str' },
  deception: { name: '기만', ability: 'cha' },
  history: { name: '역사', ability: 'int' },
  insight: { name: '통찰', ability: 'wis' },
  intimidation: { name: '위협', ability: 'cha' },
  investigation: { name: '조사', ability: 'int' },
  medicine: { name: '의학', ability: 'wis' },
  nature: { name: '자연', ability: 'int' },
  perception: { name: '지각', ability: 'wis' },
  performance: { name: '공연', ability: 'cha' },
  persuasion: { name: '설득', ability: 'cha' },
  religion: { name: '종교', ability: 'int' },
  sleight_of_hand: { name: '손재주', ability: 'dex' },
  stealth: { name: '은신', ability: 'dex' },
  survival: { name: '생존', ability: 'wis' },
} as const satisfies Record<string, { name: string; ability: Ability }>;
export type SkillId = keyof typeof SKILLS;
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

export interface ClassTemplate {
  id: string;
  name: string;
  hitDie: number;
  saves: [Ability, Ability];
  skillChoices: number;
  skillOptions: SkillId[];
  /** 추천 능력치 순서 (표준 배열 자동 배치용) */
  priority: Ability[];
}

export const CLASSES: Record<string, ClassTemplate> = {
  fighter: {
    id: 'fighter', name: '파이터', hitDie: 10, saves: ['str', 'con'], skillChoices: 2,
    skillOptions: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'persuasion', 'perception', 'survival'],
    priority: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  },
  rogue: {
    id: 'rogue', name: '로그', hitDie: 8, saves: ['dex', 'int'], skillChoices: 4,
    skillOptions: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'persuasion', 'sleight_of_hand', 'stealth'],
    priority: ['dex', 'con', 'wis', 'int', 'cha', 'str'],
  },
  cleric: {
    id: 'cleric', name: '클레릭', hitDie: 8, saves: ['wis', 'cha'], skillChoices: 2,
    skillOptions: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    priority: ['wis', 'con', 'str', 'cha', 'dex', 'int'],
  },
  wizard: {
    id: 'wizard', name: '위저드', hitDie: 6, saves: ['int', 'wis'], skillChoices: 2,
    skillOptions: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'],
    priority: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
  },
};

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/** 포인트 바이 비용 (8~15, 총 27포인트) */
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

export const proficiencyBonus = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
