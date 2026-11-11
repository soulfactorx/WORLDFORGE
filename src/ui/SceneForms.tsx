import { sceneEntry } from '../engine/scene';
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
import { REWARD_FIELDS, StructField } from './Struct';
import { ImagePicker } from './ImagePicker';
import { autoSceneArt, SCENE_FX } from '../data/sceneArt';
import { SceneTester } from './SceneTester';

type Set = (patch: Partial<WorldPackage>) => void;

const CHECKS: [string, string][] = [['', '판정 없음 (항상 성공)'], ...SKILL_IDS.map((k) => [`skill:${k}`, `기술: ${SKILLS[k].name}`] as [string, string]), ...ABILITIES.map((a) => [`ability:${a}`, `능력치: ${ABILITY_NAMES[a]}`] as [string, string])];
const ENTRY_MODES = [['button', '버튼 — 플레이어가 🎭 버튼으로 연다'], ['offer', 'GM 제안 — 버튼 + 플레이어의 행동이 계기에 해당하면 GM이 연다'], ['auto', '자동 — 조건이 맞는 순간 저절로 시작한다']] as const;
const csv = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
const uniq = (base: string, taken: string[]) => { let id = base; for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`; return id; };

/** 그림 고르기: 검색·종류별 거르기·썸네일 격자 (v0.60) */
const ImagePick = ImagePicker;

/** 작은 행 목록 (수치·상태·단계·보정) */
function Rows<T>({ title, items, make, onChange, render }: { title: string; items: T[]; make: () => T; onChange: (v: T[]) => void; render: (it: T, up: (p: Partial<T>) => void) => React.ReactNode }) {
  return (
    <fieldset className="scene-rows"><legend>{title}</legend>
      {items.map((it, i) => (
        <div key={i} className="scene-row">
          <div className="scene-row-body">{render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}</div>
          <button type="button" className="row-del" aria-label={`${title} ${i + 1}번째 줄 삭제`} title="이 줄 삭제" onClick={() => onChange(items.filter((_, j) => j !== i))}>🗑</button>
        </div>
      ))}
      <button type="button" className="small" onClick={() => onChange([...items, make()])}>＋ 추가</button>
    </fieldset>
  );
}

type CondKind = 'gauge' | 'state' | 'phase' | 'round' | 'all' | 'any' | 'not';
const condKind = (c: SceneCond): CondKind => ('gauge' in c ? 'gauge' : 'state' in c ? 'state' : 'phase' in c ? 'phase' : 'round' in c ? 'round' : 'all' in c ? 'all' : 'any' in c ? 'any' : 'not');
const blankCond = (k: CondKind, def: SceneDef, keep?: SceneCond): SceneCond => (k === 'gauge' ? { gauge: def.gauges[0]?.id ?? '', gte: 5 } : k === 'state' ? { state: def.states?.[0]?.id ?? '' }
  : k === 'phase' ? { phase: def.phases?.[0]?.id ?? '' } : k === 'round' ? { round: 3 }
  // 묶음으로 바꿀 때는 지금 조건을 그 안에 넣는다 (다시 만들지 않게)
  : k === 'all' ? { all: keep && 'any' in keep ? keep.any : keep && !('all' in keep) ? [keep] : keep && 'all' in keep ? keep.all : [] }
  : k === 'any' ? { any: keep && 'all' in keep ? keep.all : keep && !('any' in keep) ? [keep] : keep && 'any' in keep ? keep.any : [] }
  : { not: keep && !('not' in keep) ? keep : { gauge: def.gauges[0]?.id ?? '', gte: 5 } });

/** 조건을 한 문장으로 (접힌 줄·확인용) */
export function describeSceneCond(c: SceneCond | undefined, def: SceneDef): string {
  if (!c) return '항상';
  const g = (id: string) => def.gauges.find((x) => x.id === id)?.name ?? id;
  if ('gauge' in c) return `${g(c.gauge)} ${c.gte !== undefined ? `${c.gte} 이상` : `${c.lte ?? 0} 이하`}`;
  if ('state' in c) return `상태 「${def.states?.find((x) => x.id === c.state)?.name ?? c.state}」`;
  if ('phase' in c) return `단계 「${def.phases?.find((x) => x.id === c.phase)?.name ?? c.phase}」`;
  if ('round' in c) return `${c.round}차례 이상`;
  if ('not' in c) return `(${describeSceneCond(c.not, def)})이 아님`;
  const list = 'all' in c ? c.all : c.any;
  if (!list.length) return 'all' in c ? '항상 (조건 없음)' : '절대 아님 (조건 없음)';
  return list.map((x) => ('all' in x || 'any' in x ? `(${describeSceneCond(x, def)})` : describeSceneCond(x, def))).join('all' in c ? ' 그리고 ' : ' 또는 ');
}

/** 조건 하나 (묶음이면 안쪽 조건들까지) — 전부 선택 칸으로 */
function SceneCondNode({ value, def, onChange, onRemove, depth = 0 }: { value: SceneCond; def: SceneDef; onChange: (c: SceneCond) => void; onRemove?: () => void; depth?: number }) {
  const kind = condKind(value);
  const group = 'all' in value ? value.all : 'any' in value ? value.any : null;
  const setGroup = (list: SceneCond[]) => onChange('all' in value ? { all: list } : { any: list });
  return (
    <div className={`scond depth-${depth % 3}${group || kind === 'not' ? ' scond-group' : ''}`}>
      <div className="scond-row">
        <select value={kind} aria-label="조건 종류" onChange={(e) => onChange(blankCond(e.target.value as CondKind, def, value))}>
          <option value="gauge">수치가</option><option value="state">상태가 있으면</option><option value="phase">단계가</option><option value="round">차례가 지났으면</option>
          <option value="all">아래가 모두 맞으면 (그리고)</option><option value="any">아래 중 하나라도 맞으면 (또는)</option><option value="not">아래가 아니면</option>
        </select>
        {'gauge' in value && <>
          <select value={value.gauge} aria-label="수치" onChange={(e) => onChange(value.gte !== undefined ? { gauge: e.target.value, gte: value.gte } : { gauge: e.target.value, lte: value.lte ?? 0 })}>{def.gauges.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <input type="number" className="num" aria-label="기준값" value={value.gte ?? value.lte ?? 0} onChange={(e) => onChange(value.gte !== undefined ? { gauge: value.gauge, gte: Number(e.target.value) } : { gauge: value.gauge, lte: Number(e.target.value) })} />
          <select value={value.gte !== undefined ? 'gte' : 'lte'} aria-label="이상·이하" onChange={(e) => onChange(e.target.value === 'gte' ? { gauge: value.gauge, gte: value.lte ?? value.gte ?? 0 } : { gauge: value.gauge, lte: value.gte ?? value.lte ?? 0 })}>
            <option value="gte">이상</option><option value="lte">이하</option>
          </select>
        </>}
        {'state' in value && ((def.states ?? []).length ? <select value={value.state} aria-label="상태" onChange={(e) => onChange({ state: e.target.value })}>{(def.states ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : <span className="small warn">이 장면에 상태가 없습니다 — 위의 "상태"에서 먼저 만드세요</span>)}
        {'phase' in value && ((def.phases ?? []).length ? <select value={value.phase} aria-label="단계" onChange={(e) => onChange({ phase: e.target.value })}>{(def.phases ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : <span className="small warn">이 장면에 단계가 없습니다 — 위의 "단계"에서 먼저 만드세요</span>)}
        {'round' in value && <><input type="number" className="num" aria-label="차례" value={value.round} onChange={(e) => onChange({ round: Number(e.target.value) || 1 })} /><span className="small">차례 이상</span></>}
        {onRemove && <button type="button" className="icon scond-del" aria-label="이 조건 빼기" title="이 조건 빼기" onClick={onRemove}>✕</button>}
      </div>
      {group && (
        <div className="scond-children">
          {group.length === 0 && <p className="small muted">{'all' in value ? '안에 조건이 없으면 항상 맞습니다.' : '안에 조건이 없으면 절대 맞지 않습니다.'} 아래에서 조건을 넣으세요.</p>}
          {group.map((c, i) => (
            <div key={i} className="scond-child">
              {i > 0 && <span className="scond-join small">{'all' in value ? '그리고' : '또는'}</span>}
              <SceneCondNode value={c} def={def} depth={depth + 1} onChange={(n) => setGroup(group.map((x, j) => (j === i ? n : x)))} onRemove={() => setGroup(group.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="row scond-add">
            <button type="button" className="small" onClick={() => setGroup([...group, blankCond('gauge', def)])}>＋ 조건</button>
            <button type="button" className="small" onClick={() => setGroup([...group, 'all' in value ? { any: [] } : { all: [] }])} title="조건 여러 개를 괄호로 묶는다">＋ 묶음 ({'all' in value ? '또는' : '그리고'})</button>
          </div>
        </div>
      )}
      {'not' in value && <div className="scond-children"><SceneCondNode value={value.not} def={def} depth={depth + 1} onChange={(n) => onChange({ not: n })} /></div>}
    </div>
  );
}

/** 장면 조건 (v0.107): 묶음(그리고·또는·아니면)까지 선택 칸으로 만들고, 언제든 JSON으로 바꿔 고칠 수 있다 */
function SceneCondField({ label, value, def, onChange, optional }: { label: string; value: SceneCond | undefined; def: SceneDef; onChange: (c: SceneCond | undefined) => void; optional?: boolean }) {
  const [json, setJson] = useState(false);
  return (
    <fieldset className="cond-field"><legend>{label}</legend>
      {value === undefined ? (
        <div className="row"><span className="small muted">조건 없음 — 항상</span><button type="button" className="small" onClick={() => onChange(blankCond('gauge', def))}>＋ 조건 넣기</button></div>
      ) : (
        <>
          <p className="small muted cond-summary">{describeSceneCond(value, def)}</p>
          {json ? <JsonField label="" value={value} rows={5} onChange={(v) => onChange(v as SceneCond)} help='예: { "all": [{ "gauge": "deal", "gte": 8 }, { "any": [{ "state": "warm" }, { "round": 5 }] }] }' />
            : <SceneCondNode value={value} def={def} onChange={onChange} />}
          <div className="row">
            <span className="struct-toggle" role="tablist" aria-label="편집 방식">
              <button type="button" role="tab" aria-selected={!json} className={!json ? 'on' : ''} onClick={() => setJson(false)}>선택 화면</button>
              <button type="button" role="tab" aria-selected={json} className={json ? 'on' : ''} onClick={() => setJson(true)}>JSON</button>
            </span>
            {optional && <button type="button" className="small" onClick={() => onChange(undefined)}>조건 지우기</button>}
          </div>
        </>
      )}
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
      <StructField w={w} spec={{ fields: REWARD_FIELDS }} label="보상 (선택)" value={e.rewards ?? {}} rows={2} onChange={(r) => up({ rewards: r && typeof r === 'object' && Object.keys(r).length ? r : undefined })}
        help='예: { "xp": "minor", "money": 20, "items": [{ "itemId": "std/potion-healing" }] }' />
    </div>
  );
}

export function SceneForms({ w, set }: { w: WorldPackage; set: Set }) {
  const scenes = w.scenes ?? [];
  const [preset, setPreset] = useState(SCENE_PRESETS[0]!.key);
  const [testing, setTesting] = useState<string | null>(null);
  const chars = [['', '(없음 — 상대 없는 장면)'], ...w.characters.map((c) => [c.id, c.name] as const)] as const;
  const locs = [['', '(어디서나)'], ...w.locations.map((l) => [l.id, l.name] as const)] as const;
  const save = (list: SceneDef[]) => set({ scenes: list.length ? list : undefined });
  return (
    <>
      <div className="row scene-preset">
        <b>프리셋으로 추가:</b>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>{SCENE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label} — {p.desc}</option>)}</select>
        {[false, true].map((test) => (
          <button key={String(test)} type="button" onClick={() => {
            const d = SCENE_PRESETS.find((p) => p.key === preset)!.make();
            const id = uniq(d.id, scenes.map((s) => s.id));
            save([...scenes, { ...d, id }]);
            if (test) setTesting(id);
          }}>{test ? '＋ 추가하고 바로 테스트' : '＋ 추가'}</button>
        ))}
      </div>
      {testing && (w.scenes ?? []).some((s) => s.id === testing) && <SceneTester w={w} sceneId={testing} onClose={() => setTesting(null)} onApply={(d) => save(scenes.map((x) => (x.id === d.id ? d : x)))} />}
      <ItemList<SceneDef> title="장면" testKind="scene" items={scenes} onChange={save}
        make={(n) => ({ id: `scene/new-${n}`, name: '새 장면', description: '', gauges: [{ id: 'progress', name: '진척', start: 0, min: 0, max: 10 }],
          actions: [{ id: 'try', name: '시도', check: 'skill:persuasion', dc: 12, success: { gauges: { progress: 3 } } }],
          ends: [{ id: 'done', name: '성공', when: { gauge: 'progress', gte: 10 }, outcome: 'success' }, { id: 'timeout', name: '시간 초과', when: { round: 99 }, outcome: 'failure' }], maxRounds: 8, timeoutEnd: 'timeout' })}
        render={(d, up) => (
          <div className="form-grid scene-form">
            <div className="row"><button type="button" className="primary" onClick={() => setTesting(d.id)}>▶ 바로 테스트</button><span className="small muted">저장하지 않고 지금 내용 그대로 돌려 보기 · 자동 200회 시뮬레이션</span></div>
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
            <fieldset className="cond-field">
              <legend>진입 방식 — 이 장면이 어떻게 열리나</legend>
              <Select label="설정" value={d.entry ? 'custom' : 'default'} options={[['default', '기본 (상대 인물이 있으면 GM이 흐름에 따라 연다 · 없으면 버튼)'], ['custom', '사용자 정의 (방식과 계기를 직접 정한다)']] as const}
                onChange={(v) => up(v === 'custom' ? { entry: { mode: sceneEntry(d).mode }, auto: undefined } : { entry: undefined })} />
              {d.entry ? (
                <>
                  <Select label="방식" value={d.entry.mode} options={ENTRY_MODES} onChange={(mode) => up({ entry: { ...d.entry!, mode } })} />
                  {d.entry.mode === 'offer' && <Area label="계기 (GM용 — 플레이어의 어떤 행동·상황이 이 장면으로 들어가는가)" value={d.entry.trigger ?? ''} rows={2}
                    onChange={(trigger) => up({ entry: { ...d.entry!, trigger: trigger || undefined } })} />}
                  <p className="small muted enc-note">열리는 조건은 위의 "열리는 조건"·상대 인물·장소를 그대로 따른다. {d.entry.mode === 'auto' ? '조건이 맞는 순간 저절로 시작한다.' : d.entry.mode === 'offer' ? '🎭 버튼으로도 열 수 있고, 플레이어의 행동이 계기에 해당하면 GM이 연다.' : '플레이어가 🎭 버튼을 눌러야만 열린다.'}</p>
                </>
              ) : (
                <>
                  <p className="small muted enc-note">지금 방식: <b>{ENTRY_MODES.find((m) => m[0] === sceneEntry(d).mode)?.[1]}</b></p>
                  <label className="check"><input type="checkbox" checked={!!d.auto} onChange={(e) => up({ auto: e.target.checked || undefined })} /> 조건이 맞으면 저절로 시작</label>
                </>
              )}
            </fieldset>
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
