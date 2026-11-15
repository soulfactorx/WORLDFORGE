import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { BUILTIN_EVENTS } from '../engine/randomEvents';
import { applyEvent, replay } from '../engine/state/state';
import type { GameEvent } from '../engine/state/events';
import { startEvents } from './turn';
import { applyRandomEvent } from './randomEvent';

const hero = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });

describe('돌발 사건 적용 (v0.128)', () => {
  it('만남: 세계에 흔한 사람들을 참고해 엑스트라를 지어내라고 알린다', () => {
    let s = replay(startEvents(sampleWorld, hero(), 3).map((event, seq) => ({ saveId: 'x', seq, turn: 0, event })));
    const w = { ...sampleWorld, improv: { cast: '순례자, 밀수꾼' } };
    const push = (e: GameEvent) => { s = applyEvent(s, e, 1); };
    const r = applyRandomEvent(w, s, BUILTIN_EVENTS.find((e) => e.kind === 'meeting')!, 1, push);
    expect(r.lines[0]).toContain('엑스트라');
    expect(r.lines[0]).toContain('순례자, 밀수꾼');
  });
  it('기습: 전투가 시작된다', () => {
    let s = replay(startEvents(sampleWorld, hero(), 3).map((event, seq) => ({ saveId: 'x', seq, turn: 0, event })));
    const push = (e: GameEvent) => { s = applyEvent(s, e, 1); };
    const r = applyRandomEvent({ ...sampleWorld, improv: { foes: '산적' } }, s, BUILTIN_EVENTS.find((e) => e.kind === 'ambush')!, 1, push);
    expect(r.ambushed).toBe(true);
    expect(s.combat).toBeTruthy();
    expect(r.lines[0]).toContain('산적');
  });
});
