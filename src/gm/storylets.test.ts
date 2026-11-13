import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { applyEvent, replay, type GameState } from '../engine/state/state';
import { activeStorylet, eligibleStorylets } from '../engine/storylets';
import { validateWorld } from '../engine/package/validate';
import type { Storylet, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { LlmClient } from '../llm/types';
import { chooseOptionEvents, openStoryletEvents } from './storylets';
import { basicGuide } from './guide';
import { runTurn, startEvents } from './turn';

const npc = sampleWorld.characters[0]!.id;
function world(): WorldPackage {
  const w = structuredClone(sampleWorld);
  w.flags = [...(w.flags ?? []), { id: 'sided', when: '편을 들면' }];
  const cards: Storylet[] = [
    { id: 'card/fork', title: '갈림길', situation: '두 사람이 당신을 본다.', options: [
      { id: 'help', label: '그를 돕는다', stake: `bond:${npc}`, success: [{ setFlag: 'sided' }], fallout: [{ inTurns: 2, storylet: 'card/thanks' }] },
      { id: 'leave', label: '모른 척한다', stake: 'defuse' },
      { id: 'risky', label: '무모하게 뛰어든다', stake: 'escalate', check: { skill: 'athletics', dc: 'very_hard' } },
    ] },
    { id: 'card/thanks', title: '은혜', when: { flag: 'sided' }, situation: '그가 찾아온다.', options: [{ id: 'ok', label: '받는다' }, { id: 'no', label: '거절한다' }] },
    { id: 'card/crisis', title: '위기의 카드', phases: ['phase/crisis'], situation: '…', options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }] },
  ];
  w.storylets = cards;
  return w;
}
const start = (w: WorldPackage) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const step = (s: GameState, evs: GameEvent[]) => evs.reduce((x, e) => applyEvent(x, e, x.turn), s);
const next = (s: GameState) => applyEvent(s, { type: 'player_input', text: '.' }, s.turn + 1);

describe('갈래 카드 덱 (v0.115)', () => {
  it('검사기를 통과하고, 덱은 조건·국면으로 걸러진다', () => {
    const w = world();
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
    const s = start(w);
    expect(eligibleStorylets(w, s).map((c) => c.id)).toEqual(['card/fork']);
  });
  it('펼치고 → 갈림길을 고르면 효과·고른 기록·후폭풍 카드 예약 → 때가 되면 그 카드가 반드시 펼쳐진다', () => {
    const w = world();
    let s = next(start(w));
    s = step(s, openStoryletEvents(w, s, { pick: 'card/fork', quiet: false }));
    expect(activeStorylet(w, s)?.id).toBe('card/fork');
    const g = basicGuide(w, s);
    expect(g.type === 'gm_guide' && g.choiceOptions?.filter(Boolean)).toEqual(['card/fork#help', 'card/fork#leave', 'card/fork#risky']);
    s = next(s);
    const r = chooseOptionEvents(w, s, 'card/fork#help')!;
    expect(r.stake).toBe(`bond:${npc}`);
    s = step(s, r.events);
    expect(s.flags).toContain('sided');
    expect(s.storylets?.['card/fork']?.chosen).toBe('help');
    expect(activeStorylet(w, s)).toBeUndefined();
    expect(eligibleStorylets(w, s).map((c) => c.id)).not.toContain('card/fork'); // 한 번만
    s = next(s);
    expect(openStoryletEvents(w, s, { quiet: false })).toEqual([]);
    s = next(s);
    expect(openStoryletEvents(w, s, { quiet: false })).toEqual([{ type: 'storylet_opened', id: 'card/thanks', title: '은혜' }]);
  });
  it('판정이 걸린 갈림길은 3단 결과로 — 실패해도 후폭풍은 없고 상황이 바뀐다', () => {
    const w = world();
    let s = next(start(w));
    s = step(s, openStoryletEvents(w, s, { pick: 'card/fork', quiet: false }));
    const r = chooseOptionEvents(w, next(s), 'card/fork#risky')!;
    expect(r.events.some((e) => e.type === 'check_rolled' && e.tiered)).toBe(true);
    expect(r.tier).toBeDefined();
    expect(chooseOptionEvents(w, next(s), 'card/zzz#a')).toBeNull();
  });
  it('잔잔하면 엔진이 덱에서 뽑는다', () => {
    const w = world();
    const s = next(start(w));
    expect(openStoryletEvents(w, s, { quiet: true })[0]).toMatchObject({ type: 'storylet_opened', id: 'card/fork' });
  });
  it('턴: 갈림길을 고르면 판정을 엔진이 하고 걸린 것을 적용하며, GM이 고른 카드를 서술 앞에 펼친다', async () => {
    const w = world();
    let s = next(start(w));
    s = step(s, openStoryletEvents(w, s, { pick: 'card/fork', quiet: false }));
    const users: string[] = [];
    const llm: LlmClient = {
      stream: async (r, onText) => { users.push(r.user); onText('.'); return '.'; },
      json: async <T,>(r: { system: string; user: string }) => { users.push(r.user); return (r.system.includes('판단 모듈') ? { action_summary: '돕는다', check_kind: 'skill', check_skill: 'athletics', check_ability: 'str', check_dc_tier: 'hard', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', stake: '', storylet: '' } : { facts: [], summary: '', choices: [] }) as T; },
    };
    const r = await runTurn(llm, w, s, '그를 돕는다', () => {}, undefined, undefined, undefined, undefined, { option: 'card/fork#help' });
    expect(r.events.some((e) => e.type === 'check_rolled')).toBe(false); // GM의 판정은 무시
    expect(r.events.some((e) => e.type === 'stake_applied' && e.stake === `bond:${npc}`)).toBe(true);
    expect(r.state.storylets?.['card/fork']?.chosen).toBe('help');
    expect(users[0]).toContain('갈래 카드의 갈림길');
  });
});

describe('임무 → 카드 초안 (v0.115)', () => {
  it('공식 세계의 임무로 만든 초안은 검사기를 통과하고, 고르면 그 단계가 끝난다', async () => {
    const { aetheriaWorld } = await import('../data/official/aetheria');
    const { questDraftCards } = await import('../engine/storylets');
    const w = structuredClone(aetheriaWorld);
    const drafts = questDraftCards(w);
    expect(drafts.length).toBeGreaterThan(5);
    w.storylets = drafts;
    expect(validateWorld(w).filter((i) => i.level === 'error' && i.path.startsWith('storylets'))).toEqual([]);
    expect(questDraftCards(w)).toEqual([]); // 이미 카드가 있는 단계는 건너뛴다
  });
  it('갈림길의 advanceQuest는 조건과 상관없이 그 단계를 끝낸다', async () => {
    const { scenarioEvents } = await import('./scenario');
    const w = structuredClone(sampleWorld);
    const q = w.quests![0]!;
    let s = next(start(w));
    s = step(s, [{ type: 'quest_started', questId: q.id, name: q.name, objective: q.stages[0]!.objective }]);
    if (!s.quests[q.id]) return;
    s = step(s, [{ type: 'quest_pushed', questId: q.id, stage: s.quests[q.id]!.stage }]);
    const evs = scenarioEvents(w, s).events;
    expect(evs.some((e) => (e.type === 'quest_advanced' || e.type === 'quest_completed') && e.questId === q.id)).toBe(true);
  });
});
