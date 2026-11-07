import { describe, expect, it } from 'vitest';
import { SCENE_PRESETS } from '../data/scenePresets';
import { sampleWorld } from '../data/sample-world';
import { sceneActions } from '../engine/scene';
import type { WorldPackage } from '../engine/schema';
import { sandboxAct, sandboxState, simulateScene, testSheet } from './sceneTest';

describe('장면 시험 플레이 (v0.71)', () => {
  const withScenes = (): WorldPackage => ({ ...structuredClone(sampleWorld), scenes: SCENE_PRESETS.map((p) => p.make()) });

  it('시험 주인공: 세계 직업·레벨', () => {
    const s = testSheet(sampleWorld, 0, 5);
    expect(s.level).toBe(5);
    expect(s.name).toBe('시험 주인공');
  });

  it('열리는 조건과 상관없이 바로 시작하고, 행동으로 진행해 끝난다', () => {
    const w = withScenes();
    const d = w.scenes![0]!;
    w.scenes![0] = { ...d, start: { flag: 'never' }, locationId: 'loc/nowhere' };
    let s = sandboxState(w, d.id, testSheet(w));
    expect(s.scene?.sceneId).toBe(d.id);
    for (let i = 0; i < 100 && s.scene; i++) s = sandboxAct(w, s, sceneActions(d, s.scene, s.player.sheet).find((a) => a.ok)!.action.id);
    expect(s.scene).toBeUndefined();
    expect(s.sceneResults?.[d.id]).toBeTruthy();
    expect(s.log.some((l) => l.text.includes('장면 시작'))).toBe(true);
  });

  it('모든 프리셋을 자동 시뮬레이션: 끝나고, 결과가 같은 시드에서 같다', () => {
    const w = withScenes();
    for (const d of w.scenes!) {
      const r = simulateScene(w, d.id, testSheet(w, 0, 3), 40);
      const total = Object.values(r.ends).reduce((a, b) => a + b, 0) + r.stuck + r.endless;
      expect(total).toBe(40);
      expect(r.endless).toBe(0);
      expect(simulateScene(w, d.id, testSheet(w, 0, 3), 40)).toEqual(r);
    }
  });

  it('모든 프리셋의 모든 끝은 무작위 플레이로도 나올 수 있다 (v0.72 수치 조정)', () => {
    const w = withScenes();
    for (const d of w.scenes!) expect([d.id, simulateScene(w, d.id, testSheet(w, 0, 3), 400).unreached]).toEqual([d.id, []]);
  });

  it('프리셋 균형 (v0.73): 무작위 플레이로 성공 15~50%, 모든 끝 3% 이상', () => {
    const w = withScenes();
    for (const d of w.scenes!) {
      const r = simulateScene(w, d.id, testSheet(w, 0, 3), 600);
      const pct = (id: string) => Math.round(((r.ends[id] ?? 0) / r.runs) * 100);
      const win = d.ends.filter((e) => e.outcome === 'success').reduce((a, e) => a + pct(e.id), 0);
      expect([d.id, win >= 15 && win <= 50]).toEqual([d.id, true]);
      for (const e of d.ends) expect([d.id, e.id, pct(e.id) >= 3]).toEqual([d.id, e.id, true]);
    }
  });
});
