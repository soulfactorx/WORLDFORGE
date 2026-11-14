import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { aetheriaWorld } from '../data/official/aetheria';
import { createCharacter, legacyCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { replay, applyEvent } from '../engine/state/state';
import { activeStorylet } from '../engine/storylets';
import type { LlmClient, LlmRequest } from '../llm/types';
import { TAIL_MARK } from './guide';
import { presentCharacters } from './context';
import { runTurnOne } from './turnOne';
import { startEvents } from './turn';

const hero = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w = sampleWorld, ch = legacyCharacter('나')) => replay(startEvents(w, ch, 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
function one(text: string, json: Record<string, unknown>): LlmClient & { reqs: LlmRequest[] } {
  const reqs: LlmRequest[] = [];
  const body = `${text}\n\n${TAIL_MARK}\n${JSON.stringify({ summary: '요약', suggestion: '', choices: [{ text: '다음 행동', skill: '', kind: 'advance', scene: '', stake: 'defuse', option: '' }], move: { text: '', location: '' }, ...json })}`;
  return {
    reqs,
    stream: async (r, onText) => { reqs.push(r); onText(body); return body; },
    json: async <T,>(r: LlmRequest) => { reqs.push(r); return { facts: [], summary: '' } as T; },
  };
}

describe('한 번 호출 턴 (v0.118)', () => {
  it('보통 턴은 AI 요청이 한 번이고, 서술·선택지가 그 한 응답에서 나온다', async () => {
    const llm = one('문이 삐걱 열린다.', {});
    let shown = '';
    const r = await runTurnOne(llm, sampleWorld, start(), '둘러본다', (d) => { shown += d; });
    expect(llm.reqs).toHaveLength(1);
    expect(shown).not.toContain(TAIL_MARK);
    expect(r.events.find((e) => e.type === 'narration')).toMatchObject({ text: '문이 삐걱 열린다.' });
    const g = r.events.find((e) => e.type === 'gm_guide');
    expect(g?.type === 'gm_guide' && g.choices[0]).toBe('다음 행동');
    expect(g?.type === 'gm_guide' && g.choiceStakes?.[0]).toBe('defuse');
  });
  it('판정: 미리 굴린 주사위의 결과표를 주고, AI가 고른 접근법·난이도로 엔진이 같은 결과를 기록한다', async () => {
    const llm = one('힘껏 문을 민다.', { check: { approach: 'power', dc: 'hard' } });
    const r = await runTurnOne(llm, sampleWorld, start(sampleWorld, hero()), '문을 힘으로 민다', () => {});
    expect(llm.reqs[0]!.user).toContain('판정 결과표');
    const c = r.events.find((e) => e.type === 'check_rolled');
    expect(c?.type === 'check_rolled' && c.tiered).toBe(true);
    // 표에 적힌 결과와 기록된 결과가 같다
    const row = llm.reqs[0]!.user.split('\n').find((l) => l.startsWith('- power'))!;
    const tableHard = /어려움 (성공|대가|실패)/.exec(row)![1];
    const { checkTier } = await import('../engine/dice/dice');
    const ev = r.events.filter((e) => e.type === 'check_rolled').at(-1)!;
    const tier = ev.type === 'check_rolled' ? checkTier(ev.result) : undefined;
    expect(tier).toBe(tableHard === '성공' ? 'success' : tableHard === '대가' ? 'cost' : 'fail');
  });
  it('잠긴 비밀은 프롬프트에 넣지 않고, 털어놓을 수 있는 것만 — 모르는 것을 전하면 거부', async () => {
    const w = structuredClone(sampleWorld);
    const npc = w.characters[0]!;
    w.characters = [{ ...npc, locationId: w.start.locationId }];
    const sec = w.beliefs.find((b) => b.holder === npc.id && b.state === 'secret');
    const s0 = start(w);
    const llm = one('그가 입을 연다.', { shared: [{ npc: npc.id, claim: 'claim/none' }] });
    const r = await runTurnOne(llm, w, s0, '무엇을 아느냐고 묻는다', () => {});
    if (sec) expect(llm.reqs[0]!.user).not.toContain(w.claims.find((c) => c.id === sec.claim)!.statement);
    expect(llm.reqs[0]!.user).toContain('털어놓을 수 있는 것');
    expect(r.rejected.some((x) => x.includes('모르는 것을 전함'))).toBe(true);
    expect(presentCharacters(w, s0).length).toBe(1);
  });
  it('갈래 카드의 갈림길을 고르면 판정은 엔진이 먼저 — AI는 판정하지 않고, 카드·걸린 것이 서술 앞에 확정된다', async () => {
    const s0 = replay(startEvents(aetheriaWorld, hero(), 7, 'start/summoned').map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    expect(activeStorylet(aetheriaWorld, s0)?.id).toBe('card/ae-two-moons');
    const llm = one('언덕을 내려간다.', { check: { approach: 'power', dc: 'easy' } });
    const r = await runTurnOne(llm, aetheriaWorld, s0, '언덕 아래 불빛을 향해 내려간다', () => {}, undefined, undefined, undefined, undefined, { option: 'card/ae-two-moons#down', stake: 'defuse' });
    expect(llm.reqs).toHaveLength(1);
    expect(llm.reqs[0]!.user).toContain('엔진이 이미 했다');
    expect(r.events.filter((e) => e.type === 'check_rolled')).toHaveLength(0);
    expect(r.state.player.locationId).toBe('loc/vellos-gate');
    expect(r.events.some((e) => e.type === 'stake_applied' && e.stake === 'defuse')).toBe(true);
  });
  it('전환 요청: 이동은 검증해 적용하고, 갈 수 없는 곳은 거부한다', async () => {
    const s0 = start();
    const exit = sampleWorld.locations.find((l) => l.id === s0.player.locationId)!.connections[0]!;
    const ok = await runTurnOne(one('걸어간다.', { go_to: exit, time: 'scene' }), sampleWorld, s0, '간다', () => {});
    expect(ok.state.player.locationId).toBe(exit);
    const bad = await runTurnOne(one('걸어간다.', { go_to: 'loc/nowhere' }), sampleWorld, s0, '간다', () => {});
    expect(bad.rejected.some((x) => x.includes('갈 수 없는 곳'))).toBe(true);
  });
  it('JSON이 깨져도 턴은 이어진다 (기본 선택지)', async () => {
    const llm: LlmClient = { stream: async (_r, on) => { on('그냥 서술'); return '그냥 서술'; }, json: async <T,>() => ({ facts: [] }) as T };
    const r = await runTurnOne(llm, sampleWorld, start(), '둘러본다', () => {});
    expect(r.events.some((e) => e.type === 'gm_guide')).toBe(true);
    expect(r.rejected.some((x) => x.includes('JSON'))).toBe(true);
    void applyEvent;
  });
});

describe('한 번 호출 턴의 모델', () => {
  it('AI 설정의 서술 묶음(narrator)으로 간다', async () => {
    const { roleOf } = await import('../llm/metrics');
    const { groupOf } = await import('../llm');
    const { oneSystemPrompt, ONE_CALL_GROUP } = await import('./turnOne');
    expect(groupOf(roleOf(oneSystemPrompt()))).toBe(ONE_CALL_GROUP);
  });
});
