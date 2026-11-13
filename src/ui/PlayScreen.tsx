import { genreKey } from '../engine/genre';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { db } from '../storage/db';
import { findWorld } from '../storage/packages';
import { applyEvent, replay, type GameState, type LogEntry } from '../engine/state/state';
import { runTurn, CONTINUE_INPUT, type ImagePlacer } from '../gm/turn';
import { type CallRecord, metrics } from '../llm/metrics';
import { beginDebug, debugStage, endDebug } from '../debug/trace';
import { DebugPanel, useDebugOn } from './DebugPanel';
import { pendingChoice } from '../engine/story';
import { equipItem, shopHere } from '../gm/economy';
import { BoardPanel, InventoryPanel, ShopPanel } from './InventoryPanel';
import { boardHere } from '../engine/jobs';
import { autoFightEvents, minorFight, narrateCombat, playerCombatAction, playerEndTurn, setPartyOrder } from '../gm/combat';
import { currentActorId } from '../engine/combat/combat';
import { currentPhase, tensionOf } from '../engine/phase';
import { stakeLabel } from '../engine/stakes';
import type { PartyOrder, Target } from '../engine/combat/combat';
import type { GameEvent } from '../engine/state/events';
import { CombatPanel } from './CombatPanel';
import { AvControls } from './AvControls';
import { moodOf, playSfx, setMusic, sfxForLog, speak, stopMusic, stopSpeaking, type Sfx } from './audio';
import { createLlmClient } from '../llm';
import { beginRun, endRun, setUsageScope } from '../llm/usage';
import { resumeEvents } from '../llm/visibility';
import { setGmStyleOverride } from '../data/gmStyles';
import type { LlmSettings } from '../llm/types';
import { appendEvents, loadEvents, undoLastTurn } from '../storage/db';
import { CharacterPanel } from './CharacterPanel';
import { pendingChoices } from '../engine/character/build';
import { JournalPanel } from './JournalPanel';
import { AssetImage } from './AssetImage';
import { RichText } from './RichText';
import { ReskinContext } from './reskin';
import { reskinner } from '../engine/genre';
import { basicGuide, CHOICE_KINDS, gmGuide, type ChoiceKind } from '../gm/guide';
import { calendarDate } from '../engine/calendar';
import { ABILITIES, ABILITY_NAMES, SKILL_IDS, SKILLS, type SkillId } from '../engine/character/rules';
import { checkModifier } from '../engine/character/sheet';
import { approachOf, APPROACH_IDS, APPROACHES, bestSkill } from '../engine/character/approaches';

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
import { paragraphsOf, pickCharacterImage, pickSceneImage } from '../engine/assets';
import type { NarrationImage } from '../engine/state/events';
import { levelUpInfo, recap, type RewardLine, rewardDiff } from '../engine/digest';
import { type BackgroundMode, type ImageSize, loadPlayPrefs } from './playPrefs';
import { ScenePanel } from './ScenePanel';
import { clampDcMod, difficultyLabel } from '../engine/difficulty';
import { availableScenes, sceneDef } from '../engine/scene';
import { abandonSceneEvents, narrateScene, narrateSceneTurn, narrationMode, sceneActionEvents, startSceneEvents, sceneOpponent } from '../gm/scene';
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
      if (w) setUsageScope({ world: w.manifest.id, worldName: w.manifest.name, saveId: props.saveId, area: 'play' });
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
  // 글이 흘러나오는 동안의 그림 (v0.88): 문단이 끝날 때마다 그 문단에 나온 인물의 그림을 그 앞에 놓는다
  const placer = useRef<ImagePlacer | null>(null);
  const placedParas = useRef(-1);
  const [streamImages, setStreamImages] = useState<NarrationImage[]>([]);
  const [narrated, setNarrated] = useState(false);
  // 서술 전에 엔진이 확정한 기록 (v0.90): 판정 결과·실마리·전투 시작을 서술보다 먼저 보여 준다
  const [pendingLog, setPendingLog] = useState<LogEntry[]>([]);
  /** 이미 놓인 그림은 그대로 두고 새 그림만 더한다 (배경 하나 · 인물은 이름마다 하나) */
  const addStreamImages = (found: NarrationImage[], all: boolean) => setStreamImages((cur) => {
    const key = (im: NarrationImage) => (im.bg ? 'bg' : `c:${im.caption}`);
    const have = new Set(cur.map(key));
    const fresh = found.filter((im) => !have.has(key(im)) && !cur.some((x) => x.id === im.id) && (all || im.bg || im.para !== undefined));
    return fresh.length ? [...cur, ...fresh] : cur;
  });
  useEffect(() => {
    if (streaming === null) { placer.current = null; placedParas.current = -1; setStreamImages((c) => (c.length ? [] : c)); setNarrated(false); setPendingLog((c) => (c.length ? [] : c)); return; }
    const place = placer.current;
    if (!place) return;
    // 끝난 문단만 본다 (쓰는 중인 마지막 문단은 아직 누구의 것인지 모른다)
    const cut = streaming.lastIndexOf('\n\n');
    const done = cut > 0 ? streaming.slice(0, cut) : '';
    const n = done ? paragraphsOf(done).length : 0;
    if (n !== placedParas.current) {
      placedParas.current = n;
      try { addStreamImages(place(done), false); } catch { /* 미리 보기 실패는 무시 */ }
    }
    // 서술이 다 나왔으면(기록·안내를 기다리는 중) 마지막 문단까지 놓고, 자리 없는 그림도 보여 준다
    if (narrated) { try { addStreamImages(place(streaming), true); } catch { /* 무시 */ } }
  }, [streaming, narrated]);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('');
  // GM 스타일: 플레이 설정이 세계 설정보다 우선 (v0.80). 화면을 떠나면 원래대로
  useEffect(() => { setGmStyleOverride(loadPlayPrefs().gmStyle); return () => setGmStyleOverride(undefined); }, []);
  // 모바일에서 앱을 벗어나 끊긴 AI 요청을 돌아와 다시 보낼 때 알린다 (v0.79.8)
  useEffect(() => {
    const on = () => setStage('앱을 벗어난 사이 연결이 끊겨 다시 요청하는 중…');
    resumeEvents?.addEventListener('resume', on);
    return () => resumeEvents?.removeEventListener('resume', on);
  }, []);
  const [use, setUse] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (streaming === null) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [streaming !== null]);
  const [panel, setPanel] = useState<'none' | 'sheet' | 'journal' | 'codex' | 'items' | 'shop' | 'board'>('none');
  const debug = useDebugOn();
  const [showDebug, setShowDebug] = useState(false);
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
  // 전투창에 보일 "방금 일어난 일"의 시작 위치 (v0.109): 마지막 전투 행동 직전의 기록 길이
  const combatMark = useRef(0);
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
  const fightingNow = !!state?.combat || (genreKey(world) === 'fighting' && !!state?.scene);
  const phaseNow = state ? currentPhase(world, state) : undefined;
  useEffect(() => { setMusic(state ? moodOf(world.genre?.id, fightingNow, phaseNow?.music) : null); }, [fightingNow, world.genre?.id, avTick, !!state, phaseNow?.music]);
  useEffect(() => () => { stopMusic(); stopSpeaking(); }, []);

  async function submit(choice?: string, choiceUse?: string, decision?: { choiceId: string; optionId: string }, stake?: string) {
    // 선택지도 입력도 없으면 "이어서" — 지금 흐름대로 자연스럽게 다음으로 (v0.79.9)
    const text = (choice ?? input).trim() || CONTINUE_INPUT;
    if (!state || streaming !== null) return;
    const turnUse = choice !== undefined ? choiceUse : use || undefined;
    if (choice === undefined) setUse('');
    setRewards([]); setShowRecap(false); setNotice(''); followNow();
    if (choice === undefined) setInput(''); setError(''); setStreaming(''); setStage('AI에게 보내는 중'); setStartedAt(Date.now());
    abort.current = new AbortController();
    const dbg = beginDebug('turn', `턴 ${state.turn + 1}: ${text.slice(0, 60)}`, { saveId, turn: state.turn + 1, input: text, ...(turnUse ? { use: turnUse } : {}), ...(decision ? { decision } : {}) });
    // 턴별 사용량 (v0.111): 이 턴의 호출을 한 작업으로 묶고, 요청 수·토큰·첫 글자까지의 시간을 남긴다
    const runId = beginRun(`턴 ${state.turn + 1}`);
    const turnCalls: CallRecord[] = [];
    let firstMs: number | undefined;
    try {
      const t0 = performance.now();
      const client = createLlmClient(settings, { sink: (r) => { metrics.addCall(r); turnCalls.push(r); } });
      const { events, rejected, state: after } = await runTurn(client, world, state, text,
        (d) => { if (firstMs === undefined && d) firstMs = Math.round(performance.now() - t0); setStreaming((p) => (p ?? '') + d); }, abort.current.signal, (st) => { setStage(st); debugStage(st); }, turnUse, decision,
        { ...(stake ? { stake } : {}), onImages: (place) => { placer.current = place; placedParas.current = -1; }, onNarrated: () => setNarrated(true),
          onState: (st) => setPendingLog(st.log.slice(state.log.length).filter((l) => l.kind !== 'narration' && l.kind !== 'guide')) });
      metrics.addTurn({ at: Date.now(), ms: Math.round(performance.now() - t0), rejected, calls: turnCalls.reduce((a, c) => a + c.calls, 0), input: turnCalls.reduce((a, c) => a + c.input, 0), output: turnCalls.reduce((a, c) => a + c.output, 0), ...(firstMs !== undefined ? { firstMs } : {}) });
      await endDebug(dbg, { events, before: state, after, rejected });
      const turn = state.turn + 1;
      await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn, event })));
      await reload();
    } catch (e) {
      await endDebug(dbg, { error: abort.current?.signal.aborted ? '중단 (저장 안 됨)' : String((e as Error).message) });
      setError(abort.current?.signal.aborted ? '중단했습니다. 이 턴은 저장되지 않았습니다.' : (e as Error).message);
      if (choice === undefined) setInput(text); // 실패한 턴은 저장하지 않는다
    } finally {
      endRun(runId);
      setStreaming(null);
    }
  }

  /** 전투 이벤트를 현재 턴에 이어 저장하고, 전투가 끝났으면 한 번 서술한다. */
  async function commitCombat(make: (s: GameState) => GameEvent[]) {
    if (!state?.combat || streaming !== null) return;
    setError('');
    combatMark.current = state.log.length; // 이 행동으로 생기는 기록부터 전투창의 "방금 일어난 일"에 보인다
    const before = state.combat;
    let events: GameEvent[];
    const dbg = beginDebug('combat', `전투 행동 (턴 ${state.turn}, 라운드 ${state.combat.round ?? '?'})`, { saveId, turn: state.turn });
    try { events = make(state); } catch (e) { setError((e as Error).message); await endDebug(dbg, { error: (e as Error).message }); return; }
    await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn: state.turn, event })));
    const all = await loadEvents(saveId);
    let after = replay(all);
    const stateBefore = state;
    let seq = (all.at(-1)?.seq ?? -1) + 1;
    // 전투가 끝났는가: 종료 이벤트로 판단한다 (v0.85: 끝나자마자 다음 전투·장면이 이어질 수 있다)
    if (events.some((e) => e.type === 'combat_ended')) {
      const endIdx = after.log.findLastIndex((l) => l.kind === 'combat' && l.text.startsWith('⚔ 전투 종료'));
      const startIdx = after.log.slice(0, endIdx).findLastIndex((l) => l.kind === 'combat' && l.text.startsWith('⚔ 전투 시작'));
      const combatLog = after.log.slice(Math.max(0, startIdx), endIdx + 1).filter((l) => l.kind === 'combat').map((l) => l.text);
      setStreaming(''); setStage('전투를 서술하는 중'); setStartedAt(Date.now());
      abort.current = new AbortController();
      let text: string;
      try {
        text = await narrateCombat(createLlmClient(settings), world, before, after, combatLog, events, (d) => setStreaming((p) => (p ?? '') + d), abort.current.signal);
      } catch (e) {
        setError(`전투 서술 실패: ${(e as Error).message}`);
        text = '전투가 끝났다.';
      }
      // 전투 뒤 선택지도 방금 일어난 일에서 이어지게 (v0.79.5: 정해진 문구 대신 AI 안내)
      const narr: GameEvent = { type: 'narration', text };
      // 곧바로 다음 전투·장면이 이어지면 선택지를 만들지 않는다 (그것이 끝난 뒤에 만든다)
      const extra: GameEvent[] = after.combat || after.scene ? [narr] : [narr, await guideAfter(applyEvent(after, narr, after.turn), text)];
      await appendEvents(saveId, extra.map((event) => ({ saveId, seq: seq++, turn: after.turn, event })));
      setStreaming(null);
    }
    if (dbg) { const fin = await loadEvents(saveId); await endDebug(dbg, { events: fin.slice(all.length - events.length).map((x) => x.event), before: stateBefore, after: replay(fin) }); }
    await reload();
  }

  /** 자동 전투 (v0.112): 엔진이 대신 싸우고, 위험해지면 멈춰 손을 넘긴다 */
  const [notice, setNotice] = useState('');
  const autoTried = useRef('');
  async function autoFight() {
    let stopped = false;
    await commitCombat((s) => { const r = autoFightEvents(world, s); stopped = r.stopped; return r.events; });
    setNotice(stopped ? '⚡ 위험해져 자동 전투를 멈췄다 — 이제 직접 싸운다.' : '');
  }
  // 잔챙이 전투는 시작하자마자 자동으로 (설정에서 끌 수 있다). 같은 전투에서 한 번만 — 멈춘 뒤에는 다시 돌리지 않는다
  useEffect(() => {
    const cs = state?.combat;
    if (!cs || cs.outcome || streaming !== null || !loadPlayPrefs().autoMinorFights || currentActorId(cs) !== 'player' || !minorFight(world, cs)) return;
    const key = `${cs.encounterId}@${state!.turn}`;
    if (autoTried.current === key) return;
    autoTried.current = key;
    setNotice('⚡ 잔챙이 전투 — 엔진이 대신 싸운다 (위험해지면 멈춘다).');
    void autoFight();
  }, [state?.combat?.encounterId, state?.combat?.round, streaming === null]);

  /** 장면 (v0.47): 행동은 엔진만, 끝나면 서술 AI가 한 번 서술한다 */
  async function commitScene(make: (s: GameState) => GameEvent[]) {
    if (!state || streaming !== null) return;
    setError('');
    const sceneId = state.scene?.sceneId;
    const log = state.scene?.log ?? [];
    let events: GameEvent[];
    const dbg = beginDebug('scene', `장면 행동${sceneId ? ` (${sceneId})` : ''} — 턴 ${state.turn}`, { saveId, turn: state.turn });
    try { events = make(state); } catch (e) { setError((e as Error).message); await endDebug(dbg, { error: (e as Error).message }); return; }
    const stateBefore = state;
    const firstSeq = nextSeq;
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
      let text = '';
      if (mode !== 'fixed' && settings) {
        text = await narrate('장면을 서술하는 중', (on, sig) => narrateScene(createLlmClient(settings), world, after, def, [...log, ...lines], events, on, sig), '장면이 끝났다.');
        extra.push({ type: 'narration', text });
      }
      // 장면이 끝난 뒤 선택지도 그 결과에서 이어지게 (v0.79.5)
      if (!after.combat && !after.scene) extra.push(text ? await guideAfter(applyEvent(after, extra[0]!, after.turn), text) : basicGuide(world, after));
      await appendEvents(saveId, extra.map((event) => ({ saveId, seq: seq++, turn: after.turn, event })));
      setStreaming(null);
    } else if (after.scene && def && mode === 'ai' && settings && lines.length) {
      const text = await narrate('차례를 서술하는 중', (on, sig) => narrateSceneTurn(createLlmClient(settings), world, after, def, lines.at(-1)!, on, sig), '');
      if (text.trim()) await appendEvents(saveId, [{ saveId, seq: seq++, turn: after.turn, event: { type: 'narration', text } }]);
      setStreaming(null);
    }
    if (dbg) { const fin = await loadEvents(saveId); await endDebug(dbg, { events: fin.filter((x) => x.seq >= firstSeq).map((x) => x.event), before: stateBefore, after: replay(fin) }); }
    await reload();
  }

  /** 서술 뒤 GM 안내: AI로 (실패하면 기본 안내) */
  async function guideAfter(st: GameState, narration: string): Promise<GameEvent> {
    if (!settings) return basicGuide(world, st);
    setStage('다음 선택지를 고르는 중');
    try { return await gmGuide(createLlmClient(settings), world, st, narration, abort.current?.signal); }
    catch { return basicGuide(world, st); }
  }

  /** 소지품·상점: 이벤트를 현재 턴에 이어 저장한다 (AI 호출 없음) */
  async function commitEvents(make: (s: GameState) => GameEvent[]) {
    if (!state || streaming !== null) return;
    setError('');
    let events: GameEvent[];
    try { events = make(state); } catch (e) { setError((e as Error).message); return; }
    await appendEvents(saveId, events.map((event, i) => ({ saveId, seq: nextSeq + i, turn: state.turn, event })));
    const dbg = beginDebug('items', `소지품·상점 (턴 ${state.turn})`, { saveId, turn: state.turn });
    if (dbg) await endDebug(dbg, { events, before: state, after: replay(await loadEvents(saveId)) });
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
  const detail = loadPlayPrefs().skillDetail;
  const lastGuide = state.log.findLastIndex((l) => l.kind === 'guide');
  const decisive = !state.combat && !state.ending && !state.playerDead ? pendingChoice(world, state) : undefined;
  const canAct = streaming === null && !state.combat && !state.scene && !state.playerDead;
  const sceneNow = state.scene ? sceneDef(world, state.scene.sceneId) : undefined;
  const scenesHere = canAct && !state.ending ? availableScenes(world, state, { auto: false }) : [];
  const shop = shopHere(world, state);
  const board = boardHere(world, state);

  return (
    <ReskinContext.Provider value={rs}>
    <section className={`play img-${imgSize}${state.combat && !state.playerDead ? ' in-combat' : ''}${phaseNow?.tint ? ` phase-${phaseNow.tint}` : ''}`}>
      <div className="play-head">
      <div className="scene-bar">
        {locImage && <AssetImage pkg={world.manifest.id} id={locImage.id} alt={loc?.name ?? ''} className="loc-thumb" zoom />}
        <b>{loc?.name}</b>
        {Object.keys(state.party).length > 0 && <span className="small muted">동행: {Object.values(state.party).map((c) => c.name).join(', ')}</span>}
        {phaseNow && loadPlayPrefs().display !== 'immersive' && <span className="phase-chip" title={`지금 국면: ${phaseNow.name} — 긴장 ${tensionOf(state)}/10`}>🌗 {rs(phaseNow.name)} · 긴장 {tensionOf(state)}</span>}
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
        <AvControls onChange={() => setAvTick((n) => n + 1)} dcMod={state.dcMod ?? 0} dcBusy={streaming !== null}
          onDcMod={(v) => { if (clampDcMod(v) !== (state.dcMod ?? 0)) void commitEvents(() => [{ type: 'difficulty_set', dcMod: clampDcMod(v), label: difficultyLabel(clampDcMod(v)) }]); }} />
        {debug && <button onClick={() => setShowDebug(true)} title="디버그: 턴마다 AI 요청·응답과 엔진 처리">🐞 디버그</button>}
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
            {e.kind !== 'guide' && !placed(e) && e.images && e.images.length > 0 && imgSize !== 'hidden' && (() => {
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
                      const kind = CHOICE_KINDS[e.choiceKinds?.[k] as ChoiceKind];
                      // 장면으로 들어가는 선택지 (v0.85): 지금도 열 수 있으면 바로 그 장면을 시작한다
                      const sceneId = e.choiceScenes?.[k];
                      const opens = sceneId ? scenesHere.find((d) => d.id === sceneId) : undefined;
                      // 걸린 것 (v0.114): 선택지가 어디로 가는지 — 표시 수준 몰입형에서는 숨긴다
                      const stake = e.choiceStakes?.[k] || undefined;
                      const stakeTag = stake && loadPlayPrefs().display !== 'immersive' ? stakeLabel(world, state, stake) : '';
                      return (
                        <button key={k} type="button" className={kind ? `choice-${e.choiceKinds![k]}` : undefined} onClick={() => (opens ? commitScene((s) => startSceneEvents(world, s, opens.id)) : submit(c, sk ? `skill:${sk}` : undefined, undefined, stake))} title={kind ? `${kind.label}: ${kind.desc}` : undefined}>
                          {stakeTag ? <span className="choice-kind stake-tag">{opens ? '🎭 장면' : stakeTag}</span> : kind ? <span className="choice-kind">{opens ? '🎭 장면' : `${kind.icon} ${kind.label}`}</span> : `${k + 1}. `}{c}{!opens && sk && sk in SKILLS && <span className="skill-badge">🎲 {detail || !approachOf(sk) ? SKILLS[sk as SkillId].name : APPROACHES[approachOf(sk)!].name} {fmt(checkModifier(state.player.sheet, { kind: 'skill', skill: sk as SkillId }).total)}{state.player.sheet.skillProficiencies.includes(sk as SkillId) ? ' ★' : ''}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : placed(e) ? <PlacedNarration text={e.text} images={e.images!} pkg={world.manifest.id} size={imgSize} bgMode={loadPlayPrefs().background} />
              : <p className={`entry ${e.kind}`}>{e.kind === 'narration' ? <RichText text={e.text} /> : e.kind === 'check' ? <CheckLine text={rs(e.text)} /> : e.kind === 'phase' ? <><span className="phase-label">🌗 세계가 변했다</span>{rs(e.text)}</> : rs(e.text)}</p>}
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
        {streaming !== null && pendingLog.map((e, i) => (
          <div key={`p${i}`} className={`entry-wrap k-${e.kind}`}><p className={`entry ${e.kind}`}>{rs(e.text)}</p></div>
        ))}
        {streaming !== null && (streaming && streamImages.length > 0 && imgSize !== 'hidden'
          ? <PlacedNarration text={streaming} images={streamImages} pkg={world.manifest.id} size={imgSize} bgMode={loadPlayPrefs().background} />
          : <p className="entry narration">{streaming ? <RichText text={streaming} /> : '…'}</p>)}
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
      {notice && !error && <p className="status small">{notice}</p>}
      {state.playerDead ? null : state.combat ? (
        <CombatPanel cs={state.combat} busy={streaming !== null} orders={state.partyOrders}
          recent={(() => { const start = state.log.findLastIndex((l) => l.kind === 'combat' && l.text.startsWith('⚔ 전투 시작')); return state.log.slice(Math.max(start, combatMark.current, 0)).filter((l) => l.kind === 'combat').map((l) => l.text); })()}
          portrait={(id) => { const img = id === 'player' ? undefined : pickCharacterImage(world, id, 'battle', 'combat'); return img ? <AssetImage pkg={world.manifest.id} id={img.id} alt="" /> : undefined; }}
          onOrder={(npcId: string, order: PartyOrder) => commitCombat((s) => setPartyOrder(s, npcId, order))}
          onAct={(cardId: string, target: Target) => commitCombat((s) => playerCombatAction(world, s, cardId, target))}
          onEndTurn={() => commitCombat((s) => playerEndTurn(world, s))}
          onAuto={() => void autoFight()} />
      ) : state.scene && sceneNow ? (
        <ScenePanel dcMod={state.dcMod ?? 0} def={sceneNow} run={state.scene} sheet={state.player.sheet} opp={sceneOpponent(world, state, sceneNow)} busy={streaming !== null} pkg={world.manifest.id}
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
        <select className="use-select" value={use} onChange={(e) => setUse(e.target.value)} title="이 행동에 쓸 접근법·기술 (판정이 필요할 때 이것으로 굴린다)">
          <option value="">🎲 {detail ? '기술·능력' : '접근법'} (자동)</option>
          {!detail && APPROACH_IDS.map((a) => { const b = bestSkill(state.player.sheet, a); return <option key={a} value={`approach:${a}`}>{APPROACHES[a].icon} {APPROACHES[a].name} {fmt(b.mod)} — {APPROACHES[a].desc}</option>; })}
          {detail && <><optgroup label="기술">
            {[...SKILL_IDS].sort((a, b) => Number(state.player.sheet.skillProficiencies.includes(b)) - Number(state.player.sheet.skillProficiencies.includes(a))).map((k) => (
              <option key={k} value={`skill:${k}`}>{SKILLS[k].name} {fmt(checkModifier(state.player.sheet, { kind: 'skill', skill: k }).total)}{state.player.sheet.skillProficiencies.includes(k) ? ' ★' : ''}</option>
            ))}
          </optgroup>
          <optgroup label="능력치">
            {ABILITIES.map((a) => <option key={a} value={`ability:${a}`}>{ABILITY_NAMES[a]} {fmt(checkModifier(state.player.sheet, { kind: 'ability', ability: a }).total)}</option>)}
          </optgroup></>}
        </select>
        <textarea
          value={input} rows={2} placeholder="선택지를 누르거나 직접 행동을 적으세요 — 비워 두고 누르면 흐름대로 이어서"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
        />
        <button className="primary" disabled={streaming !== null} title={input.trim() ? '적은 행동을 한다' : '행동을 적지 않으면 지금 흐름대로 자연스럽게 이어서 진행한다'}>{input.trim() ? '행동' : '이어서 ▶'}</button>
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
      {showDebug && <DebugPanel saveId={saveId} world={world} state={state} onClose={() => setShowDebug(false)} />}
      {levelInfo && <LevelUpDialog info={levelInfo} sheet={state.player.sheet} rs={rs} onClose={() => setLevelInfo(null)} onSheet={() => { setLevelInfo(null); setPanel('sheet'); }} />}
    </section>
    </ReskinContext.Provider>
  );
}

/** 판정 기록 (v0.112): 결과를 굵게, 굴림은 작게 — 펼치지 않아도 결과가 먼저 읽힌다 */
function CheckLine({ text }: { text: string }) {
  const m = /^(🎲 [^:]+: )([^—]+?)( — d20.*)$/.exec(text);
  if (!m) return <>{text}</>;
  const tier = m[2]!.startsWith('성공') ? 'success' : m[2]!.startsWith('대가') ? 'cost' : 'fail';
  return <>{m[1]}<b className={`tier tier-${tier}`}>{m[2]}</b><span className="roll-detail">{m[3]}</span></>;
}

/** 자리 정보가 있는 서술 이미지인가 (v0.59) */
const placed = (e: LogEntry) => e.kind === 'narration' && !!e.images?.some((im) => im.bg || im.para !== undefined);

/** 서술 + 이미지 제자리 (v0.59): 배경은 서술 맨 앞, 인물은 그 인물이 처음 나온 문단 앞 */
function PlacedNarration({ text, images, pkg, size, bgMode }: { text: string; images: NarrationImage[]; pkg: string; size: ImageSize; bgMode: BackgroundMode }) {
  const paras = paragraphsOf(text);
  const visible = images.filter((im) => !im.bg || bgMode === 'every' || im.bg === 'new');
  const fig = (im: NarrationImage) => <figure key={im.id}><AssetImage pkg={pkg} id={im.id} alt={im.caption} zoom /><figcaption>{im.caption}</figcaption></figure>;
  if (size === 'hidden') return <div className="entry narration"><RichText text={text} /></div>;
  if (size === 'collapsed') {
    return (
      <>
        {visible.length > 0 && <details className="scene-images-fold"><summary className="small muted">🖼 {visible.map((im) => im.caption).join(' · ')}</summary><div className="scene-images">{visible.map(fig)}</div></details>}
        <div className="entry narration"><RichText text={text} /></div>
      </>
    );
  }
  const bg = visible.filter((im) => im.bg);
  const top = visible.filter((im) => !im.bg && (im.para === undefined || im.para >= paras.length));
  return (
    <div className="placed-narration">
      {bg.length > 0 && <div className="scene-images bg">{bg.map(fig)}</div>}
      {top.length > 0 && <div className="scene-images inline">{top.map(fig)}</div>}
      {paras.map((p, i) => {
        const here = visible.filter((im) => !im.bg && im.para === i);
        return (
          <Fragment key={i}>
            {here.length > 0 && <div className="scene-images inline">{here.map(fig)}</div>}
            <p className="entry narration"><RichText text={p} /></p>
          </Fragment>
        );
      })}
    </div>
  );
}
