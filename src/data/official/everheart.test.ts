import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../engine/package/validate';
import { flowWarnings } from '../../engine/package/flow';
import { simulateWorld } from '../../gm/simulate';
import { stockDataUrl } from '../stockart';
import { everheartWorld } from './everheart';

describe('공식 세계: 에버하트', () => {
  it('검사에서 오류·경고가 없다', () => {
    const issues = validateWorld(everheartWorld);
    const warnings = issues.filter((i) => i.level === 'warning');
    if (warnings.length) console.warn(warnings.map((w) => `${w.path}: ${w.message}`).join('\n'));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('이야기 흐름: 세우는 곳 없이 읽기만 하는 플래그가 없다', () => {
    const missing = flowWarnings(everheartWorld).filter((x) => x.includes('세우는 곳이 없습니다'));
    expect(missing).toEqual([]);
  });

  it('모든 이미지가 그려진다', () => {
    expect(everheartWorld.assets!.length).toBeGreaterThan(0);
    for (const a of everheartWorld.assets!) expect(stockDataUrl(a.id), a.id).toBeTruthy();
  });

  it('규모: 장소·인물·임무·명제', () => {
    expect(everheartWorld.locations.length).toBeGreaterThanOrEqual(12);
    expect(everheartWorld.characters.length).toBeGreaterThanOrEqual(12);
    expect(everheartWorld.characters.filter((c) => c.romanceable)).toHaveLength(6);
    expect(everheartWorld.characters.filter((c) => c.companion)).toHaveLength(2);
    expect(everheartWorld.quests!.length).toBeGreaterThanOrEqual(9);
    expect(everheartWorld.claims.length).toBeGreaterThanOrEqual(25);
  });

  it('시뮬레이터: 12일 동안 세계가 스스로 흘러간다', () => {
    const r = simulateWorld(everheartWorld, 12);
    expect(r.days).toHaveLength(13);
    const all = r.days.flatMap((d) => d.lines.map((l) => `${d.day}:${l}`));
    // 3일째 익명 기사, 9일째 혼인 조약 소문, 11일째 축제 전야
    expect(all.some((l) => l.startsWith('3:') && l.includes('익명'))).toBe(true);
    expect(all.some((l) => l.startsWith('9:') && l.includes('혼인 조약'))).toBe(true);
    expect(all.some((l) => l.startsWith('11:') && l.includes('축제 전야'))).toBe(true);
    // NPC 목표: 미렐라의 거래와 세라피나의 약혼이 이뤄지고 인물 사이가 바뀐다
    expect(r.state.npcGoals?.['goal/mirela-deal']?.done).toBe(true);
    expect(r.state.npcGoals?.['goal/seraphine-engagement']?.done).toBe(true);
    expect(r.state.npcRelations?.['npc/lucien|npc/seraphine']?.kind).toBe('lover');
    // 축제 준비는 무도회 전에 끝난다
    expect(r.state.vars?.['var/festival']).toBeGreaterThanOrEqual(60);
    // 같은 입력이면 같은 미래
    expect(simulateWorld(everheartWorld, 12).days).toEqual(r.days);
  });

  it('시작 방식마다 시뮬레이터가 돈다', () => {
    for (const st of everheartWorld.starts!) expect(() => simulateWorld(everheartWorld, 3, { startId: st.id })).not.toThrow();
  });
});
