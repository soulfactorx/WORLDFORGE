/**
 * 시간 흐름 — 비트 단위 (v0.112, 설계 v6 M2 3.1절).
 * 한 턴은 "한 동작"이 아니라 "다음 갈림길까지"다. GM 판단 AI가 이번 턴의 길이를 세 가지 비트 중에서 고르고, 엔진이 분으로 바꾼다.
 * (v0.58~v0.111의 잠깐·짧게·오래·몇 시간과 분 단위 설정은 없앴다 — 옛 값은 가장 가까운 비트로 읽는다.)
 */
import type { TimeRules, WorldPackage } from './schema';

export type TimeSpent = 'exchange' | 'scene' | 'stretch';
export const TIME_STEPS: Record<TimeSpent, { label: string; minutes: number; desc: string }> = {
  exchange: { label: '대화 한 판', minutes: 30, desc: '몇 마디 주고받기·짧은 확인·한 번의 시도' },
  scene: { label: '장면 하나', minutes: 120, desc: '한 자리의 일을 매듭짓기 — 조사·흥정·잠입·긴 대화' },
  stretch: { label: '몽타주', minutes: 480, desc: '반나절~하루를 건너뛴다 — 먼 길·추적·준비·기다림' },
};
/** 옛 단계 → 비트 */
const LEGACY: Record<string, TimeSpent> = { moment: 'exchange', short: 'exchange', long: 'scene', hours: 'stretch' };
export const normSpent = (spent: string | undefined): TimeSpent => (spent && spent in TIME_STEPS ? (spent as TimeSpent) : LEGACY[spent ?? ''] ?? 'exchange');

export const PACE = { slow: { label: '느리게', mul: 0.5 }, normal: { label: '보통', mul: 1 }, fast: { label: '빠르게', mul: 2 } } as const;
export type Pace = keyof typeof PACE;
/** 이동에 더해지는 분 (보통 속도) */
export const MOVE_MINUTES = 30;
const MAX_PER_TURN = 1440;

export function paceOf(world: Pick<WorldPackage, 'time'>): Pace { const p = world.time?.pace; return p && p in PACE ? p : 'normal'; }

/** 이번 턴에 흐를 분 (휴식 제외) */
export function turnMinutes(world: Pick<WorldPackage, 'time'>, spent: string | undefined, moved: boolean): { minutes: number; why: string } {
  const step = normSpent(spent);
  const pace = paceOf(world);
  const mul = PACE[pace].mul;
  const total = Math.min(MAX_PER_TURN, Math.round((TIME_STEPS[step].minutes + (moved ? MOVE_MINUTES : 0)) * mul));
  return { minutes: total, why: `GM 판단: ${TIME_STEPS[step].label} ${TIME_STEPS[step].minutes}분${moved ? ` + 이동 ${MOVE_MINUTES}분` : ''}${mul !== 1 ? ` × 세계 시간 속도 ${PACE[pace].label}(${mul})` : ''}` };
}

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);
/** @deprecated v0.112부터 쓰지 않는다 (편집기·옛 패키지 호환용) */
export type { TimeRules };
