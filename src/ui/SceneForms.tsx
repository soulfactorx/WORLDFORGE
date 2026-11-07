/**
 * 장면 폼 편집기 (v0.48): 수치·상태·단계·행동·반작용·끝을 입력 칸으로 만든다. 프리셋에서 시작할 수 있다.
 */
import { useState } from 'react';
import { ABILITIES, ABILITY_NAMES, SKILLS, SKILL_IDS } from '../engine/character/rules';
import type { SceneAction, SceneCond, SceneDef, SceneDelta, SceneEnd, SceneGauge, SceneReaction, SceneStateDef, WorldPackage } from '../engine/schema';
import { SCENE_PRESETS } from '../data/scenePresets';
import { ConditionField } from './ConditionEditor';
import { EffectsEditor } from './WorldForms';
import { Area, ItemList, JsonField, Num, Select, Text } from './form';
import { AssetImage } from './AssetImage';
import { autoSceneArt, SCENE_FX } from '../data/sceneArt';

type Set = (patch: Partial<WorldPackage>) => void;

const CHECKS: [string, string][] = [['', '판정 없음 (항상 성공)'], ...SKILL_IDS.map((k) => [`skill:${k}`, `기술: ${SKILLS[k].name}`] as [string, string]), ...ABILITIES.map((a) => [`ability:${a}`, `능력치: ${ABILITY_NAMES[a]}`] as [string, string])];
const csv = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
const uniq = (base: string, taken: string[]) => { let id = base; for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`; return id; };

/** 그림 고르기 (v0.50): 내장 장면 그림 + 이 세계의 이미지 */
function ImagePick({ label, value, w, onChange }: { label: string; value: string | undefined; w: WorldPackage; onChange: (v: string | undefined) => void }) {
  const known = !value || SCENE_FX.some((f) => `stock.${f.id}` === value) || (w.assets ?? []).some((a) => a.id === value);
  return (
    <label className="img-pick">{label}
      <span className="row">
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">(그림 없음)</option>
          {!known && <option value={value}>{value}</option>}
          <optgroup label="장면 그림 (내장)">{SCENE_FX.map((f) => <option key={f.id} value={`stock.${f.id}`}>{f.label}</option>)}</optgroup>
          {(w.assets ?? []).length > 0 && <optgroup label="이 세계의 이미지">{(w.assets ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
        </select>
        {value && <AssetImage pkg={w.manifest.id} id={value} alt={label} className="img-pick-thumb" zoom />}
      </span>
    </label>
  );
}

/** 작은 행 목록 (수치·상태·단계·보정) */
function Rows<T>({ title, items, make, onChange, render }: { title: string; items: T[]; make: () => T; onChange: (v: T[]) => void; render: (it: T, up: (p: Partial<T>) => void) => React.ReactNode }) {
  return (
    <fieldset className="scene-rows"><legend>{title}</legend>
      {items.map((it, i) => (
        <div key={i} className="scene-row">
          {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          <button type="button" className="small" aria-label="삭제" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="small" onClick={() => onChange([...items, make()])}>＋ 추가</button>
    </fieldset>
  );
}

/** 장면 조건: 흔한 꼴(수치·상태·단계·차례)은 입력 칸, 묶음(all·any)은 JSON */
function SceneCondField({ label, value, def, onChange, optional }: { label: string; value: SceneCond | undefined; def: SceneDef; onChange: (c: SceneCond | undefined) => void; optional?: boolean }) {
  const kind = !value ? 'none' : 'gauge' in value ? 'gauge' : 'state' in value ? 'state' : 'phase' in value ? 'phase' : 'round' in value ? 'round' : 'json';
  const g = value && 'gauge' in value ? value : undefined;
  return (
    <fieldset className="cond-field"><legend>{label}</legend>
      <div className="row">
        <select value={kind} onChange={(e) => {
          const k = e.target.value;
          onChange(k === 'none' ? undefined : k === 'gauge' ? { gauge: def.gauges[0]?.id ?? '', gte: 5 } : k === 'state' ? { state: def.states?.[0]?.id ?? '' }
            : k === 'phase' ? { phase: def.phases?.[0]?.id ?? '' } : k === 'round' ? { round: 3 } : { all: value ? [value] : [] });
        }}>
          {optional && <option value="none">(없음 — 항상)</option>}
          <option value="gauge">수치가</option><option value="state">상태가 있으면</option><option value="phase">단계가</option><option value="round">차례가 이상이면</option><option value="json">여러 조건 (JSON)</option>
        </select>
        {g && <>
          <select value={g.gauge} onChange={(e) => onChange({ ...g, gauge: e.target.value })}>{def.gauges.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select value={g.gte !== undefined ? 'gte' : 'lte'} onChange={(e) => onChange(e.target.value === 'gte' ? { gauge: g.gauge, gte: g.lte ?? g.gte ?? 0 } : { gauge: g.gauge, lte: g.gte ?? g.lte ?? 0 })}>
            <option value="gte">이상</option><option value="lte">이하</option>
          </select>
          <input type="number" className="num" value={g.gte ?? g.lte ?? 0} onChange={(e) => onChange(g.gte !== undefined ? { gauge: g.gauge, gte: Number(e.target.value) } : { gauge: g.gauge, lte: Number(e.target.value) })} />
        </>}
        {value && 'state' in value && <select value={value.state} onChange={(e) => onChange({ state: e.target.value })}>{(def.states ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        {value && 'phase' in value && <select value={value.phase} onChange={(e) => onChange({ phase: e.target.value })}>{(def.phases ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        {value && 'round' in value && <input type="number" className="num" value={value.round} onChange={(e) => onChange({ round: Number(e.target.value) || 1 })} />}
      </div>
      {kind === 'json' && <JsonField label="" value={value} rows={4} onChange={(v) => onChange(v as SceneCond)}
        help='예: { "all": [{ "gauge": "deal", "gte": 8 }, { "state": "warm" }] } · { "any": [ … ] }' />}
    </fieldset>
  );
}

/** 결과(수치 변화·상태·단계·한 줄) */
function DeltaEditor({ label, value, def, w, onChange }: { label: string; value: SceneDelta | undefined; def: SceneDef; w: WorldPackage; onChange: (d: SceneDelta | undefined) => void }) {
  const d = value ?? {};
  const set = (p: Partial<SceneDelta>) => { const n = { ...d, ...p }; onChange(Object.values(n).some((v) => v !== undefined && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) ? n : undefined); };
  const stateMode = (id: string) => (d.addStates?.includes(id) ? 'add' : d.removeStates?.includes(id) ? 'remove' : '');
  return (
    <fieldset className="cond-field scene-delta"><legend>{label}</legend>
      <div className="row">
        {def.gauges.map((g) => (
          <label key={g.id} className="small delta-num">{g.name}
            <input type="number" className="num" value={d.gauges?.[g.id] ?? ''} placeholder="0" onChange={(e) => {
              const gauges = { ...(d.gauges ?? {}) };
              if (e.target.value === '' || Number(e.target.value) === 0) delete gauges[g.id]; else gauges[g.id] = Number(e.target.value);
              set({ gauges: Object.keys(gauges).length ? gauges : undefined });
            }} />
          </label>
        ))}
      </div>
      {(def.states?.length ?? 0) > 0 && (
        <div className="row">{def.states!.map((st) => (
          <label key={st.id} className="small delta-num">{st.name}
            <select value={stateMode(st.id)} onChange={(e) => {
              const add = (d.addStates ?? []).filter((x) => x !== st.id); const rem = (d.removeStates ?? []).filter((x) => x !== st.id);
              if (e.target.value === 'add') add.push(st.id); if (e.target.value === 'remove') rem.push(st.id);
              set({ addStates: add.length ? add : undefined, removeStates: rem.length ? rem : undefined });
            }}><option value="">그대로</option><option value="add">붙음</option><option value="remove">풀림</option></select>
          </label>
        ))}</div>
      )}
      <div className="row">
        {(def.phases?.length ?? 0) > 0 && (
          <label className="small delta-num">단계
            <select value={d.phase ?? ''} onChange={(e) => set({ phase: e.target.value || undefined })}><option value="">그대로</option>{def.phases!.map((p) => <option key={p.id} value={p.id}>→ {p.name}</option>)}</select>
          </label>
        )}
        <input placeholder="기록에 남는 한 줄 (선택)" value={d.text ?? ''} onChange={(e) => set({ text: e.target.value || undefined })} />
      </div>
      <ImagePick label="그림" value={d.image} w={w} onChange={(image) => set({ image })} />
    </fieldset>
  );
}

function ActionForm({ a, def, w, up }: { a: SceneAction; def: SceneDef; w: WorldPackage; up: (p: Partial<SceneAction>) => void }) {
  return (
    <div className="form-grid">
      <Text label="ID" value={a.id} onChange={(id) => up({ id })} />
      <Text label="이름 (버튼)" value={a.name} onChange={(name) => up({ name })} />
      <Text label="설명 (버튼 아래 · 서술 재료)" value={a.text} onChange={(text) => up({ text: text || undefined })} />
      <Select label="판정" value={a.check ?? ''} options={CHECKS} onChange={(check) => up({ check: check || undefined })} />
      {a.check && <Num label="난이도 DC (기본 12)" value={a.dc} onChange={(dc) => up({ dc })} />}
      <ImagePick label="카드 그림" value={a.image} w={w} onChange={(image) => up({ image })} />
      <Text label="꼬리표 (쉼표로 — 상대의 좋아함·싫어함과 맞춘다)" value={(a.tags ?? []).join(', ')} onChange={(v) => up({ tags: csv(v).length ? csv(v) : undefined })} />
      {(def.phases?.length ?? 0) > 0 && (
        <fieldset className="cond-field"><legend>쓸 수 있는 단계 (비우면 언제나)</legend>
          <div className="row">{def.phases!.map((p) => (
            <label key={p.id} className="check small"><input type="checkbox" checked={a.phases?.includes(p.id) ?? false}
              onChange={(e) => { const l = (a.phases ?? []).filter((x) => x !== p.id); if (e.target.checked) l.push(p.id); up({ phases: l.length ? l : undefined }); }} /> {p.name}</label>
          ))}</div>
        </fieldset>
      )}
      <label className="check"><input type="checkbox" checked={!!a.once} onChange={(e) => up({ once: e.target.checked || undefined })} /> 장면에서 한 번만</label>
      <SceneCondField label="쓸 수 있는 조건" value={a.requires} def={def} optional onChange={(requires) => up({ requires })} />
      {a.check && (
        <Rows<NonNullable<SceneAction['mods']>[number]> title="수치가 굴림에 더해짐 (수치 × 배수, ±최대)" items={a.mods ?? []} make={() => ({ gauge: def.gauges[0]?.id ?? '', per: -1 })}
          onChange={(mods) => up({ mods: mods.length ? mods : undefined })}
          render={(m, upM) => <>
            <select value={m.gauge} onChange={(e) => upM({ gauge: e.target.value })}>{def.gauges.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <label className="small delta-num">× 배수<input type="number" step="0.5" className="num" value={m.per} onChange={(e) => upM({ per: Number(e.target.value) })} /></label>
            <label className="small delta-num">최대 ±<input type="number" className="num" value={m.max ?? ''} placeholder="없음" onChange={(e) => upM({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          </>} />
      )}
      <DeltaEditor label={a.check ? '성공하면' : '하면'} value={a.success} def={def} w={w} onChange={(success) => up({ success })} />
      {a.check && <DeltaEditor label="대성공하면 (DC를 5 이상 넘김 · 비우면 성공과 같음)" value={a.great} def={def} w={w} onChange={(great) => up({ great })} />}
      {a.check && <DeltaEditor label="실패하면" value={a.failure} def={def} w={w} onChange={(failure) => up({ failure })} />}
    </div>
  );
}

function EndForm({ e, def, w, up }: { e: SceneEnd; def: SceneDef; w: WorldPackage; up: (p: Partial<SceneEnd>) => void }) {
  return (
    <div className="form-grid">
      <Text label="ID" value={e.id} onChange={(id) => up({ id })} />
      <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
      <Select label="결과" value={e.outcome} options={[['success', '성공'], ['failure', '실패'], ['neutral', '중립']] as const} onChange={(outcome) => up({ outcome })} />
      <Text label="플레이어에게 보이는 한 줄" value={e.text} onChange={(text) => up({ text: text || undefined })} />
      <ImagePick label="끝 그림" value={e.image} w={w} onChange={(image) => up({ image })} />
      <SceneCondField label="이렇게 되면 끝" value={e.when} def={def} onChange={(when) => up({ when: when ?? { round: 99 } })} />
      <EffectsEditor label="끝나면 일어나는 일" value={e.effects} w={w} onChange={(effects) => up({ effects: effects.length ? effects : undefined })} />
      <JsonField label="보상 (선택)" value={e.rewards ?? {}} rows={2} onChange={(r) => up({ rewards: r && typeof r === 'object' && Object.keys(r).length ? r : undefined })}
        help='예: { "xp": "minor", "money": 20, "items": [{ "itemId": "std/potion-healing" }] }' />
    </div>
  );
}

export function SceneForms({ w, set }: { w: WorldPackage; set: Set }) {
  const scenes = w.scenes ?? [];
  const [preset, setPreset] = useState(SCENE_PRESETS[0]!.key);
  const chars = [['', '(없음 — 상대 없는 장면)'], ...w.characters.map((c) => [c.id, c.name] as const)] as const;
  const locs = [['', '(어디서나)'], ...w.locations.map((l) => [l.id, l.name] as const)] as const;
  const save = (list: SceneDef[]) => set({ scenes: list.length ? list : undefined });
  return (
    <>
      <div className="row scene-preset">
        <b>프리셋으로 추가:</b>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>{SCENE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label} — {p.desc}</option>)}</select>
        <button type="button" onClick={() => {
          const d = SCENE_PRESETS.find((p) => p.key === preset)!.make();
          save([...scenes, { ...d, id: uniq(d.id, scenes.map((s) => s.id)) }]);
        }}>＋ 추가</button>
      </div>
      <ItemList<SceneDef> title="장면" items={scenes} onChange={save}
        make={(n) => ({ id: `scene/new-${n}`, name: '새 장면', description: '', gauges: [{ id: 'progress', name: '진척', start: 0, min: 0, max: 10 }],
          actions: [{ id: 'try', name: '시도', check: 'skill:persuasion', dc: 12, success: { gauges: { progress: 3 } } }],
          ends: [{ id: 'done', name: '성공', when: { gauge: 'progress', gte: 10 }, outcome: 'success' }, { id: 'timeout', name: '시간 초과', when: { round: 99 }, outcome: 'failure' }], maxRounds: 8, timeoutEnd: 'timeout' })}
        render={(d, up) => (
          <div className="form-grid scene-form">
            <Text label="ID" value={d.id} onChange={(id) => up({ id })} />
            <Text label="이름" value={d.name} onChange={(name) => up({ name })} />
            <Area label="설명 (GM용 — 어떤 장면인가, 언제 권하나)" value={d.description} onChange={(description) => up({ description })} rows={2} />
            <Select label="상대 인물 (그 인물이 있어야 열림)" value={d.npcId ?? ''} options={chars} onChange={(npcId) => up({ npcId: npcId || undefined })} />
            <Select label="장소" value={d.locationId ?? ''} options={locs} onChange={(locationId) => up({ locationId: locationId || undefined })} />
            <ConditionField label="열리는 조건" value={d.start} world={w} optional onChange={(start) => up({ start })} />
            <ImagePick label="시작 그림" value={d.image} w={w} onChange={(image) => up({ image })} />
            <Area label="시작할 때 기록에 남는 글 (선택)" value={d.intro} onChange={(intro) => up({ intro: intro || undefined })} rows={2} />
            <Select label="장면 서술 (플레이 설정이 우선)" value={d.narration ?? 'end'} options={[['fixed', '정해진 글만 (AI 없음)'], ['end', '끝날 때만 AI 서술 (기본)'], ['ai', '매 차례 AI가 장면 서술']] as const} onChange={(narration) => up({ narration: narration === 'end' ? undefined : narration })} />
            <div className="row"><button type="button" className="small" onClick={() => up(autoSceneArt(d))}>🖼 빈 그림 자리 자동 채우기</button><span className="small muted">이름·설명·꼬리표의 낱말로 내장 장면 그림을 고른다 (이미 고른 것은 그대로)</span></div>
            <label className="check"><input type="checkbox" checked={!!d.auto} onChange={(e) => up({ auto: e.target.checked || undefined })} /> 조건이 맞으면 저절로 시작</label>
            <label className="check"><input type="checkbox" checked={!!d.repeatable} onChange={(e) => up({ repeatable: e.target.checked || undefined })} /> 끝난 뒤 다시 할 수 있음</label>
            <Text label="상대가 좋아하는 꼬리표 (쉼표 — 판정 이점)" value={(d.likes ?? []).join(', ')} onChange={(v) => up({ likes: csv(v).length ? csv(v) : undefined })} />
            <Text label="상대가 싫어하는 꼬리표 (쉼표 — 판정 불리)" value={(d.dislikes ?? []).join(', ')} onChange={(v) => up({ dislikes: csv(v).length ? csv(v) : undefined })} />
            <Rows<SceneGauge> title="수치 (게이지)" items={d.gauges} make={() => ({ id: uniq('gauge', d.gauges.map((g) => g.id)), name: '새 수치', start: 0, min: 0, max: 10 })} onChange={(gauges) => up({ gauges })}
              render={(g, upG) => <>
                <input className="id-in" value={g.id} title="ID" onChange={(e) => upG({ id: e.target.value })} />
                <input value={g.name} title="이름" onChange={(e) => upG({ name: e.target.value })} />
                <label className="small delta-num">시작<input type="number" className="num" value={g.start} onChange={(e) => upG({ start: Number(e.target.value) })} /></label>
                <label className="small delta-num">최소<input type="number" className="num" value={g.min ?? 0} onChange={(e) => upG({ min: Number(e.target.value) })} /></label>
                <label className="small delta-num">최대<input type="number" className="num" value={g.max ?? 100} onChange={(e) => upG({ max: Number(e.target.value) })} /></label>
                <label className="check small"><input type="checkbox" checked={g.visible !== false} onChange={(e) => upG({ visible: e.target.checked ? undefined : false })} /> 보임</label>
              </>} />
            <Rows<SceneStateDef> title="상태" items={d.states ?? []} make={() => ({ id: uniq('state', (d.states ?? []).map((s) => s.id)), name: '새 상태' })} onChange={(states) => up({ states: states.length ? states : undefined })}
              render={(st, upS) => <>
                <input className="id-in" value={st.id} title="ID" onChange={(e) => upS({ id: e.target.value })} />
                <input value={st.name} title="이름" onChange={(e) => upS({ name: e.target.value })} />
                <select value={String(st.edge ?? 0)} onChange={(e) => upS({ edge: e.target.value === '0' ? undefined : (Number(e.target.value) as 1 | -1) })}>
                  <option value="0">판정 영향 없음</option><option value="1">판정 이점</option><option value="-1">판정 불리</option>
                </select>
              </>} />
            <Rows<NonNullable<SceneDef['phases']>[number]> title="단계 (첫 단계에서 시작)" items={d.phases ?? []} make={() => ({ id: uniq('phase', (d.phases ?? []).map((p) => p.id)), name: '새 단계' })} onChange={(phases) => up({ phases: phases.length ? phases : undefined })}
              render={(p, upP) => <>
                <input className="id-in" value={p.id} title="ID" onChange={(e) => upP({ id: e.target.value })} />
                <input value={p.name} title="이름" onChange={(e) => upP({ name: e.target.value })} />
                <input value={p.text ?? ''} placeholder="장면 패널에 보이는 한 줄 (선택)" onChange={(e) => upP({ text: e.target.value || undefined })} />
                <ImagePick label="그림" value={p.image} w={w} onChange={(image) => upP({ image })} />
              </>} />
            <fieldset><legend>행동 카드</legend>
              {d.actions.map((a, i) => (
                <details key={i} className="scene-item">
                  <summary><b>{a.name || '(이름 없음)'}</b> <span className="small muted">{a.check ? CHECKS.find(([k]) => k === a.check)?.[1] : '판정 없음'}{a.dc ? ` · DC ${a.dc}` : ''}</span></summary>
                  <ActionForm a={a} def={d} w={w} up={(p) => up({ actions: d.actions.map((x, j) => (j === i ? { ...x, ...p } : x)) })} />
                  <button type="button" className="small" onClick={() => up({ actions: d.actions.filter((_, j) => j !== i) })}>행동 삭제</button>
                </details>
              ))}
              <button type="button" className="small" onClick={() => up({ actions: [...d.actions, { id: uniq('act', d.actions.map((a) => a.id)), name: '새 행동', check: 'skill:persuasion', dc: 12 }] })}>＋ 행동 추가</button>
            </fieldset>
            <fieldset><legend>반작용 (내 행동마다, 위에서부터 조건이 맞는 것 모두)</legend>
              {(d.reactions ?? []).map((r, i) => {
                const upR = (p: Partial<SceneReaction>) => up({ reactions: (d.reactions ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <details key={i} className="scene-item">
                    <summary><b>반작용 {i + 1}</b> <span className="small muted">{r.delta.text ?? ''}{r.chance !== undefined ? ` · 확률 ${Math.round(r.chance * 100)}%` : ''}</span></summary>
                    <SceneCondField label="조건 (없으면 매번)" value={r.when} def={d} optional onChange={(when) => upR({ when })} />
                    <Num label="확률 (0~1, 비우면 항상)" value={r.chance} onChange={(chance) => upR({ chance })} />
                    <DeltaEditor label="일어나는 일" value={r.delta} def={d} w={w} onChange={(delta) => upR({ delta: delta ?? {} })} />
                    <button type="button" className="small" onClick={() => up({ reactions: (d.reactions ?? []).filter((_, j) => j !== i) })}>반작용 삭제</button>
                  </details>
                );
              })}
              <button type="button" className="small" onClick={() => up({ reactions: [...(d.reactions ?? []), { delta: { gauges: { [d.gauges[0]?.id ?? 'x']: 1 } } }] })}>＋ 반작용 추가</button>
            </fieldset>
            <fieldset><legend>끝 (위에서부터 처음 맞는 것)</legend>
              {d.ends.map((e, i) => (
                <details key={i} className="scene-item">
                  <summary><b>{e.name || '(이름 없음)'}</b> <span className="small muted">{{ success: '성공', failure: '실패', neutral: '중립' }[e.outcome]}</span></summary>
                  <EndForm e={e} def={d} w={w} up={(p) => up({ ends: d.ends.map((x, j) => (j === i ? { ...x, ...p } : x)) })} />
                  <button type="button" className="small" onClick={() => up({ ends: d.ends.filter((_, j) => j !== i) })}>끝 삭제</button>
                </details>
              ))}
              <button type="button" className="small" onClick={() => up({ ends: [...d.ends, { id: uniq('end', d.ends.map((e) => e.id)), name: '새 끝', when: { round: 99 }, outcome: 'neutral' }] })}>＋ 끝 추가</button>
            </fieldset>
            <Num label="차례 한도 (비우면 없음)" value={d.maxRounds} onChange={(maxRounds) => up({ maxRounds })} />
            <Select label="차례가 다하면 이 끝으로" value={d.timeoutEnd ?? ''} options={[['', '(마지막 끝)'], ...d.ends.map((e) => [e.id, e.name] as const)] as const} onChange={(timeoutEnd) => up({ timeoutEnd: timeoutEnd || undefined })} />
          </div>
        )} />
    </>
  );
}
