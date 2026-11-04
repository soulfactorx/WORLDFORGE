import { ABILITIES, ABILITY_NAMES, CLASSES, SKILL_IDS, SKILLS, proficiencyBonus } from '../engine/character/rules';
import { type CharacterSheet, checkModifier } from '../engine/character/sheet';
import { abilityModifier } from '../engine/dice/dice';

const RESOURCE_LABEL: Record<string, string> = { slot1: '1레벨 슬롯', second_wind: '재기의 바람' };
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function CharacterPanel({ sheet, party = {} }: { sheet: CharacterSheet; party?: Record<string, CharacterSheet> }) {
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
      {Object.keys(party).length > 0 && (
        <div className="party">
          <b className="small">동료</b>
          {Object.entries(party).map(([id, c]) => (
            <div key={id} className="row small">
              <b>{c.name}</b>
              <span className="muted">{CLASSES[c.classId]?.name} {c.level}레벨</span>
              <span className="spacer" />
              {Object.entries(c.resources ?? {}).map(([k, r]) => <span key={k} className="muted">{RESOURCE_LABEL[k] ?? k} {r.cur}/{r.max}</span>)}
              <span>HP {c.hp}/{c.maxHp}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
