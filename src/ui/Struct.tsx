/**
 * 선택형 편집기 (v0.107) — JSON으로만 고치던 데이터를 칸·선택 목록·＋ 버튼으로 편집한다.
 *
 * 데이터의 모양을 "명세"(어떤 칸이 있고, 무엇을 고르는가)로 적어 두면 화면이 만들어진다.
 * 언제든 JSON 보기로 바꿔 직접 고칠 수 있고, 두 보기는 같은 값을 본다.
 * 명세에 없는 칸은 건드리지 않고 그대로 둔다 (JSON으로 넣은 값이 선택 화면에서 사라지지 않는다).
 */
import { useState } from 'react';
import { SKILLS, type SkillId } from '../engine/character/rules';
import { monsterTable } from '../engine/combat/monsters';
import { allItems } from '../engine/items';
import { AXES, AXIS_NAMES } from '../engine/relationship';
import type { Condition, StoryEffect, WorldPackage } from '../engine/schema';
import { ConditionField } from './ConditionEditor';
import { JsonField } from './form';
import { EffectsEditor } from './WorldForms';
import { phasesOf } from '../engine/phase';
import { worldVars } from '../engine/vars';
import { GM_STYLES } from '../data/gmStyles';

export type RefKind = 'locations' | 'characters' | 'claims' | 'factions' | 'scenes' | 'encounters' | 'quests' | 'items' | 'monsters' | 'flags' | 'skills'
  /** 적으로 세울 수 있는 것: 적 목록 + 이 세계의 인물 ("npc:인물ID" — 그 인물의 직업·레벨·능력치로 싸운다) (v0.110) */
  | 'foes'
  /** 국면 (v0.113) */
  | 'phases'
  /** 갈래 카드 · 걸 수 있는 것 · 카드 표시 (v0.115) */
  | 'storylets' | 'stakes' | 'cardTags';
type Base = { k: string; label: string; hint?: string; /** 비우면 칸 자체를 지운다 */ opt?: boolean };
export type Field =
  | (Base & { t: 'text' | 'long' | 'num' })
  | (Base & { t: 'bool'; dflt?: boolean })
  | (Base & { t: 'enum'; options: (readonly [string, string])[]; /** 값을 숫자로 저장한다 (예: 전열 2 · 후열 3) */ asNumber?: boolean })
  | (Base & { t: 'ref'; of: RefKind })
  | (Base & { t: 'refs'; of: RefKind })
  /** 경험치: 없음 · 작은 보상 · 큰 보상 · 숫자로 (v0.109) */
  | (Base & { t: 'xp' })
  /** [숫자, 이름] 짝의 목록 — 세계 수치의 단계 이름 같은 것 (v0.109) */
  | (Base & { t: 'pairs'; numLabel: string; textLabel: string; add: string })
  /** 양 끝의 이름 두 개 — 기류 축 (v0.113) */
  | (Base & { t: 'poles' })
  /** ID → 한 줄 글 (국면의 인물 태도 같은 것, v0.113) */
  | (Base & { t: 'textmap'; of: RefKind; add: string; textLabel: string })
  | (Base & { t: 'cond' })
  | (Base & { t: 'effects' })
  | (Base & { t: 'obj'; fields: Field[] })
  | (Base & { t: 'list'; spec: ListSpec });
/** ID로 묶인 표 (장소 ID → 상점 같은 것): 무엇의 ID인지와, 값의 모양 */
export interface MapSpec { of: RefKind; add: string; make: () => unknown; fields?: Field[]; list?: ListSpec }
export interface ListSpec { fields: Field[]; /** 접힌 줄에 보이는 이름 */ title: (x: Rec, w: WorldPackage) => string; make: (w: WorldPackage, n: number) => Rec; add: string }
type Rec = Record<string, unknown>;

/** 목록에서 고를 것들: [값, 보이는 이름] */
export function refOptions(w: WorldPackage, of: RefKind): (readonly [string, string])[] {
  const named = (xs: { id: string; name: string }[] | undefined) => (xs ?? []).map((x) => [x.id, `${x.name} (${x.id})`] as const);
  switch (of) {
    case 'locations': return named(w.locations);
    case 'characters': return named(w.characters);
    case 'factions': return named(w.factions);
    case 'scenes': return named(w.scenes);
    case 'encounters': return named(w.encounters);
    case 'quests': return named(w.quests);
    case 'claims': return w.claims.map((c) => [c.id, `${c.statement.slice(0, 36)}${c.statement.length > 36 ? '…' : ''} (${c.id})`] as const);
    case 'items': return allItems(w).map((i) => [i.id, `${i.name} (${i.id})`] as const);
    case 'monsters': return Object.values(monsterTable(w)).map((m) => [m.id, `${m.name} (${m.id})`] as const);
    case 'foes': return [...Object.values(monsterTable(w)).map((m) => [m.id, `${m.name} (${m.id})`] as const), ...w.characters.map((c) => [`npc:${c.id}`, `인물: ${c.name} (${c.id})`] as const)];
    case 'flags': return (w.flags ?? []).map((f) => [f.id, f.id] as const);
    case 'skills': return (Object.keys(SKILLS) as SkillId[]).map((k) => [k, `${SKILLS[k].name} (${k})`] as const);
    case 'phases': return named(phasesOf(w));
    case 'storylets': return (w.storylets ?? []).map((c) => [c.id, `${c.title} (${c.id})`] as const);
    case 'cardTags': return [['main', '이야기의 뼈대'], ['side', '곁가지'], ['random', '돌발'], ['twist', '반전 (국면마다 하나)'], ['job', '의뢰']] as const;
    case 'stakes': {
      const secret = new Set(w.beliefs.filter((b) => b.state === 'secret').map((b) => b.claim));
      return [
        ['escalate', '🔥 판을 키운다 (긴장 +2)'], ['defuse', '🕊 가라앉힌다 (긴장 −2)'],
        ...(w.factions ?? []).map((f) => [`side:${f.id}`, `⚖ ${f.name} 쪽`] as const),
        ...w.characters.flatMap((c) => [[`bond:${c.id}`, `🤝 ${c.name}와(과) 가까워진다`] as const, [`betray:${c.id}`, `🗡 ${c.name}를(을) 저버린다`] as const]),
        ...w.claims.filter((c) => secret.has(c.id)).map((c) => [`expose:${c.id}`, `🗝 비밀 폭로: ${c.statement.slice(0, 24)}`] as const),
        ...worldVars(w).filter((v) => v.poles).flatMap((v) => [[`theme:${v.id}:-`, `🧭 ${v.poles![0]} 쪽`] as const, [`theme:${v.id}:+`, `🧭 ${v.poles![1]} 쪽`] as const]),
        ...(w.storylets ?? []).map((c) => [`thread:${c.id}`, `🧵 다른 길: ${c.title}`] as const),
      ];
    }
  }
}

const isEmpty = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.keys(v).length);

/** 칸 하나 */
function FieldInput({ f, value, w, onChange }: { f: Field; value: unknown; w: WorldPackage; onChange: (v: unknown) => void }) {
  const out = (v: unknown) => onChange(f.opt && isEmpty(v) ? undefined : v);
  const hint = f.hint ? <span className="small muted struct-hint">{f.hint}</span> : null;
  switch (f.t) {
    case 'text': return <label>{f.label}{hint}<input value={(value as string) ?? ''} onChange={(e) => out(e.target.value)} /></label>;
    case 'long': return <label>{f.label}{hint}<textarea rows={2} value={(value as string) ?? ''} onChange={(e) => out(e.target.value)} /></label>;
    case 'num': return <label>{f.label}{hint}<input type="number" className="num" value={value === undefined || value === null ? '' : String(value)} placeholder={f.opt ? '(없음)' : '0'}
      onChange={(e) => onChange(e.target.value === '' ? (f.opt ? undefined : 0) : Number(e.target.value))} /></label>;
    case 'bool': { const on = (value as boolean | undefined) ?? f.dflt ?? false;
      return <label className="check"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked === (f.dflt ?? false) ? undefined : e.target.checked)} /> {f.label}{hint}</label>; }
    case 'enum': return <label>{f.label}{hint}<select value={value === undefined || value === null ? '' : String(value)} onChange={(e) => out(f.asNumber && e.target.value !== '' ? Number(e.target.value) : e.target.value)}>
      {(f.opt || !f.options.some(([v]) => v === String(value))) && <option value="">{f.opt ? '(기본)' : '(고르세요)'}</option>}
      {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
    case 'ref': { const opts = refOptions(w, f.of); const cur = (value as string) ?? '';
      return <label>{f.label}{hint}<select value={cur} onChange={(e) => out(e.target.value)}>
        {(f.opt || !cur) && <option value="">{f.opt ? '(없음)' : '(고르세요)'}</option>}
        {cur && !opts.some(([v]) => v === cur) && <option value={cur}>⚠ 없는 것: {cur}</option>}
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>; }
    case 'refs': { const opts = refOptions(w, f.of); const cur = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="struct-refs"><span className="struct-label">{f.label}</span>{hint}
          <ul className="chips">{cur.map((id) => <li key={id}><span>{opts.find(([v]) => v === id)?.[1] ?? `⚠ ${id}`}</span>
            <button type="button" className="chip-x" aria-label={`${id} 빼기`} title="빼기" onClick={() => out(cur.filter((x) => x !== id))}>✕</button></li>)}</ul>
          <select value="" aria-label={`${f.label} 추가`} onChange={(e) => { if (e.target.value) out([...cur, e.target.value]); }}>
            <option value="">＋ 추가…</option>{opts.filter(([v]) => !cur.includes(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>); }
    case 'xp': { const mode = typeof value === 'number' ? 'num' : value === 'minor' || value === 'major' ? (value as string) : '';
      return (
        <div className="struct-xp"><label>{f.label}{hint}
          <select value={mode} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'num' ? (typeof value === 'number' ? value : 50) : e.target.value)}>
            <option value="">(없음)</option><option value="minor">작은 보상 (다음 레벨까지의 15%)</option><option value="major">큰 보상 (40%)</option><option value="num">숫자로 정하기</option>
          </select></label>
          {mode === 'num' && <label>경험치 값<input type="number" className="num" min={0} value={value as number} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} /></label>}
        </div>); }
    case 'pairs': { const rows = Array.isArray(value) ? (value as [number, string][]) : [];
      const set = (n: [number, string][]) => out(n);
      return (
        <fieldset className="struct-obj"><legend>{f.label}</legend>{hint}
          {rows.length === 0 && <p className="small muted">아직 없습니다.</p>}
          {rows.map((r, i) => (
            <div key={i} className="struct-pair">
              <label>{f.numLabel}<input type="number" className="num" value={r[0] ?? 0} onChange={(e) => set(rows.map((x, j) => (j === i ? [Number(e.target.value) || 0, x[1]] : x)))} /></label>
              <label className="struct-pair-text">{f.textLabel}<input value={r[1] ?? ''} onChange={(e) => set(rows.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} /></label>
              <button type="button" className="icon" aria-label={`${i + 1}번째 지우기`} title="지우기" onClick={() => set(rows.filter((_, j) => j !== i))}>🗑</button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="small" onClick={() => set([...rows, [rows.length ? (rows.at(-1)![0] ?? 0) + 10 : 0, '']])}>＋ {f.add}</button>
            {rows.length > 1 && rows.some((r, i) => i > 0 && r[0] < rows[i - 1]![0]) && <button type="button" className="small" onClick={() => set([...rows].sort((a, b) => a[0] - b[0]))}>작은 값부터 정렬</button>}
          </div>
        </fieldset>); }
    case 'poles': { const v = Array.isArray(value) ? (value as string[]) : ['', ''];
      const put = (i: number, t: string) => { const n = [...v]; n[i] = t; out(n.every((x) => !x?.trim()) ? undefined : n); };
      return (
        <fieldset className="struct-obj"><legend>{f.label}</legend>{hint}
          <div className="struct-pair">
            <label className="struct-pair-text">낮은 쪽 (−)<input value={v[0] ?? ''} onChange={(e) => put(0, e.target.value)} /></label>
            <label className="struct-pair-text">높은 쪽 (+)<input value={v[1] ?? ''} onChange={(e) => put(1, e.target.value)} /></label>
          </div>
        </fieldset>); }
    case 'textmap': { const m = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, string>; const opts = refOptions(w, f.of);
      const put = (n: Record<string, string>) => out(Object.keys(n).length ? n : undefined);
      return (
        <fieldset className="struct-obj"><legend>{f.label}</legend>{hint}
          {Object.keys(m).length === 0 && <p className="small muted">아직 없습니다.</p>}
          {Object.entries(m).map(([id, t]) => (
            <div key={id} className="struct-pair">
              <label className="struct-pair-text">{opts.find(([v]) => v === id)?.[1] ?? `⚠ ${id}`} — {f.textLabel}<input value={t} onChange={(e) => put({ ...m, [id]: e.target.value })} /></label>
              <button type="button" className="icon" aria-label={`${id} 지우기`} title="지우기" onClick={() => { const { [id]: _x, ...rest } = m; put(rest); }}>🗑</button>
            </div>
          ))}
          <select value="" aria-label={f.add} onChange={(e) => { if (e.target.value) put({ ...m, [e.target.value]: '' }); }}>
            <option value="">＋ {f.add}…</option>{opts.filter(([v]) => !(v in m)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </fieldset>); }
    case 'cond': return <ConditionField label={f.label} value={value as Condition | undefined} world={w} optional={!!f.opt} onChange={(c) => onChange(c)} />;
    case 'effects': return <EffectsEditor label={f.label} value={value as StoryEffect[] | undefined} w={w} onChange={(v) => onChange(v.length || !f.opt ? v : undefined)} />;
    case 'obj': return <fieldset className="struct-obj"><legend>{f.label}</legend>{hint}<Fields fields={f.fields} value={(value as Rec) ?? {}} w={w} onChange={(v) => out(v)} /></fieldset>;
    case 'list': return <fieldset className="struct-obj"><legend>{f.label}</legend>{hint}<ListEditor spec={f.spec} value={(value as Rec[]) ?? []} w={w} onChange={(v) => out(v)} /></fieldset>;
  }
}

/** 객체 하나의 칸들. 명세에 없는 칸은 그대로 둔다 */
export function Fields({ fields, value, w, onChange }: { fields: Field[]; value: Rec; w: WorldPackage; onChange: (v: Rec) => void }) {
  return (
    <div className="struct-fields">
      {fields.map((f) => <FieldInput key={f.k} f={f} value={value[f.k]} w={w} onChange={(v) => { const n = { ...value }; if (v === undefined) delete n[f.k]; else n[f.k] = v; onChange(n); }} />)}
    </div>
  );
}

/** 객체의 목록: 줄마다 접었다 펴고, 위아래로 옮기고, 지운다 */
export function ListEditor({ spec, value, w, onChange }: { spec: ListSpec; value: Rec[]; w: WorldPackage; onChange: (v: Rec[]) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const move = (i: number, d: -1 | 1) => { const n = [...value]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j]!, n[i]!]; onChange(n); setOpen(open === i ? j : open); };
  return (
    <div className="struct-list">
      {value.length === 0 && <p className="small muted">아직 없습니다.</p>}
      {value.map((x, i) => (
        <div key={i} className="struct-item">
          <div className="struct-item-head">
            <button type="button" className="struct-item-title" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{open === i ? '▾' : '▸'} {spec.title(x, w) || `(${i + 1}번째)`}</button>
            <button type="button" className="icon" aria-label={`${i + 1}번째 위로`} title="위로" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="icon" aria-label={`${i + 1}번째 아래로`} title="아래로" disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="icon" aria-label={`${i + 1}번째 지우기`} title="지우기" onClick={() => { onChange(value.filter((_, j) => j !== i)); setOpen(null); }}>🗑</button>
          </div>
          {open === i && <Fields fields={spec.fields} value={x} w={w} onChange={(v) => onChange(value.map((y, j) => (j === i ? v : y)))} />}
        </div>
      ))}
      <button type="button" className="small" onClick={() => { onChange([...value, spec.make(w, value.length + 1)]); setOpen(value.length); }}>＋ {spec.add}</button>
    </div>
  );
}

/** ID로 묶인 표: 장소·인물을 골라 더하고, 그 아래에서 값을 편집한다 */
export function MapEditor({ spec, value, w, onChange }: { spec: MapSpec; value: Record<string, unknown>; w: WorldPackage; onChange: (v: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const opts = refOptions(w, spec.of);
  const keys = Object.keys(value);
  const drop = (k: string) => { const n = { ...value }; delete n[k]; onChange(n); };
  return (
    <div className="struct-list">
      {keys.length === 0 && <p className="small muted">아직 없습니다.</p>}
      {keys.map((k) => (
        <div key={k} className="struct-item">
          <div className="struct-item-head">
            <button type="button" className="struct-item-title" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>{open === k ? '▾' : '▸'} {opts.find(([v]) => v === k)?.[1] ?? `⚠ 없는 것: ${k}`}</button>
            <button type="button" className="icon" aria-label={`${k} 지우기`} title="지우기" onClick={() => { drop(k); setOpen(null); }}>🗑</button>
          </div>
          {open === k && (spec.list
            ? <ListEditor spec={spec.list} value={Array.isArray(value[k]) ? (value[k] as Rec[]) : []} w={w} onChange={(v) => onChange({ ...value, [k]: v })} />
            : <Fields fields={spec.fields ?? []} value={(value[k] as Rec) ?? {}} w={w} onChange={(v) => onChange({ ...value, [k]: v })} />)}
        </div>
      ))}
      <select value="" aria-label={spec.add} onChange={(e) => { const k = e.target.value; if (!k) return; onChange({ ...value, [k]: spec.make() }); setOpen(k); }}>
        <option value="">＋ {spec.add}…</option>{opts.filter(([v]) => !keys.includes(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

/**
 * 선택 화면과 JSON을 오가는 칸. JsonField와 같은 값을 주고받으므로 그대로 바꿔 끼울 수 있다.
 * spec: 목록(ListSpec) · 객체 하나(Field[]) · 고르는 목록({ refs })
 */
export function StructField<T>({ label, value, onChange, rows = 8, help, spec, w }: {
  label: string; value: T; onChange: (v: T) => void; rows?: number; help?: string; w: WorldPackage;
  spec: { list: ListSpec } | { fields: Field[] } | { refs: RefKind } | { map: MapSpec };
}) {
  const [json, setJson] = useState(false);
  return (
    <div className="struct-field">
      <div className="struct-head">
        <span className="struct-label">{label}</span>
        <span className="struct-toggle" role="tablist" aria-label="편집 방식">
          <button type="button" role="tab" aria-selected={!json} className={!json ? 'on' : ''} onClick={() => setJson(false)}>선택 화면</button>
          <button type="button" role="tab" aria-selected={json} className={json ? 'on' : ''} onClick={() => setJson(true)}>JSON</button>
        </span>
      </div>
      {json ? <JsonField label="" value={value} onChange={onChange} rows={rows} {...(help ? { help } : {})} />
        : 'list' in spec ? <ListEditor spec={spec.list} value={Array.isArray(value) ? (value as Rec[]) : []} w={w} onChange={(v) => onChange(v as T)} />
        : 'map' in spec ? <MapEditor spec={spec.map} value={value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}} w={w} onChange={(v) => onChange(v as T)} />
        : 'refs' in spec ? <FieldInput f={{ k: '', label: '', t: 'refs', of: spec.refs }} value={value} w={w} onChange={(v) => onChange((v ?? []) as T)} />
        : <Fields fields={spec.fields} value={(value as Rec) ?? {}} w={w} onChange={(v) => onChange(v as T)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 명세

const first = (w: WorldPackage, of: RefKind) => refOptions(w, of)[0]?.[0] ?? '';
const nameOf = (w: WorldPackage, of: RefKind, id: unknown) => refOptions(w, of).find(([v]) => v === id)?.[1].replace(/ \([^)]*\)$/, '') ?? String(id ?? '');

const STACKS: ListSpec = {
  add: '아이템 추가', make: (w) => ({ itemId: first(w, 'items') }), title: (x, w) => `${nameOf(w, 'items', x.itemId)}${x.n ? ` × ${x.n}` : ''}`,
  fields: [{ k: 'itemId', label: '아이템', t: 'ref', of: 'items' }, { k: 'n', label: '개수 (비우면 1)', t: 'num', opt: true }],
};

/** 보상 (임무·의뢰·장면 끝 공용) */
export const REWARD_FIELDS: Field[] = [
  { k: 'xp', label: '경험치', t: 'xp', opt: true, hint: '숫자로 정해도 레벨에 비례한 최소치는 보장됩니다' },
  { k: 'money', label: '돈', t: 'num', opt: true },
  { k: 'items', label: '아이템', t: 'list', opt: true, spec: STACKS },
  { k: 'relationship', label: '관계 변화', t: 'list', opt: true, spec: {
    add: '관계 변화 추가', make: (w) => ({ npcId: first(w, 'characters'), affinity: 5 }), title: (x, w) => `${nameOf(w, 'characters', x.npcId)} ${AXES.filter((a) => x[a]).map((a) => `${AXIS_NAMES[a]} ${Number(x[a]) > 0 ? '+' : ''}${x[a]}`).join(' · ')}`,
    fields: [{ k: 'npcId', label: '인물', t: 'ref', of: 'characters' }, ...AXES.map((a): Field => ({ k: a, label: AXIS_NAMES[a], t: 'num', opt: true }))] } },
  { k: 'reputation', label: '세력 평판', t: 'list', opt: true, spec: {
    add: '평판 변화 추가', make: (w) => ({ factionId: first(w, 'factions'), delta: 5 }), title: (x, w) => `${nameOf(w, 'factions', x.factionId)} ${Number(x.delta) > 0 ? '+' : ''}${x.delta ?? 0}`,
    fields: [{ k: 'factionId', label: '세력', t: 'ref', of: 'factions' }, { k: 'delta', label: '변화', t: 'num' }] } },
  { k: 'cards', label: '전용 카드', t: 'list', opt: true, spec: {
    add: '카드 추가', make: () => ({ who: 'player', cardId: '' }), title: (x) => `${x.who === 'player' ? '주인공' : x.who} ← ${x.cardId || '(카드 ID)'}`,
    fields: [{ k: 'who', label: '받는 쪽 (player 또는 인물 ID)', t: 'text' }, { k: 'cardId', label: '카드 ID', t: 'text' }] } },
];

export const SPEC = {
  starts: { add: '시작 방식 추가', make: (w, n) => ({ id: `start-${n}`, name: '새 시작 방식', description: '', locationId: w.start.locationId, openingScene: '' }), title: (x) => String(x.name ?? ''),
    fields: [{ k: 'id', label: 'ID (영문)', t: 'text' }, { k: 'name', label: '이름', t: 'text' }, { k: 'description', label: '설명 (플레이어에게 보임)', t: 'long' },
      { k: 'locationId', label: '시작 장소', t: 'ref', of: 'locations' }, { k: 'openingScene', label: '첫 장면', t: 'long' },
      { k: 'knows', label: '처음부터 아는 것', t: 'refs', of: 'claims', opt: true }] } as ListSpec,
  discoveries: { add: '발견 추가', make: (w) => ({ claim: first(w, 'claims'), hint: '' }), title: (x, w) => nameOf(w, 'claims', x.claim),
    fields: [{ k: 'claim', label: '알게 되는 것', t: 'ref', of: 'claims' },
      { k: 'check', label: '필요한 판정', t: 'ref', of: 'skills', opt: true, hint: '비우면 살피기만 해도 찾는다' },
      { k: 'hint', label: 'GM에게: 어떻게 하면 발견하는가', t: 'long' },
      { k: 'state', label: '발견했을 때 아는 정도', t: 'enum', opt: true, options: [['confirmed', '확실히 안다'], ['partial', '일부만 안다']] }] } as ListSpec,
  goals: { add: '목표 추가', make: (_w, n) => ({ id: `goal/new-${n}`, text: '', days: 3 }), title: (x) => String(x.text || x.id || ''),
    fields: [{ k: 'id', label: 'ID (goal/… — 세계에서 하나뿐)', t: 'text' }, { k: 'text', label: '무엇을 하려는가', t: 'long' }, { k: 'days', label: '며칠 뒤 이뤄지는가', t: 'num' },
      { k: 'start', label: '시작 조건 (비우면 처음부터)', t: 'cond', opt: true }, { k: 'stop', label: '이 조건이 참이 되면 꺾인다', t: 'cond', opt: true },
      { k: 'effects', label: '이뤄지면 일어나는 일', t: 'effects', opt: true },
      { k: 'announce', label: '이뤄졌을 때 소식', t: 'long', opt: true }, { k: 'stopped', label: '꺾였을 때 소식', t: 'long', opt: true }] } as ListSpec,
  schedule: { add: '일정 추가', make: (w) => ({ from: 8, to: 18, locationId: first(w, 'locations') }), title: (x, w) => `${x.from ?? 0}시 ~ ${x.to ?? 0}시 · ${nameOf(w, 'locations', x.locationId)}`,
    fields: [{ k: 'from', label: '몇 시부터 (0~24)', t: 'num' }, { k: 'to', label: '몇 시까지 (시작보다 작으면 자정을 넘긴다)', t: 'num' }, { k: 'locationId', label: '있는 곳', t: 'ref', of: 'locations' }] } as ListSpec,
  factionActions: { add: '세력 행동 추가', make: () => ({ name: '새 행동', every: 3, effects: [] }), title: (x) => `${x.name ?? ''} · ${x.every ?? 1}일마다`,
    fields: [{ k: 'name', label: '이름', t: 'text' }, { k: 'every', label: '며칠마다 (1 = 매일)', t: 'num' }, { k: 'condition', label: '조건 (비우면 늘)', t: 'cond', opt: true },
      { k: 'effects', label: '일어나는 일', t: 'effects' }, { k: 'news', label: '플레이어에게 들리는 소식 (비우면 조용히)', t: 'long', opt: true }] } as ListSpec,
  relationBeats: { add: '관계 사건 추가', make: (w, n) => ({ id: `beat/new-${n}`, npcId: first(w, 'characters'), name: '새 사건', condition: { all: [] }, hint: '' }), title: (x, w) => `${x.name ?? ''} — ${nameOf(w, 'characters', x.npcId)}`,
    fields: [{ k: 'id', label: 'ID (beat/…)', t: 'text' }, { k: 'npcId', label: '인물', t: 'ref', of: 'characters' }, { k: 'name', label: '이름', t: 'text' },
      { k: 'condition', label: '열리는 조건', t: 'cond' }, { k: 'hint', label: 'GM·인물에게: 장면의 방향', t: 'long' },
      { k: 'scene', label: '이 사건이 펼쳐지는 장면', t: 'ref', of: 'scenes', opt: true }, { k: 'resolveFlag', label: '이 플래그가 서면 닫힌다 (비우면 4턴 뒤)', t: 'ref', of: 'flags', opt: true },
      { k: 'approach', label: '인물이 다른 곳에 있으면', t: 'enum', opt: true, options: [['visit', '플레이어를 찾아온다'], ['message', '전갈을 보낸다'], ['none', '기다린다']] },
      { k: 'message', label: '전갈 내용', t: 'long', opt: true }] } as ListSpec,
  titles: { add: '칭호 추가', make: (_w, n) => ({ id: `title/new-${n}`, name: '새 칭호', condition: { all: [] } }), title: (x) => String(x.name ?? ''),
    fields: [{ k: 'id', label: 'ID (title/…)', t: 'text' }, { k: 'name', label: '이름', t: 'text' }, { k: 'desc', label: '설명', t: 'text', opt: true },
      { k: 'renown', label: '명성', t: 'num', opt: true }, { k: 'condition', label: '얻는 조건', t: 'cond' }] } as ListSpec,
  vars: { add: '세계 수치 추가', make: (_w, n) => ({ id: `var/new-${n}`, name: '새 수치', initial: 50 }), title: (x) => `${x.name ?? ''} (${x.id ?? ''}) — 처음 ${x.initial ?? 0}`,
    fields: [{ k: 'id', label: 'ID (var/…)', t: 'text' }, { k: 'name', label: '이름', t: 'text' }, { k: 'initial', label: '처음 값', t: 'num' },
      { k: 'min', label: '최소 (비우면 0)', t: 'num', opt: true }, { k: 'max', label: '최대 (비우면 100)', t: 'num', opt: true },
      { k: 'visible', label: '플레이어에게 보인다 (수첩·서술 분위기)', t: 'bool' },
      { k: 'labels', label: '단계 이름', t: 'pairs', opt: true, numLabel: '이 값 이상이면', textLabel: '이름', add: '단계 추가', hint: '값이 그 숫자 이상이면 그 이름으로 불린다. 예: 0 무법 · 40 불안 · 70 평온 (작은 값부터)' },
      { k: 'poles', label: '기류 축의 양 끝 (선택)', t: 'poles', opt: true, hint: '이 수치가 세계의 방향을 가르는 축이면 양 끝의 이름 — 예: 봉인 수호 ↔ 봉인 해방. 선택지가 이 축을 움직인다 (v0.113)' }] } as ListSpec,
  phases: { add: '국면 추가', make: (_w, n) => ({ id: `phase/new-${n}`, name: '새 국면', tone: '', enter: { var: 'drama', gte: 7 } }), title: (x) => `${x.name ?? ''} (${x.id ?? ''})`,
    fields: [{ k: 'id', label: 'ID (phase/…)', t: 'text' }, { k: 'name', label: '이름', t: 'text' },
      { k: 'tone', label: '이 국면의 공기 — 서술·GM·선택지의 문체', t: 'long', hint: '예: 숨 막히는 공포. 문장은 짧게, 소리는 멀리서. 사람들은 문을 걸어 잠근다' },
      { k: 'enter', label: '들어가는 조건', t: 'cond', hint: '긴장(drama 0~10)·세계 수치·플래그·임무·결정적 선택… 위의 국면부터 차례로 본다' },
      { k: 'from', label: '이 국면들에서만 올 수 있다 (비우면 어디서든)', t: 'refs', of: 'phases', opt: true },
      { k: 'announce', label: '바뀔 때 알리는 한 줄', t: 'long', opt: true },
      { k: 'tint', label: '화면 강조색', t: 'enum', opt: true, options: [['calm', '차분 (초록)'], ['warm', '따뜻 (주황)'], ['tense', '불안 (노랑)'], ['dark', '어둠 (붉음)'], ['bright', '맑음 (파랑)']] },
      { k: 'music', label: '음악', t: 'enum', opt: true, options: [['calm', '잔잔하게 (장르 기본)'], ['tense', '불안하게'], ['dark', '어둡게'], ['combat', '격렬하게']] },
      { k: 'gmStyle', label: '이 국면의 GM 스타일 (비우면 세계 설정)', t: 'enum', opt: true, options: GM_STYLES.map((g) => [g.id, `${g.emoji} ${g.name}`] as const) },
      { k: 'attitudes', label: '이 국면의 인물 태도', t: 'textmap', of: 'characters', add: '인물 추가', textLabel: '이 국면에서 어떤가', opt: true },
      { k: 'closed', label: '이 국면에는 갈 수 없는 장소', t: 'refs', of: 'locations', opt: true },
      { k: 'effects', label: '들어올 때 일어나는 일', t: 'effects', opt: true }] } as ListSpec,
  storylets: { add: '갈래 카드 추가', make: (_w, n) => ({ id: `card/new-${n}`, title: '새 카드', situation: '', options: [{ id: 'a', label: '', stake: 'escalate' }, { id: 'b', label: '', stake: 'defuse' }] }),
    title: (x) => `${x.title ?? ''}${Array.isArray(x.tags) && x.tags.length ? ` [${(x.tags as string[]).join(',')}]` : ''} — 갈림길 ${Array.isArray(x.options) ? x.options.length : 0}`,
    fields: [{ k: 'id', label: 'ID (card/…)', t: 'text' }, { k: 'title', label: '제목', t: 'text' },
      { k: 'situation', label: '상황 — 서술자가 펼칠 장면 (누가 · 어디서 · 무엇이 걸려 있나, 플레이어에게 보이는 일만)', t: 'long' },
      { k: 'when', label: '덱에 들어오는 조건 (비우면 늘)', t: 'cond', opt: true, hint: '국면·긴장·관계·임무의 지금 단계·다른 카드에서 고른 길… 플레이어가 만든 상황을 조건으로 걸수록 선택이 이야기를 가른다' },
      { k: 'phases', label: '이 국면들의 덱에만 (비우면 모든 국면)', t: 'refs', of: 'phases', opt: true },
      { k: 'locationId', label: '이 장소에서만 (비우면 어디서나)', t: 'ref', of: 'locations', opt: true },
      { k: 'tags', label: '표시', t: 'refs', of: 'cardTags', opt: true },
      { k: 'quest', label: '속한 임무 (선택)', t: 'ref', of: 'quests', opt: true },
      { k: 'weight', label: '뽑힐 무게 (비우면 조건 있는 카드 2 · 없는 카드 1)', t: 'num', opt: true },
      { k: 'repeat', label: '다시 나올 수 있다', t: 'obj', opt: true, fields: [{ k: 'after', label: '고른 뒤 몇 턴이 지나면 (비우면 한 번만)', t: 'num', opt: true }] },
      { k: 'text', label: 'AI 없이 진행할 때 보여 줄 글 (체험판, 선택)', t: 'long', opt: true },
      { k: 'options', label: '갈림길 (2~4개 — 갈림길마다 다른 것을 건다)', t: 'list', spec: {
        add: '갈림길 추가', make: (_w, n) => ({ id: String.fromCharCode(97 + Math.min(25, n - 1)), label: '' }), title: (x, w) => `${x.label || '(글 없음)'}${x.stake ? ` · ${refOptions(w, 'stakes').find(([v]) => v === x.stake)?.[1] ?? x.stake}` : ''}`,
        fields: [{ k: 'id', label: 'ID (영문, 카드 안에서 하나뿐)', t: 'text' }, { k: 'label', label: '선택지의 뼈대 (AI가 장면에 맞게 다듬는다)', t: 'text' },
          { k: 'stake', label: '걸린 것 (엔진이 결과를 적용한다)', t: 'ref', of: 'stakes', opt: true },
          { k: 'check', label: '판정 (비우면 판정 없이 성공)', t: 'obj', opt: true, fields: [{ k: 'skill', label: '기술', t: 'ref', of: 'skills' }, { k: 'dc', label: '난이도', t: 'enum', options: [['very_easy', '아주 쉬움 (5)'], ['easy', '쉬움 (10)'], ['medium', '보통 (15)'], ['hard', '어려움 (20)'], ['very_hard', '아주 어려움 (25)']] }] },
          { k: 'success', label: '성공·대가 있는 성공에 일어나는 일', t: 'effects', opt: true },
          { k: 'cost', label: '대가 (비우면 엔진이 고른다)', t: 'effects', opt: true },
          { k: 'fail', label: '실패해도 일어나는 일 (비우면 엔진이 고른 전개)', t: 'effects', opt: true },
          { k: 'successText', label: '결과 글 — 성공 (체험판·기록, 선택)', t: 'long', opt: true },
          { k: 'failText', label: '결과 글 — 실패 (선택)', t: 'long', opt: true },
          { k: 'fallout', label: '후폭풍: 몇 턴 뒤 이 카드가 반드시 펼쳐진다', t: 'list', opt: true, spec: {
            add: '후폭풍 추가', make: (w) => ({ inTurns: 2, storylet: w.storylets?.[0]?.id ?? '' }), title: (x, w) => `${x.inTurns ?? 1}턴 뒤 → ${refOptions(w, 'storylets').find(([v]) => v === x.storylet)?.[1] ?? x.storylet}`,
            fields: [{ k: 'inTurns', label: '몇 턴 뒤', t: 'num' }, { k: 'storylet', label: '펼쳐질 카드', t: 'ref', of: 'storylets' }] } }] } }] } as ListSpec,
  approaches: { add: '접근법 추가', make: () => ({ hint: '' }), title: (x) => String(x.hint ?? ''),
    fields: [{ k: 'hint', label: 'GM에게: 이런 길도 있다', t: 'long' }, { k: 'skills', label: '쓰이는 기술', t: 'refs', of: 'skills', opt: true }, { k: 'risk', label: '위험', t: 'text', opt: true }] } as ListSpec,
  outcomes: { add: '결과 추가', make: (_w, n) => ({ id: `outcome-${n}`, name: '새 결과', when: { all: [] } }), title: (x) => String(x.name ?? ''),
    fields: [{ k: 'id', label: 'ID (영문)', t: 'text' }, { k: 'name', label: '이름', t: 'text' }, { k: 'when', label: '이 결과가 되는 조건', t: 'cond' },
      { k: 'text', label: '플레이어에게 보이는 한 줄', t: 'long', opt: true }, { k: 'effects', label: '일어나는 일', t: 'effects', opt: true },
      { k: 'rewards', label: '추가 보상', t: 'obj', opt: true, fields: REWARD_FIELDS }] } as ListSpec,
  awaken: { add: '각성 단계 추가', make: () => ({ condition: { all: [] }, name: '새 단계' }), title: (x) => String(x.name ?? ''),
    fields: [{ k: 'name', label: '각성한 이름', t: 'text' }, { k: 'condition', label: '각성 조건', t: 'cond' }, { k: 'text', label: '각성할 때 보이는 글', t: 'long', opt: true },
      { k: 'bonus', label: '보너스', t: 'obj', opt: true, fields: [{ k: 'attack', label: '명중', t: 'num', opt: true }, { k: 'damage', label: '피해', t: 'num', opt: true }, { k: 'ac', label: '방어도', t: 'num', opt: true }, { k: 'save', label: '내성', t: 'num', opt: true }] }] } as ListSpec,
  randomEvents: { add: '돌발 사건 추가', make: (_w, n) => ({ id: `rand/new-${n}`, name: '새 사건', text: '', kind: 'news' }), title: (x) => `${x.name ?? ''} · ${({ ambush: '기습', meeting: '만남', news: '소문', opportunity: '기회' } as Rec)[String(x.kind)] ?? ''}`,
    fields: [{ k: 'id', label: 'ID (rand/…)', t: 'text' }, { k: 'name', label: '이름', t: 'text' }, { k: 'text', label: '플레이어에게 보이는 한 줄', t: 'long' },
      { k: 'kind', label: '종류', t: 'enum', options: [['ambush', '기습 — 적이 나타난다'], ['meeting', '만남 — 누군가 다가온다'], ['news', '소문·소식'], ['opportunity', '뜻밖의 기회']] },
      { k: 'where', label: '일어나는 장소 (비우면 어디서나)', t: 'refs', of: 'locations', opt: true }, { k: 'dangerous', label: '위험한 곳(조우가 있는 장소)에서만', t: 'bool' },
      { k: 'weight', label: '나올 무게 (비우면 1)', t: 'num', opt: true }, { k: 'cooldownDays', label: '다시 일어나기까지 며칠 (비우면 1)', t: 'num', opt: true },
      { k: 'condition', label: '조건 (비우면 늘)', t: 'cond', opt: true }, { k: 'effects', label: '일어나는 일', t: 'effects', opt: true },
      { k: 'enemies', label: '기습의 적 (비우면 장르·레벨에 맞게)', t: 'list', opt: true, hint: '목록 아래쪽의 "인물: …"을 고르면 그 인물이 자기 직업·레벨·능력치로 적이 된다', spec: {
        add: '적 추가', make: (w) => ({ monsterId: first(w, 'foes'), zone: 2 }), title: (x, w) => `${nameOf(w, 'foes', x.monsterId)} · ${x.zone === 3 ? '후열' : '전열'}`,
        fields: [{ k: 'monsterId', label: '적 (적 목록 또는 이 세계의 인물)', t: 'ref', of: 'foes' }, { k: 'zone', label: '자리', t: 'enum', asNumber: true, options: [['2', '전열'], ['3', '후열']] }] } }] } as ListSpec,
  shops: { of: 'locations', add: '상점을 둘 장소', make: () => ({ name: '상점', items: [] }),
    fields: [{ k: 'name', label: '상점 이름', t: 'text' }, { k: 'items', label: '파는 물건', t: 'refs', of: 'items' }, { k: 'factionId', label: '세력 (평판에 따라 값이 바뀐다)', t: 'ref', of: 'factions', opt: true },
      { k: 'buys', label: '플레이어의 물건을 사 준다', t: 'bool', dflt: true }] } as MapSpec,
  pickups: { of: 'locations', add: '주울 것이 있는 장소', make: () => [],
    list: { add: '주울 것 추가', make: (w) => ({ itemId: first(w, 'items'), hint: '' }), title: (x, w) => `${nameOf(w, 'items', x.itemId)}${x.n ? ` × ${x.n}` : ''}`,
      fields: [{ k: 'itemId', label: '아이템', t: 'ref', of: 'items' }, { k: 'n', label: '개수 (비우면 1)', t: 'num', opt: true }, { k: 'hint', label: 'GM에게: 어디에 어떻게 있는가', t: 'long' }] } } as MapSpec,
  gives: { of: 'characters', add: '물건을 건넬 인물', make: () => [],
    list: { add: '건넬 것 추가', make: (w) => ({ itemId: first(w, 'items') }), title: (x, w) => `${nameOf(w, 'items', x.itemId)}${x.n ? ` × ${x.n}` : ''}${x.condition ? ' (조건 있음)' : ''}`,
      fields: [{ k: 'itemId', label: '아이템', t: 'ref', of: 'items' }, { k: 'n', label: '개수 (비우면 1)', t: 'num', opt: true }, { k: 'condition', label: '건네는 조건 (비우면 만나면 바로)', t: 'cond', opt: true }] } } as MapSpec,
  loot: [{ k: 'money', label: '돈', t: 'num', opt: true }, { k: 'items', label: '아이템', t: 'list', opt: true, spec: STACKS }] as Field[],
  stacks: STACKS,
};
