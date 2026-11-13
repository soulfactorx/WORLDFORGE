import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { applyEvent, replay, type GameState } from '../engine/state/state';
import { parseStake, stakeOptions, stakeValid } from '../engine/stakes';
import { tensionOf } from '../engine/phase';
import type { LlmClient } from '../llm/types';
import { falloutEvents, stakeEvents } from './stakes';
import { guideEvent } from './guide';
import { presentCharacters } from './context';
import { runTurn, startEvents } from './turn';

const start = () => replay(startEvents(sampleWorld, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: ReturnType<typeof stakeEvents>['events']) => evs.reduce((x, e) => applyEvent(x, e, x.turn), s);
const npc = sampleWorld.characters[0]!.id;

describe('걸린 것 · 원장 · 후폭풍 (v0.114)', () => {
  it('걸린 것의 모양을 읽고 검사한다', () => {
    expect(parseStake('betray:npc/a')).toEqual({ kind: 'betray', ref: 'npc/a' });
    expect(parseStake('theme:var/x:+')).toEqual({ kind: 'theme', ref: 'var/x', dir: 1 });
    expect(parseStake('nope')).toBeNull();
    const s = start();
    expect(stakeValid(sampleWorld, s, `bond:${npc}`)).toBe(true);
    expect(stakeValid(sampleWorld, s, 'bond:npc/none')).toBe(false);
    expect(stakeOptions(sampleWorld, s, presentCharacters(sampleWorld, s)).map((o) => o.id)).toEqual(expect.arrayContaining(['escalate', 'defuse']));
  });
  it('배신은 관계·긴장을 바꾸고 원장에 남고, 2턴 뒤 후폭풍이 돌아온다', () => {
    let s = applyEvent(start(), { type: 'player_input', text: '.' }, 1);
    const t0 = tensionOf(s);
    s = apply(s, stakeEvents(sampleWorld, s, `betray:${npc}`, 'success', '그를 버리고 떠난다').events);
    expect(s.relationships[npc]?.grudge).toBeGreaterThan(0);
    expect(tensionOf(s)).toBe(t0 + 1);
    expect(s.ledger?.[0]).toMatchObject({ stake: `betray:${npc}`, choice: '그를 버리고 떠난다' });
    expect(s.fallout?.[0]?.due).toBe(3);
    s = applyEvent(s, { type: 'player_input', text: '.' }, 2);
    expect(falloutEvents(sampleWorld, s).events).toEqual([]);
    s = applyEvent(s, { type: 'player_input', text: '.' }, 3);
    const fo = falloutEvents(sampleWorld, s);
    expect(fo.lines[0]).toContain('배신');
    s = fo.events.reduce((x, e) => applyEvent(x, e, 3), s);
    expect(s.fallout).toEqual([]);
    expect(s.ledger?.[0]?.returned).toContain('↩');
    expect(s.log.some((l) => l.kind === 'fallout')).toBe(true);
  });
  it('실패하면 후폭풍을 예약하지 않는다', () => {
    const s = applyEvent(start(), { type: 'player_input', text: '.' }, 1);
    expect(stakeEvents(sampleWorld, s, 'escalate', 'fail', '.').events.some((e) => e.type === 'fallout_queued')).toBe(false);
  });
  it('선택지의 걸린 것은 유효하고 서로 겹치지 않는 것만 남는다', () => {
    const s = start();
    const g = guideEvent(sampleWorld, s, { summary: 's', suggestion: '', choices: [
      { text: 'a', skill: '', kind: 'advance', stake: 'escalate' }, { text: 'b', skill: '', kind: 'bond', stake: 'escalate' },
      { text: 'c', skill: '', kind: 'bold', stake: 'bond:npc/none' }, { text: 'd', skill: '', kind: 'wild', stake: 'defuse' }] });
    expect(g?.type === 'gm_guide' && g.choiceStakes?.slice(0, 4)).toEqual(['escalate', '', '', 'defuse']);
  });
  it('고른 선택지의 걸린 것을 턴에서 적용하고 GM·서술자에게 알린다', async () => {
    const users: string[] = [];
    const llm: LlmClient = {
      stream: async (r, onText) => { users.push(r.user); onText('.'); return '.'; },
      json: async <T,>(r: { system: string; user: string }) => { users.push(r.user); return (r.system.includes('판단 모듈') ? { action_summary: '도발', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', stake: '' } : { facts: [], summary: '', choices: [] }) as T; },
    };
    const r = await runTurn(llm, sampleWorld, start(), '판을 엎는다', () => {}, undefined, undefined, undefined, undefined, { stake: 'escalate' });
    expect(r.events.some((e) => e.type === 'stake_applied' && e.stake === 'escalate')).toBe(true);
    expect(users[0]).toContain('플레이어가 고른 선택의 무게');
    expect(users.find((u) => u.includes('엔진 확정 결과'))).toContain('선택의 무게');
  });
});
