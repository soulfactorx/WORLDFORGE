import { describe, expect, it } from 'vitest';
import { calendarDate, dayNumber, fromDayNumber } from './calendar';

describe('달력', () => {
  it('날짜가 넘어가고 카운트다운이 줄어든다', () => {
    const w = { calendar: { era: '제국력', year: 429, month: 6, day: 13, countdown: { label: '파멸', year: 429, month: 9, day: 21 } } };
    expect(calendarDate(w, 8 * 60)).toEqual({ label: '제국력 429년 6월 13일', countdown: '파멸 D-100', daysLeft: 100, elapsed: 0 });
    expect(calendarDate(w, 8 * 60 + 1440 * 18)!.label).toBe('제국력 429년 7월 1일');
    expect(calendarDate(w, 1440 * 100)!.countdown).toBe('파멸 D-DAY');
    expect(calendarDate({}, 0)).toBeUndefined();
    expect(fromDayNumber(dayNumber(429, 12, 31) + 1)).toEqual({ year: 430, month: 1, day: 1 });
  });
});
