import { worldVars } from '../engine/vars';
import { phasesOf } from '../engine/phase';
import { traitsFor } from '../engine/traits';
import { isAlwaysTrue, isUnset } from '../engine/scenario';
/**
 * 조건 빌더 (설계 v3 11장 · R8): 조건식(Condition)을 폼으로 만든다. 참조는 목록에서 고른다.
 * 모든 조건 종류를 지원하고, 언제든 JSON으로 볼 수 있다.
 */
import { useState } from 'react';
import { monsterTable } from '../engine/combat/monsters';
import { allItems } from '../engine/items';
import { AXES, AXIS_NAMES, STAGES } from '../engine/relationship';
import type { Condition, WorldPackage } from '../engine/schema';

type Kind =
  | 'all' | 'any' | 'not' | 'knows' | 'at' | 'cleared' | 'inParty' | 'relationship' | 'stage' | 'reputation' | 'flag' | 'questDone' | 'questFailed'
  | 'level' | 'chapter' | 'arcDone' | 'clock' | 'choice' | 'day' | 'hasItem' | 'money' | 'defeated' | 'npcAlive' | 'npcAt' | 'var' | 'questOutcome' | 'npcGoal' | 'sceneEnd' | 'trait' | 'encounter' | 'phase';

export const KIND_LABEL: Record<Kind, string> = {
  all: '모두 참 (그리고)', any: '하나라도 참 (또는)', not: '아니다', knows: '플레이어가 안다', at: '플레이어가 그 장소에', cleared: '조우를 이겼다',
  inParty: '동료로 함께', relationship: '관계 수치', stage: '관계 단계', reputation: '세력 평판', flag: '플래그가 섰다', questDone: '임무 성공',
  questFailed: '임무 실패', level: '레벨 이상', chapter: '줄기의 장 진행', arcDone: '줄기가 끝남', clock: '시계 칸', choice: '결정적 선택',
  day: '며칠이 지남', hasItem: '아이템을 가짐', money: '돈 이상', defeated: '적을 쓰러뜨린 수', npcAlive: '인물이 살아 있다', npcAt: '인물이 그 장소에',
  var: '세계 수치', questOutcome: '임무의 결과', npcGoal: '인물의 목표', sceneEnd: '장면의 결과', trait: '주인공 성향', encounter: '조우의 결과 (승리·패배·도주)', phase: '지금 국면',
};

const goals = (w: WorldPackage) => w.characters.flatMap((c) => (c.goals ?? []).map((g) => [g.id, `${c.name}: ${g.text.slice(0, 30)}`] as const));

export function kindOf(c: Condition): Kind {
  // 키가 겹치는 종류(npcAt의 at 등)를 먼저 본다
  if ('npcAt' in c) return 'npcAt';
  return (Object.keys(KIND_LABEL) as Kind[]).find((k) => k in c) ?? 'all';
}

function blank(kind: Kind, w: WorldPackage): Condition {
  const first = <T extends { id: string }>(list: T[] | undefined) => list?.[0]?.id ?? '';
  switch (kind) {
    case 'all': return { all: [] };
    case 'any': return { any: [] };
    case 'not': return { not: { flag: first(w.flags) } };
    case 'knows': return { knows: first(w.claims) };
    case 'at': return { at: first(w.locations) };
    case 'cleared': return { cleared: first(w.encounters) };
    case 'inParty': return { inParty: first(w.characters) };
    case 'relationship': return { relationship: first(w.characters), axis: 'trust', gte: 20 };
    case 'stage': return { stage: first(w.characters), in: ['친구', '절친', '연인'] };
    case 'reputation': return { reputation: first(w.factions), gte: 10 };
    case 'flag': return { flag: first(w.flags) };
    case 'questDone': return { questDone: first(w.quests) };
    case 'questFailed': return { questFailed: first(w.quests) };
    case 'level': return { level: 2 };
    case 'chapter': return { chapter: first(w.arcs), gte: 1 };
    case 'arcDone': return { arcDone: first(w.arcs) };
    case 'clock': return { clock: first(w.clocks), gte: 1 };
    case 'choice': return { choice: first(w.choices) };
    case 'day': return { day: 1 };
    case 'hasItem': return { hasItem: allItems(w)[0]?.id ?? '' };
    case 'money': return { money: 10 };
    case 'defeated': return { defeated: Object.keys(monsterTable(w))[0]!, n: 1 };
    case 'npcAlive': return { npcAlive: first(w.characters) };
    case 'npcAt': return { npcAt: first(w.characters), at: first(w.locations) };
    case 'var': return { var: first(worldVars(w)), gte: 5 };
    case 'phase': return { phase: phasesOf(w)[0]?.id ?? '' };
    case 'trait': return { trait: traitsFor(w)[0]?.id ?? '', gte: 20 };
    case 'questOutcome': return { questOutcome: first(w.quests) };
    case 'npcGoal': return { npcGoal: goals(w)[0]?.[0] ?? '' };
    case 'sceneEnd': return { sceneEnd: first(w.scenes) };
    case 'encounter': return { encounter: first(w.encounters), is: 'defeat' };
  }
}

/** 조건을 사람이 읽는 한 줄로 */
export function describeCondition(c: Condition, w: WorldPackage): string {
  const name = (list: { id: string; name?: string; statement?: string }[] | undefined, id: string) => {
    const x = list?.find((y) => y.id === id);
    return x?.name ?? (x?.statement ? `"${x.statement.slice(0, 24)}…"` : id);
  };
  const k = kindOf(c);
  const x = c as Record<string, unknown>;
  switch (k) {
    case 'all': return (x.all as Condition[]).length ? (x.all as Condition[]).map((y) => describeCondition(y, w)).join(' 그리고 ') : '항상';
    case 'any': return (x.any as Condition[]).length ? `(${(x.any as Condition[]).map((y) => describeCondition(y, w)).join(' 또는 ')})` : '정하지 않음 (성립하지 않음)';
    case 'not': return `아님: ${describeCondition(x.not as Condition, w)}`;
    case 'knows': return `안다: ${name(w.claims, x.knows as string)}`;
    case 'at': return `${name(w.locations, x.at as string)}에 있다`;
    case 'cleared': return `${name(w.encounters, x.cleared as string)} 승리`;
    case 'encounter': return `${name(w.encounters, x.encounter as string)} ${x.is ? ({ victory: '승리', defeat: '패배', fled: '도주' } as Record<string, string>)[x.is as string] ?? x.is : '치름'}`;
    case 'inParty': return `${name(w.characters, x.inParty as string)} 동행`;
    case 'relationship': return `${name(w.characters, x.relationship as string)} ${AXIS_NAMES[x.axis as keyof typeof AXIS_NAMES]}${x.gte !== undefined ? ` ≥ ${x.gte}` : ''}${x.lte !== undefined ? ` ≤ ${x.lte}` : ''}`;
    case 'stage': return `${name(w.characters, x.stage as string)}와 ${(x.in as string[]).join('/')}`;
    case 'reputation': return `${name(w.factions, x.reputation as string)} 평판${x.gte !== undefined ? ` ≥ ${x.gte}` : ''}${x.lte !== undefined ? ` ≤ ${x.lte}` : ''}`;
    case 'flag': return `플래그 ${x.flag}`;
    case 'questDone': return `${name(w.quests, x.questDone as string)} 성공`;
    case 'questFailed': return `${name(w.quests, x.questFailed as string)} 실패`;
    case 'level': return `레벨 ${x.level} 이상`;
    case 'chapter': return `${name(w.arcs, x.chapter as string)} ${x.gte}장 끝냄`;
    case 'arcDone': return `${name(w.arcs, x.arcDone as string)} 끝남`;
    case 'clock': return `${name(w.clocks, x.clock as string)} ${x.gte ?? 0}칸 이상`;
    case 'choice': return `${name(w.choices, x.choice as string)}${x.is ? ` = ${x.is}` : ' 고름'}`;
    case 'day': return `${x.day}일 지남`;
    case 'hasItem': return `${name(allItems(w), x.hasItem as string)}${(x.n as number) > 1 ? ` ×${x.n}` : ''} 가짐`;
    case 'money': return `돈 ${x.money} 이상`;
    case 'defeated': return `${monsterTable(w)[x.defeated as string]?.name ?? x.defeated} ${x.n ?? 1}마리 처치`;
    case 'npcAlive': return `${name(w.characters, x.npcAlive as string)} 생존`;
    case 'npcAt': return `${name(w.characters, x.npcAt as string)}이(가) ${name(w.locations, x.at as string)}에`;
    case 'trait': { const t = traitsFor(w).find((y) => y.id === x.trait); return `성향 ${t ? `${t.name}(${t.low}↔${t.high})` : String(x.trait)}${x.gte !== undefined ? ` ≥ ${x.gte}` : ''}${x.lte !== undefined ? ` ≤ ${x.lte}` : ''}`; }
    case 'phase': return `국면이 ${name(phasesOf(w), x.phase as string)}`;
    case 'var': return `${name(worldVars(w), x.var as string)}${x.gte !== undefined ? ` ≥ ${x.gte}` : ''}${x.lte !== undefined ? ` ≤ ${x.lte}` : ''}`;
    case 'sceneEnd': return `${name(w.scenes, x.sceneEnd as string)} ${x.is ? `끝 = ${w.scenes?.find((d) => d.id === x.sceneEnd)?.ends.find((e) => e.id === x.is)?.name ?? x.is}` : x.outcome ? ({ success: '성공', failure: '실패', neutral: '중립' } as Record<string, string>)[x.outcome as string] : '끝남'}`;
    case 'npcGoal': return `${goals(w).find(([id]) => id === x.npcGoal)?.[1] ?? x.npcGoal} ${({ active: '진행 중', done: '이뤄짐', stopped: '꺾임' } as Record<string, string>)[(x.is as string) ?? 'done']}`;
    case 'questOutcome': return `${name(w.quests, x.questOutcome as string)} 결과${x.is ? ` = ${w.quests?.find((q) => q.id === x.questOutcome)?.outcomes?.find((o) => o.id === x.is)?.name ?? x.is}` : ' (무엇이든)'}`;
  }
}

const Sel = ({ value, options, onChange }: { value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}>
    {!options.some((o) => o[0] === value) && <option value={value}>{value || '(선택)'}</option>}
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);
const NumIn = ({ value, onChange, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) => (
  <input type="number" className="num" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
);

/** 조건 하나 (재귀) */
export function ConditionEditor({ value, world: w, onChange, depth = 0 }: { value: Condition; world: WorldPackage; onChange: (c: Condition) => void; depth?: number }) {
  const k = kindOf(value);
  const x = value as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...x, ...patch } as Condition);
  const opts = (list: { id: string; name?: string; statement?: string }[] | undefined) => (list ?? []).map((i) => [i.id, `${i.name ?? i.statement?.slice(0, 40) ?? ''} (${i.id})`] as const);
  const flags = (w.flags ?? []).map((f) => [f.id, `${f.id} — ${f.when.slice(0, 30)}`] as const);
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((kk) => depth < 3 || !['all', 'any', 'not'].includes(kk));
  const body = (() => {
    switch (k) {
      case 'all': case 'any': {
        const list = (x[k] as Condition[]) ?? [];
        return (
          <div className="cond-children">
            {list.map((child, i) => (
              <div key={i} className="cond-child">
                <ConditionEditor value={child} world={w} depth={depth + 1} onChange={(c) => set({ [k]: list.map((y, j) => (j === i ? c : y)) })} />
                <button type="button" className="small" onClick={() => set({ [k]: list.filter((_, j) => j !== i) })} title="이 조건 빼기">✕</button>
              </div>
            ))}
            <button type="button" className="small" onClick={() => set({ [k]: [...list, blank('flag', w)] })}>＋ 조건 추가</button>
            {k === 'all' && !list.length && <span className="small muted"> (비어 있으면 항상 참)</span>}
          </div>
        );
      }
      case 'not': return <div className="cond-children"><ConditionEditor value={x.not as Condition} world={w} depth={depth + 1} onChange={(c) => set({ not: c })} /></div>;
      case 'knows': return <><Sel value={x.knows as string} options={opts(w.claims)} onChange={(v) => set({ knows: v })} /><Sel value={(x.min as string) ?? ''} options={[['', '소문이라도'], ['partial', '들은 이야기 이상'], ['confirmed', '확인함']]} onChange={(v) => onChange(v ? { ...x, min: v } as Condition : (({ min: _m, ...r }) => r)(x) as Condition)} /></>;
      case 'at': return <Sel value={x.at as string} options={opts(w.locations)} onChange={(v) => set({ at: v })} />;
      case 'cleared': return <Sel value={x.cleared as string} options={opts(w.encounters)} onChange={(v) => set({ cleared: v })} />;
      case 'encounter': return <><Sel value={x.encounter as string} options={opts(w.encounters)} onChange={(v) => set({ encounter: v })} /><Sel value={(x.is as string) ?? ''} options={[['', '(어떻게든 치렀다)'], ['victory', '이겼다'], ['defeat', '졌다'], ['fled', '달아났다']]} onChange={(v) => onChange((v ? { encounter: x.encounter, is: v } : { encounter: x.encounter }) as Condition)} /></>;
      case 'inParty': return <Sel value={x.inParty as string} options={opts(w.characters)} onChange={(v) => set({ inParty: v })} />;
      case 'npcAlive': return <Sel value={x.npcAlive as string} options={opts(w.characters)} onChange={(v) => set({ npcAlive: v })} />;
      case 'npcAt': return <><Sel value={x.npcAt as string} options={opts(w.characters)} onChange={(v) => set({ npcAt: v })} /><Sel value={x.at as string} options={opts(w.locations)} onChange={(v) => set({ at: v })} /></>;
      case 'relationship': return <><Sel value={x.relationship as string} options={opts(w.characters)} onChange={(v) => set({ relationship: v })} /><Sel value={x.axis as string} options={AXES.map((a) => [a, AXIS_NAMES[a]] as const)} onChange={(v) => set({ axis: v })} /> ≥ <NumIn value={x.gte as number} onChange={(v) => set({ gte: v })} /> ≤ <NumIn value={x.lte as number} placeholder="(없음)" onChange={(v) => set({ lte: v })} /></>;
      case 'stage': return (
        <><Sel value={x.stage as string} options={opts(w.characters)} onChange={(v) => set({ stage: v })} />
          <span className="stage-checks">{STAGES.map((st) => (
            <label key={st} className="check small"><input type="checkbox" checked={(x.in as string[]).includes(st)} onChange={(e) => set({ in: e.target.checked ? [...(x.in as string[]), st] : (x.in as string[]).filter((y) => y !== st) })} />{st}</label>
          ))}</span></>
      );
      case 'reputation': return <><Sel value={x.reputation as string} options={opts(w.factions)} onChange={(v) => set({ reputation: v })} /> ≥ <NumIn value={x.gte as number} onChange={(v) => set({ gte: v })} /></>;
      case 'flag': return <Sel value={x.flag as string} options={flags} onChange={(v) => set({ flag: v })} />;
      case 'questDone': return <Sel value={x.questDone as string} options={opts(w.quests)} onChange={(v) => set({ questDone: v })} />;
      case 'questFailed': return <Sel value={x.questFailed as string} options={opts(w.quests)} onChange={(v) => set({ questFailed: v })} />;
      case 'level': return <NumIn value={x.level as number} onChange={(v) => set({ level: v ?? 1 })} />;
      case 'chapter': return <><Sel value={x.chapter as string} options={opts(w.arcs)} onChange={(v) => set({ chapter: v })} /> 끝낸 장 ≥ <NumIn value={x.gte as number} onChange={(v) => set({ gte: v ?? 1 })} /></>;
      case 'arcDone': return <Sel value={x.arcDone as string} options={opts(w.arcs)} onChange={(v) => set({ arcDone: v })} />;
      case 'clock': return <><Sel value={x.clock as string} options={opts(w.clocks)} onChange={(v) => set({ clock: v })} /> ≥ <NumIn value={x.gte as number} onChange={(v) => set({ gte: v })} /></>;
      case 'choice': {
        const ch = w.choices?.find((c) => c.id === x.choice);
        return <><Sel value={x.choice as string} options={opts(w.choices)} onChange={(v) => set({ choice: v })} /><Sel value={(x.is as string) ?? ''} options={[['', '(무엇이든 고름)'], ...(ch?.options ?? []).map((o) => [o.id, o.text] as const)]} onChange={(v) => onChange(v ? { ...x, is: v } as Condition : (({ is: _i, ...r }) => r)(x) as Condition)} /></>;
      }
      case 'day': return <NumIn value={x.day as number} onChange={(v) => set({ day: v ?? 0 })} />;
      case 'hasItem': return <><Sel value={x.hasItem as string} options={allItems(w).map((i) => [i.id, `${i.name} (${i.id})`] as const)} onChange={(v) => set({ hasItem: v })} /> × <NumIn value={x.n as number} placeholder="1" onChange={(v) => set({ n: v })} /></>;
      case 'money': return <NumIn value={x.money as number} onChange={(v) => set({ money: v ?? 0 })} />;
      case 'trait': return <><Sel value={x.trait as string} options={traitsFor(w).map((t) => [t.id, `${t.name} (${t.low} -100 ↔ +100 ${t.high})`] as const)} onChange={(v) => set({ trait: v })} /> ≥ <NumIn value={x.gte as number} placeholder="(없음)" onChange={(v) => set({ gte: v })} /> ≤ <NumIn value={x.lte as number} placeholder="(없음)" onChange={(v) => set({ lte: v })} /></>;
      case 'phase': return <Sel value={x.phase as string} options={opts(phasesOf(w))} onChange={(v) => set({ phase: v })} />;
      case 'var': return <><Sel value={x.var as string} options={opts(worldVars(w))} onChange={(v) => set({ var: v })} /> ≥ <NumIn value={x.gte as number} placeholder="(없음)" onChange={(v) => set({ gte: v })} /> ≤ <NumIn value={x.lte as number} placeholder="(없음)" onChange={(v) => set({ lte: v })} /></>;
      case 'sceneEnd': {
        const d = w.scenes?.find((y) => y.id === x.sceneEnd);
        return <><Sel value={x.sceneEnd as string} options={opts(w.scenes)} onChange={(v) => onChange({ sceneEnd: v } as Condition)} />
          <Sel value={x.is ? `end:${x.is}` : x.outcome ? `out:${x.outcome}` : ''} options={[['', '(어떻게든 끝남)'], ['out:success', '성공으로'], ['out:failure', '실패로'], ['out:neutral', '중립으로'], ...(d?.ends ?? []).map((e) => [`end:${e.id}`, `끝: ${e.name}`] as const)]}
            onChange={(v) => onChange({ sceneEnd: x.sceneEnd, ...(v.startsWith('end:') ? { is: v.slice(4) } : v.startsWith('out:') ? { outcome: v.slice(4) } : {}) } as Condition)} /></>;
      }
      case 'npcGoal': return <><Sel value={x.npcGoal as string} options={goals(w)} onChange={(v) => set({ npcGoal: v })} /><Sel value={(x.is as string) ?? 'done'} options={[['done', '이뤄짐'], ['active', '진행 중'], ['stopped', '꺾임']]} onChange={(v) => set({ is: v })} /></>;
      case 'questOutcome': {
        const q = w.quests?.find((y) => y.id === x.questOutcome);
        return <><Sel value={x.questOutcome as string} options={opts(w.quests)} onChange={(v) => set({ questOutcome: v })} /><Sel value={(x.is as string) ?? ''} options={[['', '(어떤 결과든)'], ...(q?.outcomes ?? []).map((o) => [o.id, o.name] as const)]} onChange={(v) => onChange(v ? { ...x, is: v } as Condition : (({ is: _i, ...r }) => r)(x) as Condition)} /></>;
      }
      case 'defeated': return <><Sel value={x.defeated as string} options={Object.values(monsterTable(w)).map((m) => [m.id, `${m.name} (${m.id})`] as const)} onChange={(v) => set({ defeated: v })} /> × <NumIn value={x.n as number} placeholder="1" onChange={(v) => set({ n: v })} /></>;
    }
  })();
  return (
    <div className={`cond depth-${depth % 3}`}>
      <Sel value={k} options={kinds.map((kk) => [kk, KIND_LABEL[kk]] as const)} onChange={(v) => onChange(blank(v as Kind, w))} />
      {body}
    </div>
  );
}

/** 조건 필드 하나: 폼 + 한 줄 요약 + JSON 보기 */
export function ConditionField({ label, value, world, onChange, optional, completion }: { label: string; value: Condition | undefined; world: WorldPackage; onChange: (c: Condition | undefined) => void; optional?: boolean; /** 완료 조건: 비면 바로 끝난다고 경고 (v0.57.3) */ completion?: boolean }) {
  const [json, setJson] = useState(false);
  const [text, setText] = useState('');
  const [bad, setBad] = useState('');
  return (
    <fieldset className="cond-field">
      <legend>{label}</legend>
      {value === undefined ? (
        <button type="button" className="small" onClick={() => onChange({ all: [] })}>＋ 조건 넣기</button>
      ) : (
        <>
          <p className="small muted cond-summary">{describeCondition(value, world)}</p>
          {completion && isAlwaysTrue(value) && <p className="small warn-text">⚠ 조건이 비어 있어 <b>시작하자마자 끝납니다</b> (보상도 바로 받음). 아래에서 조건을 추가하세요.</p>}
          {completion && isUnset(value) && <p className="small muted">아직 조건을 정하지 않아 끝나지 않습니다. 아래에서 조건을 추가하세요.</p>}
          {json ? (
            <>
              <textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setBad(''); } catch { setBad('JSON 형식 오류'); } }} />
              {bad && <span className="small reason">{bad}</span>}
            </>
          ) : <ConditionEditor value={value} world={world} onChange={onChange} />}
          <div className="row">
            <button type="button" className="small" onClick={() => { setText(JSON.stringify(value, null, 1)); setJson((j) => !j); }}>{json ? '폼으로' : 'JSON'}</button>
            {optional && <button type="button" className="small" onClick={() => onChange(undefined)}>조건 지우기</button>}
          </div>
        </>
      )}
    </fieldset>
  );
}
