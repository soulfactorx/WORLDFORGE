import type { CompanionSpec, EntityId, WorldPackage } from './schema';

/**
 * NPC → 플레이어 관계 (설계 리뷰 4.5절: 핵심 4축)
 * - affinity: 호감(+) ↔ 적대(-)
 * - trust:    신뢰
 * - respect:  존경
 * - fear:     두려움
 * 모든 축은 -100 ~ 100. 변화는 Actor(NPC)가 제안하고, 엔진이 턴당 한도로 자른다.
 */
export const AXES = ['affinity', 'trust', 'respect', 'fear'] as const;
export type Axis = (typeof AXES)[number];
export type Relationship = Record<Axis, number>;

export const AXIS_NAMES: Record<Axis, string> = { affinity: '호감', trust: '신뢰', respect: '존경', fear: '두려움' };

/** 한 번의 사건(턴)으로 축 하나가 움직일 수 있는 최대치 */
export const MAX_DELTA_PER_TURN = 10;
/** 기본: 비밀을 털어놓으려면 필요한 신뢰 */
export const DEFAULT_SECRET_TRUST = 40;
/** 동료가 이 호감 이하로 떨어지면 일행을 떠난다 */
export const LEAVE_AFFINITY = -40;

const ZERO: Relationship = { affinity: 0, trust: 0, respect: 0, fear: 0 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function initialRelationship(world: WorldPackage, npcId: EntityId): Relationship {
  const c = world.characters.find((x) => x.id === npcId);
  return { ...ZERO, ...(c?.relationship ?? {}) };
}

export function relationshipOf(world: WorldPackage, saved: Record<EntityId, Relationship>, npcId: EntityId): Relationship {
  return saved[npcId] ?? initialRelationship(world, npcId);
}

/** 제안된 변화량을 정수로 만들고 턴당 한도로 자른다. 변화가 없으면 null. */
export function clampDelta(delta: Partial<Record<Axis, number>> | undefined): Partial<Relationship> | null {
  if (!delta) return null;
  const out: Partial<Relationship> = {};
  for (const a of AXES) {
    const v = Math.round(Number(delta[a] ?? 0));
    if (Number.isFinite(v) && v !== 0) out[a] = clamp(v, -MAX_DELTA_PER_TURN, MAX_DELTA_PER_TURN);
  }
  return Object.keys(out).length ? out : null;
}

export function applyDelta(r: Relationship, d: Partial<Relationship>): Relationship {
  const next = { ...r };
  for (const a of AXES) if (d[a]) next[a] = clamp(next[a] + d[a]!, -100, 100);
  return next;
}

export type Stage = '적대' | '경계' | '낯섦' | '호의' | '신뢰' | '깊은 유대';

export function stageOf(r: Relationship): Stage {
  if (r.affinity <= -40) return '적대';
  if (r.affinity < -10 || r.trust < -10) return '경계';
  if (r.affinity >= 50 && r.trust >= 60) return '깊은 유대';
  if (r.trust >= 30) return '신뢰';
  if (r.affinity >= 20) return '호의';
  return '낯섦';
}

export function secretTrustOf(world: WorldPackage, npcId: EntityId): number {
  return world.characters.find((x) => x.id === npcId)?.secretTrust ?? DEFAULT_SECRET_TRUST;
}

/** 비밀 상태의 지식을 지금 털어놓을 수 있는가 (엔진이 강제한다) */
export function canShareSecret(world: WorldPackage, npcId: EntityId, r: Relationship): boolean {
  const fear = world.characters.find((x) => x.id === npcId)?.secretFear;
  return r.trust >= secretTrustOf(world, npcId) || (fear !== undefined && r.fear >= fear);
}

/** 동행 기준 충족 여부. 미충족이면 이유를 돌려준다. */
export function joinBlocker(spec: CompanionSpec, r: Relationship): string | null {
  if (spec.minTrust !== undefined && r.trust < spec.minTrust) return '아직 충분히 믿지 않는다';
  if (spec.minAffinity !== undefined && r.affinity < spec.minAffinity) return '아직 함께 다닐 만큼 호감이 없다';
  if (r.affinity <= LEAVE_AFFINITY) return '적대적이다';
  return null;
}

export function describeDelta(d: Partial<Relationship>): string {
  return AXES.filter((a) => d[a]).map((a) => `${AXIS_NAMES[a]} ${d[a]! > 0 ? '+' : ''}${d[a]}`).join(', ');
}
