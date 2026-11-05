/**
 * 세계 시뮬레이터 (R8): 플레이어가 아무것도 하지 않고 시간만 흐르면 세계가 어떻게 되는지 미리 본다.
 * AI를 쓰지 않는다 — 엔진(시계·연표 사건·세력 행동·소문·기한·줄기)만 돌린다.
 */
import { legacyCharacter } from '../engine/character/sheet';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { scenarioEvents } from './scenario';
import { startEvents } from './turn';

export interface SimDay {
  day: number;
  lines: string[];
}

export interface SimResult {
  days: SimDay[];
  state: GameState;
}

/** 이벤트 → 제작자용 한 줄 (기록에 남지 않는 것 위주) */
function describe(world: WorldPackage, e: GameEvent): string | null {
  const name = (id: string) => world.characters.find((c) => c.id === id)?.name ?? id;
  const claim = (id: string) => world.claims.find((c) => c.id === id)?.statement.slice(0, 40) ?? id;
  switch (e.type) {
    case 'flag_set': return `플래그 ${e.flag}`;
    case 'npc_moved': return `${name(e.npcId)} → ${world.locations.find((l) => l.id === e.to)?.name ?? e.to}`;
    case 'npc_killed': return `✝ ${e.name} 죽음`;
    case 'rumor_spread': return e.beliefs.map((b) => `소문: ${name(b.source ?? '')} → ${name(b.holder)} "${claim(b.claim)}"`).join('\n');
    case 'clock_changed': return `시계 ${world.clocks?.find((c) => c.id === e.clockId)?.name ?? e.clockId}: ${e.value}칸`;
    case 'world_event': return e.skipped ? `사건 "${e.name}" — 막힘` : `사건 "${e.name}"`;
    case 'faction_acted': return `세력 행동: ${e.name}`;
    case 'choice_offered': return `결정의 순간이 열림: ${e.name}`;
    case 'beat_opened': return `관계 사건 열림: ${e.name}`;
    default: return null;
  }
}

export function simulateWorld(world: WorldPackage, days: number, opts: { flags?: string[]; startId?: string } = {}): SimResult {
  let state = replay(startEvents(world, legacyCharacter('시험용'), 1, opts.startId).map((event, seq) => ({ saveId: 'sim', seq, turn: 0, event })));
  const push = (e: GameEvent) => { state = applyEvent(state, e, state.turn); };
  const out: SimDay[] = [];
  const day0: string[] = [];
  for (const f of opts.flags ?? []) push({ type: 'flag_set', flag: f });
  if (opts.flags?.length) {
    const evs = scenarioEvents(world, state).events;
    evs.forEach(push);
    day0.push(`처음부터 세운 플래그: ${opts.flags.join(', ')}`, ...evs.map((e) => describe(world, e)).filter((x): x is string => !!x));
  }
  out.push({ day: 0, lines: [...day0, ...state.log.filter((l) => l.kind === 'quest' || l.kind === 'omen').map((l) => l.text)] });
  for (let d = 1; d <= Math.min(60, Math.max(1, days)); d++) {
    const logFrom = state.log.length;
    const lines: string[] = [];
    state = { ...state, turn: state.turn + 1 };
    push({ type: 'time_advanced', minutes: 1440 });
    for (const e of scenarioEvents(world, state).events) {
      push(e);
      const t = describe(world, e);
      if (t) lines.push(...t.split('\n'));
    }
    const logged = state.log.slice(logFrom).filter((l) => l.kind !== 'relation' || l.text.startsWith('♡')).map((l) => l.text);
    out.push({ day: d, lines: [...logged, ...lines] });
  }
  return { days: out, state };
}
