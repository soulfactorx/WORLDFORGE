import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../engine/package/validate';
import { flowWarnings } from '../../engine/package/flow';
import { simulateWorld } from '../../gm/simulate';
import { stockDataUrl } from '../stockart';
import { aetheriaWorld } from './aetheria';

/** 의도한 경고: 최종 보스 조우는 1레벨 2인 일행 기준으로 치명적이다 (마지막 장에서만 일어난다) */
const INTENDED = (msg: string) => msg.includes('"월주 세레스"');

describe('공식 세계: 에테리아', () => {
  it('검사기 오류가 없고, 의도한 것 말고는 경고도 없다', () => {
    const issues = validateWorld(aetheriaWorld);
    const warnings = issues.filter((i) => i.level === 'warning');
    if (warnings.length) console.log(warnings.map((w) => `${w.path}: ${w.message}`).join('\n'));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(warnings.filter((w) => !INTENDED(w.message))).toEqual([]);
  });

  it('플래그는 세우는 곳과 읽는 곳이 모두 있다', () => {
    expect(flowWarnings(aetheriaWorld)).toEqual([]);
  });

  it('이미지가 모두 그려지고, 모든 인물·장소에 이미지가 있다', () => {
    for (const a of aetheriaWorld.assets!) expect(stockDataUrl(a.id), a.id).toBeTruthy();
    for (const c of aetheriaWorld.characters) expect(aetheriaWorld.assets!.some((a) => a.characterId === c.id), c.id).toBe(true);
    for (const l of aetheriaWorld.locations) expect(aetheriaWorld.assets!.some((a) => a.locationId === l.id), l.id).toBe(true);
  });

  it('규모: 장소·인물·임무·명제·조우', () => {
    expect(aetheriaWorld.locations.length).toBeGreaterThanOrEqual(14);
    expect(aetheriaWorld.characters.length).toBeGreaterThanOrEqual(12);
    expect(aetheriaWorld.quests!.length).toBeGreaterThanOrEqual(9);
    expect(aetheriaWorld.claims.length).toBeGreaterThanOrEqual(25);
    expect(aetheriaWorld.encounters!.length).toBeGreaterThanOrEqual(6);
    expect(aetheriaWorld.characters.filter((c) => c.companion).length).toBeGreaterThanOrEqual(3);
    expect(aetheriaWorld.arcs!.find((a) => a.kind === 'main')!.chapters).toHaveLength(5);
  });

  it('시뮬레이터: 12일 동안 세계가 스스로 움직인다', () => {
    const r = simulateWorld(aetheriaWorld, 12);
    expect(r.days).toHaveLength(13);
    // 첫 임무와 줄기가 시작된다
    expect(r.state.quests['quest/strange-world']).toBeDefined();
    // 3일째부터 국경 분쟁 임무가 열리고, 8일째에는 이상 현상 임무가 열린다
    expect(r.state.quests['quest/border-dispute']).toBeDefined();
    expect(r.state.quests['quest/omens']).toBeDefined();
    // 봉인의 균열 시계가 차오르고, 세계 수치가 바뀐다
    expect(r.state.clocks['clock/seal-crack']!.value).toBe(12);
    expect(r.state.flags).toContain('god_stirring');
    expect(r.state.vars?.seal ?? 60).toBeLessThan(60);
    expect(r.state.vars?.tension ?? 40).toBeGreaterThan(40);
    const all = r.days.flatMap((d) => d.lines);
    expect(all.some((l) => l.includes('검은 월식'))).toBe(true);
    expect(all.some((l) => l.includes('회색 관문의 첫 피'))).toBe(true);
    // 플레이어가 막지 않으면 세레스가 협회를 장악한다 (9일)
    expect(r.state.npcGoals?.['goal/seres-coup']?.done).toBe(true);
  });

  it('시작 방식마다 시뮬레이션이 돈다', () => {
    for (const st of aetheriaWorld.starts!) expect(() => simulateWorld(aetheriaWorld, 3, { startId: st.id })).not.toThrow();
    const rookie = simulateWorld(aetheriaWorld, 1, { startId: 'start/rookie' });
    expect(rookie.state.quests['quest/lost-children']).toBeDefined();
  });
});
