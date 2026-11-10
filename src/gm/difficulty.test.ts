import { describe, expect, it, beforeEach } from 'vitest';
import { wuxiaSample } from '../data/sample-genres';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { clampDcMod, difficultyLabel, withDcMod } from '../engine/difficulty';
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
    expect(clampDcMod(99)).toBe(6);
    expect(difficultyLabel(-2)).toContain('쉬움');
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
