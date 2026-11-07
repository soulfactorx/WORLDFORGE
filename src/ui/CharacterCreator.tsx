import { useRs } from './reskin';
import { useMemo, useState } from 'react';
import { recommendedSkills, skillOptionsOf } from '../engine/classes';
import type { PlayerProfile, TraitAxis, WorldClass } from '../engine/schema';
import { TRAIT_START } from '../engine/traits';
import { gendersOf, profileErrors } from '../engine/profile';
import { abilityModifier } from '../engine/dice/dice';
import { ABILITIES, ABILITY_NAMES, CLASSES, POINT_BUY_BUDGET, POINT_BUY_COST, SKILLS, STANDARD_ARRAY, type SkillId } from '../engine/character/rules';
import {
  type Abilities, type AbilityMethod, type CharacterSheet, createCharacter, pointBuySpent, suggestedStandardArray, validateCreation,
} from '../engine/character/sheet';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const POINT_VALUES = Object.keys(POINT_BUY_COST).map(Number);

const DEFAULT_CLASSES: WorldClass[] = Object.values(CLASSES).map((c) => ({ id: c.id, name: c.name, base: c.id, blurb: c.blurb }));

export function CharacterCreator({ onCreate, onCancel, classes = DEFAULT_CLASSES, profile: form = { fields: [] }, traits: axes = [] }: { onCreate: (c: CharacterSheet) => void; onCancel: () => void; classes?: WorldClass[]; /** 주인공 정보 양식 (v0.68) */ profile?: PlayerProfile; /** 성향 축 (v0.69) */ traits?: TraitAxis[] }) {
  const list = classes.filter((c) => CLASSES[c.base]);
  const [name, setName] = useState('');
  const genders = gendersOf(form);
  const [gender, setGender] = useState('');
  const [lean, setLean] = useState<Record<string, number>>(() => Object.fromEntries(axes.map((t) => [t.id, t.initial ?? 0])));
  const [info, setInfo] = useState<Record<string, string>>(() => Object.fromEntries((form.fields ?? []).filter((f) => f.kind === 'select' && f.required && f.options?.length).map((f) => [f.id, f.options![0]!])));
  const rs = useRs();
  const [roleId, setRoleId] = useState(list[0]?.id ?? 'fighter');
  const role = list.find((c) => c.id === roleId) ?? list[0] ?? DEFAULT_CLASSES[0]!;
  const classId = role.base;
  const [method, setMethod] = useState<AbilityMethod>('standard');
  const [abilities, setAbilities] = useState<Abilities>(() => suggestedStandardArray(role.base));
  const [skills, setSkills] = useState<SkillId[]>(() => recommendedSkills(role));
  const cls = CLASSES[classId]!;
  const options = skillOptionsOf(role);
  // 기본 8직업이 아니면 시트에 역할 이름을 남긴다
  const custom = !(role.id === role.base && role.name === cls.name);

  const input = { name: name.trim() || '이방인', classId, method, abilities, skills, ...(custom ? { role: { id: role.id, name: role.name, skillOptions: options } } : {}), ...(gender ? { gender } : {}), profile: info, ...(axes.length ? { traits: lean } : {}) };
  const errors = useMemo(() => [...profileErrors(form, gender, info), ...validateCreation(input)], [name, roleId, method, abilities, skills, gender, info]);

  function changeClass(id: string) {
    const next = list.find((c) => c.id === id) ?? role;
    setRoleId(next.id);
    setSkills(recommendedSkills(next));
    if (method === 'standard') setAbilities(suggestedStandardArray(next.base));
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
      {(genders.length > 0 || (form.fields ?? []).length > 0 || axes.length > 0) && (
        <fieldset className="profile-form">
          <legend>주인공 정보</legend>
          {genders.length > 0 && (
            <div className="row gender-pick" role="radiogroup" aria-label="성별">
              <span className="small">성별</span>
              {genders.map((g) => <button key={g} type="button" role="radio" aria-checked={gender === g} className={gender === g ? 'primary' : ''} onClick={() => setGender(g)}>{g}</button>)}
            </div>
          )}
          {axes.filter((t) => t.choose !== false).map((t) => (
            <div key={t.id} className="row trait-pick" role="radiogroup" aria-label={t.name}>
              <span className="small">성향 · {t.name}</span>
              {TRAIT_START.map(([v, which]) => {
                const label = which === 'low' ? `${t.low} 쪽` : which === 'high' ? `${t.high} 쪽` : '중간';
                return <button key={which} type="button" role="radio" aria-checked={lean[t.id] === v} className={lean[t.id] === v ? 'primary' : ''} onClick={() => setLean((p) => ({ ...p, [t.id]: v }))}>{label}</button>;
              })}
            </div>
          ))}
          {axes.some((t) => t.choose !== false) && <p className="small muted">성향은 플레이하며 행동에 따라 움직이고, 이야기 갈림길(임무·선택·결말)이 이것을 봅니다.</p>}
          {(form.fields ?? []).map((f) => (
            <label key={f.id}>{f.label}{f.required ? ' *' : ''}{f.visible ? <span className="small muted"> · 사람들이 보고 아는 것</span> : null}
              {f.kind === 'select'
                ? <select value={info[f.id] ?? ''} onChange={(e) => setInfo((p) => ({ ...p, [f.id]: e.target.value }))}>{!f.required && <option value="">(정하지 않음)</option>}{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : f.kind === 'long'
                  ? <textarea rows={2} value={info[f.id] ?? ''} placeholder={f.placeholder} onChange={(e) => setInfo((p) => ({ ...p, [f.id]: e.target.value }))} />
                  : <input value={info[f.id] ?? ''} placeholder={f.placeholder} onChange={(e) => setInfo((p) => ({ ...p, [f.id]: e.target.value }))} />}
              {f.help && <span className="small muted">{f.help}</span>}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset>
        <legend>직업</legend>
        <div className="row">
          {list.map((c) => (
            <button key={c.id} type="button" className={c.id === role.id ? 'primary' : ''} onClick={() => changeClass(c.id)}>{rs(c.name)}</button>
          ))}
        </div>
        <p className="small">{rs(role.blurb || cls.blurb)}</p>
        {role.strengths && <p className="small">잘하는 것: <b>{role.strengths}</b></p>}
        <p className="muted small">{custom ? <>규칙: {rs(cls.name)} 계열 · </> : null}생명 주사위 d{cls.hitDie} · 내성 숙련: {cls.saves.map((a) => ABILITY_NAMES[a]).join(', ')}</p>
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
          {options.map((s) => (
            <label key={s} className="check">
              <input type="checkbox" checked={skills.includes(s)} disabled={!skills.includes(s) && skills.length >= cls.skillChoices} onChange={() => toggleSkill(s)} />
              {SKILLS[s].name} <span className="muted small">({ABILITY_NAMES[SKILLS[s].ability]}){role.skills?.includes(s) ? ' · 추천' : ''}</span>
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
