import { ABILITIES, ABILITY_NAMES, CLASSES, SKILL_IDS, SKILLS, proficiencyBonus } from '../engine/character/rules';
import { type CharacterSheet, checkModifier } from '../engine/character/sheet';
import { abilityModifier } from '../engine/dice/dice';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function CharacterPanel({ sheet }: { sheet: CharacterSheet }) {
  return (
    <aside className="sheet">
      <div className="row">
        <b>{sheet.name}</b>
        <span className="muted small">{CLASSES[sheet.classId]?.name ?? '직업 없음'} {sheet.level}레벨 · 숙련 보너스 {sign(proficiencyBonus(sheet.level))}</span>
        <span className="spacer" />
        <span>HP {sheet.hp}/{sheet.maxHp}</span>
      </div>
      <div className="ability-grid">
        {ABILITIES.map((a) => (
          <div key={a} className="stat">
            <span className="muted small">{ABILITY_NAMES[a]}{sheet.saveProficiencies.includes(a) ? ' ●' : ''}</span>
            <b>{sign(abilityModifier(sheet.abilities[a]))}</b>
            <span className="muted small">{sheet.abilities[a]}</span>
          </div>
        ))}
      </div>
      <div className="skill-grid small">
        {SKILL_IDS.map((s) => (
          <span key={s} className={sheet.skillProficiencies.includes(s) ? 'prof' : 'muted'}>
            {sheet.skillProficiencies.includes(s) ? '●' : '○'} {SKILLS[s].name} {sign(checkModifier(sheet, { kind: 'skill', skill: s }).total)}
          </span>
        ))}
      </div>
      <p className="muted small">● 숙련 · 내성 굴림 숙련은 능력치 옆 ●</p>
    </aside>
  );
}
