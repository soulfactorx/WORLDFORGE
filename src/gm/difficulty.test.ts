import { describe, expect, it, beforeEach } from 'vitest';
import { wuxiaSample } from '../data/sample-genres';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { clampDcMod, combatScale, difficultyEffect, difficultyLabel, withDcMod } from '../engine/difficulty';
import { sceneActions, newRun } from '../engine/scene';
import type { SceneDef } from '../engine/schema';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import type { LlmClient, LlmRequest } from '../llm/types';
import { runTurn, startEvents } from './turn';
import { clearNewGameMemory, loadNewGameMemory, saveNewGameMemory } from '../ui/newGameMemory';

const hero = () => createCharacter({ name: '나', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: ['persuasion', 'insight', 'perception'] });
const start = () => replay(startEvents(wuxiaSample, hero(), 9).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
function mock(order: string[]): LlmClient {
  return {
    async stream(_r, onText) { order.push('narrator'); onText('당신은 말을 건넨다.'); return '당신은 말을 건넨다.'; },
    async json<T>(req: LlmRequest) {
      if (req.system.includes('판단 모듈')) return { action_summary: '설득', check_kind: 'skill', check_skill: 'persuasion', check_ability: 'cha', check_dc_tier: 'medium', check_mode: 'normal', check_reason: '설득', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], take_items: [], scene_image: '' } as T;
      if (req.system.includes('안내자')) return { summary: '', suggestion: '', choices: [] } as T;
      return { facts: [], summary: '' } as T;
    },
  };
}

describe('게임 난이도 (v0.90)', () => {
  it('세이브의 DC 보정이 행동 판정에 더해진다', async () => {
    for (const dcMod of [-4, 0, 2]) {
      const s: GameState = applyEvent(start(), { type: 'difficulty_set', dcMod, label: difficultyLabel(dcMod) }, 0);
      const r = await runTurn(mock([]), wuxiaSample, s, '주모를 설득한다', () => {}, undefined, () => {}, undefined, undefined, { leads: false });
      const check = r.events.find((e) => e.type === 'check_rolled');
      expect(check?.type === 'check_rolled' && check.result.dc).toBe(15 + dcMod);
    }
    expect(withDcMod(5, -6)).toBe(2);
    expect(clampDcMod(99)).toBe(8);
    expect(difficultyLabel(-4)).toContain('쉬움');
    expect(difficultyLabel(-8)).toContain('이야기');
    expect(difficultyLabel(3)).toContain('사용자 정의');
  });

  it('장면의 행동 판정에도 더해진다', () => {
    const def: SceneDef = { id: 'scene/x', name: 'x', description: '', gauges: [{ id: 'g', name: 'g', start: 0 }], actions: [{ id: 'a', name: 'a', check: 'skill:persuasion', dc: 12, success: { gauges: { g: 1 } } }], ends: [{ id: 'e', name: 'e', when: { gauge: 'g', gte: 9 }, outcome: 'success' }] };
    expect(sceneActions(def, newRun(def), hero())[0]!.dc).toBe(12);
    expect(sceneActions(def, newRun(def), hero(), undefined, 2)[0]!.dc).toBe(14);
    expect(sceneActions(def, newRun(def), hero(), undefined, -4)[0]!.dc).toBe(8);
  });

  it('판정 결과는 서술이 시작되기 전에 화면에 알려진다', async () => {
    const order: string[] = [];
    let seenCheck = false;
    await runTurn(mock(order), wuxiaSample, start(), '주모를 설득한다', () => {}, undefined, () => {}, undefined, undefined,
      { leads: false, onState: (st) => { if (st.log.some((l) => l.kind === 'check')) { seenCheck = true; if (!order.includes('check-shown')) order.push('check-shown'); } } });
    expect(seenCheck).toBe(true);
    expect(order.indexOf('check-shown')).toBeLessThan(order.indexOf('narrator'));
  });
});

describe('난이도 점검 (v0.106)', () => {
  it('이야기는 보통 판정을 대부분 통하게 한다 · 기록에 원래 난이도가 함께 보인다', async () => {
    const s: GameState = applyEvent(start(), { type: 'difficulty_set', dcMod: -8, label: difficultyLabel(-8) }, 0);
    const r = await runTurn(mock([]), wuxiaSample, s, '주모를 설득한다', () => {}, undefined, () => {}, undefined, undefined, { leads: false });
    const check = r.events.find((e) => e.type === 'check_rolled');
    expect(check?.type === 'check_rolled' && [check.result.dc, check.dcBase]).toEqual([7, 15]);
    expect(r.state.log.find((l) => l.kind === 'check')?.text).toContain('(난이도 이야기: 15 → 7)');
    // 보통 난이도에서는 덧붙이지 않는다
    const n = await runTurn(mock([]), wuxiaSample, start(), '주모를 설득한다', () => {}, undefined, () => {}, undefined, undefined, { leads: false });
    expect(n.state.log.find((l) => l.kind === 'check')?.text).not.toContain('난이도');
    expect(difficultyEffect(-8)).toContain('보통 15 → 7');
    expect(difficultyEffect(0)).toContain('규칙 그대로');
  });
  it('GM 판단에게 난이도 등급의 뜻을 알려 준다', async () => {
    let schema: Record<string, unknown> = {}; let system = '';
    const llm: LlmClient = { ...mock([]), async json<T>(req: LlmRequest, sc: Record<string, unknown>) { if (req.system.includes('판단 모듈')) { schema = sc; system = req.system; } return mock([]).json<T>(req, sc); } };
    await runTurn(llm, wuxiaSample, start(), '주모를 설득한다', () => {}, undefined, () => {}, undefined, undefined, { leads: false });
    const desc = (schema as { properties: { check_dc_tier: { description: string } } }).properties.check_dc_tier.description;
    expect(desc).toContain('medium=15');
    expect(desc).toContain('hard는 전문가도');
    expect(system).toContain('습관처럼 medium·hard를 고르지 않는다');
  });
  it('전투: 적의 방어도·명중·체력 — 전투 중에 바꾸면 지금 싸움의 방어도에 바로 적용된다', () => {
    expect(combatScale(-8)).toEqual({ ac: -4, hp: 0.5 });
    expect(combatScale(4)).toEqual({ ac: 2, hp: 1.25 });
    const foe = { id: 'e1', side: 'enemy', ac: 14 }, me = { id: 'player', side: 'player', ac: 15 };
    const s0 = { ...start(), combat: { combatants: { e1: foe, player: me } } } as unknown as GameState;
    const s1 = applyEvent(s0, { type: 'difficulty_set', dcMod: -8, label: '이야기' }, 0);
    expect(s1.combat!.combatants.e1!.ac).toBe(10);
    expect(s1.combat!.combatants.player!.ac).toBe(15);
    expect(s1.combat!.difficulty).toBe(-8);
    expect(applyEvent(s1, { type: 'difficulty_set', dcMod: 0, label: '보통' }, 0).combat!.combatants.e1!.ac).toBe(14); // 되돌리면 원래대로
    expect(s1.log.at(-1)!.text).toContain('지금 전투에도 적용');
  });
});

describe('새 게임 입력 기억 (v0.90)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  });
  it('적은 값을 기억하고, 다른 양식에서 적은 항목은 지우지 않고 더한다', () => {
    expect(loadNewGameMemory()).toEqual({});
    saveNewGameMemory({ name: '연우', gender: '여성', info: { looks: '검은 머리' }, infoByLabel: { 외모: '검은 머리' }, lean: { good: 30 }, roleId: 'bard', classId: 'bard', dcMod: -2 });
    saveNewGameMemory({ name: '연우', info: { origin: '강남' }, infoByLabel: { 출신: '강남' }, lean: { justice: -30 }, roleId: 'swordsman', classId: 'fighter' });
    const m = loadNewGameMemory();
    expect(m).toMatchObject({ name: '연우', gender: '여성', roleId: 'swordsman', classId: 'fighter', dcMod: -2 });
    expect(m.info).toEqual({ looks: '검은 머리', origin: '강남' });
    expect(m.infoByLabel).toEqual({ 외모: '검은 머리', 출신: '강남' });
    expect(m.lean).toEqual({ good: 30, justice: -30 });
    clearNewGameMemory();
    expect(loadNewGameMemory()).toEqual({});
  });
});
