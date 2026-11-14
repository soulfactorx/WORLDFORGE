import { describe, expect, it } from 'vitest';
import type { AssetMeta } from '../engine/schema';
import type { LlmClient, LlmRequest } from '../llm/types';
import { classifyAssetsVision } from './assetmatch';

describe('그림을 보고 분류 (v0.121)', () => {
  it('그림을 함께 보내고, 받은 분류를 적용한다 (없는 인물은 버린다)', async () => {
    const reqs: LlmRequest[] = [];
    const llm: LlmClient = { stream: async () => '', json: async <T,>(r: LlmRequest) => { reqs.push(r); return { items: ['0|c|npc/a||smile,eating', '1|c|npc/zzz||sad', '2|s||loc/b|night'] } as T; } };
    const assets: AssetMeta[] = [0, 1, 2].map((i) => ({ id: `a${i}`, name: `${i}.png`, kind: 'other', tags: [], mime: 'image/png', size: 1 }));
    const r = await classifyAssetsVision(llm, assets.map((a, i) => ({ index: i, name: a.name, mime: 'image/jpeg', data: 'AAAA' })), assets,
      [{ id: 'npc/a', name: '에이', look: '붉은 머리' }], [{ id: 'loc/b', name: '비' }]);
    expect(reqs[0]!.images).toHaveLength(3);
    expect(r.assets[0]).toMatchObject({ kind: 'character', characterId: 'npc/a', tags: ['smile', 'eating'] });
    expect(r.assets[1]!.kind).toBe('other');
    expect(r.assets[2]).toMatchObject({ kind: 'scene', locationId: 'loc/b', tags: ['night'] });
    expect(r.changed).toBe(2);
  });
});
