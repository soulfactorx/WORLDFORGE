import { describe, expect, it } from 'vitest';
import { groupOf, modelFor } from './index';

describe('역할별 모델 (R9)', () => {
  const s = { provider: 'openai-compatible' as const, apiKey: '', model: 'big', roleModels: { judge: 'small', narrator: '' } };
  it('역할 묶음별로 모델을 고르고, 비어 있으면 기본 모델', () => {
    expect(modelFor(s, '너는 1인칭 TRPG의 게임 마스터 판단 모듈이다.')).toBe('small');
    expect(modelFor(s, '너는 기록관이다')).toBe('small');
    expect(modelFor(s, '너는 1인칭 TRPG의 서술자이자 NPC 연기자다.')).toBe('big');
    expect(modelFor(s, '너는 1인칭 TRPG 속 한 명의 NPC다.')).toBe('big');
    expect(modelFor({ ...s, roleModels: undefined }, '판단 모듈')).toBe('big');
    expect([groupOf('combat'), groupOf('guide'), groupOf('translate')]).toEqual(['narrator', 'judge', 'build']);
  });
});
