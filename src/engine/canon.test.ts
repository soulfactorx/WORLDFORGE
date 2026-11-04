import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { MAX_FACTS_PER_TURN, playerStateFromNpc, protectedTopicsOf, shareableBelief, validateImprovisedFacts } from './canon';

const scene = ['loc/village-gate', 'npc/bran'];

describe('즉흥 사실 검증', () => {
  it('허용 범위 안의 장면 엔티티는 기록된다', () => {
    const [d] = validateImprovisedFacts(sampleWorld, [], scene, [{ subject: 'npc/bran', statement: '  브란에게는  딸이 하나 있다. ' }]);
    expect(d).toEqual({ fact: { subject: 'npc/bran', statement: '브란에게는 딸이 하나 있다.' }, accepted: true });
  });
  it('즉흥 금지(none) 대상은 거부', () => {
    const [d] = validateImprovisedFacts(sampleWorld, [], ['loc/forest-clearing'], [{ subject: 'loc/forest-clearing', statement: '제단은 고대 엘프가 만들었다.' }]);
    expect(d!.accepted).toBe(false);
  });
  it('장면 밖·미지의 대상, 중복, 한도 초과 거부', () => {
    const ds = validateImprovisedFacts(sampleWorld, [{ subject: 'npc/bran', statement: '브란은 마흔다섯 살이다.', turn: 1 }], scene, [
      { subject: 'npc/ilse', statement: '일제는 고양이를 키운다.' },
      { subject: 'npc/ghost', statement: '?' },
      { subject: 'npc/bran', statement: '브란은 마흔다섯 살이다.' },
    ]);
    expect(ds.map((d) => d.accepted)).toEqual([false, false, false]);
    const many = Array.from({ length: MAX_FACTS_PER_TURN + 2 }, (_, i) => ({ subject: 'npc/bran', statement: `사실 ${i}` }));
    expect(validateImprovisedFacts(sampleWorld, [], scene, many).filter((d) => d.accepted)).toHaveLength(MAX_FACTS_PER_TURN);
  });
  it('보호 주제는 이름표만 노출하고 내용은 노출하지 않는다', () => {
    const t = protectedTopicsOf(sampleWorld, 'npc/ilse');
    expect(t).toEqual(['일제의 화상 자국이 생긴 경위']);
    expect(t.join()).not.toContain('의식');
  });
});

describe('NPC → 플레이어 지식 전달', () => {
  it('NPC가 아는 명제만 전달 가능', () => {
    expect(shareableBelief(sampleWorld, [], 'npc/bran', 'claim/elder-strange')).not.toBeNull();
    expect(shareableBelief(sampleWorld, [], 'npc/bran', 'claim/altar-summoning')).toBeNull();
  });
  it('들은 말은 최대 partial, 소문은 소문', () => {
    expect(playerStateFromNpc('confirmed')).toBe('partial');
    expect(playerStateFromNpc('secret')).toBe('partial');
    expect(playerStateFromNpc('rumor')).toBe('rumor');
  });
});
