/** 세계의 직업 편집 (v0.56): 장르 프리셋을 고르거나, 이름·소개·기술을 직접 정한다. 규칙은 규칙 직업(base)을 따른다. */
import { CLASS_PRESETS, GENRE_CLASS_PRESET, presetById } from '../data/classPresets';
import { genreOf } from '../data/genres';
import { ABILITY_NAMES, CLASSES, SKILL_IDS, SKILLS } from '../engine/character/rules';
import { classesFor } from '../engine/classes';
import type { WorldClass, WorldPackage } from '../engine/schema';
import { useState } from 'react';
import { Area, Select, Text } from './form';

const BASES = Object.values(CLASSES).map((c) => [c.id, `${c.name} — d${c.hitDie}, 기술 ${c.skillChoices}개`] as const);

export function ClassEditor({ world, onChange }: { world: WorldPackage; onChange: (classes: WorldClass[] | undefined) => void }) {
  const own = world.classes ?? [];
  const genreDefault = GENRE_CLASS_PRESET[world.genre?.id ?? 'high_fantasy'] ?? 'fantasy';
  const [preset, setPreset] = useState(genreDefault);
  const using = own.length ? null : presetById(genreDefault);
  const set = (i: number, patch: Partial<WorldClass>) => onChange(own.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: number) => { const n = [...own]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); onChange(n); };

  return (
    <div className="class-editor">
      <p className="muted small">
        주인공 만들기에서 고르는 <b>직업</b>입니다. 이름·소개·잘하는 것·기술은 이 세계에 맞게 바꾸고, 생명력·주문·전투 능력 같은 <b>규칙은 &lsquo;규칙 직업&rsquo;</b>(d20 기본 8직업)을 따릅니다.
        예: 로맨스의 &lsquo;사교계 인사&rsquo; = 규칙상 바드. 비워 두면 장르({genreOf(world.genre?.id).label}) 기본 프리셋을 씁니다.
      </p>
      <div className="row">
        <label>프리셋
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {CLASS_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}{p.id === genreDefault ? ' (장르 기본)' : ''}</option>)}
          </select>
        </label>
        <button onClick={() => { if (!own.length || confirm('지금 직업 목록을 이 프리셋으로 바꿀까요?')) onChange(structuredClone(presetById(preset)!.classes)); }}>이 프리셋으로 채우기</button>
        {own.length > 0 && <button onClick={() => confirm('이 세계 전용 직업을 지우고 장르 기본 프리셋을 쓸까요?') && onChange(undefined)}>장르 기본으로 되돌리기</button>}
      </div>
      <p className="small muted">{presetById(preset)?.description}</p>

      {using ? (
        <div className="status">
          <p className="small">지금은 장르 기본 프리셋 <b>{using.label}</b>을 씁니다: {classesFor(world).map((c) => c.name).join(' · ')}</p>
          <button onClick={() => onChange(structuredClone(using.classes))}>✎ 이 목록을 복사해서 직접 고치기</button>
        </div>
      ) : (
        <>
          {own.map((c, i) => {
            const base = CLASSES[c.base];
            const opts = new Set(c.skillOptions ?? []);
            const rec = new Set(c.skills ?? []);
            const stateOf = (s: string) => (rec.has(s) ? 'rec' : opts.has(s) ? 'opt' : '');
            const setSkill = (s: string, v: string) => {
              const o = new Set(opts); const r = new Set(rec);
              o.delete(s); r.delete(s);
              if (v === 'opt' || v === 'rec') o.add(s);
              if (v === 'rec') r.add(s);
              // 추천 기술은 후보에도 들어간다 — 후보를 정하지 않았으면 규칙 직업 후보를 그대로 쓴다
              const optList = SKILL_IDS.filter((x) => o.has(x));
              set(i, { skills: SKILL_IDS.filter((x) => r.has(x)), skillOptions: optList.length ? optList : undefined });
            };
            return (
              <details key={i} className="class-card" open={own.length <= 3}>
                <summary><b>{c.name || '(이름 없음)'}</b> <span className="muted small">규칙: {base?.name ?? c.base}{c.strengths ? ` · ${c.strengths}` : ''}</span></summary>
                <div className="form-grid">
                  <Text label="이름" value={c.name} onChange={(name) => set(i, { name })} />
                  <Text label="ID (영문)" value={c.id} onChange={(id) => set(i, { id })} />
                  <Select label="규칙 직업 (생명력·주문·전투 능력)" value={c.base} options={BASES} onChange={(b) => set(i, { base: b })} />
                  <Text label="잘하는 것 (예: 화술 · 매력 · 소문)" value={c.strengths} onChange={(strengths) => set(i, { strengths: strengths || undefined })} />
                  <Area label="소개" value={c.blurb} onChange={(blurb) => set(i, { blurb: blurb || undefined })} rows={2} />
                </div>
                {base && (
                  <fieldset>
                    <legend className="small">기술 — 후보 {opts.size ? opts.size : `(규칙 직업 기본 ${base.skillOptions.length})`} · 추천 {rec.size}/{base.skillChoices}</legend>
                    <p className="small muted">‘후보’를 하나도 정하지 않으면 규칙 직업의 기본 후보({base.skillOptions.map((s) => SKILLS[s].name).join('·')})를 씁니다. 후보는 {base.skillChoices}개 이상이어야 합니다. ‘추천’은 처음에 골라 둡니다.</p>
                    <div className="skill-grid">
                      {SKILL_IDS.map((s) => (
                        <label key={s} className="row small">
                          <span className="grow">{SKILLS[s].name} <span className="muted">({ABILITY_NAMES[SKILLS[s].ability]})</span></span>
                          <select value={stateOf(s)} onChange={(e) => setSkill(s, e.target.value)}>
                            <option value="">—</option><option value="opt">후보</option><option value="rec">추천</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <div className="row">
                  <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button disabled={i === own.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button onClick={() => onChange([...own.slice(0, i + 1), { ...structuredClone(c), id: `${c.id}_copy`, name: `${c.name} (사본)` }, ...own.slice(i + 1)])}>복제</button>
                  <span className="spacer" />
                  <button onClick={() => confirm(`"${c.name}" 직업을 지울까요?`) && onChange(own.filter((_, j) => j !== i))}>삭제</button>
                </div>
              </details>
            );
          })}
          <div className="row">
            <button onClick={() => { let n = own.length + 1; while (own.some((c) => c.id === `class${n}`)) n++; onChange([...own, { id: `class${n}`, name: '새 직업', base: 'fighter' }]); }}>＋ 직업 추가</button>
            <span className="small muted">한 세계에 같은 규칙 직업을 여러 번 써도 됩니다 (예: 기사와 근위병 둘 다 파이터).</span>
          </div>
        </>
      )}
    </div>
  );
}
