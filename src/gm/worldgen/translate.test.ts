import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../../llm/types';
import { needsKorean, translateBudget, translateToKorean } from './translate';

describe('한국어 번역', () => {
  it('외국어 글만 골라 묶음으로 번역하고, 실패한 묶음은 원문을 둔다', async () => {
    expect(needsKorean('Silver hair and red eyes. She speaks briefly.')).toBe(true);
    expect(needsKorean('은발에 붉은 눈. Hedwig은 짧게 말한다.')).toBe(false);
    expect(needsKorean('short')).toBe(false);
    let calls = 0, sent = '';
    const llm: LlmClient = { stream: async () => '', json: async <T,>(r: { user: string }) => {
      calls++; sent = r.user;
      if (r.user.includes('FAIL')) throw new Error('x');
      const items = JSON.parse(r.user.slice(r.user.indexOf('['))) as { id: string }[];
      return { items: items.map((i) => ({ id: i.id, text: `번역:${i.id}` })) } as T;
    } };
    const long = (s: string) => `${s} `.repeat(30);
    const r = await translateToKorean(llm, [{ id: 'a', text: long('Hedwig is calm') }, { id: 'b', text: '이미 한국어로 된 충분히 긴 설명 글입니다.' }, { id: 'c', text: long('FAIL please') }], [{ latin: 'Hedwig', korean: '헤드비히' }], undefined, undefined, 500, 2);
    expect(r.get('a')).toBe('번역:a');
    expect(r.has('b')).toBe(false);
    expect(r.has('c')).toBe(false);
    expect(calls).toBe(2);
    expect(sent).toContain('Hedwig → 헤드비히');
  });
});


describe('번역 출력 한도 (v0.37.10)', () => {
  it('영어 원문은 글자×1.5+3000, 한자·가나 원문은 더 넉넉하게, 최대 24000', () => {
    expect(translateBudget('a'.repeat(6000))).toBe(12000);
    expect(translateBudget('漢'.repeat(6000))).toBe(16200);
    expect(translateBudget('a'.repeat(40000))).toBe(24000);
  });
});
