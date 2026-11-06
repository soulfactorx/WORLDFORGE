import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../engine/package/validate';
import { flowWarnings } from '../../engine/package/flow';
import { simulateWorld } from '../../gm/simulate';
import { stockDataUrl } from '../stockart';
import { cheonhaWorld } from './cheonha';

describe('공식 세계: 천하무림', () => {
  it('검사기 오류가 없다 (경고는 의도한 고레벨 조우 난이도뿐)', () => {
    const issues = validateWorld(cheonhaWorld);
    const errors = issues.filter((i) => i.level === 'error');
    const warnings = issues.filter((i) => i.level === 'warning');
    if (warnings.length) console.log(warnings.map((w) => `${w.path}: ${w.message}`).join('\n'));
    expect(errors).toEqual([]);
    // 후반부 조우(혈도문·사도명·위천광·검총)는 1레벨 기준 치명적인 것이 의도다
    expect(warnings.filter((w) => !/^encounters\[\d+\]$/.test(w.path) || !w.message.includes('치명적'))).toEqual([]);
  });

  it('플래그 흐름에 막힌 곳이 없다', () => {
    expect(flowWarnings(cheonhaWorld).filter((x) => x.includes('세우는 곳이 없습니다'))).toEqual([]);
  });

  it('규모: 장소·인물·임무·명제·조우', () => {
    expect(cheonhaWorld.locations.length).toBeGreaterThanOrEqual(14);
    expect(cheonhaWorld.characters.length).toBeGreaterThanOrEqual(12);
    expect(cheonhaWorld.characters.filter((c) => c.companion).length).toBeGreaterThanOrEqual(3);
    expect(cheonhaWorld.quests!.length).toBeGreaterThanOrEqual(9);
    expect(cheonhaWorld.claims.length).toBeGreaterThanOrEqual(25);
    expect(cheonhaWorld.encounters!.length).toBeGreaterThanOrEqual(6);
    expect(cheonhaWorld.arcs!.find((a) => a.kind === 'main')!.chapters).toHaveLength(5);
  });

  it('모든 기본 이미지가 그려진다', () => {
    for (const a of cheonhaWorld.assets ?? []) expect(stockDataUrl(a.id), a.id).toBeTruthy();
  });

  it('12일 시뮬레이션: 세계가 스스로 흘러간다', () => {
    const r = simulateWorld(cheonhaWorld, 12);
    expect(r.days).toHaveLength(13);
    const all = r.days.flatMap((d) => d.lines.map((l) => `${d.day}:${l}`));
    expect(all.some((l) => l.startsWith('2:') && l.includes('두 번째 시체'))).toBe(true);
    expect(all.some((l) => l.includes('혈풍령의 북소리'))).toBe(true);
    // 아무도 막지 않으면 9일째 종리휘의 탄핵 공작이 이뤄지고 맹주가 끌려간다
    expect(r.state.npcGoals?.['goal/jongri-coup']?.done).toBe(true);
    expect(r.state.npcLocations['npc/namgung']).toBe('loc/capital');
    expect(r.state.clocks['clock/cult-march']!.value).toBeGreaterThanOrEqual(12);
    expect(r.state.vars?.['pact']).toBeLessThan(55);
    expect(r.state.ending).toBeFalsy();
  });

  it('다른 시작: 생존자는 사부와 원수 줄기로 시작한다', () => {
    const r = simulateWorld(cheonhaWorld, 1, { startId: 'start/survivor' });
    expect(r.state.player.locationId).toBe('loc/ruined-sect');
    expect(r.state.arcs['arc/master']).toBeTruthy();
  });
});
