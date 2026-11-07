import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { validateWorld } from './package/validate';
import { timeRules, turnMinutes } from './time';

describe('시간 흐름 (v0.58)', () => {
  it('기본: GM이 고른 길이 + 이동, 없으면 잠깐', () => {
    expect(turnMinutes(sampleWorld, 'moment', false).minutes).toBe(2);
    expect(turnMinutes(sampleWorld, 'short', false).minutes).toBe(15);
    expect(turnMinutes(sampleWorld, 'long', true).minutes).toBe(70);
    expect(turnMinutes(sampleWorld, 'hours', false).minutes).toBe(180);
    expect(turnMinutes(sampleWorld, undefined, false).minutes).toBe(2);
    expect(turnMinutes(sampleWorld, 'short', false).why).toContain('짧게');
  });
  it('세계 설정: 고정·단계별 분·이동·최대', () => {
    expect(turnMinutes({ time: { mode: 'fixed', perTurn: 30 } }, 'hours', false).minutes).toBe(30);
    expect(turnMinutes({ time: { steps: { short: 5 }, move: 60 } }, 'short', true).minutes).toBe(65);
    const capped = turnMinutes({ time: { maxPerTurn: 100 } }, 'hours', true);
    expect(capped.minutes).toBe(100);
    expect(capped.why).toContain('최대');
    expect(timeRules({}).mode).toBe('ai');
  });
  it('검사기', () => {
    const bad = validateWorld({ ...sampleWorld, time: { mode: 'slow' as never, perTurn: -1, steps: { nap: 3 } as never } }).filter((i) => i.path.startsWith('time')).map((i) => i.path);
    expect(bad).toEqual(expect.arrayContaining(['time.mode', 'time.perTurn', 'time.steps.nap']));
    expect(validateWorld({ ...sampleWorld, time: { mode: 'fixed', perTurn: 20 } }).filter((i) => i.path.startsWith('time'))).toEqual([]);
  });
});
