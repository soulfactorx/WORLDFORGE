import { useEffect, useRef, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { db } from '../storage/db';
import { findWorld } from '../storage/packages';
import { replay, type GameState } from '../engine/state/state';
import { runTurn } from '../gm/turn';
import { metrics } from '../llm/metrics';
import { pendingChoice } from '../engine/story';
import { equipItem, shopHere } from '../gm/economy';
import { BoardPanel, InventoryPanel, ShopPanel } from './InventoryPanel';
import { boardHere } from '../engine/jobs';
import { narrateCombat, playerCombatAction, playerEndTurn, setPartyOrder } from '../gm/combat';
import type { PartyOrder, Target } from '../engine/combat/combat';
import type { GameEvent } from '../engine/state/events';
import { CombatPanel } from './CombatPanel';
import { AvControls } from './AvControls';
import { moodOf, playSfx, setMusic, sfxForLog, speak, stopMusic, stopSpeaking, type Sfx } from './audio';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';
import { appendEvents, loadEvents, undoLastTurn } from '../storage/db';
import { CharacterPanel } from './CharacterPanel';
import { pendingChoices } from '../engine/character/build';
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
import { pickCharacterImage, pickSceneImage } from '../engine/assets';
import { levelUpInfo, recap, type RewardLine, rewardDiff } from '../engine/digest';
import { loadPlayPrefs } from './playPrefs';
import { ScenePanel } from './ScenePanel';
import { availableScenes, sceneDef } from '../engine/scene';
import { abandonSceneEvents, narrateScene, narrateSceneTurn, narrationMode, sceneActionEvents, startSceneEvents } from '../gm/scene';
import { CodexPanel } from './CodexPanel';
import { recordEnding } from './collection';
import { XpBar } from './Rewards';
import { LevelUpDialog, LootDialog, RecapCard, RewardBanner } from './Rewards';
import { effectiveItem, itemDef as itemDefOf } from '../engine/items';

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
  const [panel, setPanel] = useState<'none' | 'sheet' | 'journal' | 'codex' | 'items' | 'shop' | 'board'>('none');
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function reload() {
    const events = await loadEvents(saveId);
    setState(replay(events));
    setNextSeq((events.at(-1)?.seq ?? -1) + 1);
  }
  useEffect(() => { reload(); return () => abort.current?.abort(); }, [saveId]);
  // 자동 스크롤 (v0.51.1): 맨 아래를 보고 있을 때만 따라간다. 위로 올리면 멈추고 "↓ 새 글" 버튼으로 돌아온다.
  // 글이 길어질 때마다 끌어내리지 않으므로 AI가 쓰는 동안에도 마음대로 스크롤할 수 있다.
  const logRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [behind, setBehind] = useState(false);
  const scroller = (): HTMLElement => {
    const el = logRef.current;
    if (el && el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
    return (document.scrollingElement ?? document.documentElement) as HTMLElement;
  };
  const toBottom = () => { const s = scroller(); s.scrollTop = s.scrollHeight; };
  const followNow = () => { follow.current = true; setBehind(false); toBottom(); };
  const touching = useRef(false);
  useEffect(() => {
    // 맨 아래에 닿으면 다시 따라가고, 충분히 위에 있으면 멈춘다 (그 사이는 그대로)
    const onScroll = () => {
      const s = scroller(); const d = s.scrollHeight - s.scrollTop - s.clientHeight;
      if (d < 12) { follow.current = true; setBehind(false); } else if (d > 120) follow.current = false;
    };
    // 사용자의 손길을 먼저 본다: 새 글이 스크롤 이벤트보다 먼저 와도 끌어내리지 않게
    const stop = () => { follow.current = false; };
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) stop(); };
    const onKey = (e: KeyboardEvent) => { if (['PageUp', 'ArrowUp', 'Home'].includes(e.key) && !(e.target as HTMLElement)?.closest?.('textarea, input, select')) stop(); };
    const onTouchStart = () => { touching.current = true; };
    const onTouchEnd = () => { touching.current = false; onScroll(); };
    const el = logRef.current;
    el?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el?.removeEventListener('scroll', onScroll); window.removeEventListener('scroll', onScroll); window.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart); window.removeEventListener('touchend', onTouchEnd); window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [!!state, !!logRef.current]);
  // 손가락이 화면에 닿아 있는 동안은 절대 끌어내리지 않는다
  useEffect(() => { if (follow.current && !touching.current) toBottom(); else if (!follow.current) setBehind(true); }, [state?.log.length, streaming]);

  // 연출 (설계 v3 R10): 새로 생긴 기록에 효과음·음성, 장면에 맞는 음악
  const seenLog = useRef<number | null>(null);
  const [avTick, setAvTick] = useState(0);
  useEffect(() => {
    if (!state) return;
    const prev = seenLog.current;
    seenLog.current = state.log.length;
    if (prev === null || state.log.length <= prev) return; // 처음 불러올 때·되돌릴 때는 조용히
    const fresh = state.log.slice(prev);
    const sounds = [...new Set(fresh.map((l) => sfxForLog(l.kind, l.text)).filter((x): x is Sfx => !!x))].slice(0, 3);
    sounds.forEach((k, i) => setTimeout(() => playSfx(k), i * 180));
    const narr = fresh.filter((l) => l.kind === 'narration').at(-1);
    if (narr) speak(narr.text);
  }, [state?.log.length]);
  // 보상 연출 · 세션 훅 (설계 v4 E2): 새로 생긴 것만 보여 준다 (처음 불러올 때는 "지난 이야기", 되돌릴 때는 조용히)
  const prevState = useRef<GameState | null>(null);
  const [rewards, setRewards] = useState<RewardLine[]>([]);
  const [levelInfo, setLevelInfo] = useState<ReturnType<typeof levelUpInfo> | null>(null);
  const [showRecap, setShowRecap] = useState(false);
  const [loot, setLoot] = useState<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const prev = prevState.current;
    prevState.current = state;
    if (!prev) { if (state.ending) recordEnding(world.manifest.id, state.ending); if (state.turn > 0) setShowRecap(true); return; }
    if (state.log.length <= prev.log.length) return;
    if (state.ending && state.ending !== prev.ending) recordEnding(world.manifest.id, state.ending);
    // 표시 수준 (설계 v4 E8): 몰입형은 알림·창 없이 기록에만 남긴다
    if (loadPlayPrefs().display === 'immersive') return;
    const r = rewardDiff(world, prev, state);
    if (r.length) setRewards(r);
    const good = r.find((l) => l.itemId && (l.rarity === 'rare' || l.rarity === 'epic' || l.rarity === 'legendary'));
    if (good) setLoot(good.itemId!);
    if (state.player.sheet.level > prev.player.sheet.level) setLevelInfo(levelUpInfo(prev.player.sheet, state.player.sheet));
  }, [state]);
  // 격투 장르는 장면(턴제 격투) 중에도 전투 음악 (v0.49)
  const fightingNow = !!state?.combat || (world.genre?.id === 'fighting' && !!state?.scene);
  useEffect(() => { setMusic(state ? moodOf(world.genre?.id, fightingNow) : null); }, [fightingNow, world.genre?.id, avTick, !!state]);
  useEffect(() => () => { stopMusic(); stopSpeaking(); }, []);

  async function submit(choice?: string, choiceUse?: string, decision?: { choiceId: string; optionId: string }) {
    const text = (choice ?? input).trim();
    if (!state || !text || streaming !== null) return;
    const turnUse = choice !== undefined ? choiceUse : use || undefined;
    if (choice === undefined) setUse('');
    setRewards([]); setShowRecap(false); followNow();
    if (choice === undefined) setInput(''); setError(''); setStreaming(''); setStage('AI에게 보내는 중'); setStartedAt(Date.now());
    abort.current = new AbortController();
    try {
      const t0 = performance.now();
      const { events, rejected } = await runTurn(createLlmClient(settings), world, state, text,
        (d) => setStreaming((p) => (p ?? '') + d), abort.current.signal, setStage, turnUse, decision, { adaptive: loadPlayPrefs().adaptive });
      metrics.addTurn({ at: Date.now(), ms: Math.round(performance.now() - t0), rejected });
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

  /** 장면 (v0.47): 행동은 엔진만, 끝나면 서술 AI가 한 번 서술한다 */
  async function commitScene(make: (s: GameState) => GameEvent[]) {
    if (!state || streaming !== null) return;
    setError('');
    const sceneId = state.scene?.sceneId;
    const log = state.scene?.log ?? [];
    let events: GameEvent[];
    try { events = make(state); } catch (e) { setError((e as Error).message); return; }
    await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn: state.turn, event })));
    const all = await loadEvents(saveId);
    const after = replay(all);
    const def = sceneId ? sceneDef(world, sceneId) : undefined;
    // 장면 서술 (v0.50): 정해진 글만 / 끝날 때만 AI / 매 차례 AI — 플레이 설정이 장면 설정보다 우선
    const mode = def ? narrationMode(def, loadPlayPrefs().sceneNarration) : 'fixed';
    const lines = events.flatMap((e) => (e.type === 'scene_action' ? [e.line] : []));
    let seq = (all.at(-1)?.seq ?? -1) + 1;
    const narrate = async (label: string, run: (onText: (d: string) => void, signal: AbortSignal) => Promise<string>, fallback: string) => {
      setStreaming(''); setStage(label); setStartedAt(Date.now());
      abort.current = new AbortController();
      try { return await run((d) => setStreaming((p) => (p ?? '') + d), abort.current.signal); }
      catch (e) { setError(`${label} 실패: ${(e as Error).message}`); return fallback; }
    };
    if (sceneId && !after.scene && def) {
      const extra: GameEvent[] = [];
      if (mode !== 'fixed' && settings) {
        const text = await narrate('장면을 서술하는 중', (on, sig) => narrateScene(createLlmClient(settings), world, after, def, [...log, ...lines], on, sig), '장면이 끝났다.');
        extra.push({ type: 'narration', text });
      }
      extra.push(basicGuide(world, after));
      await appendEvents(saveId, extra.map((event) => ({ saveId, seq: seq++, turn: after.turn, event })));
      setStreaming(null);
    } else if (after.scene && def && mode === 'ai' && settings && lines.length) {
      const text = await narrate('차례를 서술하는 중', (on, sig) => narrateSceneTurn(createLlmClient(settings), world, after, def, lines.at(-1)!, on, sig), '');
      if (text.trim()) await appendEvents(saveId, [{ saveId, seq: seq++, turn: after.turn, event: { type: 'narration', text } }]);
      setStreaming(null);
    }
    await reload();
  }

  /** 소지품·상점: 이벤트를 현재 턴에 이어 저장한다 (AI 호출 없음) */
  async function commitEvents(make: (s: GameState) => GameEvent[]) {
    if (!state || streaming !== null) return;
    setError('');
    let events: GameEvent[];
    try { events = make(state); } catch (e) { setError((e as Error).message); return; }
    await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn: state.turn, event })));
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
  const imgSize = loadPlayPrefs().images;
  const lastGuide = state.log.findLastIndex((l) => l.kind === 'guide');
  const decisive = !state.combat && !state.ending && !state.playerDead ? pendingChoice(world, state) : undefined;
  const canAct = streaming === null && !state.combat && !state.scene && !state.playerDead;
  const sceneNow = state.scene ? sceneDef(world, state.scene.sceneId) : undefined;
  const scenesHere = canAct && !state.ending ? availableScenes(world, state, { auto: false }) : [];
  const shop = shopHere(world, state);
  const board = boardHere(world, state);

  return (
    <ReskinContext.Provider value={rs}>
    <section className={`play img-${imgSize}`}>
      <div className="play-head">
      <div className="scene-bar">
        {locImage && <AssetImage pkg={world.manifest.id} id={locImage.id} alt={loc?.name ?? ''} className="loc-thumb" zoom />}
        <b>{loc?.name}</b>
        {Object.keys(state.party).length > 0 && <span className="small muted">동행: {Object.values(state.party).map((c) => c.name).join(', ')}</span>}
        {date && <span className="small date">{date.label}{date.countdown && <b className={date.daysLeft !== undefined && date.daysLeft <= 7 ? 'dday urgent' : 'dday'}> · {date.countdown}</b>}</span>}
        {loadPlayPrefs().display === 'game' && <XpBar sheet={state.player.sheet} />}
        <span className="muted small nowrap">{String(Math.floor(state.worldMinutes / 60) % 24).padStart(2, '0')}:{String(state.worldMinutes % 60).padStart(2, '0')} · 턴 {state.turn}</span>
      </div>
      {/* 도구 줄: 넓은 화면은 한 줄, 휴대폰은 4칸 격자 (v0.37.7) */}
      <div className="head-tools">
        {(() => {
          const tab = (id: typeof panel, label: string, extra?: string) => (
            <button key={id} onClick={() => setPanel((p) => (p === id ? 'none' : id))} aria-expanded={panel === id} className={[panel === id ? 'on' : '', extra ?? ''].join(' ').trim() || undefined}>{label}</button>
          );
          const pending = pendingChoices(state.player.sheet);
          return [
            tab('sheet', `👤 캐릭터${pending ? ` ★${pending}` : ''}`, pending ? 'has-pending' : ''),
            tab('journal', '📖 수첩'),
            tab('codex', '📚 도감'),
            tab('items', '🎒 소지품'),
            ...(shop && !state.combat ? [tab('shop', `🛒 ${rs(shop.name)}`)] : []),
            ...(board && !state.combat ? [tab('board', `📜 ${rs(board.name)}`)] : []),
          ];
        })()}
        <AvControls onChange={() => setAvTick((n) => n + 1)} />
        <button onClick={undo} disabled={state.turn === 0 || streaming !== null} title="턴 되돌리기">↶ 되돌리기</button>
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
          {panel === 'sheet' && <CharacterPanel sheet={state.player.sheet} party={state.party} world={world} state={state} disabled={streaming !== null || !!state.playerDead} onChoose={(kind, value) => commitEvents(() => [{ type: 'build_choice', who: 'player', kind, value }])} />}
          {panel === 'journal' && <JournalPanel world={world} state={state} />}
          {panel === 'codex' && <CodexPanel world={world} state={state} />}
          {panel === 'items' && <InventoryPanel world={world} state={state} onCommit={commitEvents} disabled={streaming !== null || !!state.combat || !!state.playerDead} />}
          {panel === 'board' && (board && !state.combat ? <BoardPanel world={world} state={state} onCommit={commitEvents} disabled={streaming !== null || !!state.playerDead} /> : <p className="muted small">여기에는 의뢰판이 없다.</p>)}
          {panel === 'shop' && (shop && !state.combat ? <ShopPanel world={world} state={state} onCommit={commitEvents} disabled={streaming !== null || !!state.playerDead} /> : <p className="muted small">여기에는 상점이 없다.</p>)}
        </div>
      )}
      </div>
      <div className="log" ref={logRef}>
        {showRecap && <RecapCard r={recap(world, state)} rs={rs} onClose={() => setShowRecap(false)} onSheet={() => { setShowRecap(false); setPanel('sheet'); }} />}
        {state.log.map((e, i) => (
          <div key={i} className={`entry-wrap k-${e.kind}`}>
            {e.kind !== 'guide' && e.images && e.images.length > 0 && imgSize !== 'hidden' && (() => {
              const figs = <div className="scene-images">{e.images.map((im) => <figure key={im.id}><AssetImage pkg={world.manifest.id} id={im.id} alt={im.caption} zoom /><figcaption>{im.caption}</figcaption></figure>)}</div>;
              return imgSize === 'collapsed'
                ? <details className="scene-images-fold"><summary className="small muted">🖼 {e.images.map((im) => im.caption).join(' · ')}</summary>{figs}</details>
                : figs;
            })()}
            {e.kind === 'guide' ? (
              <div className={`guide ${i === lastGuide ? 'current' : 'past'}`}>
                {e.images && e.images.length > 0 && i === lastGuide && imgSize !== 'hidden' && imgSize !== 'collapsed' && (
                  <div className="guide-faces">{e.images.map((im) => <span key={im.id} className="face"><AssetImage pkg={world.manifest.id} id={im.id} alt={im.caption} zoom /><small>{im.caption}</small></span>)}</div>
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
        {decisive && streaming === null && (
          <div className="decisive" role="group" aria-label="결정의 순간">
            <p><b>◆ 결정의 순간 — {rs(decisive.name)}</b></p>
            <p>{rs(decisive.prompt)}</p>
            <div className="choices">
              {decisive.options.map((o) => (
                <button key={o.id} type="button" onClick={() => confirm(`"${o.text}" — 이 결정은 되돌리기 전에는 바꿀 수 없습니다. 고를까요?`) && submit(o.text, undefined, { choiceId: decisive.id, optionId: o.id })}>{rs(o.text)}</button>
              ))}
            </div>
            <p className="small muted">아직 정하지 않았다면 평소처럼 행동해도 됩니다. 이 선택은 고를 때까지 남아 있습니다.</p>
          </div>
        )}
        {streaming !== null && <p className="entry narration">{streaming ? <RichText text={streaming} /> : '…'}</p>}
        <div ref={bottom} />
      </div>
      {behind && <button type="button" className="jump-new" onClick={followNow}>↓ 새 글{streaming !== null ? ' (쓰는 중)' : ''}</button>}
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
          portrait={(id) => { const img = id === 'player' ? undefined : pickCharacterImage(world, id, 'battle', 'combat'); return img ? <AssetImage pkg={world.manifest.id} id={img.id} alt="" /> : undefined; }}
          onOrder={(npcId: string, order: PartyOrder) => commitCombat((s) => setPartyOrder(s, npcId, order))}
          onAct={(cardId: string, target: Target) => commitCombat((s) => playerCombatAction(world, s, cardId, target))}
          onEndTurn={() => commitCombat((s) => playerEndTurn(world, s))} />
      ) : state.scene && sceneNow ? (
        <ScenePanel def={sceneNow} run={state.scene} sheet={state.player.sheet} busy={streaming !== null} pkg={world.manifest.id}
          npcName={sceneNow.npcId ? world.characters.find((c) => c.id === sceneNow.npcId)?.name : undefined}
          onAct={(id) => commitScene((s) => sceneActionEvents(world, s, id))}
          onQuit={() => commitScene((s) => abandonSceneEvents(world, s))} />
      ) : (
      <>
      {rewards.length > 0 && <RewardBanner lines={rewards} onClose={() => setRewards([])} />}
      {scenesHere.length > 0 && (
        <div className="scene-start">{scenesHere.map((d) => (
          <button key={d.id} type="button" className="has-pending" title={d.description} onClick={() => commitScene((s) => startSceneEvents(world, s, d.id))}>🎭 {rs(d.name)}</button>
        ))}</div>
      )}
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
      </>
      )}
      {loot && !levelInfo && (() => {
        const raw = itemDefOf(world, loot);
        if (!raw) return null;
        const item = effectiveItem(world, state, raw);
        const canEquip = ['weapon', 'armor', 'shield', 'trinket'].includes(item.kind) && !state.combat && !Object.values(state.equipped ?? {}).includes(loot);
        return <LootDialog item={item} rs={rs} canEquip={canEquip} onClose={() => setLoot(null)} onEquip={() => { setLoot(null); commitEvents((s) => equipItem(world, s, loot)); }} />;
      })()}
      {levelInfo && <LevelUpDialog info={levelInfo} sheet={state.player.sheet} rs={rs} onClose={() => setLevelInfo(null)} onSheet={() => { setLevelInfo(null); setPanel('sheet'); }} />}
    </section>
    </ReskinContext.Provider>
  );
}
