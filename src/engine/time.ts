/**
 * 시간 흐름 (v0.58): 턴마다 게임 속 시간이 얼마나 흐르는가.
 * 기본은 GM 판단 AI가 행동의 길이를 네 단계(잠깐·짧게·오래·몇 시간) 중에서 고르고, 엔진이 분으로 바꾼다.
 */
import type { TimeRules, WorldPackage } from './schema';

export type TimeSpent = 'moment' | 'short' | 'long' | 'hours';
export const TIME_STEPS: Record<TimeSpent, { label: string; minutes: number; desc: string }> = {
  moment: { label: '잠깐', minutes: 2, desc: '말 몇 마디, 한두 동작' },
  short: { label: '짧게', minutes: 15, desc: '살펴보기·흥정·짧은 대화나 활동' },
  long: { label: '오래', minutes: 60, desc: '꼼꼼한 수색·긴 대화·작업·식사' },
  hours: { label: '몇 시간', minutes: 180, desc: '하루 일과·긴 기다림·먼 길 (휴식 제외)' },
};
export const TIME_DEFAULTS = { perTurn: 10, move: 10, maxPerTurn: 240 } as const;

export function timeRules(world: Pick<WorldPackage, 'time'>): Required<Omit<TimeRules, 'steps'>> & { steps: Record<TimeSpent, number> } {
  const t = world.time ?? {};
  const pos = (v: number | undefined, d: number) => (typeof v === 'number' && v >= 0 ? v : d);
  return {
    mode: t.mode === 'fixed' ? 'fixed' : 'ai',
    perTurn: pos(t.perTurn, TIME_DEFAULTS.perTurn),
    move: pos(t.move, TIME_DEFAULTS.move),
    maxPerTurn: pos(t.maxPerTurn, TIME_DEFAULTS.maxPerTurn) || TIME_DEFAULTS.maxPerTurn,
    steps: Object.fromEntries((Object.keys(TIME_STEPS) as TimeSpent[]).map((k) => [k, pos(t.steps?.[k], TIME_STEPS[k].minutes)])) as Record<TimeSpent, number>,
  };
}

/** 이번 턴에 흐를 분 (휴식 제외) */
export function turnMinutes(world: Pick<WorldPackage, 'time'>, spent: string | undefined, moved: boolean): { minutes: number; why: string } {
  const r = timeRules(world);
  const step = (spent && spent in TIME_STEPS ? spent : 'moment') as TimeSpent;
  const base = r.mode === 'fixed' ? r.perTurn : r.steps[step];
  const total = Math.min(r.maxPerTurn, base + (moved ? r.move : 0));
  const why = `${r.mode === 'fixed' ? `턴마다 ${r.perTurn}분 (고정)` : `GM 판단: ${TIME_STEPS[step].label} ${r.steps[step]}분`}${moved ? ` + 이동 ${r.move}분` : ''}${total < base + (moved ? r.move : 0) ? ` → 한 턴 최대 ${r.maxPerTurn}분` : ''}`;
  return { minutes: total, why };
}

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);
