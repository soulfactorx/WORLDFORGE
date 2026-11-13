import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { applyEvent, replay, type GameState } from '../engine/state/state';
import { intensityHint, MIN_PHASE_TURNS, phasesOf, tensionOf } from '../engine/phase';
import { validateWorld } from '../engine/package/validate';
import { phaseEvents } from './phase';
import { startEvents } from './turn';
import type { GameEvent } from '../engine/state/events';

const start = (w = sampleWorld) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
/** 한 턴: 이 턴의 일(events)을 넣고 긴장·국면을 굴린다 */
function turn(w: typeof sampleWorld, s: GameState, events: GameEvent[] = [], extra: { delta: number; why: string }[] = []): GameState {
  const t = s.turn + 1;
  s = applyEvent(s, { type: 'player_input', text: '.' }, t);
  for (const e of events) s = applyEvent(s, e, t);
  for (const e of phaseEvents(w, s, events, extra)) s = applyEvent(s, e, t);
  return s;
}
const fail: GameEvent = { type: 'check_rolled', skill: '운동', reason: '', tiered: true, rngState: 1, result: { rolls: [2], kept: 2, modifier: 0, total: 2, dc: 15, success: false, natural20: false, natural1: false } };

describe('기류·국면 (v0.113)', () => {
  it('국면을 정하지 않은 세계는 긴장으로 움직이는 기본 국면 셋을 쓴다', () => {
    expect(phasesOf(sampleWorld).map((p) => p.name)).toEqual(['위기', '술렁임', '평온']);
    expect(phasesOf({ ...sampleWorld, autoPhases: false })).toEqual([]);
    let s = turn(sampleWorld, start());
    expect(s.phase).toBe('phase/calm');
    expect(s.log.some((l) => l.kind === 'phase')).toBe(false); // 처음 정해질 때는 기록하지 않는다
  });
  it('실패가 쌓이면 긴장이 오르고, 문턱을 넘으면 국면이 바뀐다 (들어온 뒤 몇 턴은 머문다)', () => {
    let s = turn(sampleWorld, start());
    for (let i = 0; i < 3; i++) s = turn(sampleWorld, s, [fail]);
    expect(tensionOf(s)).toBe(5);
    expect(s.phase).toBe('phase/stir');
    const since = s.phaseSince!;
    s = turn(sampleWorld, s, [], [{ delta: 3, why: '시험' }]); // 긴장 8 — 하지만 아직 머문다
    expect(s.turn - since).toBeLessThan(MIN_PHASE_TURNS);
    expect(s.phase).toBe('phase/stir');
    s = turn(sampleWorld, s); s = turn(sampleWorld, s);
    expect(s.phase).toBe('phase/crisis');
    expect(s.log.filter((l) => l.kind === 'phase').map((l) => l.text)).toEqual([expect.stringContaining('평온 → 술렁임'), expect.stringContaining('술렁임 → 위기')]);
    expect(s.phasePath).toEqual(['phase/calm', 'phase/stir', 'phase/crisis']);
  });
  it('세계가 정한 국면: from · 조건 · 들어올 때 효과 · 닫힌 장소', () => {
    const w = structuredClone(sampleWorld);
    w.flags = [...(w.flags ?? []), { id: 'flag/broken', when: '봉인이 깨지면' }];
    w.phases = [
      { id: 'ph/peace', name: '평화', tone: '고요', enter: { var: 'drama', lte: 10 } },
      { id: 'ph/fall', name: '붕괴', tone: '무너짐', from: ['ph/peace'], enter: { flag: 'flag/broken' }, closed: [w.locations[1]!.id], effects: [{ var: 'drama', add: 3 }] },
    ];
    w.phases = [w.phases[1]!, w.phases[0]!];
    expect(validateWorld(w).filter((i) => i.level === 'error' && i.path.startsWith('phases'))).toEqual([]);
    let s = turn(w, start(w));
    expect(s.phase).toBe('ph/peace');
    s = turn(w, s); s = turn(w, s); s = turn(w, s, [{ type: 'flag_set', flag: 'flag/broken' }]);
    expect(s.phase).toBe('ph/fall');
    expect(tensionOf(s)).toBe(5);
  });
  it('강도 곡선: 오래 잔잔하면 오름, 정점이 이어지면 터뜨린다', () => {
    let s = start();
    for (let i = 0; i < 4; i++) s = turn(sampleWorld, s);
    expect(intensityHint(s)?.kind).toBe('rise');
    s = turn(sampleWorld, s, [], [{ delta: 6, why: '시험' }]);
    for (let i = 0; i < 3; i++) s = turn(sampleWorld, s);
    expect(intensityHint(s)?.kind).toBe('peak');
  });
  it('검사기: 없는 국면·장소·인물을 가리키면 오류', () => {
    const w = structuredClone(sampleWorld);
    w.phases = [{ id: 'ph/a', name: 'A', tone: 't', enter: { phase: 'ph/zzz' }, from: ['ph/q'], closed: ['loc/zzz'], attitudes: { 'npc/zzz': 'x' } }];
    const paths = validateWorld(w).filter((i) => i.level === 'error').map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['phases[0].enter', 'phases[0].from', 'phases[0].closed', 'phases[0].attitudes']));
  });
});
