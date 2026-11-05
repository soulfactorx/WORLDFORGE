import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { npcLocationOf, rumorSpreadOn } from '../engine/world';
import { presentCharacters } from './context';
import { scenarioEvents } from './scenario';
import { startEvents } from './turn';

const world = (): WorldPackage => {
  const w = structuredClone(sampleWorld);
  w.factions = [{ id: 'fac/watch', name: '경비대', description: '', actions: [
    { name: '순찰 강화', every: 2, effects: [{ reputation: 'fac/watch', delta: 1 }], news: '📜 경비대가 숲길 순찰을 늘렸다는 소문이 돈다.' },
    { name: '조용한 일', every: 1, condition: { flag: 'never' }, effects: [{ setFlag: 'never' }] },
  ] }];
  w.flags = [...(w.flags ?? []), { id: 'never', when: '(테스트)' }];
  w.characters = w.characters.map((c) => (c.id === 'npc/bran' ? { ...c, faction: 'fac/watch', schedule: [{ from: 20, to: 6, locationId: 'loc/inn' }] } : c.id === 'npc/ilse' ? { ...c, faction: 'fac/watch' } : c));
  return w;
};
const start = (w: WorldPackage) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const run = (w: WorldPackage, s: GameState, extra: GameEvent[] = []) => {
  for (const e of extra) s = applyEvent(s, e, s.turn);
  for (const e of scenarioEvents(w, s).events) s = applyEvent(s, e, s.turn);
  return s;
};
const hours = (h: number): GameEvent => ({ type: 'time_advanced', minutes: h * 60 });

describe('지속되는 세계 (설계 v3 7장)', () => {
  it('검사기 통과', () => {
    expect(validateWorld(world()).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('일정: 밤에는 여관, 낮에는 원래 자리. 이야기가 옮긴 곳과 동료는 일정보다 우선', () => {
    const w = world();
    const bran = w.characters.find((c) => c.id === 'npc/bran')!;
    let s = start(w); // 8시
    expect(npcLocationOf(s, bran)).toBe('loc/village-gate');
    s = run(w, s, [hours(13)]); // 21시
    expect(npcLocationOf(s, bran)).toBe('loc/inn');
    expect(presentCharacters(w, { ...s, player: { ...s.player, locationId: 'loc/inn' } }).map((c) => c.id)).toContain('npc/bran');
    s = run(w, s, [hours(10)]); // 다음 날 7시
    expect(npcLocationOf(s, bran)).toBe('loc/village-gate');
    s = run(w, s, [{ type: 'npc_moved', npcId: 'npc/bran', to: 'loc/old-road' }, hours(13)]);
    expect(npcLocationOf(s, bran)).toBe('loc/old-road');
  });
  it('세력 행동: 며칠마다, 조건이 맞을 때만, 소식은 징조로', () => {
    const w = world();
    let s = start(w);
    expect(s.simDay).toBe(0);
    s = run(w, s, [hours(24)]);
    expect(s.reputation['fac/watch']).toBeUndefined();
    s = run(w, s, [hours(24 * 3)]); // 4일째까지: 2일·4일 두 번
    expect(s.reputation['fac/watch']).toBe(2);
    expect(s.log.filter((l) => l.kind === 'omen' && l.text.includes('순찰')).length).toBe(2);
    expect(s.flags).not.toContain('never');
    expect(s.simDay).toBe(4);
  });
  it('소문 전파: 같은 세력·가까운 사이로 하루씩, 비밀은 퍼지지 않고, 결정적이다', () => {
    const w = world();
    const s = start(w);
    const day1 = rumorSpreadOn(w, s, 1);
    expect(day1).toEqual(rumorSpreadOn(w, s, 1));
    expect(day1.length).toBeGreaterThan(0);
    for (const b of day1) {
      expect(['npc/bran', 'npc/ilse']).toContain(b.holder);
      expect(['rumor', 'mistaken']).toContain(b.state);
      const src = [...w.beliefs, ...s.beliefs].find((x) => x.holder === b.source && x.claim === b.claim)!;
      expect(src.state).not.toBe('secret');
    }
    const after = run(w, s, [hours(24 * 5)]);
    const spread = after.beliefs.filter((b) => b.holder !== 'player' && b.source?.startsWith('npc/'));
    expect(spread.length).toBeGreaterThan(day1.length - 1);
    expect(run({ ...w, simulation: { rumors: false } }, s, [hours(48)]).beliefs.filter((b) => b.holder !== 'player').length).toBe(0);
  });
});
