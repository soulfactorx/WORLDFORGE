import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import { knowledgeOf } from './knowledge';

describe('knowledgeOf', () => {
  it('플레이어는 처음에 아무것도 모른다', () => {
    expect(knowledgeOf(sampleWorld, [], 'player')).toEqual([]);
  });
  it('NPC는 자기 Belief만 받고, 진실 여부는 노출되지 않는다', () => {
    const k = knowledgeOf(sampleWorld, [], 'npc/bran');
    expect(k.map((x) => x.statement)).toContain('숲속 제단은 저주받은 곳이라 가까이 가면 안 된다.');
    expect(JSON.stringify(k)).not.toContain('소환진');
    expect(JSON.stringify(k)).not.toContain('truth');
  });
  it('세이브에서 획득한 지식이 반영된다', () => {
    const k = knowledgeOf(sampleWorld, [{ holder: 'player', claim: 'claim/village-name', state: 'confirmed', source: 'npc/bran' }], 'player');
    expect(k).toEqual([{ statement: '이 마을의 이름은 미스트베일이다.', state: 'confirmed', source: 'npc/bran' }]);
  });
});
