import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from './character/sheet';
import { replay, applyEvent } from './state/state';
import { startEvents } from '../gm/turn';
import { scenarioEvents } from '../gm/scenario';

describe('진행 시계 — 턴마다 차는 눈금 (v0.112)', () => {
  it('every: beat는 턴이 지날 때마다 찬다', () => {
    const w = structuredClone(sampleWorld);
    w.clocks = [{ id: 'clock/t', name: '다가오는 것', segments: 4, tick: [{ every: 'beat', by: 1 }], at: [{ segment: 2, omen: '징조' }] }];
    let s = replay(startEvents(w, legacyCharacter('나'), 3).map((event, seq) => ({ saveId: 'x', seq, turn: 0, event })));
    const step = () => { const turn = s.turn + 1; s = applyEvent(s, { type: 'player_input', text: '.' }, turn); for (const e of scenarioEvents(w, s).events) s = applyEvent(s, e, turn); };
    step(); // 첫 턴: 처음 잰다
    const v0 = s.clocks['clock/t']!.value;
    step(); step();
    expect(s.clocks['clock/t']!.value).toBe(v0 + 2);
    expect(s.log.some((l) => l.kind === 'omen' && l.text === '징조')).toBe(true);
  });
});
