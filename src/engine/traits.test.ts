import { describe, expect, it } from 'vitest';
import { romanceSample } from '../data/sample-genres';
import { sampleWorld } from '../data/sample-world';
import { buildActorContext, buildNarratorContext } from '../gm/context';
import { effectEvents } from '../gm/story';
import { runTurn, startEvents } from '../gm/turn';
import type { LlmClient } from '../llm/types';
import { borrow, catalogOf } from './borrow';
import { createCharacter, legacyCharacter, suggestedStandardArray } from './character/sheet';
import { validateWorld } from './package/validate';
import { evalCondition } from './scenario';
import type { WorldPackage } from './schema';
import { applyEvent, replay } from './state/state';
import { traitLabel, traitsFor, traitValue } from './traits';

const start = (w: WorldPackage, traits?: Record<string, number>) => {
  const sh = traits ? createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'], gender: '여성', traits }) : legacyCharacter('나');
  return replay(startEvents(w, sh, 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
};

describe('주인공 성향 (v0.69)', () => {
  it('장르 기본 축, 시작 기울기, 말로 된 표시', () => {
    expect(traitsFor(sampleWorld).map((t) => t.id)).toEqual(['good', 'law']);
    expect(traitsFor(romanceSample).map((t) => `${t.low}↔${t.high}`)).toEqual(['냉정↔다정', '신중↔대담']);
    const s = start(sampleWorld, { good: 40, law: 0 });
    expect(traitValue(sampleWorld, s.player.sheet, 'good')).toBe(40);
    expect(traitLabel(traitsFor(sampleWorld)[0]!, 40)).toBe('선 쪽');
    expect(traitLabel(traitsFor(sampleWorld)[0]!, -70)).toBe('매우 악');
  });

  it('GM 판단 AI의 기울기: 축마다 한 턴 ±10까지, 없는 축은 거부, 기록에 남는다', async () => {
    const llm: LlmClient = { stream: async (_r, on) => { on('서술'); return '서술'; }, json: async <T,>(r: { system: string }) => {
      if (r.system.includes('판단 모듈')) return { action_summary: '살려 준다', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', time_spent: 'moment',
        trait_shift: [{ trait: 'good', delta: 25, reason: '다친 적을 살려 보냈다' }, { trait: 'nope', delta: 3, reason: 'x' }] } as T;
      if (r.system.includes('안내자')) return { summary: '요약', suggestion: '', choices: [{ text: 'a', skill: '', kind: 'advance' }] } as T;
      return { facts: [] } as T;
    } };
    const r = await runTurn(llm, sampleWorld, start(sampleWorld), '다친 고블린을 살려 보낸다', () => {});
    expect(traitValue(sampleWorld, r.state.player.sheet, 'good')).toBe(10);
    expect(r.rejected).toContain('없는 성향 축: nope');
    expect(r.state.log.some((l) => l.text.includes('◐ 선악 +10') && l.text.includes('살려 보냈다'))).toBe(true);
  });

  it('조건이 성향을 읽고, 효과가 성향을 움직인다', () => {
    let s = start(sampleWorld, { good: -30, law: 0 });
    expect(evalCondition(sampleWorld, s, { trait: 'good', lte: -20 })).toBe(true);
    expect(evalCondition(sampleWorld, s, { trait: 'good', gte: 20 })).toBe(false);
    for (const e of effectEvents(sampleWorld, s, [{ trait: 'good', add: 60 }], '구원')) s = applyEvent(s, e, s.turn);
    expect(traitValue(sampleWorld, s.player.sheet, 'good')).toBe(30);
    expect(evalCondition(sampleWorld, s, { trait: 'good', gte: 20 })).toBe(true);
  });

  it('AI 컨텍스트: 서술·판단은 수치와 말로, NPC는 뚜렷한 인상만', () => {
    const s = start(romanceSample, { warmth: -40, boldness: 0 });
    expect(buildNarratorContext(romanceSample, s)).toContain('온기 [warmth]: -40 — 냉정 쪽');
    const a = buildActorContext(romanceSample, s, romanceSample.characters[0]!);
    expect(a).toContain('이 낯선 이에게서 받는 인상');
    expect(a).toContain('냉정 쪽');
    expect(a).not.toContain('대담');
  });

  it('검사기: 없는 축을 쓰는 조건·효과, 축 정의', () => {
    const w: WorldPackage = { ...structuredClone(sampleWorld), traits: [{ id: 'mercy', name: '자비', low: '냉혹', high: '자비' }, { id: 'mercy', name: '', low: '', high: 'x' }],
      endings: [{ id: 'end/x', name: 'x', condition: { trait: 'good', gte: 50 }, epilogue: 'x' }] };
    const paths = validateWorld(w).filter((i) => i.level === 'error').map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['traits[1].id', 'traits[1].name', 'traits[1].low']));
    expect(paths.some((p) => p.startsWith('endings[0]'))).toBe(true);
  });

  it('만계서고: 주인공 양식·성향을 가져오고, 가져온 결말이 쓰는 축은 함께 온다', () => {
    expect(catalogOf(romanceSample).some((e) => e.kind === 'profile')).toBe(true);
    const r = borrow(sampleWorld, romanceSample, [{ kind: 'profile', id: 'profile' }]);
    expect(traitsFor(r.world).map((t) => t.id)).toEqual(['good', 'law', 'warmth', 'boldness']);
    expect(r.world.playerProfile!.fields!.some((f) => f.id === 'status')).toBe(true);
    expect(validateWorld(r.world).filter((i) => i.level === 'error')).toEqual([]);
    const src: WorldPackage = { ...structuredClone(romanceSample), endings: [...(romanceSample.endings ?? []), { id: 'end/cold', name: '얼음 여왕', condition: { trait: 'warmth', lte: -60 }, epilogue: '…' }] };
    const r2 = borrow(sampleWorld, src, [{ kind: 'ending', id: 'end/cold' }]);
    expect(traitsFor(r2.world).some((t) => t.id === 'warmth')).toBe(true);
    expect(r2.world.endings!.find((e) => e.name === '얼음 여왕')!.condition).toEqual({ trait: 'warmth', lte: -60 });
    expect(validateWorld(r2.world).filter((i) => i.level === 'error')).toEqual([]);
  });
});
