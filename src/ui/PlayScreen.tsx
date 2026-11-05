import { useEffect, useRef, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { db } from '../storage/db';
import { findWorld } from '../storage/packages';
import { replay, type GameState } from '../engine/state/state';
import { runTurn } from '../gm/turn';
import { narrateCombat, playerCombatAction, playerEndTurn, setPartyOrder } from '../gm/combat';
import type { PartyOrder, Target } from '../engine/combat/combat';
import type { GameEvent } from '../engine/state/events';
import { CombatPanel } from './CombatPanel';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';
import { appendEvents, loadEvents, undoLastTurn } from '../storage/db';
import { CharacterPanel } from './CharacterPanel';
import { JournalPanel } from './JournalPanel';
import { AssetImage } from './AssetImage';
import { RichText } from './RichText';
import { ReskinContext } from './reskin';
import { reskinner } from '../engine/genre';
import { basicGuide } from '../gm/guide';
import { calendarDate } from '../engine/calendar';
import { ABILITIES, ABILITY_NAMES, SKILL_IDS, SKILLS, type SkillId } from '../engine/character/rules';
import { checkModifier } from '../engine/character/sheet';

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
import { pickSceneImage } from '../engine/assets';

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

/** 세이브가 쓰는 세계관 패키지를 찾아서 연다 */
export function PlayScreen(props: { saveId: string; settings: LlmSettings; onExit: () => void }) {
  const [world, setWorld] = useState<WorldPackage | null | 'missing'>(null);
  const [need, setNeed] = useState('');
  useEffect(() => {
    (async () => {
      const meta = await db.saves.get(props.saveId);
      if (!meta) { setWorld('missing'); return; }
      const w = await findWorld(meta.packageId, meta.packageVersion);
      setNeed(`${meta.packageId}@${meta.packageVersion}`);
      setWorld(w ?? 'missing');
    })();
  }, [props.saveId]);
  if (world === null) return <p className="muted">불러오는 중…</p>;
  if (world === 'missing') {
    return (
      <section className="panel">
        <p>이 세이브가 쓰는 세계관 패키지(<code>{need}</code>)가 없습니다. 패키지 파일을 가져온 뒤 다시 열어 주세요.</p>
        <button onClick={props.onExit}>돌아가기</button>
      </section>
    );
  }
  return <PlayWorld {...props} world={world} />;
}

function PlayWorld({ saveId, settings, onExit, world }: { saveId: string; settings: LlmSettings; onExit: () => void; world: WorldPackage }) {
  const lock = useSaveLock(saveId);
  const [state, setState] = useState<GameState | null>(null);
  const [nextSeq, setNextSeq] = useState(0);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('');
  const [use, setUse] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (streaming === null) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [streaming !== null]);
  const [panel, setPanel] = useState<'none' | 'sheet' | 'journal'>('none');
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function reload() {
    const events = await loadEvents(saveId);
    setState(replay(events));
    setNextSeq((events.at(-1)?.seq ?? -1) + 1);
  }
  useEffect(() => { reload(); return () => abort.current?.abort(); }, [saveId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [state?.log.length, streaming]);

  async function submit(choice?: string, choiceUse?: string) {
    const text = (choice ?? input).trim();
    if (!state || !text || streaming !== null) return;
    const turnUse = choice !== undefined ? choiceUse : use || undefined;
    if (choice === undefined) setUse('');
    if (choice === undefined) setInput(''); setError(''); setStreaming(''); setStage('AI에게 보내는 중'); setStartedAt(Date.now());
    abort.current = new AbortController();
    try {
      const { events } = await runTurn(createLlmClient(settings), world, state, text,
        (d) => setStreaming((p) => (p ?? '') + d), abort.current.signal, setStage, turnUse);
      const turn = state.turn + 1;
      await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn, event })));
      await reload();
    } catch (e) {
      setError(abort.current?.signal.aborted ? '중단했습니다. 이 턴은 저장되지 않았습니다.' : (e as Error).message);
      if (choice === undefined) setInput(text); // 실패한 턴은 저장하지 않는다
    } finally {
      setStreaming(null);
    }
  }

  /** 전투 이벤트를 현재 턴에 이어 저장하고, 전투가 끝났으면 한 번 서술한다. */
  async function commitCombat(make: (s: GameState) => GameEvent[]) {
    if (!state?.combat || streaming !== null) return;
    setError('');
    const before = state.combat;
    let events: GameEvent[];
    try { events = make(state); } catch (e) { setError((e as Error).message); return; }
    await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn: state.turn, event })));
    const all = await loadEvents(saveId);
    let after = replay(all);
    let seq = (all.at(-1)?.seq ?? -1) + 1;
    if (!after.combat) {
      const startIdx = after.log.findLastIndex((l) => l.kind === 'combat' && l.text.startsWith('⚔ 전투 시작'));
      const combatLog = after.log.slice(startIdx).filter((l) => l.kind === 'combat').map((l) => l.text);
      setStreaming(''); setStage('전투를 서술하는 중'); setStartedAt(Date.now());
      abort.current = new AbortController();
      let text: string;
      try {
        text = await narrateCombat(createLlmClient(settings), world, before, after, combatLog, (d) => setStreaming((p) => (p ?? '') + d), abort.current.signal);
      } catch (e) {
        setError(`전투 서술 실패: ${(e as Error).message}`);
        text = '전투가 끝났다.';
      }
      await appendEvents(saveId, [
        { saveId, seq: seq++, turn: after.turn, event: { type: 'narration', text } },
        { saveId, seq: seq++, turn: after.turn, event: basicGuide(world, after) },
      ]);
      setStreaming(null);
    }
    await reload();
  }

  async function undo() {
    await undoLastTurn(saveId);
    await reload();
  }

  if (lock === 'busy') return <section className="panel"><p>이 세이브는 다른 탭에서 열려 있습니다.</p><button onClick={onExit}>돌아가기</button></section>;
  if (!state || lock === 'pending') return <p className="muted">불러오는 중…</p>;
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  const locImage = loc ? pickSceneImage(world, loc.id, '', 'bar') : undefined;
  const date = calendarDate(world, state.worldMinutes);
  const rs = reskinner(world);
  const lastGuide = state.log.findLastIndex((l) => l.kind === 'guide');
  const canAct = streaming === null && !state.combat && !state.playerDead;

  return (
    <ReskinContext.Provider value={rs}>
    <section className="play">
      <div className="play-head">
      <div className="scene-bar">
        {locImage && <AssetImage pkg={world.manifest.id} id={locImage.id} alt={loc?.name ?? ''} className="loc-thumb" />}
        <b>{loc?.name}</b>
        {Object.keys(state.party).length > 0 && <span className="small muted">동행: {Object.values(state.party).map((c) => c.name).join(', ')}</span>}
        {date && <span className="small date">{date.label}{date.countdown && <b className={date.daysLeft !== undefined && date.daysLeft <= 7 ? 'dday urgent' : 'dday'}> · {date.countdown}</b>}</span>}
        <span className="muted small">{String(Math.floor(state.worldMinutes / 60) % 24).padStart(2, '0')}:{String(state.worldMinutes % 60).padStart(2, '0')} · 턴 {state.turn}</span>
        <span className="spacer" />
        <button onClick={() => setPanel((p) => (p === 'sheet' ? 'none' : 'sheet'))}>캐릭터 {panel === 'sheet' ? '▲' : '▼'}</button>
        <button onClick={() => setPanel((p) => (p === 'journal' ? 'none' : 'journal'))}>수첩 {panel === 'journal' ? '▲' : '▼'}</button>
        <button onClick={undo} disabled={state.turn === 0 || streaming !== null}>↶ 턴 되돌리기</button>
        <button onClick={onExit}>나가기</button>
      </div>
      {state.playerDead && (
        <div className="ending dead small">
          ✝ <b>당신은 죽었다.</b> 이 세계에서의 이야기는 여기서 끝났다. <b>↶ 턴 되돌리기</b>로 전투 전으로 돌아갈 수 있다.
        </div>
      )}
      {state.ending && (
        <div className="ending small">
          ◆ 결말: <b>{world.endings?.find((e) => e.id === state.ending)?.name}</b> — 이야기는 여기서 매듭지어졌다. 원하면 계속 이 세계를 돌아다닐 수 있다.
        </div>
      )}
      {panel !== 'none' && (
        <div className="head-panel">
          {panel === 'sheet' && <CharacterPanel sheet={state.player.sheet} party={state.party} />}
          {panel === 'journal' && <JournalPanel world={world} state={state} />}
        </div>
      )}
      </div>
      <div className="log">
        {state.log.map((e, i) => (
          <div key={i} className={`entry-wrap k-${e.kind}`}>
            {e.kind !== 'guide' && e.images && e.images.length > 0 && (
              <div className="scene-images">
                {e.images.map((im) => <figure key={im.id}><AssetImage pkg={world.manifest.id} id={im.id} alt={im.caption} /><figcaption>{im.caption}</figcaption></figure>)}
              </div>
            )}
            {e.kind === 'guide' ? (
              <div className={`guide ${i === lastGuide ? 'current' : 'past'}`}>
                {e.images && e.images.length > 0 && i === lastGuide && (
                  <div className="guide-faces">{e.images.map((im) => <span key={im.id} className="face"><AssetImage pkg={world.manifest.id} id={im.id} alt={im.caption} /><small>{im.caption}</small></span>)}</div>
                )}
                <p><b>🎲 GM</b> {e.text}</p>
                {e.suggestion && i === lastGuide && <p className="suggestion">💡 {e.suggestion}</p>}
                {i === lastGuide && canAct && e.choices && e.choices.length > 0 && (
                  <div className="choices">
                    {e.choices.map((c, k) => {
                      const sk = e.choiceSkills?.[k];
                      return (
                        <button key={k} type="button" onClick={() => submit(c, sk ? `skill:${sk}` : undefined)}>
                          {k + 1}. {c}{sk && sk in SKILLS && <span className="skill-badge">🎲 {SKILLS[sk as SkillId].name} {fmt(checkModifier(state.player.sheet, { kind: 'skill', skill: sk as SkillId }).total)}{state.player.sheet.skillProficiencies.includes(sk as SkillId) ? ' ★' : ''}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : <p className={`entry ${e.kind}`}>{e.kind === 'narration' ? <RichText text={e.text} /> : rs(e.text)}</p>}
          </div>
        ))}
        {streaming !== null && <p className="entry narration">{streaming ? <RichText text={streaming} /> : '…'}</p>}
        <div ref={bottom} />
      </div>
      {streaming !== null && (
        <div className="ai-status" role="status" aria-live="polite">
          <span className="spinner" /> <span>{stage || 'AI 처리 중'}… {Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}초</span>
          <span className="spacer" />
          <button type="button" className="small" onClick={() => abort.current?.abort()}>중단</button>
        </div>
      )}
      {error && <p className="status">❌ {error}</p>}
      {state.playerDead ? null : state.combat ? (
        <CombatPanel cs={state.combat} busy={streaming !== null} orders={state.partyOrders}
          onOrder={(npcId: string, order: PartyOrder) => commitCombat((s) => setPartyOrder(s, npcId, order))}
          onAct={(cardId: string, target: Target) => commitCombat((s) => playerCombatAction(world, s, cardId, target))}
          onEndTurn={() => commitCombat((s) => playerEndTurn(world, s))} />
      ) : (
      <form className="input-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <select className="use-select" value={use} onChange={(e) => setUse(e.target.value)} title="이 행동에 쓸 기술·능력치 (판정이 필요할 때 이것으로 굴린다)">
          <option value="">🎲 기술·능력 (자동)</option>
          <optgroup label="기술">
            {[...SKILL_IDS].sort((a, b) => Number(state.player.sheet.skillProficiencies.includes(b)) - Number(state.player.sheet.skillProficiencies.includes(a))).map((k) => (
              <option key={k} value={`skill:${k}`}>{SKILLS[k].name} {fmt(checkModifier(state.player.sheet, { kind: 'skill', skill: k }).total)}{state.player.sheet.skillProficiencies.includes(k) ? ' ★' : ''}</option>
            ))}
          </optgroup>
          <optgroup label="능력치">
            {ABILITIES.map((a) => <option key={a} value={`ability:${a}`}>{ABILITY_NAMES[a]} {fmt(checkModifier(state.player.sheet, { kind: 'ability', ability: a }).total)}</option>)}
          </optgroup>
        </select>
        <textarea
          value={input} rows={2} placeholder="선택지를 누르거나 직접 행동을 적으세요 (예: 주변을 자세히 살펴본다)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
        />
        <button className="primary" disabled={streaming !== null}>행동</button>
      </form>
      )}
    </section>
    </ReskinContext.Provider>
  );
}
