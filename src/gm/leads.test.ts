import { describe, expect, it } from 'vitest';
import { wuxiaSample } from '../data/sample-genres';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import type { LlmClient, LlmRequest } from '../llm/types';
import { runTurn, startEvents } from './turn';

/** 실마리가 턴에 들어가는가 (v0.89): 엔진이 굴린 이야기는 NPC·서술 AI에게 확정으로 가고, 플레이어의 지식이 된다 */
function mock(seen: { actor: string[]; narrator: string[]; director: string[] }, speakers: string[]): LlmClient {
  return {
    async stream(req, onText) { seen.narrator.push(req.user); onText('당신은 객잔에 앉아 있다.'); return '당신은 객잔에 앉아 있다.'; },
    async json<T>(req: LlmRequest) {
      if (req.system.includes('판단 모듈')) { seen.director.push(`${req.system}\n${req.user}`); return { action_summary: '둘러본다', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: speakers.map((npc_id) => ({ npc_id, reacting_to: '인사' })), start_encounter: '', rest: 'none', discover: [], set_flags: [], take_items: [], scene_image: '' } as T; }
      if (req.system.includes('한 명의 NPC')) { seen.actor.push(`${req.system}\n${req.user}`); return { action: '', dialogue: '어서 오시오.', shared_claims: [], party_decision: 'none', relationship_change: { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0, reason: '' }, expression: '', give_items: [] } as T; }
      if (req.system.includes('안내자')) return { summary: '', suggestion: '', choices: [] } as T;
      return { facts: [], summary: '' } as T;
    },
  };
}
const hero = () => createCharacter({ name: '나', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: ['persuasion', 'insight', 'perception'] });
const start = (seed: number) => replay(startEvents(wuxiaSample, hero(), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

describe('실마리가 턴에 들어간다 (v0.89)', () => {
  it('말문: 인물이 대사에 담지 않아도 플레이어는 알게 되고, NPC·서술 AI는 확정된 이야기로 받는다', async () => {
    let told = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const seen = { actor: [] as string[], narrator: [] as string[], director: [] as string[] };
      const r = await runTurn(mock(seen, ['npc/wang']), wuxiaSample, start(seed), '주모에게 인사한다', () => {});
      const lead = r.events.find((e) => e.type === 'lead' && e.kind === 'tell');
      if (!lead) continue;
      told++;
      const got = r.events.filter((e) => e.type === 'knowledge_revealed' && e.belief.source === 'npc/wang');
      expect(got.length).toBe(1);
      expect(seen.actor[0]).toContain('이번에 네가 먼저 꺼내는 이야기');
      expect(seen.actor[0]).toContain((got[0] as { statement?: string }).statement!);
      expect(seen.narrator[0]).toContain('실마리 — 말문');
      expect(r.state.log.some((l) => l.text.startsWith('🎲 말문'))).toBe(true);
    }
    expect(told).toBeGreaterThan(2);
  });

  it('아무도 말하지 않는 턴에도 그 자리의 인물이 먼저 말을 걸 수 있다 · 끄면 조용하다', async () => {
    let approached = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const seen = { actor: [] as string[], narrator: [] as string[], director: [] as string[] };
      const r = await runTurn(mock(seen, []), wuxiaSample, start(seed), '가만히 앉아 있는다', () => {});
      if (r.events.some((e) => e.type === 'npc_spoke')) { approached++; expect(seen.actor[0]).toContain('네가 먼저 말을 건다'); }
      const off = await runTurn(mock({ actor: [], narrator: [], director: [] }, []), wuxiaSample, start(seed), '가만히 앉아 있는다', () => {}, undefined, () => {}, undefined, undefined, { leads: false });
      expect(off.events.some((e) => e.type === 'npc_spoke' || e.type === 'lead')).toBe(false);
    }
    expect(approached).toBeGreaterThan(2);
  });

  it('GM 판단 AI는 세계의 진실을 받고, 서술·NPC AI는 받지 않는다', async () => {
    const seen = { actor: [] as string[], narrator: [] as string[], director: [] as string[] };
    await runTurn(mock(seen, ['npc/wang']), wuxiaSample, start(3), '주모에게 인사한다', () => {});
    const truth = wuxiaSample.facts[0]!.statement.slice(0, 30);
    expect(seen.director[0]).toContain('GM만 아는 세계의 진실');
    expect(seen.director[0]).toContain(truth);
    expect(seen.narrator[0]).not.toContain(truth);
    expect(seen.actor[0]).not.toContain(truth);
  });
});
