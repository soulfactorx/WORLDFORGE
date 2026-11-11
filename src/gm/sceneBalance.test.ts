import { describe, expect, it } from 'vitest';
import { SCENE_PRESETS } from '../data/scenePresets';
import { sampleWorld } from '../data/sample-world';
import type { WorldPackage } from '../engine/schema';
import { balanceGap, balanceParams, balanceScene, normalizeTargets } from './sceneBalance';
import { simulateScene, testSheet } from './sceneTest';

/** v0.104: 장면 결과 비율 맞추기 */
describe('장면 결과 비율 맞추기', () => {
  const world = (): WorldPackage => ({ ...structuredClone(sampleWorld), scenes: SCENE_PRESETS.map((p) => p.make()) });

  it('목표를 합 100으로 나누고, 움직일 숫자를 찾는다', () => {
    const d = world().scenes!.find((s) => s.id === 'scene/crafting')!;
    const t = normalizeTargets(d, { masterwork: 1, ruined: 1, plain: 2 });
    expect(Math.round(t.plain!)).toBe(50);
    expect(Object.values(normalizeTargets(d, {})).map(Math.round)).toEqual([33, 33, 33]);
    const ps = balanceParams(d, ['dc', 'ends', 'start', 'rounds']);
    expect(ps.some((p) => p.label.includes('DC'))).toBe(true);
    expect(ps.filter((p) => p.label.startsWith('끝')).length).toBe(3); // any 안쪽의 기준 둘 + 걸작의 기준
    expect(ps.some((p) => p.label === '차례 한도')).toBe(true);
    expect(balanceParams(d, []).length).toBe(0);
  });

  it('골고루: 치우친 장면을 목표에 가깝게 만들고, 글·행동은 건드리지 않는다', async () => {
    const w = world(); const id = 'scene/negotiation';
    const orig = w.scenes!.find((s) => s.id === id)!;
    const r = await balanceScene(w, id, testSheet(w), { targets: { deal: 1, walkout: 1, stalemate: 1 }, knobs: ['dc', 'ends', 'start', 'rounds'] });
    expect(r.gapAfter).toBeLessThan(r.gapBefore);
    expect(r.gapAfter).toBeLessThanOrEqual(25);
    expect(r.changes.length).toBeGreaterThan(0);
    expect(r.scene.actions.map((a) => [a.id, a.name, a.check, a.success, a.failure])).toEqual(orig.actions.map((a) => [a.id, a.name, a.check, a.success, a.failure]));
    expect(r.scene.ends.map((e) => [e.id, e.outcome, e.effects])).toEqual(orig.ends.map((e) => [e.id, e.outcome, e.effects]));
    expect(w.scenes!.find((s) => s.id === id)).toEqual(orig); // 원본은 그대로
  }, 60_000);

  it('원하는 비율: 성공 70%를 목표로 하면 성공이 늘어난다', async () => {
    const w = world(); const id = 'scene/date';
    const r = await balanceScene(w, id, testSheet(w), { targets: { sweet: 70, flop: 15, fine: 15 }, knobs: ['dc', 'ends', 'start'] });
    expect(r.after.ends.sweet! / r.after.runs).toBeGreaterThan(r.before.ends.sweet! / r.before.runs + 0.15);
    expect(r.gapAfter).toBeLessThan(r.gapBefore);
  }, 60_000);

  it('손잡이가 없으면 바꾸지 않고 까닭을 알린다 · 멈추라고 하면 멈춘다', async () => {
    const w = world(); const id = 'scene/chase';
    const none = await balanceScene(w, id, testSheet(w), { targets: {}, knobs: [] });
    expect(none.changes).toEqual([]);
    expect(none.note).toContain('움직일 수 있는 숫자가 없습니다');
    const stop = await balanceScene(w, id, testSheet(w), { targets: { caught: 1, escaped: 1, exhausted: 1 }, knobs: ['dc', 'ends', 'start'], onStep: ({ evals }) => evals < 5 });
    expect(stop.evals).toBeLessThan(10);
    expect(stop.note).toContain('멈췄습니다');
  }, 60_000);

  it('신중한 플레이어는 무작위보다 성공 확률이 높은 행동을 고른다 (결과가 달라진다)', () => {
    const w = world(); const id = 'scene/negotiation'; const d = w.scenes!.find((s) => s.id === id)!;
    const a = simulateScene(w, id, testSheet(w), 200, 7, 'random'), b = simulateScene(w, id, testSheet(w), 200, 7, 'careful');
    expect(a.ends).not.toEqual(b.ends);
    expect(balanceGap(d, a, normalizeTargets(d, {}))).toBeGreaterThan(0);
  });
});
