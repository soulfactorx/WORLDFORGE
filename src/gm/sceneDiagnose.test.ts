import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import type { SceneDef, WorldPackage } from '../engine/schema';
import { diagnoseScene } from './sceneDiagnose';
import { testSheet } from './sceneTest';

/** v0.105: 안 나오는 끝이 왜 안 나오는지 */
const base = (over: Partial<SceneDef>): SceneDef => ({
  id: 'scene/t', name: '시험', description: '',
  gauges: [{ id: 'p', name: '진척', start: 0, min: 0, max: 10 }, { id: 'r', name: '위험', start: 0, min: 0, max: 10 }],
  actions: [{ id: 'go', name: '나아간다', success: { gauges: { p: 2 } } }],
  ends: [{ id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }],
  ...over,
});
const diag = (d: SceneDef) => {
  const w: WorldPackage = { ...structuredClone(sampleWorld), scenes: [d] };
  return diagnoseScene(w, d.id, testSheet(w), { runs: 60 });
};
const whyOf = (d: SceneDef, endId: string) => diag(d).find((x) => x.endId === endId)?.findings.map((f) => `${f.why} ${f.fix}`).join(' | ') ?? '';

describe('장면 끝 진단', () => {
  it('잘 나오는 끝은 진단하지 않는다', () => {
    expect(diag(base({}))).toEqual([]);
  });
  it('기준이 수치의 범위를 벗어났다', () => {
    const d = base({ ends: [{ id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }, { id: 'x', name: '초월', when: { gauge: 'p', gte: 12 }, outcome: 'success' }] });
    expect(whyOf(d, 'x')).toContain('0~10 사이에서만');
  });
  it('수치를 움직이는 행동이 없다', () => {
    const d = base({ ends: [{ id: 'bad', name: '사고', when: { gauge: 'r', gte: 5 }, outcome: 'failure' }, { id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }] });
    const s = whyOf(d, 'bad');
    expect(s).toContain('위험을(를) 올리는 행동이나 반작용이 하나도 없습니다');
    expect(s).toContain('변화를 넣으세요');
  });
  it('위의 끝이 더 느슨한 기준으로 먼저 난다 (순서)', () => {
    const d = base({ ends: [{ id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }, { id: 'great', name: '완주', when: { gauge: 'p', gte: 10 }, outcome: 'success' }] });
    const s = whyOf(d, 'great');
    expect(s).toContain('더 느슨한 기준');
    expect(s).toContain('위로 옮기');
  });
  it('같은 순간에 맞았지만 위의 끝에 가려졌다', () => {
    const d = base({ actions: [{ id: 'go', name: '나아간다', success: { gauges: { p: 3, r: 3 } } }],
      ends: [{ id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }, { id: 'bad', name: '사고', when: { gauge: 'r', gte: 6 }, outcome: 'failure' }] });
    expect(whyOf(d, 'bad')).toContain('같은 순간에 먼저 맞아');
  });
  it('차례 한도 안에 닿을 수 없다', () => {
    const d = base({ maxRounds: 3, timeoutEnd: 'late', actions: [{ id: 'go', name: '나아간다', success: { gauges: { p: 1 } } }],
      ends: [{ id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }, { id: 'late', name: '시간 초과', when: { round: 99 }, outcome: 'neutral' }] });
    const s = whyOf(d, 'win');
    expect(s).toContain('6차례가 필요합니다');
    expect(s).toContain('차례 한도는 3');
  });
  it('닿을 수는 있지만 다른 끝이 먼저 난다 — 어디까지 갔는지 알려 준다', () => {
    const d = base({ actions: [{ id: 'go', name: '나아간다', success: { gauges: { p: 1, r: 3 } } }],
      ends: [{ id: 'bad', name: '사고', when: { gauge: 'r', gte: 6 }, outcome: 'failure' }, { id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }] });
    const s = whyOf(d, 'win');
    expect(s).toContain('가장 높이 간 값이 2');
    expect(s).toContain('「사고」(100%)이 먼저');
    expect(s).toContain('기준을 2 이상으로 당기면');
  });
  it('상태를 붙이는 곳이 없다 · 차례 한도까지 가는 판이 없다', () => {
    const d = base({ states: [{ id: 'key', name: '열쇠' }], maxRounds: 9, timeoutEnd: 'late',
      ends: [{ id: 'secret', name: '비밀문', when: { state: 'key' }, outcome: 'success' }, { id: 'win', name: '도착', when: { gauge: 'p', gte: 6 }, outcome: 'success' }, { id: 'late', name: '시간 초과', when: { round: 99 }, outcome: 'neutral' }] });
    expect(whyOf(d, 'secret')).toContain('이 상태를 붙이는 행동이나 반작용이 없습니다');
    const late = whyOf(d, 'late');
    expect(late).toContain('차례 한도(9)가 다했을 때');
    expect(late).toContain('가장 길게 간 판이 3차례');
  });
});
