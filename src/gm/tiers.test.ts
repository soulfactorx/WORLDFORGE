import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { checkTier } from '../engine/dice/dice';
import { createRng } from '../engine/dice/rng';
import { applyEvent, replay } from '../engine/state/state';
import { costOf, failForwardOf } from './tiers';
import { startEvents } from './turn';

const start = () => replay(startEvents(sampleWorld, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const r = (total: number, dc: number, kept = 10) => ({ total, dc, success: total >= dc, natural20: kept === 20, natural1: kept === 1 });

describe('판정 3단 결과 (v0.112)', () => {
  it('DC 이상 성공 · DC-5까지 대가 · 그 아래 실패 · 자연 20/1', () => {
    expect(checkTier(r(15, 15))).toBe('success');
    expect(checkTier(r(10, 15))).toBe('cost');
    expect(checkTier(r(9, 15))).toBe('fail');
    expect(checkTier(r(3, 15, 20))).toBe('success');
    expect(checkTier(r(30, 15, 1))).toBe('fail');
  });
  it('대가와 전개는 엔진이 고르고, 같은 주사위면 같은 결과다', () => {
    const s = start();
    const a = costOf(sampleWorld, s, createRng(42), { skillOrAbility: 'athletics', present: [] });
    const b = costOf(sampleWorld, s, createRng(42), { skillOrAbility: 'athletics', present: [] });
    expect(a).toEqual(b);
    expect(a.line).toBeTruthy();
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => failForwardOf(sampleWorld, s, createRng(i), { skillOrAbility: 'athletics', present: [] }).kind));
    expect(kinds.has('lost') && kinds.has('hurt')).toBe(true);
  });
  it('다쳐도 전투 밖에서는 HP 1 아래로 내려가지 않는다', () => {
    let s = start();
    s = applyEvent(s, { type: 'hp_changed', delta: -999, reason: '시험' }, 1);
    expect(s.player.sheet.hp).toBe(1);
  });
});
