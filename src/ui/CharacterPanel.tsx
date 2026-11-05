import { useRs } from './reskin';
import { ABILITIES, ABILITY_NAMES, CLASSES, SKILL_IDS, SKILLS, proficiencyBonus } from '../engine/character/rules';
import { type CharacterSheet, checkModifier } from '../engine/character/sheet';
import { abilityModifier } from '../engine/dice/dice';
import { MAX_LEVEL, XP_FOR_LEVEL } from '../engine/character/progression';
import { CLASS_KITS } from '../engine/combat/cards';
import { resourcesOf } from '../engine/character/sheet';

const RESOURCE_LABEL: Record<string, string> = {
  slot1: '1레벨 슬롯', slot2: '2레벨 슬롯', second_wind: '재기의 바람', action_surge: '행동 연쇄',
  channel_divinity: '신성 변환', arcane_recovery: '비전 회복',
};

function XpBar({ sheet }: { sheet: CharacterSheet }) {
  const xp = sheet.xp ?? 0;
  if (sheet.level >= MAX_LEVEL) return <span className="small muted">경험치 {xp} (최고 레벨)</span>;
  const from = XP_FOR_LEVEL[sheet.level]!, to = XP_FOR_LEVEL[sheet.level + 1]!;
  return (
    <span className="xp small">
      <span className="muted">경험치 {xp} / {to}</span>
      <span className="hpbar"><span style={{ width: `${Math.min(100, (100 * (xp - from)) / (to - from))}%`, background: 'var(--accent)' }} /></span>
    </span>
  );
}
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function CharacterPanel({ sheet, party = {} }: { sheet: CharacterSheet; party?: Record<string, CharacterSheet> }) {
  const rs = useRs();
  return (
    <aside className="sheet">
      <div className="row">
        <b>{sheet.name}</b>
        <span className="muted small">{rs(CLASSES[sheet.classId]?.name ?? '직업 없음')} {sheet.level}레벨 · 숙련 보너스 {sign(proficiencyBonus(sheet.level))}</span>
        <span className="spacer" />
        <span>HP {sheet.hp}/{sheet.maxHp}</span>
      </div>
      <div className="row small">
        <XpBar sheet={sheet} />
        <span className="spacer" />
        {Object.entries(resourcesOf(sheet)).map(([k, r]) => <span key={k} className="muted">{rs(RESOURCE_LABEL[k] ?? k)} {r.cur}/{r.max}</span>)}
      </div>
      {Object.entries(CLASS_KITS[sheet.classId]?.features ?? {}).some(([lv]) => Number(lv) <= sheet.level) && (
        <p className="small muted">능력: {Object.entries(CLASS_KITS[sheet.classId]!.features!).filter(([lv]) => Number(lv) <= sheet.level).flatMap(([, f]) => f).join(' · ')}</p>
      )}
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
              <span className="muted">{rs(CLASSES[c.classId]?.name ?? '')} {c.level}레벨</span>
              <span className="spacer" />
              {Object.entries(c.resources ?? {}).map(([k, r]) => <span key={k} className="muted">{rs(RESOURCE_LABEL[k] ?? k)} {r.cur}/{r.max}</span>)}
              <span>HP {c.hp}/{c.maxHp}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
