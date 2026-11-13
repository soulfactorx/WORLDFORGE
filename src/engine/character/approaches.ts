/**
 * 접근법 6가지 (v0.112, 설계 v6 V6): 플레이어에게는 SRD 기술 18종 대신 접근법을 보여 준다.
 * 판정은 내부에서 그대로 SRD 기술로 굴리고, 접근법을 고르면 그 안에서 이 캐릭터가 가장 잘하는 기술을 쓴다.
 */
import { type CharacterSheet, checkModifier } from './sheet';
import type { SkillId } from './rules';

export type ApproachId = 'power' | 'finesse' | 'senses' | 'talk' | 'guile' | 'lore';
export const APPROACHES: Record<ApproachId, { name: string; icon: string; desc: string; skills: SkillId[] }> = {
  power: { name: '힘', icon: '💪', desc: '밀고 들어 올리고 버티고 겁을 준다', skills: ['athletics', 'intimidation'] },
  finesse: { name: '재주', icon: '🤸', desc: '날렵하게 몰래, 손끝으로', skills: ['acrobatics', 'sleight_of_hand', 'stealth'] },
  senses: { name: '감각', icon: '👁', desc: '살피고 읽고 견디고 돌본다', skills: ['perception', 'insight', 'survival', 'animal_handling', 'medicine'] },
  talk: { name: '말', icon: '💬', desc: '설득하고 마음을 움직인다', skills: ['persuasion', 'performance'] },
  guile: { name: '속임수', icon: '🎭', desc: '속이고 떠보고 둘러댄다', skills: ['deception'] },
  lore: { name: '학식', icon: '📚', desc: '알고 따지고 조사한다', skills: ['investigation', 'arcana', 'history', 'nature', 'religion'] },
};
export const APPROACH_IDS = Object.keys(APPROACHES) as ApproachId[];

export function approachOf(skill: string): ApproachId | undefined {
  return APPROACH_IDS.find((a) => APPROACHES[a].skills.includes(skill as SkillId));
}
/** 이 접근법에서 이 캐릭터가 가장 잘하는 기술과 보정 */
export function bestSkill(sheet: CharacterSheet, a: ApproachId): { skill: SkillId; mod: number } {
  return APPROACHES[a].skills.map((skill) => ({ skill, mod: checkModifier(sheet, { kind: 'skill', skill }).total }))
    .reduce((m, x) => (x.mod > m.mod ? x : m));
}
