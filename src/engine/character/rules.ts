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
  /** 한 줄 소개 (직업 고르기 화면) */
  blurb: string;
}

export const CLASSES: Record<string, ClassTemplate> = {
  fighter: {
    id: 'fighter', name: '파이터', hitDie: 10, saves: ['str', 'con'], skillChoices: 2,
    skillOptions: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'persuasion', 'perception', 'survival'],
    priority: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
    blurb: '튼튼한 갑옷과 무기의 달인. 재기의 바람으로 버티고, 5레벨부터 두 번 벤다.',
  },
  rogue: {
    id: 'rogue', name: '로그', hitDie: 8, saves: ['dex', 'int'], skillChoices: 4,
    skillOptions: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'persuasion', 'sleight_of_hand', 'stealth'],
    priority: ['dex', 'con', 'wis', 'int', 'cha', 'str'],
    blurb: '그림자 속의 기술자. 틈을 노린 암습, 재빠른 몸놀림, 7레벨 회피.',
  },
  cleric: {
    id: 'cleric', name: '클레릭', hitDie: 8, saves: ['wis', 'cha'], skillChoices: 2,
    skillOptions: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    priority: ['wis', 'con', 'str', 'cha', 'dex', 'int'],
    blurb: '신의 힘을 빌리는 치유자이자 전사. 치유·광휘 주문, 신성 변환.',
  },
  wizard: {
    id: 'wizard', name: '위저드', hitDie: 6, saves: ['int', 'wis'], skillChoices: 2,
    skillOptions: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'],
    priority: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
    blurb: '책으로 익힌 비전 마법. 몸은 약하지만 화염구·냉기 원뿔로 전장을 바꾼다.',
  },
  bard: {
    id: 'bard', name: '바드', hitDie: 8, saves: ['dex', 'cha'], skillChoices: 3,
    skillOptions: ['acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight_of_hand', 'stealth', 'survival'],
    priority: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
    blurb: '말과 노래로 싸우는 이야기꾼. 음유 영감으로 동료를 돕고, 조롱·최면 문양으로 적을 흔든다.',
  },
  ranger: {
    id: 'ranger', name: '레인저', hitDie: 10, saves: ['str', 'dex'], skillChoices: 3,
    skillOptions: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
    priority: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
    blurb: '황야의 사냥꾼. 사냥꾼의 표식으로 사냥감을 쫓고, 활과 칼, 약간의 자연 마법.',
  },
  paladin: {
    id: 'paladin', name: '팔라딘', hitDie: 10, saves: ['wis', 'cha'], skillChoices: 2,
    skillOptions: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
    priority: ['str', 'cha', 'con', 'wis', 'dex', 'int'],
    blurb: '맹세로 싸우는 성기사. 안수로 치유하고, 신성 강타로 내리치며, 6레벨부터 곁의 동료를 지킨다.',
  },
  warlock: {
    id: 'warlock', name: '워락', hitDie: 8, saves: ['wis', 'cha'], skillChoices: 2,
    skillOptions: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
    priority: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
    blurb: '계약으로 힘을 얻은 술사. 슬롯은 적지만 짧은 휴식마다 돌아온다. 섬뜩한 화살과 저주.',
  },
};

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/** 포인트 바이 비용 (8~15, 총 27포인트) */
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

export const proficiencyBonus = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
