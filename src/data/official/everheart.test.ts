import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../engine/package/validate';
import { flowWarnings } from '../../engine/package/flow';
import { simulateWorld } from '../../gm/simulate';
import { sceneActionEvents } from '../../gm/scene';
import { startEvents } from '../../gm/turn';
import { createCharacter, suggestedStandardArray } from '../../engine/character/sheet';
import { availableScenes, newRun, sceneActions } from '../../engine/scene';
import { evalCondition } from '../../engine/scenario';
import { currentDay } from '../../engine/world';
import type { SceneDef } from '../../engine/schema';
import type { GameEvent } from '../../engine/state/events';
import { applyEvent, type GameState, replay } from '../../engine/state/state';
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

  // ---- 장면 (v0.48)
  const ch = () => createCharacter({ name: '나', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: ['persuasion', 'performance', 'insight'] });
  const begin = (seed: number) => replay(startEvents(everheartWorld, ch(), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
  const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);
  const playOut = (def: SceneDef, seed: number) => {
    let s: GameState = { ...begin(seed), scene: newRun(def) };
    for (let i = 0; i <= (def.maxRounds ?? 20) && s.scene; i++) {
      const opts = sceneActions(def, s.scene, s.player.sheet).filter((a) => a.ok);
      expect(opts.length, `${def.name} ${i}차례`).toBeGreaterThan(0);
      s = apply(s, sceneActionEvents(everheartWorld, s, opts[(i * 7 + seed) % opts.length]!.action.id));
    }
    return s;
  };

  it('장면 5개: 검사기 통과, 여러 시드로 끝까지 진행되고 결과가 갈린다', () => {
    const defs = everheartWorld.scenes!;
    expect(defs.map((d) => d.id)).toEqual(['scene/first-waltz', 'scene/teo-market-date', 'scene/charity-auction', 'scene/salon-debate', 'scene/lab-containment']);
    expect(validateWorld(everheartWorld).filter((i) => i.path.startsWith('scenes'))).toEqual([]);
    const outcomes = new Set<string>();
    for (const def of defs) {
      expect(def.maxRounds, def.id).toBeGreaterThan(0);
      for (let seed = 1; seed <= 6; seed++) {
        const s = playOut(def, seed);
        expect(s.scene, `${def.name} seed ${seed}`).toBeUndefined();
        const r = s.sceneResults?.[def.id];
        expect(r, `${def.name} seed ${seed}`).toBeDefined();
        outcomes.add(r!.outcome);
      }
    }
    expect(outcomes.has('success') && outcomes.has('failure')).toBe(true);
  });

  it('봉인실: 이상을 알면 엘리안 곁에서 열리고, 성공하면 seal_restored로 임무 단계가 넘어간다', () => {
    const w = everheartWorld;
    const def = w.scenes!.find((d) => d.id === 'scene/lab-containment')!;
    // 엘리안은 9~18시에 연구소에 있다
    let s = apply(begin(4), [{ type: 'moved', to: 'loc/academy' }, { type: 'moved', to: 'loc/mage-lab' }]);
    s = { ...s, worldMinutes: currentDay(s) * 1440 + 10 * 60 };
    expect(availableScenes(w, s).map((d) => d.id)).not.toContain(def.id);
    s = apply(s, [{ type: 'knowledge_revealed', belief: { holder: 'player', claim: 'claim/lab-seal', state: 'confirmed', source: 'world' }, statement: '' }]);
    expect(availableScenes(w, s).map((d) => d.id)).toContain(def.id);
    const run = newRun(def);
    s = { ...s, scene: { ...run, phase: 'mend', gauges: { ...run.gauges, circuit: 10 } } };
    s = apply(s, sceneActionEvents(w, s, 'soothe'));
    expect(s.sceneResults?.[def.id]?.endId).toBe('restored');
    expect(s.flags).toContain('seal_restored');
    expect(evalCondition(w, s, { knows: 'claim/elian-accident-truth' })).toBe(true);
    expect(availableScenes(w, s).map((d) => d.id)).not.toContain(def.id);
  });
});

