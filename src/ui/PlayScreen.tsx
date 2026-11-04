import { useEffect, useRef, useState } from 'react';
import { sampleWorld } from '../data/sample-world';
import { replay, type GameState } from '../engine/state/state';
import { runTurn } from '../gm/turn';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';
import { appendEvents, loadEvents, undoLastTurn } from '../storage/db';

/**
 * 같은 세이브를 두 탭에서 동시에 열면 이벤트 로그가 꼬이므로 Web Locks로 한 탭만 허용한다.
 */
function useSaveLock(saveId: string): 'pending' | 'held' | 'busy' {
  const [status, setStatus] = useState<'pending' | 'held' | 'busy'>('pending');
  useEffect(() => {
    if (!('locks' in navigator)) { setStatus('held'); return; }
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    navigator.locks.request(`worldforge-save-${saveId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { setStatus('busy'); return; }
      setStatus('held');
      await held;
    });
    return () => release();
  }, [saveId]);
  return status;
}

export function PlayScreen({ saveId, settings, onExit }: { saveId: string; settings: LlmSettings; onExit: () => void }) {
  const lock = useSaveLock(saveId);
  const [state, setState] = useState<GameState | null>(null);
  const [nextSeq, setNextSeq] = useState(0);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function reload() {
    const events = await loadEvents(saveId);
    setState(replay(events));
    setNextSeq((events.at(-1)?.seq ?? -1) + 1);
  }
  useEffect(() => { reload(); return () => abort.current?.abort(); }, [saveId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [state?.log.length, streaming]);

  async function submit() {
    if (!state || !input.trim() || streaming !== null) return;
    const text = input.trim();
    setInput(''); setError(''); setStreaming('');
    abort.current = new AbortController();
    try {
      const { events } = await runTurn(createLlmClient(settings), sampleWorld, state, text,
        (d) => setStreaming((p) => (p ?? '') + d), abort.current.signal);
      const turn = state.turn + 1;
      await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn, event })));
      await reload();
    } catch (e) {
      setError((e as Error).message);
      setInput(text); // 실패한 턴은 저장하지 않는다
    } finally {
      setStreaming(null);
    }
  }

  async function undo() {
    await undoLastTurn(saveId);
    await reload();
  }

  if (lock === 'busy') return <section className="panel"><p>이 세이브는 다른 탭에서 열려 있습니다.</p><button onClick={onExit}>돌아가기</button></section>;
  if (!state || lock === 'pending') return <p className="muted">불러오는 중…</p>;
  const loc = sampleWorld.locations.find((l) => l.id === state.player.locationId);

  return (
    <section className="play">
      <div className="scene-bar">
        <b>{loc?.name}</b>
        <span className="muted small">턴 {state.turn}</span>
        <span className="spacer" />
        <button onClick={undo} disabled={state.turn === 0 || streaming !== null}>↶ 턴 되돌리기</button>
        <button onClick={onExit}>나가기</button>
      </div>
      <div className="log">
        {state.log.map((e, i) => <p key={i} className={`entry ${e.kind}`}>{e.text}</p>)}
        {streaming !== null && <p className="entry narration">{streaming || '…'}</p>}
        <div ref={bottom} />
      </div>
      {error && <p className="status">❌ {error}</p>}
      <form className="input-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          value={input} rows={2} placeholder="무엇을 하시겠습니까? (예: 주변을 자세히 살펴본다)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
        />
        <button className="primary" disabled={streaming !== null}>행동</button>
      </form>
    </section>
  );
}
