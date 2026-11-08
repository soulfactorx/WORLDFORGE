/**
 * 시험실 (v0.84) — 편집기 🧪 시험 묶음.
 * - 상태 시험대 (LabPanel): 원하는 상태를 만들고, 장치마다 조건 ✓/✗와 이유, 규칙·선택·효과·전투·장면을 해 본다. 항목 단위 시험.
 * - 자동 플레이 (AutoPlayPanel): AI 없이 무작위 플레이어를 여러 번 돌려 세계 전체를 점검한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { classesFor } from '../engine/classes';
import type { EncounterSpec } from '../engine/combat/combat';
import { DIFFICULTY_LABEL } from '../engine/combat/monsters';
import { flowWarnings } from '../engine/package/flow';
import { validateWorld } from '../engine/package/validate';
import { AXES, AXIS_NAMES } from '../engine/relationship';
import type { Condition, RelationAxis, StoryEffect, WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';
import { traitsFor } from '../engine/traits';
import { AUTO_ACTION_LABEL, AUTO_STYLE_LABEL, type AutoReport, type AutoStyle, autoPlay, blockers, neverSeen } from '../gm/autoplay';
import {
  condTrace, fightStats, type FightStats, type LabResult, type LabRow, type LabSetup, labChoose, labEffects, labFight, labFireRule, labFlag, labInput, labMove,
  labQuest, labSheet, labState, labStatus, labStep, labSummary, labWait, type Trace,
} from '../gm/lab';
import { simulateScene, type SimResult } from '../gm/sceneTest';
import { describeCondition } from './ConditionEditor';
import { EffectsEditor } from './WorldForms';

const KIND_LABEL: Record<string, string> = { rule: '⚖ 규칙', quest: '📜 임무', ending: '🏁 결말', choice: '◆ 결정', flag: '🚩 플래그', scene: '🎭 장면', encounter: '⚔ 조우', title: '🏅 칭호', beat: '💞 관계 사건' };
const storeKey = (w: WorldPackage) => `wf.lab.${w.manifest.id}`;
function loadSetup(w: WorldPackage): LabSetup { try { return JSON.parse(localStorage.getItem(storeKey(w)) ?? '{}') as LabSetup; } catch { return {}; } }
function saveSetup(w: WorldPackage, s: LabSetup) { try { localStorage.setItem(storeKey(w), JSON.stringify(s)); } catch { /* 저장소 없음 */ } }

/** 이 명제를 아는 인물 (조건 "안다"가 막혔을 때 어디서 알 수 있나) */
function holders(w: WorldPackage, claim: string): string {
  const list = w.beliefs.filter((b) => b.claim === claim && b.holder !== 'player').map((b) => `${w.characters.find((c) => c.id === b.holder)?.name ?? b.holder}(${({ rumor: '소문', partial: '들은 얘기', confirmed: '확실', mistaken: '잘못 앎', secret: '비밀' } as Record<string, string>)[b.state] ?? b.state})`);
  const where = w.locations.filter((l) => l.discoveries?.some((d) => d.claim === claim)).map((l) => `${l.name}에서 조사`);
  return [...list, ...where].join(', ');
}

export function TraceView({ t, w }: { t: Trace; w: WorldPackage }) {
  const c = t.c as Record<string, unknown>;
  const group = 'all' in c ? '모두' : 'any' in c ? '하나 이상' : 'not' in c ? '아님' : null;
  if (group && (!t.kids?.length)) return <div className={`trace ${t.ok ? 'ok' : 'no'}`}>{t.ok ? '✓' : '✗'} {'all' in c ? '항상 (조건 없음)' : '정하지 않음'}</div>;
  return (
    <div className={`trace ${t.ok ? 'ok' : 'no'}`}>
      {group ? <>{t.ok ? '✓' : '✗'} <b>{group}</b>:<div className="trace-kids">{t.kids!.map((k, i) => <TraceView key={i} t={k} w={w} />)}</div></>
        : <>{t.ok ? '✓' : '✗'} {describeCondition(t.c, w)}{!t.ok && 'knows' in c && holders(w, c.knows as string) ? <span className="muted"> — 아는 곳: {holders(w, c.knows as string)}</span> : null}</>}
    </div>
  );
}

// ---------------------------------------------------------------- 상태 시험대

function SetupForm({ w, setup, onChange }: { w: WorldPackage; setup: LabSetup; onChange: (s: LabSetup) => void }) {
  const up = (p: Partial<LabSetup>) => onChange({ ...setup, ...p });
  const toggle = (key: 'flags' | 'questsDone' | 'questsStarted' | 'knows' | 'dead', id: string, on: boolean) => up({ [key]: on ? [...(setup[key] ?? []), id] : (setup[key] ?? []).filter((x) => x !== id) });
  const classes = classesFor(w);
  const [relNpc, setRelNpc] = useState(w.characters[0]?.id ?? '');
  const [relAxis, setRelAxis] = useState<RelationAxis>('trust');
  const [relVal, setRelVal] = useState(30);
  const [item, setItem] = useState(w.items?.[0]?.id ?? '');
  const [claimQ, setClaimQ] = useState('');
  const checks = (key: 'flags' | 'questsDone' | 'questsStarted' | 'knows' | 'dead', list: { id: string; label: string }[]) => (
    <div className="lab-checks">{list.map((x) => <label key={x.id} className="check small"><input type="checkbox" checked={!!setup[key]?.includes(x.id)} onChange={(e) => toggle(key, x.id, e.target.checked)} />{x.label}</label>)}</div>
  );
  return (
    <div className="lab-setup">
      <div className="lab-grid">
        {(w.starts ?? []).length > 0 && <label>시작 방식<select value={setup.startId ?? ''} onChange={(e) => up({ startId: e.target.value || undefined })}><option value="">(기본)</option>{w.starts!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        <label>있는 곳<select value={setup.locationId ?? ''} onChange={(e) => up({ locationId: e.target.value || undefined })}><option value="">(시작 장소)</option>{w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>직업<select value={setup.classIndex ?? 0} onChange={(e) => up({ classIndex: Number(e.target.value) })}>{classes.map((c, i) => <option key={c.id} value={i}>{c.name}</option>)}</select></label>
        <label>레벨<input type="number" min={1} max={10} value={setup.level ?? 1} onChange={(e) => up({ level: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></label>
        <label>지난 날<input type="number" min={0} max={365} value={setup.days ?? 0} onChange={(e) => up({ days: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label>돈<input type="number" value={setup.money ?? ''} placeholder="(시작 그대로)" onChange={(e) => up({ money: e.target.value === '' ? undefined : Number(e.target.value) || 0 })} /></label>
      </div>
      {(w.vars ?? []).length > 0 && <fieldset className="cond-field"><legend>세계 수치</legend><div className="lab-grid">{w.vars!.map((v) => (
        <label key={v.id}>{v.name}<input type="number" value={setup.vars?.[v.id] ?? v.initial} onChange={(e) => up({ vars: { ...(setup.vars ?? {}), [v.id]: Number(e.target.value) || 0 } })} /></label>))}</div></fieldset>}
      {traitsFor(w).length > 0 && <fieldset className="cond-field"><legend>주인공 성향 (-100 ~ 100)</legend><div className="lab-grid">{traitsFor(w).map((t) => (
        <label key={t.id}>{t.name} <span className="muted small">({t.low}↔{t.high})</span><input type="number" min={-100} max={100} value={setup.traits?.[t.id] ?? 0} onChange={(e) => up({ traits: { ...(setup.traits ?? {}), [t.id]: Math.max(-100, Math.min(100, Number(e.target.value) || 0)) } })} /></label>))}</div></fieldset>}
      {w.characters.length > 0 && (
        <fieldset className="cond-field"><legend>관계 (절대값)</legend>
          <div className="lab-row">
            <select value={relNpc} onChange={(e) => setRelNpc(e.target.value)}>{w.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select value={relAxis} onChange={(e) => setRelAxis(e.target.value as RelationAxis)}>{AXES.map((a) => <option key={a} value={a}>{AXIS_NAMES[a]}</option>)}</select>
            <input type="number" className="num" value={relVal} onChange={(e) => setRelVal(Number(e.target.value) || 0)} />
            <button type="button" onClick={() => up({ relations: { ...(setup.relations ?? {}), [relNpc]: { ...(setup.relations?.[relNpc] ?? {}), [relAxis]: relVal } } })}>＋ 넣기</button>
          </div>
          <ul className="small lab-list">{Object.entries(setup.relations ?? {}).flatMap(([id, axes]) => Object.entries(axes).map(([a, v]) => (
            <li key={`${id}${a}`}>{w.characters.find((c) => c.id === id)?.name ?? id} {AXIS_NAMES[a as RelationAxis]} = {v}
              <button type="button" className="small" aria-label="빼기" onClick={() => { const next = { ...(setup.relations ?? {}) }; const ax = { ...(next[id] ?? {}) }; delete ax[a as RelationAxis]; next[id] = ax; up({ relations: next }); }}>🗑</button></li>)))}</ul>
        </fieldset>
      )}
      {(w.flags ?? []).length > 0 && <details><summary className="small">🚩 선 플래그 ({setup.flags?.length ?? 0})</summary>{checks('flags', w.flags!.map((f) => ({ id: f.id, label: f.id })))}</details>}
      {(w.quests ?? []).length > 0 && <details><summary className="small">📜 완료한 임무 ({setup.questsDone?.length ?? 0}) · 진행 중 ({setup.questsStarted?.length ?? 0})</summary>
        <p className="small muted">완료</p>{checks('questsDone', w.quests!.map((q) => ({ id: q.id, label: q.name })))}
        <p className="small muted">진행 중 (1단계)</p>{checks('questsStarted', w.quests!.map((q) => ({ id: q.id, label: q.name })))}</details>}
      {(w.choices ?? []).length > 0 && <details><summary className="small">◆ 이미 한 결정 ({Object.keys(setup.choices ?? {}).length})</summary><div className="lab-grid">{w.choices!.map((c) => (
        <label key={c.id}>{c.name}<select value={setup.choices?.[c.id] ?? ''} onChange={(e) => { const next = { ...(setup.choices ?? {}) }; if (e.target.value) next[c.id] = e.target.value; else delete next[c.id]; up({ choices: next }); }}>
          <option value="">(아직 안 함)</option>{c.options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}</select></label>))}</div></details>}
      {w.claims.length > 0 && <details><summary className="small">💡 플레이어가 아는 것 ({setup.knows?.length ?? 0})</summary>
        {w.claims.length > 10 && <input type="search" placeholder="찾기" value={claimQ} onChange={(e) => setClaimQ(e.target.value)} />}
        {checks('knows', w.claims.filter((c) => !claimQ || c.statement.includes(claimQ) || c.id.includes(claimQ)).map((c) => ({ id: c.id, label: c.statement.slice(0, 60) })))}</details>}
      {(w.items ?? []).length > 0 && (
        <details><summary className="small">🎒 소지품 ({Object.keys(setup.items ?? {}).length})</summary>
          <div className="lab-row">
            <select value={item} onChange={(e) => setItem(e.target.value)}>{w.items!.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            <button type="button" onClick={() => up({ items: { ...(setup.items ?? {}), [item]: (setup.items?.[item] ?? 0) + 1 } })}>＋ 1개</button>
          </div>
          <ul className="small lab-list">{Object.entries(setup.items ?? {}).map(([id, n]) => <li key={id}>{w.items?.find((i) => i.id === id)?.name ?? id} ×{n} <button type="button" className="small" aria-label="빼기" onClick={() => { const next = { ...(setup.items ?? {}) }; delete next[id]; up({ items: next }); }}>🗑</button></li>)}</ul>
        </details>
      )}
      {w.characters.length > 0 && <details><summary className="small">✝ 죽은 인물 ({setup.dead?.length ?? 0})</summary>{checks('dead', w.characters.map((c) => ({ id: c.id, label: c.name })))}</details>}
    </div>
  );
}

interface LogEntry { title: string; lines: string[]; error?: string }

function SceneSim({ w, sceneId, state, setup }: { w: WorldPackage; sceneId: string; state: GameState; setup: LabSetup }) {
  const [r, setR] = useState<SimResult | null>(null);
  const def = w.scenes?.find((d) => d.id === sceneId);
  if (!def) return null;
  return (
    <div className="lab-actions">
      <button type="button" onClick={() => setR(simulateScene(w, sceneId, { ...labSheet(w, setup), level: state.player.sheet.level }, 200))}>🎭 200번 자동 진행</button>
      {r && <span className="small">끝: {Object.entries(r.ends).map(([id, n]) => `${def.ends.find((e) => e.id === id)?.name ?? id} ${Math.round((n / r.runs) * 100)}%`).join(' · ') || '없음'} · 평균 {r.avgRounds}차례{r.stuck ? ` · 멈춤 ${r.stuck}` : ''}{r.endless ? ` · 끝없음 ${r.endless}` : ''}{r.unreached.length ? ` · 안 나온 끝: ${r.unreached.join(', ')}` : ''}{r.unusedActions.length ? ` · 안 쓰인 행동: ${r.unusedActions.join(', ')}` : ''}</span>}
    </div>
  );
}

function FightTest({ w, spec, state, act }: { w: WorldPackage; spec: EncounterSpec; state: GameState; act: (title: string, f: () => LabResult) => void }) {
  const [st, setSt] = useState<FightStats | null>(null);
  return (
    <div className="lab-actions">
      <button type="button" onClick={() => act(`⚔ ${spec.id} 한 번 싸움`, () => labFight(w, state, spec))}>⚔ 한 번 싸워 보기</button>
      <button type="button" onClick={() => setSt(fightStats(w, state, spec, 60))}>📊 60번 승률</button>
      {st && <span className="small">난이도 {DIFFICULTY_LABEL[st.difficulty as keyof typeof DIFFICULTY_LABEL] ?? st.difficulty} (적 {st.xp}XP) · 승리 {Math.round((st.victory / st.n) * 100)}% · 쓰러짐 {Math.round((st.defeat / st.n) * 100)}%{st.dead ? ` (사망 ${Math.round((st.dead / st.n) * 100)}%)` : ''} · 도주 {Math.round((st.fled / st.n) * 100)}% · 평균 {st.avgRounds}라운드 · 남은 HP {st.avgHpLeft}% <span className="muted">(자동 조작 기준 — 실제 플레이어보다 서툴다)</span></span>}
    </div>
  );
}

export function LabPanel({ w, focus }: { w: WorldPackage; focus?: { kind: string; id: string; n: number } | null }) {
  const [setup, setSetupRaw] = useState<LabSetup>(() => loadSetup(w));
  const setSetup = (s: LabSetup) => { setSetupRaw(s); saveSetup(w, s); };
  const base = useMemo(() => { try { return labState(w, setup); } catch { return null; } }, [w, setup]);
  const [hist, setHist] = useState<GameState[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const cur = hist.at(-1) ?? base;
  useEffect(() => { setHist([]); setLog([]); }, [base]);
  const [kind, setKind] = useState<string>('all');
  const [only, setOnly] = useState<'all' | 'ok' | 'no'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [input, setInput] = useState('');
  const [fx, setFx] = useState<StoryEffect[]>([]);
  const [force, setForce] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    setKind(focus.kind); setOnly('all'); setOpen(`${focus.kind}:${focus.id}`);
    setTimeout(() => document.getElementById(`lab-${focus.kind}-${focus.id}`)?.scrollIntoView({ block: 'center' }), 50);
  }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!base || !cur) return <p className="status">❌ 시험 상태를 만들 수 없습니다 (세계 검사 오류를 먼저 고치세요).</p>;
  const act = (title: string, f: () => LabResult) => {
    const r = f();
    setLog((l) => [{ title, lines: r.lines.length ? r.lines : ['(아무 일도 일어나지 않음)'], ...(r.error ? { error: r.error } : {}) }, ...l].slice(0, 40));
    if (!r.error) setHist((h) => [...h, r.state]);
  };
  const rows = labStatus(w, cur).filter((r) => (kind === 'all' || r.kind === kind) && (only === 'all' || (only === 'ok' ? r.ok : !r.ok)));
  const kinds = [...new Set(labStatus(w, cur).map((r) => r.kind))];
  const extra = (r: LabRow) => {
    switch (r.kind) {
      case 'rule': {
        const rule = w.rules?.find((x) => x.id === r.id)!;
        return (
          <div className="lab-actions">
            {rule.trigger.kind === 'action' && <span className="small muted">행동: {rule.trigger.describe}{rule.trigger.keywords?.length ? ` · 낱말: ${rule.trigger.keywords.join(', ')}` : ''}</span>}
            <label className="check small"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />반복·추가 조건 무시</label>
            <button type="button" onClick={() => act(`⚖ ${rule.name} 발동`, () => labFireRule(w, cur, rule.id, force))}>▶ 발동해 보기</button>
          </div>
        );
      }
      case 'quest': return <div className="lab-actions"><button type="button" onClick={() => act(`📜 ${r.name} 시작으로`, () => labQuest(w, cur, r.id, 'start'))}>시작된 것으로</button><button type="button" onClick={() => act(`📜 ${r.name} 완료로`, () => labQuest(w, cur, r.id, 'done'))}>완료된 것으로 → 이어지는 일</button></div>;
      case 'choice': { const c = w.choices?.find((x) => x.id === r.id)!; return <div className="lab-actions">{c.options.map((o) => <button key={o.id} type="button" onClick={() => act(`◆ ${c.name} → ${o.text}`, () => labChoose(w, cur, c.id, o.id))}>이걸 고르면: {o.text}</button>)}</div>; }
      case 'flag': return cur.flags.includes(r.id) ? null : <div className="lab-actions"><button type="button" onClick={() => act(`🚩 ${r.id} 세움`, () => labFlag(w, cur, r.id))}>세워 보기 → 이어지는 일</button></div>;
      case 'encounter': { const e = w.encounters?.find((x) => x.id === r.id)!; return <FightTest w={w} spec={e} state={cur} act={act} />; }
      case 'scene': return <SceneSim w={w} sceneId={r.id} state={cur} setup={setup} />;
      default: return null;
    }
  };
  return (
    <div className="lab">
      <p className="muted small">AI 없이 엔진만으로 시험합니다. 아래에서 상태를 만들면 그 상태에서 각 장치가 어떤지(✓/✗와 이유) 보이고, 규칙·결정·효과·전투를 해 보면 엔진이 이어서 일으키는 일(규칙 연쇄·임무·결말)이 기록에 나옵니다. 실제 세이브에는 영향이 없습니다.</p>
      <details className="lab-box" open={!hist.length}>
        <summary><b>① 시험 상태 만들기</b> <span className="small muted">(이 세계에 저장 — 다음에 와도 그대로)</span></summary>
        <SetupForm w={w} setup={setup} onChange={setSetup} />
        <div className="lab-actions"><button type="button" onClick={() => { if (confirm('시험 상태 설정을 비울까요?')) setSetup({}); }}>설정 비우기</button></div>
      </details>

      <div className="lab-box">
        <b>② 지금 상태</b>{hist.length > 0 && <span className="small muted"> · {hist.length}번 해 봄</span>}
        <ul className="small lab-summary">{labSummary(w, cur).map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="lab-actions">
          <button type="button" className="primary" onClick={() => act('▶ 엔진 한 단계', () => labStep(w, cur))} title="이 상태가 된 순간 엔진이 일으키는 일 (상태 규칙·임무·시계·결말…)">▶ 엔진 한 단계</button>
          <button type="button" disabled={!hist.length} onClick={() => { setHist((h) => h.slice(0, -1)); setLog((l) => [{ title: '↶ 되돌림', lines: [] }, ...l]); }}>↶ 되돌리기</button>
          <button type="button" disabled={!hist.length} onClick={() => { setHist([]); setLog([]); }}>↺ 처음 상태로</button>
        </div>
        <div className="lab-row">
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="이동할 곳"><option value="">이동할 곳…</option>{w.locations.filter((l) => l.id !== cur.player.locationId).map((l) => <option key={l.id} value={l.id}>{l.name}{w.locations.find((x) => x.id === cur.player.locationId)?.connections.includes(l.id) ? '' : ' (연결 안 됨)'}</option>)}</select>
          <button type="button" disabled={!moveTo} onClick={() => act(`🧭 ${w.locations.find((l) => l.id === moveTo)?.name} 이동`, () => labMove(w, cur, moveTo))}>이동</button>
          <button type="button" onClick={() => act('⏱ 1시간', () => labWait(w, cur, 60))}>+1시간</button>
          <button type="button" onClick={() => act('⏱ 하루', () => labWait(w, cur, 1440))}>+1일</button>
          <button type="button" onClick={() => act('⏱ 일주일', () => labWait(w, cur, 1440 * 7))}>+7일</button>
        </div>
        {(w.rules ?? []).some((r) => r.trigger.kind === 'action') && (
          <div className="lab-row">
            <input value={input} placeholder="플레이어 입력 시험 — 낱말로 걸리는 행동 규칙" onChange={(e) => setInput(e.target.value)} />
            <button type="button" disabled={!input.trim()} onClick={() => act(`⌨ "${input}"`, () => labInput(w, cur, input))}>입력 시험</button>
          </div>
        )}
        <details><summary className="small">✦ 아무 효과나 적용해 보기</summary>
          <EffectsEditor label="적용할 효과" value={fx} w={w} onChange={setFx} />
          <button type="button" disabled={!fx.length} onClick={() => act('✦ 효과 적용', () => labEffects(w, cur, fx))}>적용 → 이어지는 일</button>
        </details>
      </div>

      {log.length > 0 && (
        <div className="lab-box">
          <b>③ 일어난 일</b> <span className="small muted">(최근 것이 위)</span>
          <ol className="lab-log small">{log.map((e, i) => (
            <li key={log.length - i}><b>{e.title}</b>{e.error && <span className="err"> — {e.error}</span>}{e.lines.length > 0 && <ul>{e.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>}</li>
          ))}</ol>
        </div>
      )}

      <div className="lab-box" ref={rowsRef}>
        <b>④ 장치별 상태 · 항목 시험</b>
        <div className="lab-filters">
          <button type="button" className={kind === 'all' ? 'primary' : ''} onClick={() => setKind('all')}>전체</button>
          {kinds.map((k) => <button key={k} type="button" className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k] ?? k}</button>)}
          <select value={only} onChange={(e) => setOnly(e.target.value as 'all' | 'ok' | 'no')} aria-label="보기"><option value="all">✓·✗ 모두</option><option value="ok">✓ 참만</option><option value="no">✗ 거짓만</option></select>
        </div>
        <ul className="lab-rows">
          {rows.map((r) => { const key = `${r.kind}:${r.id}`; const isOpen = open === key; return (
            <li key={key} id={`lab-${r.kind}-${r.id}`} className={isOpen ? 'open' : ''}>
              <button type="button" className="lab-row-head" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                <span className={r.ok ? 'ok' : 'no'}>{r.ok ? '✓' : '✗'}</span>
                <span className="lab-row-name"><span className="muted small">{KIND_LABEL[r.kind]}</span> {r.name}</span>
                <span className="lab-row-status small muted">{r.status}</span>
              </button>
              {isOpen && (
                <div className="lab-row-body">
                  {r.cond ? <TraceView t={condTrace(w, cur, r.cond)} w={w} /> : <p className="small muted">조건 없음</p>}
                  {extra(r)}
                </div>
              )}
            </li>
          ); })}
          {!rows.length && <li className="small muted">해당하는 장치가 없습니다.</li>}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 자동 플레이 · 전체 점검

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '-');

function Blockers({ w, rep, c }: { w: WorldPackage; rep: AutoReport; c: Condition }) {
  const b = blockers(w, rep.finals, c).slice(0, 6);
  return <ul className="small lab-list">{b.map((x, i) => <li key={i}><span className={x.pct ? '' : 'err'}>{x.pct}%</span> {describeCondition(x.c, w)}{'knows' in x.c && x.pct < 50 && holders(w, x.c.knows) ? <span className="muted"> — 아는 곳: {holders(w, x.c.knows)}</span> : null}</li>)}</ul>;
}

export function AutoPlayPanel({ w }: { w: WorldPackage }) {
  const [runs, setRuns] = useState(20);
  const [steps, setSteps] = useState(300);
  const [style, setStyle] = useState<AutoStyle>('balanced');
  const [keepGoing, setKeepGoing] = useState(true);
  const [useSetup, setUseSetup] = useState(false);
  const [busy, setBusy] = useState(0);
  const [rep, setRep] = useState<AutoReport | null>(null);
  const abort = useRef<AbortController | null>(null);
  const issues = useMemo(() => validateWorld(w), [w]);
  const flows = useMemo(() => flowWarnings(w), [w]);
  const go = async () => {
    abort.current = new AbortController();
    setBusy(0.001); setRep(null);
    try {
      const r = await autoPlay(w, { runs, steps, style, keepGoing, ...(useSetup ? { setup: loadSetup(w) } : {}) }, (d) => setBusy(d), abort.current.signal);
      setRep(r);
    } finally { setBusy(0); }
  };
  const ns = rep ? neverSeen(w, rep) : null;
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <div className="lab">
      <div className="lab-box">
        <b>전체 점검 (정적)</b>
        <ul className="small lab-list">
          <li>{errors ? <span className="err">❌ 오류 {errors}개</span> : '✓ 오류 없음'} · 경고 {issues.length - errors}개 <span className="muted">(편집기 위쪽 검사 목록에서 눌러 이동)</span></li>
          {flows.length ? flows.slice(0, 8).map((f, i) => <li key={i}>⚠ {f}</li>) : <li>✓ 플래그 흐름: 세우는 곳 없는 플래그 없음</li>}
          {flows.length > 8 && <li className="muted">… 외 {flows.length - 8}개 (보드·지도 탭의 이야기 보드)</li>}
        </ul>
      </div>
      <div className="lab-box">
        <b>자동 플레이 (AI 없이 무작위 플레이어)</b>
        <p className="small muted">매 걸음 지금 할 수 있는 행동(이동·대화·도발·조사·줍기·결정·규칙 행동·전투·장면·결정적 선택·휴식) 중 하나를 고르고, 엔진이 결과와 연쇄를 확정합니다. 대화하면 NPC가 아는 것을 전하고(비밀은 신뢰가 쌓여야) 건넬 것을 건넵니다. 판정·전투는 주사위로. 여러 번 돌려 결말·임무·규칙·장면이 실제로 닿는지 봅니다.</p>
        <div className="lab-grid">
          <label>실행 횟수<select value={runs} onChange={(e) => setRuns(Number(e.target.value))}>{[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}번</option>)}</select></label>
          <label>한 번에 걸음<select value={steps} onChange={(e) => setSteps(Number(e.target.value))}>{[100, 300, 600, 1000].map((n) => <option key={n} value={n}>{n}걸음</option>)}</select></label>
          <label>플레이 성향<select value={style} onChange={(e) => setStyle(e.target.value as AutoStyle)}>{(Object.keys(AUTO_STYLE_LABEL) as AutoStyle[]).map((k) => <option key={k} value={k}>{AUTO_STYLE_LABEL[k]}</option>)}</select></label>
        </div>
        <label className="check small"><input type="checkbox" checked={keepGoing} onChange={(e) => setKeepGoing(e.target.checked)} />죽어도 HP 1로 일어나 계속 (이야기 도달을 보려고)</label>
        <label className="check small"><input type="checkbox" checked={useSetup} onChange={(e) => setUseSetup(e.target.checked)} />상태 시험대에서 만든 상태에서 시작</label>
        <div className="lab-actions">
          <button type="button" className="primary" disabled={!!busy || errors > 0} onClick={() => void go()}>{busy ? `돌리는 중… ${Math.floor(busy)}/${runs}` : '▶ 자동 플레이'}</button>
          {!!busy && <button type="button" onClick={() => abort.current?.abort()}>멈추기</button>}
          {errors > 0 && <span className="small err">검사 오류를 먼저 고치세요.</span>}
        </div>
      </div>
      {rep && ns && (
        <>
          <div className="lab-box">
            <b>결과 — {rep.runs}번 · {rep.steps}걸음 · {AUTO_STYLE_LABEL[rep.style]}</b>
            <div className="lab-stats">
              <div><b>{pct(rep.runs - rep.noEnding, rep.runs)}</b><span>결말 도달</span></div>
              <div><b>{Object.keys(rep.endings).length}/{(w.endings ?? []).length}</b><span>나온 결말 종류</span></div>
              <div><b>{rep.avgLevel}</b><span>평균 레벨</span></div>
              <div><b>{rep.deaths}</b><span>쓰러져 죽음{keepGoing ? ' (계속함)' : ''}</span></div>
              {rep.stuck > 0 && <div><b className="err">{rep.stuck}</b><span>할 일이 없어 멈춤</span></div>}
            </div>
            {(w.endings ?? []).length > 0 && <table className="lab-table small"><tbody>{(w.endings ?? []).map((e) => { const x = rep.endings[e.id]; return (
              <tr key={e.id}><td>{e.name}</td><td><span className="lab-bar" style={{ width: `${x ? Math.max(4, (x.n / rep.runs) * 100) : 0}%` }} /></td><td>{x ? `${pct(x.n, rep.runs)} · 평균 ${x.avgStep}걸음` : <span className="err">0</span>}</td></tr>); })}
              <tr><td className="muted">결말 없이 끝남</td><td><span className="lab-bar muted-bar" style={{ width: `${(rep.noEnding / rep.runs) * 100}%` }} /></td><td>{pct(rep.noEnding, rep.runs)}</td></tr></tbody></table>}
          </div>
          {(ns.endings.length + ns.quests.length + ns.questsNeverDone.length + ns.rules.length + ns.flags.length + ns.scenes.length + ns.encounters.length + ns.choices.length) > 0 && (
            <div className="lab-box">
              <b>한 번도 일어나지 않은 것</b> <span className="small muted">— 무작위 플레이어 기준이라 실제로 막힌 것과 드문 것이 섞여 있습니다. %는 실행이 끝났을 때 그 조건이 참이던 비율 (낮은 것이 막힌 곳)</span>
              {ns.endings.map((e) => <details key={e.id}><summary className="small">🏁 결말 「{e.name}」</summary><Blockers w={w} rep={rep} c={e.condition} /></details>)}
              {ns.quests.map((q) => <details key={q.id}><summary className="small">📜 시작되지 않은 임무 「{q.name}」</summary><Blockers w={w} rep={rep} c={q.start} /></details>)}
              {ns.questsNeverDone.map((q) => {
                const stages = rep.finals.map((s) => s.quests[q.id]).filter((p) => p && !p.done && !p.failed).map((p) => p!.stage);
                const top = stages.length ? [...stages].sort((a, b) => stages.filter((x) => x === b).length - stages.filter((x) => x === a).length)[0]! : 0;
                const st = q.stages[top];
                return <details key={q.id}><summary className="small">📜 끝나지 않은 임무 「{q.name}」 — 주로 {top + 1}단계에서 멈춤</summary>{st && <><p className="small">{st.objective}</p><Blockers w={w} rep={rep} c={st.complete} /></>}</details>;
              })}
              {ns.choices.map((c) => <details key={c.id}><summary className="small">◆ 열리지 않은 결정 「{c.name}」</summary><Blockers w={w} rep={rep} c={c.when} /></details>)}
              {ns.rules.length > 0 && <details><summary className="small">⚖ 발동하지 않은 규칙 {ns.rules.length}개</summary><ul className="small lab-list">{ns.rules.map((r) => <li key={r.id}>{r.name}{r.trigger.kind === 'state' ? <Blockers w={w} rep={rep} c={r.trigger.condition} /> : <span className="muted"> (행동 규칙 — 추가 조건이 늘 거짓이었을 수 있음)</span>}</li>)}</ul></details>}
              {ns.flags.length > 0 && <details><summary className="small">🚩 서지 않은 플래그 {ns.flags.length}개</summary><ul className="small lab-list">{ns.flags.map((f) => <li key={f.id}>{f.id}{f.requires ? <Blockers w={w} rep={rep} c={f.requires} /> : null}</li>)}</ul></details>}
              {ns.scenes.length > 0 && <p className="small">🎭 시작되지 않은 장면: {ns.scenes.map((d) => d.name).join(', ')}</p>}
              {ns.encounters.length > 0 && <p className="small">⚔ 싸우지 않은 조우: {ns.encounters.map((e) => e.name).join(', ')}</p>}
            </div>
          )}
          <div className="lab-box">
            <b>세부</b>
            {(w.quests ?? []).length > 0 && <details open><summary className="small">📜 임무</summary><table className="lab-table small"><thead><tr><th>임무</th><th>시작</th><th>완료</th><th>실패</th></tr></thead><tbody>{w.quests!.map((q) => { const x = rep.quests[q.id]; return <tr key={q.id}><td>{q.name}</td><td>{pct(x?.started ?? 0, rep.runs)}</td><td>{pct(x?.done ?? 0, rep.runs)}</td><td>{pct(x?.failed ?? 0, rep.runs)}</td></tr>; })}</tbody></table></details>}
            {(w.rules ?? []).length > 0 && <details><summary className="small">⚖ 규칙 발동</summary><table className="lab-table small"><thead><tr><th>규칙</th><th>한 번이라도 발동한 실행</th></tr></thead><tbody>{w.rules!.map((r) => <tr key={r.id}><td>{r.name}</td><td>{pct(rep.rules[r.id] ?? 0, rep.runs)}</td></tr>)}</tbody></table></details>}
            {Object.keys(rep.encounters).length > 0 && <details><summary className="small">⚔ 조우 <span className="muted">— 자동 조작 기준</span></summary><table className="lab-table small"><thead><tr><th>조우</th><th>싸움</th><th>승리</th><th>쓰러짐</th></tr></thead><tbody>{Object.entries(rep.encounters).map(([id, x]) => <tr key={id}><td>{w.encounters?.find((e) => e.id === id)?.name ?? id}</td><td>{x.fought}</td><td>{pct(x.victory, x.fought)}</td><td>{pct(x.defeat, x.fought)}</td></tr>)}</tbody></table></details>}
            {Object.keys(rep.scenes).length > 0 && <details><summary className="small">🎭 장면 (시작 · 끝 분포)</summary><ul className="small lab-list">{Object.entries(rep.scenes).map(([id, x]) => { const d = w.scenes?.find((s) => s.id === id); return <li key={id}>{d?.name ?? id}: {pct(x.started, rep.runs)} — {Object.entries(x.ends).map(([e, n]) => `${d?.ends.find((y) => y.id === e)?.name ?? e} ${n}`).join(' · ')}</li>; })}</ul></details>}
            {Object.keys(rep.choices).length > 0 && <details><summary className="small">◆ 결정 (고른 선택지)</summary><ul className="small lab-list">{Object.entries(rep.choices).map(([id, x]) => { const c = w.choices?.find((y) => y.id === id); return <li key={id}>{c?.name ?? id}: {Object.entries(x).map(([o, n]) => `${c?.options.find((y) => y.id === o)?.text ?? o} ${n}`).join(' · ')}</li>; })}</ul></details>}
            <details><summary className="small">🎲 한 행동 비율</summary><p className="small">{Object.entries(rep.actions).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${AUTO_ACTION_LABEL[k as keyof typeof AUTO_ACTION_LABEL] ?? k} ${n}`).join(' · ')}</p></details>
            <details><summary className="small">📃 첫 번째 실행 기록 ({rep.sample.steps}걸음{rep.sample.ending ? ` · 결말 「${rep.sample.ending.name}」` : ''})</summary><pre className="lab-trace small">{rep.sample.trace.join('\n')}</pre></details>
          </div>
        </>
      )}
    </div>
  );
}
