import type { Belief, Claim, WorldPackage } from '../schema';

export interface KnownClaim {
  claim: Claim;
  belief: Belief;
}

/**
 * 특정 주체(holder)가 알고 있는 명제만 돌려준다.
 * 프롬프트에 넣을 지식은 반드시 이 함수를 거친다 — "모르는 정보는 프롬프트에 존재하지 않는다" 원칙.
 * 반환값에는 Claim의 진위(truth)를 넣지 않는다: 믿는 사람은 그것이 거짓인지 모른다.
 */
export function knowledgeOf(world: WorldPackage, saveBeliefs: Belief[], holder: string): { statement: string; state: Belief['state'] }[] {
  const merged = new Map<string, Belief>();
  for (const b of [...world.beliefs, ...saveBeliefs]) if (b.holder === holder) merged.set(b.claim, b);
  const claims = new Map(world.claims.map((c) => [c.id, c]));
  return [...merged.values()].flatMap((b) => {
    const c = claims.get(b.claim);
    return c ? [{ statement: c.statement, state: b.state }] : [];
  });
}
