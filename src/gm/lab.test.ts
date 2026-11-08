import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { everheartWorld } from '../data/official/everheart';
import type { WorldPackage } from '../engine/schema';
import { autoPlay, autoRun, blockers, neverSeen } from './autoplay';
import { condTrace, fightStats, labChoose, labEffects, labFireRule, labInput, labQuest, labState, labStatus, labStep } from './lab';

function ruled(): WorldPackage {
  const w = structuredClone(sampleWorld);
  w.vars = [{ id: 'suspicion', name: '의심', initial: 0, min: 0, max: 100 }];
  w.flags = [...(w.flags ?? []), { id: 'alarm', when: '(엔진)', requires: { not: { all: [] } } }];
  w.rules = [
    { id: 'rule/steal', name: '훔치기', trigger: { kind: 'action', describe: '물건을 훔친다', keywords: ['훔친다'] }, effects: [{ var: 'suspicion', add: 60 }] },
    { id: 'rule/alarm', name: '경보', trigger: { kind: 'state', condition: { var: 'suspicion', gte: 50 } }, effects: [{ setFlag: 'alarm' }] },
  ];
  return w;
}

describe('상태 시험대 (v0.84)', () => {
  it('설정대로 상태를 만든다: 장소·날·플래그·수치·관계·임무·지식·소지품', () => {
    const w = ruled();
    const s = labState(w, { locationId: 'loc/inn', days: 3, flags: ['chose_stay'], vars: { suspicion: 30 }, relations: { 'npc/ilse': { trust: 40 } }, questsDone: ['quest/why-am-i-here'], knows: ['claim/way-home'], money: 50 });
    expect(s.player.locationId).toBe('loc/inn');
    expect(Math.floor(s.worldMinutes / 1440)).toBeGreaterThanOrEqual(3);
    expect(s.flags).toContain('chose_stay');
    expect(s.vars?.suspicion).toBe(30);
    expect(s.relationships['npc/ilse']?.trust).toBe(40);
    expect(s.quests['quest/why-am-i-here']?.done).toBe(true);
    expect(s.beliefs.some((b) => b.holder === 'player' && b.claim === 'claim/way-home')).toBe(true);
    expect(s.money).toBe(50);
    // 이 상태면 "남는다" 결말 조건이 참 → 엔진 한 단계에 결말
    expect(labStatus(w, s).find((r) => r.id === 'ending/stay')?.ok).toBe(true);
    expect(labStep(w, s).lines).toContain('🏁 결말: 안개골짜기의 수호자');
  });

  it('조건 추적: 어느 하위 조건이 막았는지', () => {
    const w = ruled();
    const s = labState(w, { flags: ['chose_stay'] });
    const t = condTrace(w, s, w.endings!.find((e) => e.id === 'ending/stay')!.condition);
    expect(t.ok).toBe(false);
    expect(t.kids!.map((k) => k.ok)).toEqual([true, false]);
  });

  it('규칙·입력·효과를 해 보면 연쇄까지 기록된다', () => {
    const w = ruled();
    const s = labState(w, {});
    const a = labInput(w, s, '상인의 지갑을 훔친다');
    expect(a.hit).toEqual(['rule/steal']);
    expect(a.lines).toEqual(expect.arrayContaining(['⚖ 규칙 발동: 훔치기', '⚖ 규칙 발동: 경보 (상태)', '🚩 플래그 alarm']));
    expect(labFireRule(w, a.state, 'rule/steal').error).toBeTruthy(); // 한 번만
    expect(labFireRule(w, a.state, 'rule/steal', true).error).toBeUndefined(); // 무시하고 발동
    const e = labEffects(w, s, [{ var: 'suspicion', add: 80 }]);
    expect(e.lines).toContain('🚩 플래그 alarm');
  });

  it('결정·임무 완료를 해 보면 이어지는 일이 나온다', () => {
    const w = structuredClone(sampleWorld);
    const s = labState(w, { knows: ['claim/way-home', 'claim/altar-summoning'] });
    const c = w.choices![0]!;
    const r = labChoose(w, s, c.id, c.options[0]!.id);
    expect(r.lines[0]).toContain('◆ 결정');
    const q = labQuest(w, s, 'quest/why-am-i-here', 'done');
    expect(q.lines).toContain('✅ 임무 완료: 낯선 하늘 아래');
  });

  it('조우 승률 (자동 조작)', () => {
    const w = structuredClone(sampleWorld);
    const st = fightStats(w, labState(w, { level: 3 }), w.encounters![0]!, 20);
    expect(st.victory + st.defeat + st.fled).toBe(20);
    expect(st.victory).toBeGreaterThan(0);
  });
});

describe('자동 플레이 (v0.84)', () => {
  it('같은 씨앗이면 같은 결과, 끝까지 돈다', () => {
    const a = autoRun(sampleWorld, 5, 120);
    const b = autoRun(sampleWorld, 5, 120);
    expect(a.trace).toEqual(b.trace);
    expect(a.steps).toBeGreaterThan(0);
  });

  it('보고서: 결말 분포·한 번도 안 된 것·막힌 조건', async () => {
    const r = await autoPlay(everheartWorld, { runs: 8, steps: 300 });
    expect(r.runs).toBe(8);
    expect(Object.values(r.endings).reduce((n, e) => n + e.n, 0) + r.noEnding).toBe(8);
    const ns = neverSeen(everheartWorld, r);
    expect(ns.endings.length).toBeLessThan((everheartWorld.endings ?? []).length);
    const e = ns.endings[0];
    if (e) expect(blockers(everheartWorld, r.finals, e.condition).length).toBeGreaterThan(0);
  });
});
