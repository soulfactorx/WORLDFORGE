/**
 * 게임 속 날짜 (v0.15). 세이브의 worldMinutes(0 = 첫날 0시, 시작은 8시)로 날짜를 센다.
 * 월 길이는 양력(평년)을 쓴다 — 판타지 달력도 대개 이렇게 쓰고, 정확한 날짜 계산보다 "며칠 남았나"가 중요하다.
 */
import type { Calendar, WorldPackage } from './schema';

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const clampMonth = (m: number) => Math.min(12, Math.max(1, Math.round(m) || 1));

/** 연·월·일 → 연속된 날 번호 */
export function dayNumber(y: number, m: number, d: number): number {
  const mm = clampMonth(m);
  return Math.round(y) * 365 + DAYS.slice(0, mm - 1).reduce((a, b) => a + b, 0) + Math.min(DAYS[mm - 1]!, Math.max(1, Math.round(d) || 1)) - 1;
}

export function fromDayNumber(n: number): { year: number; month: number; day: number } {
  const year = Math.floor(n / 365);
  let r = n - year * 365, month = 1;
  while (r >= DAYS[month - 1]!) { r -= DAYS[month - 1]!; month++; }
  return { year, month, day: r + 1 };
}

export function calendarDate(world: Pick<WorldPackage, 'calendar'>, worldMinutes: number): { label: string; countdown?: string; daysLeft?: number; elapsed: number } | undefined {
  const c: Calendar | undefined = world.calendar;
  if (!c || !c.year) return undefined;
  const elapsed = Math.floor(worldMinutes / 1440);
  const today = dayNumber(c.year, c.month, c.day) + elapsed;
  const d = fromDayNumber(today);
  const label = `${c.era ? `${c.era} ` : ''}${d.year}년 ${d.month}월 ${d.day}일`;
  if (!c.countdown?.year) return { label, elapsed };
  const daysLeft = dayNumber(c.countdown.year, c.countdown.month, c.countdown.day) - today;
  const countdown = daysLeft > 0 ? `${c.countdown.label} D-${daysLeft}` : daysLeft === 0 ? `${c.countdown.label} D-DAY` : `${c.countdown.label} D+${-daysLeft}`;
  return { label, countdown, daysLeft, elapsed };
}
