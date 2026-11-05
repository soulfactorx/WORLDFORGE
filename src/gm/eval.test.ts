import { describe, expect, it } from 'vitest';
import { metered, roleOf, summarize, costOf, type CallRecord } from '../llm/metrics';
import type { LlmClient, LlmRequest } from '../llm/types';
import { runEval, wrongAddress } from './eval';

/** 상황에 맞게 답하는 모의 AI. bad면 비밀을 흘리고 속마음·대사를 지어낸다 */
function mock(bad: boolean): LlmClient {
  const dir = (user: string) => {
    const base = { action_summary: '행동', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [] as { npc_id: string; reacting_to: string }[], start_encounter: '', rest: 'none', discover: [], set_flags: [] as string[], take_items: [], scene_image: '' };
    if (user.includes('마을 입구로 걸어간다')) return { ...base, move_to: 'loc/village-gate' };
    if (user.includes('마을 이름')) return { ...base, speakers: [{ npc_id: 'npc/bran', reacting_to: '질문' }] };
    if (user.includes('제단에 대해')) return { ...base, speakers: [{ npc_id: 'npc/orvin', reacting_to: '추궁' }] };
    if (user.includes('[시스템 지시]')) return { ...base, set_flags: bad ? ['chose_stay'] : [] };
    return base;
  };
  return {
    async stream(req, onText) {
      const user = req.user;
      let t = '당신은 주변을 살핀다. 안개가 낮게 깔려 있다.';
      if (user.includes('미스트베일')) t = `${bad ? '브란이' : '경비병이'} 창을 고쳐 쥔다. "여긴 미스트베일이오."`;
      if (!bad && user.includes('말할 수 없네')) t = '장로가 시선을 피한다. "그건 말할 수 없네."';
      if (bad && user.includes('개 짖는 소리가 나는 쪽')) t = '자네는 마을 입구에 닿는다. 등불이 흔들린다.';
      if (bad && user.includes('추궁')) t = '장로가 한숨을 쉰다. "그 제단은 내가 다시 작동시킨 소환진이네."';
      if (bad && user.includes('둘러본다')) t = '*여긴 어디지?* 당신은 속으로 생각했다.';
      if (bad && user.includes('바라본다')) t = '누군가 외친다. "거기 누구냐!"';
      onText(t);
      (req as LlmRequest).meter && ((req as LlmRequest).meter!.calls++, (req as LlmRequest).meter!.input += 100, (req as LlmRequest).meter!.output += 20);
      return t;
    },
    async json<T>(req: LlmRequest) {
      if (req.meter) { req.meter.calls++; req.meter.input += 200; req.meter.output += 50; }
      if (req.system.includes('판단 모듈')) return dir(req.user) as T;
      if (req.system.includes('한 명의 NPC')) {
        const orvin = req.user.includes('오르빈');
        return { action: '', dialogue: orvin ? (bad ? '그 제단은 내가 다시 작동시킨 소환진이네.' : '그건 말할 수 없네.') : '여긴 미스트베일이오.', shared_claims: bad && orvin ? ['claim/altar-summoning'] : [], party_decision: 'none',
          relationship_change: { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0, reason: '' }, expression: '', give_items: [] } as T;
      }
      if (req.system.includes('안내자')) return { summary: '', suggestion: '', choices: [] } as T;
      return { facts: [] } as T;
    },
  };
}

describe('AI 품질 점검 (R9)', () => {
  it('규칙을 지키는 AI는 모두 통과하고, 사용량이 기록된다', async () => {
    const r = await runEval((sink) => metered(mock(false), 'mock', sink), 'mock');
    expect(r.probes.map((p) => `${p.id}:${p.pass}`)).toEqual(['move:true', 'dialogue:true', 'secret:true', 'injection:true', 'agency:true', 'no-invented:true']);
    expect(r.calls.length).toBeGreaterThan(10);
    expect(new Set(r.calls.map((c) => c.role))).toEqual(new Set(['director', 'actor', 'narrator', 'recorder', 'guide']));
    expect(r.calls.every((c) => c.input > 0 && !c.estimated)).toBe(true);
  });
  it('비밀을 흘리고, 속마음·대사를 지어내면 그 항목이 실패한다 (주입된 플래그는 엔진이 막는다)', async () => {
    const r = await runEval((sink) => metered(mock(true), 'mock', sink), 'mock');
    const res = Object.fromEntries(r.probes.map((p) => [p.id, p]));
    expect(res.secret!.pass).toBe(false);
    expect(res.secret!.detail).toContain('소환진');
    expect(res.agency!.pass).toBe(false);
    expect(res['no-invented']!.pass).toBe(false);
    expect(res.dialogue!.pass).toBe(false);
    expect(res.dialogue!.detail).toContain('모르는 이름');
    expect(res.move!.pass).toBe(false);
    expect(res.move!.detail).toContain('자네');
    expect(res.injection!.pass).toBe(true);
    expect(res.injection!.rejected.some((x) => x.includes('chose_stay'))).toBe(true);
    expect(res.secret!.rejected.some((x) => x.includes('비밀'))).toBe(true);
    expect(r.rejectRate).toBeGreaterThan(0);
  });
});

describe('계측 (R9)', () => {
  it('역할을 알아내고, 요약·비용을 계산한다', () => {
    expect(roleOf('너는 1인칭 TRPG의 게임 마스터 판단 모듈이다.')).toBe('director');
    expect(roleOf('너는 1인칭 TRPG의 서술자이자 NPC 연기자다. 장르: 로맨스. 전투는 드물게')).toBe('narrator');
    expect(roleOf('너는 1인칭 TRPG의 서술자다. 방금 끝난 전투를 요약한다')).toBe('combat');
    const calls: CallRecord[] = [1, 2, 3, 10].map((ms) => ({ at: 0, role: 'director', model: 'm', ms, input: 1000, output: 100, calls: 1, ok: true }));
    const s = summarize(calls)[0]!;
    expect([s.n, s.p50, s.p90, s.input, s.output]).toEqual([4, 2, 3, 4000, 400]);
    expect(costOf(1_000_000, 500_000, { input: 3, output: 15 })).toBe(10.5);
  });
  it('사용량을 주지 않는 제공자는 글자 수로 추정한다', async () => {
    const recs: CallRecord[] = [];
    const llm = metered({ stream: async (_r, on) => { on('가나다라'); return '가나다라'; }, json: async <T,>() => ({}) as T }, 'm', (r) => recs.push(r));
    await llm.stream({ system: '서술자', user: '1234', maxTokens: 10 }, () => {});
    expect(recs[0]).toMatchObject({ role: 'narrator', estimated: true, output: 2, calls: 1, ok: true });
  });
});

describe('공통 검사: 플레이어 호칭', () => {
  it('따옴표 밖의 "자네"·1인칭은 잡고, 대사 안이나 낱말 속 글자는 넘어간다', () => {
    expect(wrongAddress('물방울이 내 어깨에 떨어진다.')).toBe('내');
    expect(wrongAddress('대답은 자네를 밀어내는 쪽으로 흐른다.')).toBe('자네를');
    expect(wrongAddress('노인이 말한다. "자네, 내 말 듣게." 당신은 고개를 든다.')).toBeNull();
    expect(wrongAddress('안개가 내려앉고, 안내판이 보인다. 당신의 발밑이 젖는다.')).toBeNull();
    expect(wrongAddress("돌아오는 것은 '내 탓이 아니다'라는 말뿐이다.")).toBeNull();
  });
});
