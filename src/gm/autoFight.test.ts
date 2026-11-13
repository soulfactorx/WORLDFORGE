import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { applyEvent, replay, type GameState } from '../engine/state/state';
import { autoFightEvents, beginEncounterAnywhere, minorFight } from './combat';
import { startEvents } from './turn';

const start = (seed: number) => replay(startEvents(sampleWorld, legacyCharacter('나'), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: ReturnType<typeof autoFightEvents>['events']) => evs.reduce((x, e) => applyEvent(x, e, x.turn), s);

describe('자동 전투 (v0.112)', () => {
  it('엔진이 대신 싸워 끝내거나, 위험해지면 멈춘다 — 같은 주사위면 같은 결과', () => {
    let ended = 0, stopped = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let s = start(seed);
      s = apply(s, beginEncounterAnywhere(sampleWorld, s, 'enc/clearing-wolves', 1));
      if (!s.combat) continue;
      expect(minorFight(sampleWorld, s.combat)).toBe(true);
      const a = autoFightEvents(sampleWorld, s);
      expect(autoFightEvents(sampleWorld, s)).toEqual(a);
      const after = apply(s, a.events);
      if (a.stopped) { stopped++; expect(after.combat && !after.combat.outcome).toBeTruthy(); }
      else { ended++; expect(a.events.some((e) => e.type === 'combat_ended')).toBe(true); }
    }
    expect(ended + stopped).toBeGreaterThan(0);
    expect(ended).toBeGreaterThan(0);
  });
});
