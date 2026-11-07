/**
 * 디버그 모드 화면 (v0.57): 턴마다 AI 요청·응답·파라미터와 엔진 처리(이벤트·상태 변화)를 본다.
 * 현재 상태 전체·세계 데이터 전체·세이브 이벤트 로그도 볼 수 있다.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { clearDebug, currentEntry, type DebugCall, type DebugEntry, debugOn, loadDebug, setDebugOn, subscribeDebug } from '../debug/trace';
import type { WorldPackage } from '../engine/schema';
import { replay, type GameState } from '../engine/state/state';
import { ROLE_LABEL, type Role } from '../llm/metrics';
import { loadEvents } from '../storage/db';
import type { StoredEvent } from '../engine/state/events';

export function useDebugOn(): boolean { return useSyncExternalStore(subscribeDebug, debugOn); }

export function DebugToggle() {
  const on = useDebugOn();
  return (
    <label className="check small"><input type="checkbox" checked={on} onChange={(e) => setDebugOn(e.target.checked)} /> 🐞 디버그 모드 — 턴마다 AI 요청·응답·파라미터와 엔진 처리를 기록 (이 브라우저에만, API 키는 기록 안 함)</label>
  );
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString();
const KIND_ICON: Record<DebugEntry['kind'], string> = { turn: '▶', combat: '⚔', scene: '🎭', items: '🎒', other: '✦' };
const roleName = (r: string) => ROLE_LABEL[r as Role] ?? r;
const size = (s: string) => (s.length > 1024 ? `${(s.length / 1024).toFixed(1)}K자` : `${s.length}자`);
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const copy = (s: string) => { void navigator.clipboard?.writeText(s).catch(() => {}); };

// ---------------------------------------------------------------- 공용 보기

/** 긴 글: 접기 + 복사 */
function TextBlock({ title, text, open }: { title: string; text: string; open?: boolean }) {
  return (
    <details className="dbg-block" open={open}>
      <summary><b>{title}</b> <span className="muted small">{size(text)}</span> <button className="link small" onClick={(e) => { e.preventDefault(); copy(text); }}>복사</button></summary>
      <pre className="dbg-pre">{text}</pre>
    </details>
  );
}

/** JSON 나무 — 펼친 곳만 그린다 (큰 데이터도 가볍게) */
export function JsonTree({ value, name, depth = 0, open }: { value: unknown; name?: string; depth?: number; open?: boolean }) {
  const [isOpen, setOpen] = useState(open ?? depth < 1);
  const label = name !== undefined ? <span className="dbg-key">{name}: </span> : null;
  if (value === null || typeof value !== 'object') {
    const s = typeof value === 'string' ? JSON.stringify(value) : String(value);
    return <div className="dbg-leaf">{label}<span className={`dbg-${value === null ? 'null' : typeof value}`}>{s.length > 600 ? <LongString s={s} /> : s}</span></div>;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const brief = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <details className="dbg-node" open={isOpen} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{label}<span className="muted">{brief}</span>{depth === 0 && <> <button className="link small" onClick={(e) => { e.preventDefault(); copy(JSON.stringify(value, null, 2)); }}>복사</button></>}</summary>
      {isOpen && <div className="dbg-children">{entries.slice(0, 500).map(([k, v]) => <JsonTree key={k} name={k} value={v} depth={depth + 1} />)}{entries.length > 500 && <div className="muted small">… {entries.length - 500}개 더 (JSON 내보내기로 전부 보기)</div>}</div>}
    </details>
  );
}
function LongString({ s }: { s: string }) {
  const [all, setAll] = useState(false);
  return <>{all ? s : `${s.slice(0, 600)}…`} <button className="link small" onClick={() => setAll(!all)}>{all ? '접기' : `전부 (${size(s)})`}</button></>;
}

// ---------------------------------------------------------------- AI 호출

function CallView({ c, i }: { c: DebugCall; i: number }) {
  const u = c.usage;
  return (
    <details className="dbg-call" open={false}>
      <summary>
        <b>#{i + 1} {roleName(c.role)}</b> <span className="muted small">{c.kind === 'json' ? '구조화(JSON)' : '스트리밍 글'} · {c.model}{c.ms !== undefined ? ` · ${(c.ms / 1000).toFixed(1)}초` : ' · 진행 중…'}{u ? ` · 입력 ${u.input} / 출력 ${u.output} 토큰${u.estimated ? '(추정)' : ''}` : ''}{c.attempts.length > 1 ? ` · 요청 ${c.attempts.length}번` : ''}</span>
        {c.error && <span className="warn-text small"> ❌ {c.error.slice(0, 80)}</span>}
      </summary>
      <div className="dbg-call-body">
        <p className="small">제공자: <code>{c.provider}</code> · 모델: <code>{c.model}</code> · max_tokens: <code>{c.params.maxTokens}</code>{c.params.effort ? <> · effort: <code>{c.params.effort}</code></> : null}{c.label ? <> · 이름: {c.label}</> : null} · 시작 {fmtTime(c.at)}</p>
        <TextBlock title="시스템 프롬프트" text={c.system} />
        <TextBlock title="사용자 프롬프트 (게임 컨텍스트)" text={c.user} />
        {c.schema && <details className="dbg-block"><summary><b>응답 스키마</b></summary><JsonTree value={c.schema} /></details>}
        {c.attempts.length === 0 && <p className="small muted">실제 요청 기록 없음 (저장된 결과를 다시 썼거나, 요청 전에 멈춤)</p>}
        {c.attempts.map((a, j) => (
          <details key={j} className="dbg-block">
            <summary><b>실제 요청 {j + 1}</b> <span className="muted small">{a.endpoint} · {fmtTime(a.at)}{a.ms !== undefined ? ` · ${(a.ms / 1000).toFixed(1)}초` : ''}{a.status !== undefined ? ` · ${a.status}` : ''}</span>{a.error && <span className="warn-text small"> ❌ {a.error.slice(0, 80)}</span>}</summary>
            <p className="small muted">요청 본문 (API 키·헤더 제외)</p>
            <JsonTree value={a.request} open />
            {a.meta && <><p className="small muted">응답 정보</p><JsonTree value={a.meta} open /></>}
            {a.raw !== undefined && <TextBlock title="응답 원문" text={a.raw} />}
          </details>
        ))}
        {c.output !== undefined && <TextBlock title="최종 결과 (글)" text={c.output} open />}
        {c.parsed !== undefined && <details className="dbg-block" open><summary><b>최종 결과 (해석한 JSON)</b></summary><JsonTree value={c.parsed} open /></details>}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- 한 턴

function EntryView({ e, saveId }: { e: DebugEntry; saveId?: string }) {
  const [tab, setTab] = useState<'sum' | 'calls' | 'events' | 'diff' | 'state'>('sum');
  const [snap, setSnap] = useState<GameState | null | 'loading'>(null);
  const tokens = e.calls.reduce((s, c) => ({ i: s.i + (c.usage?.input ?? 0), o: s.o + (c.usage?.output ?? 0) }), { i: 0, o: 0 });
  useEffect(() => { setTab('sum'); setSnap(null); }, [e.id]);
  async function loadSnap() {
    if (!saveId || e.turn === undefined) return;
    setSnap('loading');
    const all = await loadEvents(saveId);
    setSnap(replay(all.filter((x) => x.turn <= e.turn!)));
  }
  const t = (id: typeof tab, label: string) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); if (id === 'state' && snap === null) void loadSnap(); }}>{label}</button>;
  return (
    <div className="dbg-entry">
      <div className="row"><b>{KIND_ICON[e.kind]} {e.title}</b><span className="spacer" /><span className="muted small">{fmtTime(e.at)}{e.ms !== undefined ? ` · ${(e.ms / 1000).toFixed(1)}초` : ' · 진행 중…'}</span></div>
      <div className="tabs dbg-tabs">
        {t('sum', '요약')}
        {t('calls', `AI 호출 ${e.calls.length}`)}
        {t('events', `이벤트 ${e.events?.length ?? 0}`)}
        {t('diff', `상태 변화 ${e.diff?.length ?? 0}`)}
        {saveId && e.turn !== undefined && t('state', '이 시점 상태')}
      </div>
      {tab === 'sum' && (
        <div className="dbg-sum">
          {e.input !== undefined && <p><b>플레이어 입력</b>: {e.input}</p>}
          {e.use && <p><b>쓰겠다고 고른 것</b>: <code>{e.use}</code></p>}
          {e.decision !== undefined && <p><b>결정적 선택</b>: <code>{JSON.stringify(e.decision)}</code></p>}
          {e.error && <p className="warn-text">❌ {e.error}</p>}
          <p className="small">AI 호출 {e.calls.length}번 · 입력 {tokens.i} / 출력 {tokens.o} 토큰 · 이벤트 {e.events?.length ?? 0}개 · 상태 변화 {e.diff?.length ?? 0}곳</p>
          {e.stages.length > 0 && (
            <><b className="small">진행 단계</b>
              <ol className="small dbg-stages">{e.stages.map((s, i) => <li key={i}><span className="muted">+{((s.at - e.at) / 1000).toFixed(1)}초</span> {s.text}</li>)}</ol></>
          )}
          {e.calls.length > 0 && (
            <><b className="small">AI 호출 순서</b>
              <ol className="small dbg-stages">{e.calls.map((c) => <li key={c.id}>{roleName(c.role)} <span className="muted">— {c.model}{c.ms !== undefined ? `, ${(c.ms / 1000).toFixed(1)}초` : ''}{c.error ? ' ❌' : ''}</span></li>)}</ol></>
          )}
          <b className="small">엔진이 거부한 AI 제안 ({e.rejected?.length ?? 0})</b>
          {e.rejected?.length ? <ul className="small warn-list">{e.rejected.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="small muted">없음</p>}
          {e.newLog && e.newLog.length > 0 && (
            <><b className="small">새로 생긴 기록 ({e.newLog.length})</b>
              <ul className="small dbg-log">{e.newLog.map((l, i) => <li key={i}><code>{l.kind}</code> {l.text.length > 300 ? `${l.text.slice(0, 300)}…` : l.text}</li>)}</ul></>
          )}
          {e.notes.map((n, i) => <details key={i} className="dbg-block"><summary><b>{n.label}</b></summary><JsonTree value={n.data} open /></details>)}
        </div>
      )}
      {tab === 'calls' && (e.calls.length ? e.calls.map((c, i) => <CallView key={c.id} c={c} i={i} />) : <p className="muted small">이 동작은 AI를 부르지 않았습니다 (엔진만).</p>)}
      {tab === 'events' && (
        e.events?.length
          ? <ol className="dbg-events">{e.events.map((ev, i) => <li key={i} className="dbg-ev"><span className="muted small">{i + 1}.</span><JsonTree name={ev.type} value={ev} depth={1} /></li>)}</ol>
          : <p className="muted small">이벤트 없음{!e.done ? ' (진행 중)' : ''}</p>
      )}
      {tab === 'diff' && (
        e.diff?.length
          ? <table className="dbg-diff small"><thead><tr><th>경로</th><th>전</th><th>후</th></tr></thead><tbody>
              {e.diff.map((d, i) => <tr key={i}><td><code>{d.path}</code></td><td>{d.before === undefined ? <span className="muted">—</span> : <JsonTree value={d.before} depth={1} />}</td><td>{d.after === undefined ? <span className="muted">—</span> : <JsonTree value={d.after} depth={1} />}</td></tr>)}
            </tbody></table>
          : <p className="muted small">바뀐 상태 없음{!e.done ? ' (진행 중)' : ''}</p>
      )}
      {tab === 'state' && (snap === 'loading' || snap === null ? <p className="muted small">계산하는 중…</p> : <><p className="small muted">턴 {e.turn}까지의 이벤트로 다시 계산한 상태입니다.</p><JsonTree value={snap} open /></>)}
    </div>
  );
}

// ---------------------------------------------------------------- 패널

export function DebugPanel({ saveId, world, state, onClose }: { saveId?: string; world?: WorldPackage; state?: GameState; onClose: () => void }) {
  const [tab, setTab] = useState<'turns' | 'state' | 'world' | 'events'>('turns');
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<StoredEvent[] | null>(null);
  const [filter, setFilter] = useState('');
  const on = useDebugOn();
  useEffect(() => subscribeDebug(() => setTick((n) => n + 1)), []);
  useEffect(() => { void loadDebug(saveId).then(setEntries); }, [saveId, tick]);
  useEffect(() => { if (tab === 'events' && saveId) void loadEvents(saveId).then(setLog); }, [tab, saveId, tick]);
  const live = currentEntry();
  const list = useMemo(() => (live && !entries.some((e) => e.id === live.id) && (!saveId || live.saveId === saveId) ? [live, ...entries] : entries), [entries, live, tick]);
  const shown = list.filter((e) => !filter || `${e.title} ${e.input ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const selected = list.find((e) => e.id === sel) ?? list[0];
  const types = log ? [...new Set(log.map((x) => x.event.type))].sort() : [];
  const [evType, setEvType] = useState('');

  return (
    <div className="dbg-back" role="dialog" aria-label="디버그">
      <div className="dbg-panel">
        <div className="row dbg-head">
          <b>🐞 디버그</b>
          <div className="tabs dbg-tabs">
            {([['turns', `턴 기록 ${list.length}`], ['state', '현재 상태'], ['world', '세계 데이터'], ['events', '이벤트 로그']] as const).map(([id, l]) => (
              (id === 'turns' || (id === 'world' ? world : saveId)) && <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
            ))}
          </div>
          <span className="spacer" />
          <button onClick={onClose}>닫기</button>
        </div>
        {!on && <p className="small warn-text">디버그 모드가 꺼져 있어 새 기록이 남지 않습니다. <button className="link" onClick={() => setDebugOn(true)}>켜기</button></p>}

        {tab === 'turns' && (
          <div className="dbg-split">
            <div className="dbg-list">
              <div className="row">
                <input type="search" placeholder="찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <div className="row small">
                <button className="small" onClick={() => download(`worldforge-debug-${Date.now()}.json`, list)}>⤓ JSON 내보내기</button>
                <button className="small" onClick={() => confirm('디버그 기록을 지울까요?') && void clearDebug(saveId)}>지우기</button>
              </div>
              {shown.length === 0 && <p className="small muted">기록이 없습니다. 디버그 모드를 켜고 한 턴 진행해 보세요.</p>}
              <ul>
                {shown.map((e) => (
                  <li key={e.id}>
                    <button className={selected?.id === e.id ? 'on' : ''} onClick={() => setSel(e.id)}>
                      <span>{KIND_ICON[e.kind]} {e.title}</span>
                      <span className="muted small">{fmtTime(e.at)} · AI {e.calls.length}{e.rejected?.length ? ` · 거부 ${e.rejected.length}` : ''}{e.error ? ' · ❌' : ''}{!e.done ? ' · 진행 중' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="dbg-detail">{selected ? <EntryView e={selected} saveId={saveId} /> : null}</div>
          </div>
        )}
        {tab === 'state' && state && (
          <div className="dbg-scroll">
            <div className="row small"><span className="muted">턴 {state.turn} · 기록 {state.log.length}줄</span><span className="spacer" /><button className="small" onClick={() => download(`worldforge-state-t${state.turn}.json`, state)}>⤓ JSON 내보내기</button></div>
            <JsonTree value={state} open />
          </div>
        )}
        {tab === 'world' && world && (
          <div className="dbg-scroll">
            <div className="row small"><span className="muted">{world.manifest.name} · {world.manifest.id} v{world.manifest.version}</span></div>
            <JsonTree value={world} open />
          </div>
        )}
        {tab === 'events' && (
          <div className="dbg-scroll">
            <div className="row small">
              <select value={evType} onChange={(e) => setEvType(e.target.value)} style={{ width: 'auto' }}><option value="">모든 종류 ({log?.length ?? 0})</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              <span className="spacer" />
              {log && <button className="small" onClick={() => download(`worldforge-events-${saveId}.json`, log)}>⤓ JSON 내보내기</button>}
            </div>
            {!log ? <p className="muted small">불러오는 중…</p> : (
              <ol className="dbg-events">
                {log.filter((x) => !evType || x.event.type === evType).slice(-500).reverse().map((x) => <li key={x.seq} className="dbg-ev"><span className="muted small nowrap">#{x.seq} · 턴 {x.turn}</span><JsonTree name={x.event.type} value={x.event} depth={1} /></li>)}
              </ol>
            )}
            <p className="small muted">세이브의 모든 상태는 이 이벤트들을 차례로 적용해 만듭니다 (최근 500개 표시).</p>
          </div>
        )}
      </div>
    </div>
  );
}
