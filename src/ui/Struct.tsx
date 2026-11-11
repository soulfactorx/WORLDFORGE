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

export type RefKind = 'locations' | 'characters' | 'claims' | 'factions' | 'scenes' | 'encounters' | 'quests' | 'items' | 'monsters' | 'flags' | 'skills';
type Base = { k: string; label: string; hint?: string; /** 비우면 칸 자체를 지운다 */ opt?: boolean };
export type Field =
  | (Base & { t: 'text' | 'long' | 'num' })
  | (Base & { t: 'bool'; dflt?: boolean })
  | (Base & { t: 'enum'; options: (readonly [string, string])[] })
  | (Base & { t: 'ref'; of: RefKind })
  | (Base & { t: 'refs'; of: RefKind })
  | (Base & { t: 'cond' })
  | (Base & { t: 'effects' })
  | (Base & { t: 'obj'; fields: Field[] })
  | (Base & { t: 'list'; spec: ListSpec });
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
    case 'flags': return (w.flags ?? []).map((f) => [f.id, f.id] as const);
    case 'skills': return (Object.keys(SKILLS) as SkillId[]).map((k) => [k, `${SKILLS[k].name} (${k})`] as const);
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
    case 'enum': return <label>{f.label}{hint}<select value={(value as string) ?? ''} onChange={(e) => out(e.target.value)}>
      {(f.opt || !f.options.some(([v]) => v === value)) && <option value="">{f.opt ? '(기본)' : '(고르세요)'}</option>}
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

/**
 * 선택 화면과 JSON을 오가는 칸. JsonField와 같은 값을 주고받으므로 그대로 바꿔 끼울 수 있다.
 * spec: 목록(ListSpec) · 객체 하나(Field[]) · 고르는 목록({ refs })
 */
export function StructField<T>({ label, value, onChange, rows = 8, help, spec, w }: {
  label: string; value: T; onChange: (v: T) => void; rows?: number; help?: string; w: WorldPackage;
  spec: { list: ListSpec } | { fields: Field[] } | { refs: RefKind };
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
  { k: 'xp', label: '경험치', t: 'enum', opt: true, options: [['minor', '작은 보상 (레벨에 맞춰)'], ['major', '큰 보상 (레벨에 맞춰)']], hint: '정해진 숫자로 주려면 JSON에서 "xp": 100처럼 적습니다' },
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
      { k: 'min', label: '최소 (비우면 0)', t: 'num', opt: true }, { k: 'max', label: '최대 (비우면 100)', t: 'num', opt: true }] } as ListSpec,
  events: { add: '연표 사건 추가', make: (_w, n) => ({ id: `event/new-${n}`, name: '새 사건', when: { day: 3 }, effects: [] }), title: (x) => `${x.name ?? ''}${(x.when as Rec | undefined)?.day !== undefined ? ` · ${(x.when as Rec).day}일째` : ''}`,
    fields: [{ k: 'id', label: 'ID (event/…)', t: 'text' }, { k: 'name', label: '이름', t: 'text' },
      { k: 'when', label: '언제 일어나는가', t: 'obj', hint: '날 수와 조건을 함께 적으면 둘 다 맞아야 한다. 달력 날짜(date)는 JSON에서 적는다', fields: [{ k: 'day', label: '시작 후 며칠째', t: 'num', opt: true }, { k: 'condition', label: '조건', t: 'cond', opt: true }] },
      { k: 'unless', label: '이 조건이 참이면 일어나지 않는다', t: 'cond', opt: true }, { k: 'effects', label: '일어나는 일', t: 'effects' },
      { k: 'announce', label: '플레이어에게 보이는 소식 (비우면 조용히)', t: 'long', opt: true }] } as ListSpec,
  approaches: { add: '접근법 추가', make: () => ({ hint: '' }), title: (x) => String(x.hint ?? ''),
    fields: [{ k: 'hint', label: 'GM에게: 이런 길도 있다', t: 'long' }, { k: 'skills', label: '쓰이는 기술', t: 'refs', of: 'skills', opt: true }, { k: 'risk', label: '위험', t: 'text', opt: true }] } as ListSpec,
  outcomes: { add: '결과 추가', make: (_w, n) => ({ id: `outcome-${n}`, name: '새 결과', when: { all: [] } }), title: (x) => String(x.name ?? ''),
    fields: [{ k: 'id', label: 'ID (영문)', t: 'text' }, { k: 'name', label: '이름', t: 'text' }, { k: 'when', label: '이 결과가 되는 조건', t: 'cond' },
      { k: 'text', label: '플레이어에게 보이는 한 줄', t: 'long', opt: true }, { k: 'effects', label: '일어나는 일', t: 'effects', opt: true },
      { k: 'rewards', label: '추가 보상', t: 'obj', opt: true, fields: REWARD_FIELDS }] } as ListSpec,
  awaken: { add: '각성 단계 추가', make: () => ({ condition: { all: [] }, name: '새 단계' }), title: (x) => String(x.name ?? ''),
    fields: [{ k: 'name', label: '각성한 이름', t: 'text' }, { k: 'condition', label: '각성 조건', t: 'cond' }, { k: 'text', label: '각성할 때 보이는 글', t: 'long', opt: true },
      { k: 'bonus', label: '보너스', t: 'obj', opt: true, fields: [{ k: 'attack', label: '명중', t: 'num', opt: true }, { k: 'damage', label: '피해', t: 'num', opt: true }, { k: 'ac', label: '방어도', t: 'num', opt: true }, { k: 'save', label: '내성', t: 'num', opt: true }] }] } as ListSpec,
  loot: [{ k: 'money', label: '돈', t: 'num', opt: true }, { k: 'items', label: '아이템', t: 'list', opt: true, spec: STACKS }] as Field[],
  stacks: STACKS,
};
