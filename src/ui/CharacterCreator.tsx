import { useRs } from './reskin';
import { useMemo, useState } from 'react';
import { abilityModifier } from '../engine/dice/dice';
import { ABILITIES, ABILITY_NAMES, CLASSES, POINT_BUY_BUDGET, POINT_BUY_COST, SKILLS, STANDARD_ARRAY, type SkillId } from '../engine/character/rules';
import {
  type Abilities, type AbilityMethod, type CharacterSheet, createCharacter, pointBuySpent, suggestedStandardArray, validateCreation,
} from '../engine/character/sheet';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const POINT_VALUES = Object.keys(POINT_BUY_COST).map(Number);

export function CharacterCreator({ onCreate, onCancel }: { onCreate: (c: CharacterSheet) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const rs = useRs();
  const [classId, setClassId] = useState('fighter');
  const [method, setMethod] = useState<AbilityMethod>('standard');
  const [abilities, setAbilities] = useState<Abilities>(() => suggestedStandardArray('fighter'));
  const [skills, setSkills] = useState<SkillId[]>([]);
  const cls = CLASSES[classId]!;

  const input = { name: name.trim() || '이방인', classId, method, abilities, skills };
  const errors = useMemo(() => validateCreation(input), [name, classId, method, abilities, skills]);

  function changeClass(id: string) {
    setClassId(id);
    setSkills([]);
    if (method === 'standard') setAbilities(suggestedStandardArray(id));
  }
  function changeMethod(m: AbilityMethod) {
    setMethod(m);
    setAbilities(m === 'standard' ? suggestedStandardArray(classId) : { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  }
  function toggleSkill(s: SkillId) {
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : prev.length < cls.skillChoices ? [...prev, s] : prev));
  }
  /** 표준 배열: 선택한 값을 가진 다른 능력치와 맞바꾼다 → 항상 배열 전체가 유지된다 */
  function setStandard(a: (typeof ABILITIES)[number], v: number) {
    setAbilities((prev) => {
      const other = ABILITIES.find((k) => k !== a && prev[k] === v);
      return other ? { ...prev, [a]: v, [other]: prev[a] } : { ...prev, [a]: v };
    });
  }

  return (
    <section className="panel">
      <h2>주인공 만들기</h2>
      <p className="muted small">당신은 이 세계에 소환된 이방인입니다. 몸과 기술은 기억하지만, 이 세계에 대해서는 아무것도 모릅니다.</p>
      <label>이름<input value={name} placeholder="이방인" onChange={(e) => setName(e.target.value)} /></label>

      <fieldset>
        <legend>직업</legend>
        <div className="row">
          {Object.values(CLASSES).map((c) => (
            <button key={c.id} type="button" className={c.id === classId ? 'primary' : ''} onClick={() => changeClass(c.id)}>{rs(c.name)}</button>
          ))}
        </div>
        <p className="small">{rs(cls.blurb)}</p>
        <p className="muted small">생명 주사위 d{cls.hitDie} · 내성 숙련: {cls.saves.map((a) => ABILITY_NAMES[a]).join(', ')}</p>
      </fieldset>

      <fieldset>
        <legend>능력치</legend>
        <div className="row">
          <label className="check"><input type="radio" checked={method === 'standard'} onChange={() => changeMethod('standard')} /> 표준 배열</label>
          <label className="check"><input type="radio" checked={method === 'pointbuy'} onChange={() => changeMethod('pointbuy')} /> 포인트 바이</label>
          {method === 'pointbuy' && <span className="muted small">사용 {pointBuySpent(abilities)} / {POINT_BUY_BUDGET}</span>}
        </div>
        <div className="ability-grid">
          {ABILITIES.map((a) => (
            <label key={a}>
              <span>{ABILITY_NAMES[a]} <span className="muted">{sign(abilityModifier(abilities[a]))}</span></span>
              <select value={abilities[a]} onChange={(e) => (method === 'standard' ? setStandard(a, Number(e.target.value)) : setAbilities((p) => ({ ...p, [a]: Number(e.target.value) })))}>
                {(method === 'standard' ? STANDARD_ARRAY : POINT_VALUES).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>기술 숙련 ({skills.length}/{cls.skillChoices})</legend>
        <div className="skill-grid">
          {cls.skillOptions.map((s) => (
            <label key={s} className="check">
              <input type="checkbox" checked={skills.includes(s)} disabled={!skills.includes(s) && skills.length >= cls.skillChoices} onChange={() => toggleSkill(s)} />
              {SKILLS[s].name} <span className="muted small">({ABILITY_NAMES[SKILLS[s].ability]})</span>
            </label>
          ))}
        </div>
      </fieldset>

      {errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="row">
        <button type="button" onClick={onCancel}>취소</button>
        <button type="button" className="primary" disabled={errors.length > 0} onClick={() => onCreate(createCharacter(input))}>이 캐릭터로 시작</button>
      </div>
    </section>
  );
}
