import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { romanceSample } from '../data/sample-genres';
import { legacyCharacter } from '../engine/character/sheet';
import { evalCondition } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { obeyedOrders } from './combat';
import { relationshipEvents } from './relationship';
import { BEAT_TURNS, scenarioEvents } from './scenario';
import { startEvents } from './turn';

const world = (): WorldPackage => ({
  ...structuredClone(sampleWorld),
  factions: [{ id: 'fac/guard', name: '경비대', description: '마을 경비대', reputation: 5 }],
  relations: [
    { a: 'npc/bran', b: 'npc/ilse', kind: 'rival', note: '오랜 앙숙' },
    { a: 'npc/bran', b: 'npc/orvin', kind: 'family' },
  ],
  characters: sampleWorld.characters.map((c) => (c.id === 'npc/bran' ? { ...c, faction: 'fac/guard', romanceable: true } : c)),
  flags: [...(sampleWorld.flags ?? []), { id: 'bran_confessed', when: '브란이 속마음을 털어놓았을 때' }],
  relationBeats: [{ id: 'beat/bran-heart', npcId: 'npc/bran', name: '브란의 고백', condition: { relationship: 'npc/bran', axis: 'intimacy', gte: 20 }, hint: '브란이 속마음을 털어놓는다', resolveFlag: 'bran_confessed' }],
});
const start = (w: WorldPackage) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const bran = { id: 'npc/bran', name: '브란' };

describe('관계 2.0 — 파급·평판·단계', () => {
  it('가까워지면 단계 변화가 기록되고, 소속 세력 평판·라이벌 원한·가족 호감이 따라 움직인다', () => {
    const w = world();
    let s = start(w);
    s = { ...s, relationships: { 'npc/bran': { affinity: 5, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0 } } };
    const evs = relationshipEvents(w, s, bran, { affinity: 8, intimacy: 5 }, '목숨을 구했다');
    const kinds = evs.map((e) => e.type);
    expect(kinds[0]).toBe('relationship_changed');
    expect(evs).toContainEqual(expect.objectContaining({ type: 'relation_stage', npcId: 'npc/bran', from: '낯섦', to: '아는 사이' }));
    expect(evs).toContainEqual(expect.objectContaining({ type: 'reputation_changed', factionId: 'fac/guard', delta: 4, base: 5 }));
    expect(evs).toContainEqual(expect.objectContaining({ type: 'relationship_changed', npcId: 'npc/ilse', delta: { grudge: 3 } }));
    expect(evs).toContainEqual(expect.objectContaining({ type: 'relationship_changed', npcId: 'npc/orvin', delta: { affinity: 3 } }));
    for (const e of evs) s = applyEvent(s, e, 1);
    expect(s.reputation['fac/guard']).toBe(9);
    expect(evalCondition(w, s, { reputation: 'fac/guard', gte: 9 })).toBe(true);
    expect(evalCondition(w, s, { stage: 'npc/bran', in: ['아는 사이'] })).toBe(true);
    expect(s.log.some((l) => l.text.includes('♡ 브란'))).toBe(true);
  });
  it('작은 변화는 퍼지지 않는다', () => {
    const w = world();
    const evs = relationshipEvents(w, start(w), bran, { affinity: 2 }, '인사');
    expect(evs.filter((e) => e.type === 'relationship_changed')).toHaveLength(1);
  });
});

describe('관계 사건', () => {
  it('조건이 맞으면 열리고, 해결 플래그가 서면 닫힌다', () => {
    const w = world();
    let s = start(w);
    expect(scenarioEvents(w, s).events.some((e) => e.type === 'beat_opened')).toBe(false);
    s = { ...s, relationships: { 'npc/bran': { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 25, grudge: 0 } } };
    const opened = scenarioEvents(w, s).events;
    expect(opened).toContainEqual({ type: 'beat_opened', beatId: 'beat/bran-heart', npcId: 'npc/bran', name: '브란의 고백' });
    for (const e of opened) s = applyEvent(s, e, s.turn);
    expect(scenarioEvents(w, s).events.some((e) => e.type === 'beat_opened')).toBe(false);
    s = applyEvent(s, { type: 'flag_set', flag: 'bran_confessed' }, s.turn);
    expect(scenarioEvents(w, s).events).toContainEqual({ type: 'beat_closed', beatId: 'beat/bran-heart' });
  });
  it('해결 플래그가 없으면 몇 턴 뒤 닫힌다', () => {
    const w = world();
    w.relationBeats![0]!.resolveFlag = undefined;
    let s: GameState = { ...start(w), relationships: { 'npc/bran': { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 25, grudge: 0 } } };
    for (const e of scenarioEvents(w, s).events) s = applyEvent(s, e, s.turn);
    s = { ...s, turn: s.turn + BEAT_TURNS };
    expect(scenarioEvents(w, s).events).toContainEqual({ type: 'beat_closed', beatId: 'beat/bran-heart' });
  });
});

describe('동료 충성도', () => {
  it('충성도가 낮은 동료의 명령은 무시된다', () => {
    const w = world();
    const s = { ...start(w), partyOrders: { 'npc/bran': { mode: 'guard' as const, conserve: false } } };
    expect(obeyedOrders(w, s)).toHaveProperty('npc/bran');
    const bad = { ...s, relationships: { 'npc/bran': { affinity: -20, trust: -20, respect: 0, fear: 0, intimacy: 0, grudge: 40 } } };
    expect(obeyedOrders(w, bad)).toEqual({});
  });
});


describe('질투 (로맨스 샘플)', () => {
  it('카시안과 친밀이 깊어지면 엘레노어의 원한이 쌓이고, 견제 사건이 열린다', () => {
    const w = romanceSample;
    let s = start(w);
    const evs = relationshipEvents(w, s, { id: 'npc/cassian', name: '카시안' }, { affinity: 4, intimacy: 6 }, '춤을 췄다');
    const el = evs.find((e) => e.type === 'relationship_changed' && e.npcId === 'npc/eleanor');
    expect(el && el.type === 'relationship_changed' && el.delta).toEqual({ grudge: 3, affinity: -3 });
    // 리나(동지)는 호감
    expect(evs).toContainEqual(expect.objectContaining({ type: 'relationship_changed', npcId: 'npc/rina', delta: { affinity: 2 } }));
    for (const e of evs) s = applyEvent(s, e, 1);
    for (const e of relationshipEvents(w, s, { id: 'npc/cassian', name: '카시안' }, { intimacy: 6 }, '정원에서')) s = applyEvent(s, e, 1);
    expect(scenarioEvents(w, s).events).toContainEqual(expect.objectContaining({ type: 'beat_opened', beatId: 'beat/eleanor-jealous' }));
  });
});
