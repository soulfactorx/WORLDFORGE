import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { validateWorld } from './package/validate';
import { normSpent, turnMinutes } from './time';

describe('시간 흐름 — 비트 (v0.112, 설계 v6 M2)', () => {
  it('GM이 고른 비트 + 이동, 없으면 대화 한 판', () => {
    expect(turnMinutes(sampleWorld, 'exchange', false).minutes).toBe(30);
    expect(turnMinutes(sampleWorld, 'scene', true).minutes).toBe(150);
    expect(turnMinutes(sampleWorld, 'stretch', false).minutes).toBe(480);
    expect(turnMinutes(sampleWorld, undefined, false).minutes).toBe(30);
    expect(turnMinutes(sampleWorld, 'scene', false).why).toContain('장면 하나');
  });
  it('옛 단계는 가장 가까운 비트로 읽는다', () => {
    expect(normSpent('moment')).toBe('exchange');
    expect(normSpent('long')).toBe('scene');
    expect(normSpent('hours')).toBe('stretch');
  });
  it('세계 시간 속도', () => {
    expect(turnMinutes({ time: { pace: 'fast' } }, 'scene', false).minutes).toBe(240);
    expect(turnMinutes({ time: { pace: 'slow' } }, 'exchange', true).minutes).toBe(30);
    expect(turnMinutes({ time: { mode: 'fixed', perTurn: 5 } }, 'scene', false).minutes).toBe(120); // 옛 설정은 읽지 않는다
  });
  it('검사기: 잘못된 속도는 오류, 옛 설정은 경고', () => {
    const bad = validateWorld({ ...sampleWorld, time: { pace: 'warp' as never } }).filter((i) => i.path.startsWith('time'));
    expect(bad.map((i) => i.path)).toContain('time.pace');
    const old = validateWorld({ ...sampleWorld, time: { mode: 'fixed', perTurn: 20 } }).filter((i) => i.path.startsWith('time'));
    expect(old.map((i) => i.level)).toEqual(['warning']);
    expect(validateWorld({ ...sampleWorld, time: { pace: 'fast' } }).filter((i) => i.path.startsWith('time'))).toEqual([]);
  });
});
