import { useRs } from './reskin';
import { clearNewGameMemory, loadNewGameMemory, saveNewGameMemory } from './newGameMemory';
import { DIFFICULTIES, difficultyLabel } from '../engine/difficulty';
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

export function CharacterCreator({ onCreate, onCancel, classes = DEFAULT_CLASSES, profile: form = { fields: [] }, traits: axes = [] }: { onCreate: (c: CharacterSheet, opts: { dcMod: number }) => void; onCancel: () => void; classes?: WorldClass[]; /** 주인공 정보 양식 (v0.68) */ profile?: PlayerProfile; /** 성향 축 (v0.69) */ traits?: TraitAxis[] }) {
  const list = classes.filter((c) => CLASSES[c.base]);
  // 지난번에 적은 값 (v0.90): 같은 항목은 미리 채운다 — 이 세계의 양식에 맞는 것만
  const [mem] = useState(loadNewGameMemory);
  const [prefilled, setPrefilled] = useState(() => Object.keys(mem).length > 0);
  const [name, setName] = useState(mem.name ?? '');
  const genders = gendersOf(form);
  const [gender, setGender] = useState(mem.gender && genders.includes(mem.gender) ? mem.gender : '');
  const [lean, setLean] = useState<Record<string, number>>(() => Object.fromEntries(axes.map((t) => [t.id, t.choose !== false && mem.lean?.[t.id] !== undefined && TRAIT_START.some(([v]) => v === mem.lean![t.id]) ? mem.lean[t.id]! : t.initial ?? 0])));
  const [info, setInfo] = useState<Record<string, string>>(() => {
    const base = Object.fromEntries((form.fields ?? []).filter((f) => f.kind === 'select' && f.required && f.options?.length).map((f) => [f.id, f.options![0]!]));
    for (const f of form.fields ?? []) {
      const v = mem.info?.[f.id] ?? mem.infoByLabel?.[f.label];
      if (v && (f.kind !== 'select' || f.options?.includes(v))) base[f.id] = v;
    }
    return base;
  });
  const rs = useRs();
  // 직업: 같은 ID → 같은 규칙 직업 → 첫 직업
  const startRole = list.find((c) => c.id === mem.roleId) ?? list.find((c) => c.base === mem.classId) ?? list[0];
  const [roleId, setRoleId] = useState(startRole?.id ?? 'fighter');
  const role = list.find((c) => c.id === roleId) ?? list[0] ?? DEFAULT_CLASSES[0]!;
  const classId = role.base;
  // 능력치·기술은 규칙 직업이 같을 때만 그대로 가져온다 (다르면 그 직업의 추천값)
  const sameBase = !!startRole && startRole.base === mem.classId;
  const [method, setMethod] = useState<AbilityMethod>(sameBase && mem.method ? mem.method : 'standard');
  const [abilities, setAbilities] = useState<Abilities>(() => (sameBase && mem.abilities ? mem.abilities : suggestedStandardArray(role.base)));
  const [skills, setSkills] = useState<SkillId[]>(() => {
    const opts = skillOptionsOf(role);
    const kept = sameBase ? (mem.skills ?? []).filter((s): s is SkillId => opts.includes(s as SkillId)) : [];
    return kept.length === CLASSES[role.base]!.skillChoices ? kept : recommendedSkills(role);
  });
  const [dcMod, setDcMod] = useState(mem.dcMod ?? 0);
  /** 미리 채운 것을 지우고 이 세계의 기본값으로 */
  function resetForm() {
    clearNewGameMemory(); setPrefilled(false);
    setName(''); setGender(''); setDcMod(0);
    setLean(Object.fromEntries(axes.map((t) => [t.id, t.initial ?? 0])));
    setInfo(Object.fromEntries((form.fields ?? []).filter((f) => f.kind === 'select' && f.required && f.options?.length).map((f) => [f.id, f.options![0]!])));
    const first = list[0] ?? DEFAULT_CLASSES[0]!;
    setRoleId(first.id); setMethod('standard'); setAbilities(suggestedStandardArray(first.base)); setSkills(recommendedSkills(first));
  }
  function create() {
    saveNewGameMemory({
      name: name.trim(), ...(gender ? { gender } : {}), info, infoByLabel: Object.fromEntries((form.fields ?? []).filter((f) => info[f.id]).map((f) => [f.label, info[f.id]!])),
      lean: Object.fromEntries(axes.filter((t) => t.choose !== false).map((t) => [t.id, lean[t.id] ?? 0])), roleId: role.id, classId, method, abilities, skills, dcMod,
    });
    onCreate(createCharacter(input), { dcMod });
  }
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
      {prefilled && (
        <p className="small prefill-note">지난번에 적은 값으로 미리 채웠습니다. <button type="button" className="small" onClick={resetForm}>기억 지우고 처음부터</button></p>
      )}
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

      <fieldset>
        <legend>난이도</legend>
        <label>판정과 전투의 난이도
          <select value={DIFFICULTIES.some((d) => d.dc === dcMod) ? String(dcMod) : 'custom'} onChange={(e) => setDcMod(Number(e.target.value) || 0)}>
            {DIFFICULTIES.map((d) => <option key={d.id} value={d.dc}>{difficultyLabel(d.dc)} — {d.desc}</option>)}
            {!DIFFICULTIES.some((d) => d.dc === dcMod) && <option value="custom">{difficultyLabel(dcMod)}</option>}
          </select>
        </label>
        <p className="small muted">행동 판정·장면 판정·실마리 굴림의 DC와, 전투에서 적의 방어도·체력에 적용됩니다. 플레이 중에도 "소리·화면" 설정에서 바꿀 수 있습니다.</p>
      </fieldset>

      {errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="row">
        <button type="button" onClick={onCancel}>취소</button>
        <button type="button" className="primary" disabled={errors.length > 0} onClick={create}>이 캐릭터로 시작</button>
      </div>
    </section>
  );
}
