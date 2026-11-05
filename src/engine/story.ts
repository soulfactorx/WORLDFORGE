/**
 * 이야기 엔진 (설계 v3 5장) — 순수 함수. 무엇이 일어나야 하는지만 판단하고, 이벤트 생성은 gm/scenario가 한다.
 *  - 줄기·장: 시작 조건으로 열리고, 장마다 완료·실패 조건
 *  - 결정적 선택 (D4): 조건이 맞으면 고정 선택지가 나타난다 (한 번에 하나)
 *  - 진행 시계: 시간(하루·한 시간)과 조건으로 칸이 차고, 정해진 칸에서 효과·징조
 *  - 연표 사건: 날 수·날짜·조건에 일어나고, unless가 참이면 막힌다
 */
import { dayNumber } from './calendar';
import { evalCondition } from './scenario';
import type { Arc, Clock, DecisiveChoice, WorldEvent, WorldPackage } from './schema';
import type { GameState } from './state/state';

export type ArcTransition =
  | { kind: 'started'; arc: Arc }
  | { kind: 'chapter'; arc: Arc; index: number }
  | { kind: 'ended'; arc: Arc; failed: boolean };

/** 줄기 변화 (한 번에 여러 장이 끝날 수 있다) */
export function arcTransitions(world: WorldPackage, state: GameState): ArcTransition[] {
  const out: ArcTransition[] = [];
  const arcs = structuredClone(state.arcs ?? {});
  const view = (): GameState => ({ ...state, arcs });
  for (const arc of world.arcs ?? []) {
    if (!arc.chapters.length) continue;
    if (!arcs[arc.id] && evalCondition(world, view(), arc.start)) {
      arcs[arc.id] = { chapter: 0, done: false };
      out.push({ kind: 'started', arc });
    }
    const p = arcs[arc.id];
    if (!p) continue;
    for (let guard = 0; !p.done && guard <= arc.chapters.length; guard++) {
      const ch = arc.chapters[p.chapter];
      if (!ch) break;
      if (ch.fail && evalCondition(world, view(), ch.fail)) {
        p.done = true; p.failed = true;
        out.push({ kind: 'ended', arc, failed: true });
        break;
      }
      if (!evalCondition(world, view(), ch.complete)) break;
      out.push({ kind: 'chapter', arc, index: p.chapter });
      p.chapter++;
      if (p.chapter >= arc.chapters.length) { p.done = true; out.push({ kind: 'ended', arc, failed: false }); }
    }
  }
  return out;
}

export function activeChapters(world: WorldPackage, state: GameState) {
  return (world.arcs ?? []).flatMap((arc) => {
    const p = state.arcs?.[arc.id];
    const ch = p && !p.done ? arc.chapters[p.chapter] : undefined;
    return ch ? [{ arc, chapter: ch, index: p!.chapter }] : [];
  });
}

export interface ClockUpdate {
  clock: Clock;
  value: number;
  minutes: number;
  /** 이번에 발동한 조건 눈금 번호 */
  onFired: number[];
  /** 새로 이른 칸 */
  reached: number[];
}

const UNIT = { day: 1440, hour: 60 } as const;

/**
 * 시계 갱신: 시간 눈금(마지막으로 기록한 시각 이후 지난 만큼) + 처음 참이 된 조건 눈금.
 * 바뀐 것이 없으면 기록하지 않는다 (시각을 기록하지 않아도 다음 계산에서 지난 시간이 모두 반영된다).
 */
export function clockUpdates(world: WorldPackage, state: GameState): ClockUpdate[] {
  const out: ClockUpdate[] = [];
  for (const clock of world.clocks ?? []) {
    const max = Math.max(1, clock.segments);
    const cur = state.clocks?.[clock.id] ?? { value: Math.min(max, clock.start ?? 0), minutes: state.worldMinutes, onFired: [], reached: [] };
    const fresh = !state.clocks?.[clock.id];
    let value = cur.value;
    for (const t of clock.tick) if ('every' in t) value += t.by * (Math.floor(state.worldMinutes / UNIT[t.every]) - Math.floor(cur.minutes / UNIT[t.every]));
    const onFired: number[] = [];
    clock.tick.forEach((t, i) => {
      if ('on' in t && !cur.onFired.includes(i) && evalCondition(world, state, t.on)) { value += t.by; onFired.push(i); }
    });
    value = Math.max(0, Math.min(max, value));
    const reached = clock.at.filter((x) => value >= x.segment && !cur.reached.includes(x.segment)).map((x) => x.segment).sort((x, y) => x - y);
    if (!fresh && value === cur.value && !onFired.length && !reached.length) continue;
    out.push({ clock, value, minutes: state.worldMinutes, onFired, reached });
  }
  return out;
}

/** 이 사건의 날이 되었는가 (날짜는 달력이 있을 때만) */
function dateReached(world: WorldPackage, state: GameState, e: WorldEvent): boolean {
  const elapsed = Math.floor(state.worldMinutes / 1440);
  if (e.when.day !== undefined && elapsed < e.when.day) return false;
  if (e.when.date) {
    const c = world.calendar;
    if (!c?.year) return false;
    if (dayNumber(e.when.date.year, e.when.date.month, e.when.date.day) - dayNumber(c.year, c.month, c.day) > elapsed) return false;
  }
  if (e.when.condition && !evalCondition(world, state, e.when.condition)) return false;
  return e.when.day !== undefined || !!e.when.date || !!e.when.condition;
}

export function dueWorldEvents(world: WorldPackage, state: GameState): { event: WorldEvent; skipped: boolean }[] {
  return (world.events ?? []).filter((e) => !state.worldEvents?.[e.id] && dateReached(world, state, e))
    .map((event) => ({ event, skipped: !!event.unless && evalCondition(world, state, event.unless) }));
}

/** 다가오는 연표 사건 (GM용: 날짜가 정해진 것, 가까운 순) */
export function upcomingWorldEvents(world: WorldPackage, state: GameState, n = 3) {
  const elapsed = Math.floor(state.worldMinutes / 1440);
  const c = world.calendar;
  return (world.events ?? []).filter((e) => !state.worldEvents?.[e.id]).flatMap((e) => {
    const d = e.when.day ?? (e.when.date && c?.year ? dayNumber(e.when.date.year, e.when.date.month, e.when.date.day) - dayNumber(c.year, c.month, c.day) : undefined);
    return d === undefined ? [] : [{ event: e, inDays: d - elapsed }];
  }).sort((a, b) => a.inDays - b.inDays).slice(0, n);
}

/** 지금 고르기를 기다리는 결정적 선택 */
export function pendingChoice(world: WorldPackage, state: GameState): DecisiveChoice | undefined {
  return (world.choices ?? []).find((c) => state.choices?.[c.id] && !state.choices[c.id]!.chosen);
}

/** 새로 나타날 결정적 선택 (기다리는 선택이 있으면 없음) */
export function choiceToOffer(world: WorldPackage, state: GameState): DecisiveChoice | undefined {
  if (pendingChoice(world, state)) return undefined;
  return (world.choices ?? []).find((c) => !state.choices?.[c.id] && (!c.locationId || c.locationId === state.player.locationId) && c.options.length > 0 && evalCondition(world, state, c.when));
}

/**
 * 연출 템포 (설계 v3 5.5): 최근 기록을 보고 Director에게 다음 장면의 결을 제안한다.
 */
export function pacingHint(state: GameState): string | null {
  const recent = state.log.filter((l) => l.turn > state.turn - 6);
  const combatTurns = new Set(state.log.filter((l) => l.kind === 'combat' && l.turn > state.turn - 3).map((l) => l.turn)).size;
  if (combatTurns >= 2) return '최근 전투가 이어졌다. 숨을 돌리고 인물과 이야기하는 장면이 어울린다.';
  if (state.turn >= 6 && !recent.some((l) => l.kind === 'quest' || l.kind === 'knowledge' || l.kind === 'omen' || l.kind === 'combat')) {
    return '한동안 진전이 없었다. 단서·소문·사건 하나로 흐름을 당긴다 (억지로 끌고 가지 않는다).';
  }
  return null;
}
