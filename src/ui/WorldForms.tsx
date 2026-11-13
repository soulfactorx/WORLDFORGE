import { traitsFor } from '../engine/traits';
import { UNSET_CONDITION } from '../engine/scenario';
/**
 * 나머지 편집 폼 (R8 마무리): 줄기·결정적 선택·진행 시계·연표 사건·아이템·세계만의 적·의뢰판.
 * 조건은 조건 빌더, 효과는 효과 편집기로. 고급 항목은 각 탭의 JSON 보기로.
 */
import { MONSTERS, monsterTable } from '../engine/combat/monsters';
import { allItems } from '../engine/items';
import { AXES, AXIS_NAMES, RELATION_KIND_LABEL } from '../engine/relationship';
import { QUEST_TYPE_LABEL } from '../engine/scenario';
import {
  type Arc, type Chapter, type Clock, type CustomMonster, type DecisiveChoice, type ItemDef, type Job, type MonsterAttack, type MonsterSpecial, QUEST_TYPES, type StoryEffect, type WorldEvent, type WorldPackage,
} from '../engine/schema';
import { ConditionField } from './ConditionEditor';
import { Area, ItemList, JsonField, Num, Select, Text } from './form';
import { SPEC, StructField } from './Struct';
import { ALL_CARDS } from '../engine/combat/combat';

type Set = (patch: Partial<WorldPackage>) => void;
const opts = (list: { id: string; name?: string; statement?: string }[] | undefined) => (list ?? []).map((i) => [i.id, `${i.name ?? i.statement?.slice(0, 30) ?? ''} (${i.id})`] as const);

// ---------------------------------------------------------------- 효과

type FxKind = 'setFlag' | 'moveNpc' | 'killNpc' | 'reveal' | 'relationship' | 'reputation' | 'clock' | 'giveItem' | 'takeItem' | 'money' | 'var' | 'npcRelation' | 'trait' | 'startScene' | 'startEncounter' | 'moveTo';
const FX_LABEL: Record<FxKind, string> = {
  setFlag: '플래그 세우기', moveNpc: '인물 옮기기', killNpc: '인물 죽음', reveal: '플레이어가 알게 됨', relationship: '관계 변화', reputation: '세력 평판',
  clock: '시계 칸 바꾸기', giveItem: '아이템 주기', takeItem: '아이템 빼앗기', money: '돈', var: '세계 수치 바꾸기', npcRelation: '인물끼리 관계 바꾸기', trait: '주인공 성향 움직이기',
  startScene: '장면으로 이어진다', startEncounter: '전투로 이어진다', moveTo: '플레이어를 옮긴다',
};
const fxKind = (e: StoryEffect): FxKind => (Object.keys(FX_LABEL) as FxKind[]).find((k) => k in e)!;
function blankFx(k: FxKind, w: WorldPackage): StoryEffect {
  const f = <T extends { id: string }>(l: T[] | undefined) => l?.[0]?.id ?? '';
  switch (k) {
    case 'setFlag': return { setFlag: f(w.flags) };
    case 'moveNpc': return { moveNpc: f(w.characters), to: f(w.locations) };
    case 'killNpc': return { killNpc: f(w.characters) };
    case 'reveal': return { reveal: f(w.claims), state: 'rumor' };
    case 'relationship': return { relationship: f(w.characters), delta: { trust: 5 } };
    case 'reputation': return { reputation: f(w.factions), delta: 5 };
    case 'clock': return { clock: f(w.clocks), by: 1 };
    case 'giveItem': return { giveItem: allItems(w)[0]?.id ?? '' };
    case 'takeItem': return { takeItem: allItems(w)[0]?.id ?? '' };
    case 'money': return { money: 10 };
    case 'var': return { var: f(w.vars), add: -10 };
    case 'trait': return { trait: traitsFor(w)[0]?.id ?? '', add: 5 };
    case 'npcRelation': return { npcRelation: f(w.characters), with: w.characters[1]?.id ?? f(w.characters), kind: 'rival' };
    case 'startScene': return { startScene: f(w.scenes) };
    case 'startEncounter': return { startEncounter: f(w.encounters) };
    case 'moveTo': return { moveTo: f(w.locations) };
  }
}

const S = ({ value, options, onChange }: { value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}>
    {!options.some((o) => o[0] === value) && <option value={value}>{value || '(선택)'}</option>}
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);
const N = ({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) => <input type="number" className="num" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || 0)} />;

export function EffectsEditor({ label, value, w, onChange }: { label: string; value: StoryEffect[] | undefined; w: WorldPackage; onChange: (v: StoryEffect[]) => void }) {
  const list = value ?? [];
  const up = (i: number, e: StoryEffect) => onChange(list.map((x, j) => (j === i ? e : x)));
  const items = allItems(w).map((i) => [i.id, `${i.name} (${i.id})`] as const);
  return (
    <fieldset className="cond-field">
      <legend>{label}</legend>
      {list.map((e, i) => {
        const k = fxKind(e);
        const x = e as Record<string, unknown>;
        return (
          <div key={i} className="cond-child">
            <div className="cond">
              <S value={k} options={(Object.keys(FX_LABEL) as FxKind[]).map((kk) => [kk, FX_LABEL[kk]] as const)} onChange={(v) => up(i, blankFx(v as FxKind, w))} />
              {k === 'setFlag' && <S value={x.setFlag as string} options={(w.flags ?? []).map((f) => [f.id, f.id] as const)} onChange={(v) => up(i, { setFlag: v })} />}
              {k === 'moveNpc' && <><S value={x.moveNpc as string} options={opts(w.characters)} onChange={(v) => up(i, { ...x, moveNpc: v } as StoryEffect)} /> → <S value={x.to as string} options={opts(w.locations)} onChange={(v) => up(i, { ...x, to: v } as StoryEffect)} /></>}
              {k === 'killNpc' && <S value={x.killNpc as string} options={opts(w.characters)} onChange={(v) => up(i, { killNpc: v })} />}
              {k === 'reveal' && <><S value={x.reveal as string} options={opts(w.claims)} onChange={(v) => up(i, { ...x, reveal: v } as StoryEffect)} /><S value={(x.state as string) ?? 'rumor'} options={[['rumor', '소문으로'], ['partial', '들은 이야기로'], ['confirmed', '확실하게']]} onChange={(v) => up(i, { ...x, state: v } as StoryEffect)} /></>}
              {k === 'relationship' && (() => {
                const d = x.delta as Record<string, number>;
                const axis = Object.keys(d)[0] ?? 'trust';
                return <><S value={x.relationship as string} options={opts(w.characters)} onChange={(v) => up(i, { ...x, relationship: v } as StoryEffect)} /><S value={axis} options={AXES.map((a) => [a, AXIS_NAMES[a]] as const)} onChange={(v) => up(i, { ...x, delta: { [v]: d[axis] ?? 5 } } as StoryEffect)} /><N value={d[axis]} onChange={(v) => up(i, { ...x, delta: { [axis]: v } } as StoryEffect)} /></>;
              })()}
              {k === 'reputation' && <><S value={x.reputation as string} options={opts(w.factions)} onChange={(v) => up(i, { ...x, reputation: v } as StoryEffect)} /><N value={x.delta as number} onChange={(v) => up(i, { ...x, delta: v } as StoryEffect)} /></>}
              {k === 'clock' && <><S value={x.clock as string} options={opts(w.clocks)} onChange={(v) => up(i, { ...x, clock: v } as StoryEffect)} /> 칸 <N value={x.by as number} onChange={(v) => up(i, { ...x, by: v } as StoryEffect)} /></>}
              {(k === 'giveItem' || k === 'takeItem') && <><S value={x[k] as string} options={items} onChange={(v) => up(i, { ...x, [k]: v } as StoryEffect)} /> × <N value={(x.n as number) ?? 1} onChange={(v) => up(i, { ...x, n: v } as StoryEffect)} /></>}
              {k === 'money' && <N value={x.money as number} onChange={(v) => up(i, { money: v })} />}
              {k === 'startScene' && <S value={x.startScene as string} options={opts(w.scenes)} onChange={(v) => up(i, { startScene: v })} />}
              {k === 'startEncounter' && <S value={x.startEncounter as string} options={opts(w.encounters)} onChange={(v) => up(i, { startEncounter: v })} />}
              {k === 'moveTo' && <S value={x.moveTo as string} options={opts(w.locations)} onChange={(v) => up(i, { moveTo: v })} />}
              {k === 'trait' && <><S value={x.trait as string} options={traitsFor(w).map((t) => [t.id, `${t.name} (${t.low}↔${t.high})`] as const)} onChange={(v) => up(i, { ...x, trait: v } as StoryEffect)} /> <N value={x.add as number} onChange={(v) => up(i, { trait: x.trait, add: v ?? 0 } as StoryEffect)} /> <span className="small muted">(+면 {traitsFor(w).find((t) => t.id === x.trait)?.high ?? '높은 쪽'}, -면 {traitsFor(w).find((t) => t.id === x.trait)?.low ?? '낮은 쪽'})</span></>}
              {k === 'var' && <><S value={x.var as string} options={opts(w.vars)} onChange={(v) => up(i, { ...x, var: v } as StoryEffect)} /><S value={x.set !== undefined ? 'set' : 'add'} options={[['add', '더하기'], ['set', '정하기']]} onChange={(v) => up(i, (v === 'set' ? { var: x.var, set: (x.add as number) ?? 50 } : { var: x.var, add: (x.set as number) ?? 10 }) as StoryEffect)} /><N value={(x.set ?? x.add) as number} onChange={(v) => up(i, (x.set !== undefined ? { var: x.var, set: v ?? 0 } : { var: x.var, add: v ?? 0 }) as StoryEffect)} /></>}
              {k === 'npcRelation' && <><S value={x.npcRelation as string} options={opts(w.characters)} onChange={(v) => up(i, { ...x, npcRelation: v } as StoryEffect)} /> ↔ <S value={x.with as string} options={opts(w.characters)} onChange={(v) => up(i, { ...x, with: v } as StoryEffect)} /><S value={x.kind as string} options={[...Object.entries(RELATION_KIND_LABEL), ['none', '관계 끊김']] as [string, string][]} onChange={(v) => up(i, { ...x, kind: v } as StoryEffect)} /></>}
            </div>
            <button type="button" className="small" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      <button type="button" className="small" onClick={() => onChange([...list, blankFx('setFlag', w)])}>＋ 효과 추가</button>
    </fieldset>
  );
}

// ---------------------------------------------------------------- 이야기 흐름

export function ArcForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<Arc> title="줄기" items={w.arcs ?? []} onChange={(arcs) => set({ arcs })}
      make={(n) => ({ id: `arc/new-${n}`, name: '새 이야기', kind: 'main', start: (w.arcs ?? []).length ? { arcDone: w.arcs!.at(-1)!.id } : { all: [] }, chapters: [{ name: '1장', goal: '', complete: UNSET_CONDITION }] })}
      render={(a, up) => (
        <div className="form-grid">
          <Text label="ID" value={a.id} onChange={(id) => up({ id })} />
          <Text label="이름" value={a.name} onChange={(name) => up({ name })} />
          <Select label="종류" value={a.kind} options={[['main', '메인 줄기'], ['faction', '세력 줄기'], ['character', '인물 줄기']] as const} onChange={(kind) => up({ kind })} />
          <ConditionField label="시작 조건 (2부라면: 앞 줄기가 끝남)" value={a.start} world={w} onChange={(start) => up({ start: start ?? { all: [] } })} />
          {a.chapters.map((ch, i) => {
            const upCh = (p: Partial<typeof ch>) => up({ chapters: a.chapters.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <fieldset key={i} className="stage-box"><legend>{i + 1}장</legend>
                <Text label="장 이름" value={ch.name} onChange={(name) => upCh({ name })} />
                <Area label="GM 목표 (이 장에서 일어나야 할 일)" value={ch.goal} onChange={(goal) => upCh({ goal })} rows={2} />
                <Text label="수첩에 보이는 한 줄 (비밀 누설 금지)" value={ch.summary} onChange={(summary) => upCh({ summary: summary || undefined })} />
                <ConditionField label="끝나는 조건" value={ch.complete} world={w} completion onChange={(complete) => upCh({ complete: complete ?? UNSET_CONDITION })} />
                <ConditionField label="실패 조건 (줄기가 실패로 끝남)" value={ch.fail} world={w} optional onChange={(fail) => upCh({ fail })} />
                <ChapterXp value={ch.xp} onChange={(xp) => upCh({ xp })} />
                <EffectsEditor label="장을 끝냈을 때" value={ch.effects} w={w} onChange={(effects) => upCh({ effects: effects.length ? effects : undefined })} />
                {a.chapters.length > 1 && <button type="button" className="small" onClick={() => up({ chapters: a.chapters.filter((_, j) => j !== i) })}>장 삭제</button>}
              </fieldset>
            );
          })}
          <button type="button" className="small" onClick={() => up({ chapters: [...a.chapters, { name: `${a.chapters.length + 1}장`, goal: '', complete: UNSET_CONDITION }] })}>＋ 장 추가</button>
        </div>
      )} />
  );
}

/** 장 보상 경험치 (v0.57.3) */
function ChapterXp({ value, onChange }: { value: Chapter['xp']; onChange: (v: Chapter['xp']) => void }) {
  const mode = value === undefined || value === 'chapter' ? 'chapter' : value === 'major' || value === 'minor' ? value : value === 0 ? 'none' : 'num';
  return (
    <div className="row">
      <label>장을 끝냈을 때 경험치
        <select value={mode} onChange={(e) => { const m = e.target.value; onChange(m === 'chapter' ? undefined : m === 'none' ? 0 : m === 'num' ? 100 : (m as 'major' | 'minor')); }}>
          <option value="chapter">다음 레벨까지 필요한 만큼 (기본 — 장마다 1레벨)</option>
          <option value="major">큰 보상 (다음 레벨까지의 약 25%)</option>
          <option value="minor">작은 보상 (약 10%)</option>
          <option value="num">직접 숫자</option>
          <option value="none">없음</option>
        </select>
      </label>
      {mode === 'num' && <label>경험치<input type="number" min={1} value={typeof value === 'number' ? value : 100} onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))} /></label>}
    </div>
  );
}

export function ChoiceForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<DecisiveChoice> title="결정적 선택" testKind="choice" items={w.choices ?? []} onChange={(choices) => set({ choices })}
      make={(n) => ({ id: `choice/new-${n}`, name: '새 결정', prompt: '무엇을 할 것인가?', when: { all: [] }, options: [{ id: 'a', text: '첫째 길', effects: [] }, { id: 'b', text: '둘째 길', effects: [] }] })}
      render={(c, up) => (
        <div className="form-grid">
          <Text label="ID" value={c.id} onChange={(id) => up({ id })} />
          <Text label="이름" value={c.name} onChange={(name) => up({ name })} />
          <Area label="플레이어에게 보이는 질문" value={c.prompt} onChange={(prompt) => up({ prompt })} rows={2} />
          <Select label="이 장소에서만" value={c.locationId ?? ''} options={[['', '(어디서나)'], ...opts(w.locations)] as const} onChange={(locationId) => up({ locationId: locationId || undefined })} />
          <ConditionField label="나타나는 조건" value={c.when} world={w} onChange={(when) => up({ when: when ?? { all: [] } })} />
          {c.options.map((o, i) => {
            const upO = (p: Partial<typeof o>) => up({ options: c.options.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <fieldset key={i} className="stage-box"><legend>선택지 {o.id}</legend>
                <Text label="글" value={o.text} onChange={(text) => upO({ text })} />
                <EffectsEditor label="고르면" value={o.effects} w={w} onChange={(effects) => upO({ effects })} />
                {c.options.length > 2 && <button type="button" className="small" onClick={() => up({ options: c.options.filter((_, j) => j !== i) })}>선택지 삭제</button>}
              </fieldset>
            );
          })}
          <button type="button" className="small" onClick={() => up({ options: [...c.options, { id: String.fromCharCode(97 + c.options.length), text: '다른 길', effects: [] }] })}>＋ 선택지 추가</button>
        </div>
      )} />
  );
}

export function ClockForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<Clock> title="진행 시계" items={w.clocks ?? []} onChange={(clocks) => set({ clocks })}
      make={(n) => ({ id: `clock/new-${n}`, name: '다가오는 위협', segments: 6, tick: [{ every: 'beat', by: 1 }], at: [{ segment: 3, omen: '불길한 소문이 돈다.' }, { segment: 6, effects: [] }] })}
      render={(c, up) => {
        const daily = c.tick.find((t): t is { every: 'day' | 'hour' | 'beat'; by: number } => 'every' in t);
        const ons = c.tick.filter((t): t is { on: import('../engine/schema').Condition; by: number } => 'on' in t);
        const setTicks = (d: typeof daily | undefined, o: typeof ons) => up({ tick: [...(d ? [d] : []), ...o] });
        return (
          <div className="form-grid">
            <Text label="ID" value={c.id} onChange={(id) => up({ id })} />
            <Text label="이름 (플레이어가 막지 않으면 다가오는 일)" value={c.name} onChange={(name) => up({ name })} />
            <Num label="칸 수 (1~20)" value={c.segments} onChange={(segments) => up({ segments: segments ?? 6 })} />
            <Num label="처음 칸" value={c.start} onChange={(start) => up({ start })} />
            <label>시간 눈금
              <span className="row">
                <S value={daily?.every ?? ''} options={[['', '(시간으로는 차지 않음)'], ['beat', '턴마다 (권장)'], ['day', '하루마다'], ['hour', '한 시간마다']]} onChange={(v) => setTicks(v ? { every: v as 'day', by: daily?.by ?? 1 } : undefined, ons)} />
                {daily && <><N value={daily.by} onChange={(by) => setTicks({ ...daily, by }, ons)} />칸</>}
              </span>
            </label>
            {ons.map((t, i) => (
              <fieldset key={i} className="stage-box"><legend>사건 눈금 {i + 1} (조건이 처음 참이 될 때 한 번)</legend>
                <ConditionField label="조건" value={t.on} world={w} onChange={(on) => setTicks(daily, ons.map((x, j) => (j === i ? { ...x, on: on ?? { all: [] } } : x)))} />
                <label>칸 바꾸기 <N value={t.by} onChange={(by) => setTicks(daily, ons.map((x, j) => (j === i ? { ...x, by } : x)))} /></label>
                <button type="button" className="small" onClick={() => setTicks(daily, ons.filter((_, j) => j !== i))}>눈금 삭제</button>
              </fieldset>
            ))}
            <button type="button" className="small" onClick={() => setTicks(daily, [...ons, { on: { all: [] }, by: -2 }])}>＋ 사건 눈금 (예: 경고하면 -2칸)</button>
            {c.at.map((a, i) => {
              const upA = (p: Partial<typeof a>) => up({ at: c.at.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <fieldset key={i} className="stage-box"><legend>{a.segment}칸에 이르면</legend>
                  <Num label="칸" value={a.segment} onChange={(segment) => upA({ segment: segment ?? 1 })} />
                  <Text label="플레이어에게 보이는 징조 (비우면 조용히)" value={a.omen} onChange={(omen) => upA({ omen: omen || undefined })} />
                  <EffectsEditor label="효과" value={a.effects} w={w} onChange={(effects) => upA({ effects: effects.length ? effects : undefined })} />
                  <button type="button" className="small" onClick={() => up({ at: c.at.filter((_, j) => j !== i) })}>삭제</button>
                </fieldset>
              );
            })}
            <button type="button" className="small" onClick={() => up({ at: [...c.at, { segment: c.segments }] })}>＋ 칸 사건 추가</button>
          </div>
        );
      }} />
  );
}

export function EventForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<WorldEvent> title="연표 사건" items={w.events ?? []} onChange={(events) => set({ events })}
      make={(n) => ({ id: `event/new-${n}`, name: '새 사건', when: { day: 3 }, effects: [], announce: '📜 소식이 돈다.' })}
      render={(e, up) => (
        <div className="form-grid">
          <Text label="ID" value={e.id} onChange={(id) => up({ id })} />
          <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
          <Num label="며칠째 (시작 후 지난 날)" value={e.when.day} onChange={(day) => up({ when: { ...e.when, day } })} />
          {w.calendar && (
            <label>달력 날짜 (비우면 날 수만)
              <span className="row">
                <N value={e.when.date?.year} onChange={(year) => up({ when: { ...e.when, date: { year, month: e.when.date?.month ?? 1, day: e.when.date?.day ?? 1 } } })} />년
                <N value={e.when.date?.month} onChange={(month) => up({ when: { ...e.when, date: { year: e.when.date?.year ?? w.calendar!.year, month, day: e.when.date?.day ?? 1 } } })} />월
                <N value={e.when.date?.day} onChange={(day) => up({ when: { ...e.when, date: { year: e.when.date?.year ?? w.calendar!.year, month: e.when.date?.month ?? 1, day } } })} />일
                {e.when.date && <button type="button" className="small" onClick={() => up({ when: { ...e.when, date: undefined } })}>지우기</button>}
              </span>
            </label>
          )}
          <ConditionField label="조건 (날짜 대신 또는 함께)" value={e.when.condition} world={w} optional onChange={(condition) => up({ when: { ...e.when, condition } })} />
          <ConditionField label="막히는 조건 (참이면 일어나지 않는다 — 바꿀 수 있는 미래)" value={e.unless} world={w} optional onChange={(unless) => up({ unless })} />
          <EffectsEditor label="일어나면" value={e.effects} w={w} onChange={(effects) => up({ effects })} />
          <Text label="플레이어에게 보이는 소식 (비우면 조용히)" value={e.announce} onChange={(announce) => up({ announce: announce || undefined })} />
        </div>
      )} />
  );
}

// ---------------------------------------------------------------- 아이템

const KIND_OPTS = [['consumable', '소모품'], ['weapon', '무기'], ['armor', '갑옷'], ['shield', '방패'], ['trinket', '장신구'], ['scroll', '비급·주문서'], ['key', '중요한 물건'], ['treasure', '보물'], ['misc', '잡동사니']] as const;
const PLAYER_CARDS = Object.values(ALL_CARDS).filter((c) => c.kind !== 'monster' && c.kind !== 'item' && c.kind !== 'basic');
const RARITY_OPTS = [['common', '일반'], ['uncommon', '고급'], ['rare', '희귀'], ['epic', '영웅'], ['legendary', '유물']] as const;
const WEAPON_CARDS = ['weapon/longsword', 'weapon/shortsword', 'weapon/dagger', 'weapon/mace', 'weapon/shortbow', 'weapon/javelin'];

export function ItemForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<ItemDef> title="아이템" items={w.items ?? []} onChange={(items) => set({ items })}
      make={(n) => ({ id: `item/new-${n}`, name: '새 물건', description: '', kind: 'misc', price: 10 })}
      render={(it, up) => (
        <div className="form-grid">
          <Text label="ID" value={it.id} onChange={(id) => up({ id })} />
          <Text label="이름" value={it.name} onChange={(name) => up({ name })} />
          <Area label="설명" value={it.description} onChange={(description) => up({ description })} rows={2} />
          <Select label="종류" value={it.kind} options={KIND_OPTS} onChange={(kind) => up({ kind })} />
          <Num label="가격 (팔 때는 절반)" value={it.price} onChange={(price) => up({ price })} />
          {it.kind === 'consumable' && <Text label="회복 (주사위, 예: 2d4+2)" value={it.heal} onChange={(heal) => up({ heal: heal || undefined })} />}
          {it.kind === 'consumable' && (
            <label>푸는 상태 이상<span className="stage-checks">{(['poisoned', 'frightened', 'restrained', 'stunned', 'blinded'] as const).map((c) => (
              <label key={c} className="check small"><input type="checkbox" checked={!!it.cures?.includes(c)} onChange={(e) => { const cures = e.target.checked ? [...(it.cures ?? []), c] : (it.cures ?? []).filter((x) => x !== c); up({ cures: cures.length ? cures : undefined }); }} />{{ poisoned: '중독', frightened: '공포', restrained: '포박', stunned: '기절', blinded: '실명' }[c]}</label>
            ))}</span></label>
          )}
          {it.kind === 'weapon' && <Select label="전투 카드" value={it.card ?? ''} options={[['', '(없음)'], ...WEAPON_CARDS.map((c) => [c, c] as const)] as const} onChange={(card) => up({ card: card || undefined })} />}
          {it.kind === 'armor' && <><Num label="갑옷 AC 기본" value={it.armor?.base} onChange={(base) => up({ armor: { ...it.armor, base: base ?? 11 } })} /><Num label="민첩 상한 (비우면 없음)" value={it.armor?.dexMax} onChange={(dexMax) => up({ armor: { base: it.armor?.base ?? 11, ...(dexMax !== undefined ? { dexMax } : {}) } })} /></>}
          {it.kind === 'shield' && <Num label="AC 보너스" value={it.acBonus} onChange={(acBonus) => up({ acBonus })} />}
          <Select label="등급 (전리품 굴림·색)" value={it.rarity ?? 'common'} options={RARITY_OPTS} onChange={(rarity) => up({ rarity: rarity === 'common' ? undefined : rarity })} />
          {['weapon', 'armor', 'shield', 'trinket'].includes(it.kind) && (
            <fieldset className="stage-box"><legend>장비 보너스</legend><div className="ability-grid">
              {it.kind === 'weapon' && <Num label="명중" value={it.bonus?.attack} onChange={(attack) => up({ bonus: { ...it.bonus, attack } })} />}
              {it.kind === 'weapon' && <Num label="피해" value={it.bonus?.damage} onChange={(damage) => up({ bonus: { ...it.bonus, damage } })} />}
              <Num label="AC" value={it.bonus?.ac} onChange={(ac) => up({ bonus: { ...it.bonus, ac } })} />
              <Num label="모든 내성" value={it.bonus?.save} onChange={(save) => up({ bonus: { ...it.bonus, save } })} />
            </div></fieldset>
          )}
          {['weapon', 'armor', 'shield', 'trinket'].includes(it.kind) && <Select label="장비하면 얻는 카드" value={it.cards?.[0] ?? ''} options={[['', '(없음)'], ...PLAYER_CARDS.map((c) => [c.id, `${c.name} (${c.id})`] as const)] as const} onChange={(c) => up({ cards: c ? [c] : undefined })} />}
          {it.kind === 'scroll' && <Select label="익히면 얻는 카드" value={it.teaches ?? ''} options={[['', '(없음)'], ...PLAYER_CARDS.map((c) => [c.id, `${c.name} (${c.id})`] as const)] as const} onChange={(teaches) => up({ teaches: teaches || undefined })} />}
          <StructField w={w} spec={{ list: SPEC.awaken }} label="유물 각성 (조건이 맞을 때마다 한 단계씩 — 비우면 일반 물건)" value={it.awaken ?? []} rows={4}
            help='예: [{ "condition": { "questDone": "quest/x" }, "name": "깨어난 검", "text": "칼날에 빛이 돈다", "bonus": { "attack": 1, "damage": 1 } }, { "condition": { "level": 5 }, "name": "이름을 되찾은 검", "cards": ["weapon/storm_strike"] }]'
            onChange={(a) => up({ awaken: Array.isArray(a) && a.length ? a : undefined })} />
        </div>
      )} />
  );
}

// ---------------------------------------------------------------- 세계만의 적

const ROLE_OPTS = [['minion', '졸개'], ['brute', '돌격'], ['skirmisher', '유격'], ['artillery', '사격'], ['controller', '제어'], ['leader', '지휘'], ['boss', '보스']] as const;
const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ABIL_KO = { str: '근력', dex: '민첩', con: '건강', int: '지능', wis: '지혜', cha: '매력' } as const;
const COND_OPTS = [['', '(없음)'], ['poisoned', '중독'], ['frightened', '공포'], ['restrained', '포박'], ['stunned', '기절'], ['blinded', '실명']] as const;

function AttackRows({ list, onChange }: { list: MonsterAttack[]; onChange: (v: MonsterAttack[]) => void }) {
  const up = (i: number, p: Partial<MonsterAttack>) => onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <>
      {list.map((a, i) => (
        <div key={i} className="cond-child"><div className="cond">
          <input value={a.name} placeholder="이름" onChange={(e) => up(i, { name: e.target.value })} />
          <S value={a.kind} options={[['melee', '근접'], ['ranged', '원거리']]} onChange={(v) => up(i, { kind: v as 'melee' })} />
          명중 +<N value={a.toHit} onChange={(toHit) => up(i, { toHit })} />
          <input className="num" value={a.damage} title="피해 주사위" onChange={(e) => up(i, { damage: e.target.value })} />+<N value={a.bonus} onChange={(bonus) => up(i, { bonus })} />
          <input className="num" value={a.type} title="피해 종류" onChange={(e) => up(i, { type: e.target.value })} />
          ×<N value={a.count ?? 1} onChange={(count) => up(i, { count: count > 1 ? count : undefined })} />
          {a.kind === 'ranged' && <>사거리<N value={a.range ?? 3} onChange={(range) => up(i, { range })} /></>}
          <S value={a.inflict?.condition ?? ''} options={COND_OPTS} onChange={(v) => up(i, { inflict: v ? { condition: v as 'poisoned', save: a.inflict?.save ?? 'con', dc: a.inflict?.dc ?? 12, rounds: a.inflict?.rounds ?? 1 } : undefined })} />
          {a.inflict && <>내성<S value={a.inflict.save} options={ABIL.map((x) => [x, ABIL_KO[x]] as const)} onChange={(v) => up(i, { inflict: { ...a.inflict!, save: v as 'con' } })} />DC<N value={a.inflict.dc} onChange={(dc) => up(i, { inflict: { ...a.inflict!, dc } })} /><N value={a.inflict.rounds} onChange={(rounds) => up(i, { inflict: { ...a.inflict!, rounds } })} />라운드</>}
        </div><button type="button" className="small" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button></div>
      ))}
      <button type="button" className="small" onClick={() => onChange([...list, { name: '공격', kind: 'melee', toHit: 4, damage: '1d8', bonus: 2, type: '참격' }])}>＋ 공격</button>
    </>
  );
}

function SpecialRows({ list, onChange }: { list: MonsterSpecial[]; onChange: (v: MonsterSpecial[]) => void }) {
  const up = (i: number, p: Partial<MonsterSpecial>) => onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <>
      {list.map((s, i) => (
        <div key={i} className="cond-child"><div className="cond">
          <input value={s.name} placeholder="이름" onChange={(e) => up(i, { name: e.target.value })} />
          <S value={s.kind} options={[['save', '한 명'], ['area', '한 존 범위']]} onChange={(v) => up(i, { kind: v as 'save' })} />
          <S value={s.save} options={ABIL.map((x) => [x, `${ABIL_KO[x]} 내성`] as const)} onChange={(v) => up(i, { save: v as 'dex' })} />
          DC<N value={s.dc} onChange={(dc) => up(i, { dc })} />
          <input className="num" value={s.damage} title="피해 주사위" onChange={(e) => up(i, { damage: e.target.value })} />
          <input className="num" value={s.type} title="피해 종류" onChange={(e) => up(i, { type: e.target.value })} />
          사거리<N value={s.range} onChange={(range) => up(i, { range })} />
          횟수<N value={s.uses ?? 0} onChange={(uses) => up(i, { uses: uses > 0 ? uses : undefined })} />
          <S value={s.inflict?.condition ?? ''} options={COND_OPTS} onChange={(v) => up(i, { inflict: v ? { condition: v as 'poisoned', rounds: s.inflict?.rounds ?? 1 } : undefined })} />
          {s.inflict && <><N value={s.inflict.rounds} onChange={(rounds) => up(i, { inflict: { ...s.inflict!, rounds } })} />라운드</>}
        </div><button type="button" className="small" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button></div>
      ))}
      <button type="button" className="small" onClick={() => onChange([...list, { name: '기술', kind: 'save', save: 'dex', dc: 12, damage: '2d6', type: '화염', range: 1, uses: 1 }])}>＋ 기술</button>
    </>
  );
}

export function MonsterForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<CustomMonster> title="적" items={w.monsters ?? []} onChange={(monsters) => set({ monsters: monsters.length ? monsters : undefined })}
      make={(n) => ({ id: `mon/new-${n}`, name: '새 적', look: '', role: 'brute', cr: '1', xp: 200, ac: 13, hp: 30, abilities: { str: 14, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, attacks: [{ name: '공격', kind: 'melee', toHit: 4, damage: '1d8', bonus: 2, type: '참격' }] })}
      render={(m, up) => (
        <div className="form-grid">
          <Text label="ID (mon/…)" value={m.id} onChange={(id) => up({ id })} />
          <Text label="이름" value={m.name} onChange={(name) => up({ name })} />
          <Area label="외형·성격 한 줄 (전투 서술에 쓰임)" value={m.look} onChange={(look) => up({ look })} rows={2} />
          <Select label="역할" value={m.role} options={ROLE_OPTS} onChange={(role) => up({ role })} />
          <Text label="도전 지수" value={m.cr} onChange={(cr) => up({ cr })} />
          <Num label="경험치 (CR 1/4=50·1/2=100·1=200·2=450·3=700·5=1800)" value={m.xp} onChange={(xp) => up({ xp: xp ?? 0 })} />
          <Num label="AC" value={m.ac} onChange={(ac) => up({ ac: ac ?? 10 })} />
          <Num label="HP" value={m.hp} onChange={(hp) => up({ hp: hp ?? 1 })} />
          <div className="ability-grid">{ABIL.map((a) => <Num key={a} label={ABIL_KO[a]} value={m.abilities[a]} onChange={(v) => up({ abilities: { ...m.abilities, [a]: v ?? 10 } })} />)}</div>
          <Num label="이 HP 비율 아래면 도망 (예: 0.3, 비우면 끝까지)" value={m.fleeAt} onChange={(fleeAt) => up({ fleeAt: fleeAt || undefined })} />
          <label className="check"><input type="checkbox" checked={!!m.preferRanged} onChange={(e) => up({ preferRanged: e.target.checked || undefined })} /> 원거리를 좋아함 (후열에 머문다)</label>
          <label className="check"><input type="checkbox" checked={!!m.packTactics} onChange={(e) => up({ packTactics: e.target.checked || undefined })} /> 무리 전술</label>
          <label>면역<span className="stage-checks">{COND_OPTS.slice(1).map(([c, l]) => (
            <label key={c} className="check small"><input type="checkbox" checked={!!m.immune?.includes(c as 'poisoned')} onChange={(e) => { const immune = e.target.checked ? [...(m.immune ?? []), c as 'poisoned'] : (m.immune ?? []).filter((x) => x !== c); up({ immune: immune.length ? immune : undefined }); }} />{l}</label>
          ))}</span></label>
          <fieldset className="cond-field"><legend>공격 (주사위·종류·연격·상태 이상)</legend><AttackRows list={m.attacks} onChange={(attacks) => up({ attacks })} /></fieldset>
          <fieldset className="cond-field"><legend>기술 (내성 피해 · 범위)</legend><SpecialRows list={m.specials ?? []} onChange={(specials) => up({ specials: specials.length ? specials : undefined })} /></fieldset>
          {(m.phases ?? []).map((ph, i) => {
            const upP = (p: Partial<typeof ph>) => up({ phases: m.phases!.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <fieldset key={i} className="stage-box"><legend>보스 단계 {i + 1}</legend>
                <Num label="HP 비율 아래 (0~1)" value={ph.below} onChange={(below) => upP({ below: below ?? 0.5 })} />
                <Text label="대사" value={ph.line} onChange={(line) => upP({ line })} />
                <Num label="AC 변화" value={ph.ac} onChange={(ac) => upP({ ac: ac || undefined })} />
                <AttackRows list={ph.attacks ?? []} onChange={(attacks) => upP({ attacks: attacks.length ? attacks : undefined })} />
                <SpecialRows list={ph.specials ?? []} onChange={(specials) => upP({ specials: specials.length ? specials : undefined })} />
                <button type="button" className="small" onClick={() => up({ phases: m.phases!.filter((_, j) => j !== i) })}>단계 삭제</button>
              </fieldset>
            );
          })}
          <button type="button" className="small" onClick={() => up({ phases: [...(m.phases ?? []), { below: 0.5, line: '분노한다!' }] })}>＋ 보스 단계</button>
        </div>
      )} />
  );
}

// ---------------------------------------------------------------- 의뢰판

export function BoardForms({ w, set }: { w: WorldPackage; set: Set }) {
  const table = monsterTable(w);
  const withBoard = w.locations.filter((l) => l.board);
  const setBoard = (locId: string, board: NonNullable<(typeof w.locations)[number]['board']> | undefined) =>
    set({ locations: w.locations.map((l) => { if (l.id !== locId) return l; const { board: _b, ...rest } = l; return board ? { ...rest, board } : rest; }) });
  return (
    <div>
      <div className="row">
        <span className="small">의뢰판 추가:</span>
        <S value="" options={[['', '(장소 고르기)'], ...w.locations.filter((l) => !l.board).map((l) => [l.id, l.name] as const)]} onChange={(id) => id && setBoard(id, { name: '게시판', jobs: [] })} />
      </div>
      {withBoard.map((l) => (
        <fieldset key={l.id} className="stage-box"><legend>{l.name}의 의뢰판</legend>
          <div className="row">
            <input value={l.board!.name} onChange={(e) => setBoard(l.id, { ...l.board!, name: e.target.value })} />
            <button type="button" className="small" onClick={() => confirm('이 의뢰판을 지울까요?') && setBoard(l.id, undefined)}>의뢰판 삭제</button>
          </div>
          <ItemList<Job> title="의뢰" items={l.board!.jobs} onChange={(jobs) => setBoard(l.id, { ...l.board!, jobs })}
            make={(n) => ({ id: `job/new-${n}`, name: '새 의뢰', type: 'hunt', description: '', locationId: l.id, enemies: [{ monsterId: Object.keys(table)[0]!, zone: 2 }] })}
            render={(j, up) => (
              <div className="form-grid">
                <Text label="ID (job/…)" value={j.id} onChange={(id) => up({ id })} />
                <Text label="이름" value={j.name} onChange={(name) => up({ name })} />
                <Select label="유형" value={j.type} options={QUEST_TYPES.map((t) => [t, QUEST_TYPE_LABEL[t]] as const)} onChange={(type) => up({ type })} />
                <Area label="의뢰 내용 (플레이어에게 보임)" value={j.description} onChange={(description) => up({ description })} rows={2} />
                <Select label="일이 벌어지는 곳" value={j.locationId} options={opts(w.locations)} onChange={(locationId) => up({ locationId })} />
                <fieldset className="cond-field"><legend>토벌할 적 (있으면 맡을 때마다 조우가 생기고, 이기면 끝난다)</legend>
                  {(j.enemies ?? []).map((e, i) => (
                    <div key={i} className="cond-child"><div className="cond">
                      <S value={e.monsterId} options={Object.values(table).map((m) => [m.id, `${m.name}${MONSTERS[m.id] ? '' : ' ★'} (${m.xp}XP)`] as const)} onChange={(monsterId) => up({ enemies: j.enemies!.map((x, k) => (k === i ? { ...x, monsterId } : x)) })} />
                      <S value={String(e.zone)} options={[['2', '적 전열'], ['3', '적 후열']]} onChange={(z) => up({ enemies: j.enemies!.map((x, k) => (k === i ? { ...x, zone: Number(z) as 2 } : x)) })} />
                    </div><button type="button" className="small" onClick={() => up({ enemies: j.enemies!.filter((_, k) => k !== i) })}>✕</button></div>
                  ))}
                  <button type="button" className="small" onClick={() => up({ enemies: [...(j.enemies ?? []), { monsterId: Object.keys(table)[0]!, zone: 2 }] })}>＋ 적</button>
                </fieldset>
                {!(j.enemies?.length) && <ConditionField label="완료 조건 (토벌이 아닌 의뢰)" value={j.complete} world={w} onChange={(complete) => up({ complete })} />}
                <ConditionField label="맡을 수 있는 조건 (예: 평판)" value={j.requires} world={w} optional onChange={(requires) => up({ requires })} />
                <Num label="기한 (일)" value={j.timeLimit?.days} onChange={(days) => up({ timeLimit: days ? { days } : undefined })} />
                <Num label="보상 돈 (비우면 위협도로 정함)" value={j.rewards?.money} onChange={(money) => up({ rewards: money ? { ...j.rewards, money } : undefined })} />
                <label className="check"><input type="checkbox" checked={j.repeatable !== false} onChange={(e) => up({ repeatable: e.target.checked ? undefined : false })} /> 끝낸 뒤 다시 맡을 수 있다</label>
              </div>
            )} />
        </fieldset>
      ))}
    </div>
  );
}
