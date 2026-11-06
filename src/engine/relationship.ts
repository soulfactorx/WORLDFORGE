import type { CompanionSpec, EntityId, NpcRelation, NpcRelationKind, WorldPackage } from './schema';
import type { GameState } from './state/state';

/**
 * NPC → 플레이어 관계 (설계 v3 4.2: 6축)
 * - affinity: 호감(+) ↔ 적대(-)
 * - trust:    신뢰
 * - respect:  존경
 * - fear:     두려움
 * - intimacy: 친밀 (우정·로맨스의 깊이)
 * - grudge:   원한 (쌓인 적대)
 * 모든 축은 -100 ~ 100. 변화는 Actor(NPC)가 제안하고, 엔진이 턴당 한도로 자른다.
 */
export const AXES = ['affinity', 'trust', 'respect', 'fear', 'intimacy', 'grudge'] as const;
export type Axis = (typeof AXES)[number];
export type Relationship = Record<Axis, number>;

export const AXIS_NAMES: Record<Axis, string> = { affinity: '호감', trust: '신뢰', respect: '존경', fear: '두려움', intimacy: '친밀', grudge: '원한' };

/** 한 번의 사건(턴)으로 축 하나가 움직일 수 있는 최대치 */
export const MAX_DELTA_PER_TURN = 10;
/** 기본: 비밀을 털어놓으려면 필요한 신뢰 */
export const DEFAULT_SECRET_TRUST = 40;
/** 동료가 이 호감 이하로 떨어지면 일행을 떠난다 */
export const LEAVE_AFFINITY = -40;
/** 동료의 원한이 이 이상이면 일행을 떠난다 */
export const LEAVE_GRUDGE = 50;
/** 충성도가 이보다 낮은 동료는 전투 명령을 따르지 않는다 */
export const OBEY_LOYALTY = 25;

export const ZERO_RELATIONSHIP: Relationship = { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0 };
const ZERO = ZERO_RELATIONSHIP;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function initialRelationship(world: WorldPackage, npcId: EntityId): Relationship {
  const c = world.characters.find((x) => x.id === npcId);
  return { ...ZERO, ...(c?.relationship ?? {}) };
}

export function relationshipOf(world: WorldPackage, saved: Record<EntityId, Partial<Relationship>>, npcId: EntityId): Relationship {
  const r = saved[npcId];
  return r ? { ...ZERO, ...r } : initialRelationship(world, npcId);
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

export function applyDelta(r: Partial<Relationship>, d: Partial<Relationship>): Relationship {
  const next = { ...ZERO, ...r };
  for (const a of AXES) if (d[a]) next[a] = clamp(next[a] + d[a]!, -100, 100);
  return next;
}

/** 관계 단계 (설계 v3 4.2). 앞쪽이 가까운 사이, 뒤쪽 셋은 적대 쪽 */
export const STAGES = ['연인', '절친', '친구', '믿는 사이', '아는 사이', '낯섦', '경계', '적대', '숙적'] as const;
export type Stage = (typeof STAGES)[number];
export const HOSTILE_STAGES: Stage[] = ['경계', '적대', '숙적'];

/** romanceable: 연인이 될 수 있는 인물인가 (아니면 같은 감정은 절친으로 남는다) */
export function stageOf(r: Partial<Relationship>, romanceable = false): Stage {
  const x = { ...ZERO, ...r };
  if (x.grudge >= 60 || x.affinity <= -70) return '숙적';
  if (x.affinity <= -40 || x.grudge >= 35) return '적대';
  if (x.affinity < -10 || x.trust < -10 || x.grudge >= 15) return '경계';
  if (romanceable && x.intimacy >= 60 && x.affinity >= 50) return '연인';
  if (x.intimacy >= 60 && x.affinity >= 50 && x.trust >= 40) return '절친';
  if (x.affinity >= 35 && (x.trust >= 25 || x.intimacy >= 25)) return '친구';
  if (x.trust >= 30) return '믿는 사이';
  if (x.affinity >= 10 || x.trust >= 10 || x.intimacy >= 10) return '아는 사이';
  return '낯섦';
}

export function stageFor(world: WorldPackage, saved: Record<EntityId, Partial<Relationship>>, npcId: EntityId): Stage {
  return stageOf(relationshipOf(world, saved, npcId), !!world.characters.find((c) => c.id === npcId)?.romanceable);
}

/** 동료 충성도 0~100 (관계에서 계산, 설계 v3 4.2). 처음은 50 */
export function loyaltyOf(r: Partial<Relationship>): number {
  const x = { ...ZERO, ...r };
  return clamp(Math.round(50 + (x.affinity + x.trust) / 4 + x.intimacy / 4 - x.grudge / 2 - Math.max(0, x.fear) / 4), 0, 100);
}

/** 동료가 일행을 떠날 만큼 틀어졌는가 */
export const wantsToLeave = (r: Partial<Relationship>) => ({ ...ZERO, ...r }).affinity <= LEAVE_AFFINITY || ({ ...ZERO, ...r }).grudge >= LEAVE_GRUDGE;

export const RELATION_KIND_LABEL: Record<NpcRelationKind, string> = { family: '가족', ally: '동지', rival: '라이벌', lover: '연인', master: '스승·주인', enemy: '원수' };

/** 이 인물이 다른 인물과 맺은 관계 (master는 방향에 따라 제자·스승) */
export const relationKey = (a: EntityId, b: EntityId) => [a, b].sort().join('|');

/** 지금의 인물 사이: 세계가 정한 관계 + 이야기로 바뀐 관계 (설계 v4 E7) */
export function currentRelations(world: WorldPackage, state?: Pick<GameState, 'npcRelations'>): NpcRelation[] {
  const over = state?.npcRelations ?? {};
  const base = (world.relations ?? []).filter((r) => !(relationKey(r.a, r.b) in over));
  const added = Object.entries(over).flatMap(([k, v]) => {
    if (!v) return [];
    const orig = (world.relations ?? []).find((r) => relationKey(r.a, r.b) === k);
    const [a, b] = orig ? [orig.a, orig.b] : k.split('|') as [EntityId, EntityId];
    return [{ a, b, kind: v.kind, ...(v.note ? { note: v.note } : {}) }];
  });
  return [...base, ...added];
}

export function relationsOf(world: WorldPackage, npcId: EntityId, state?: Pick<GameState, 'npcRelations'>) {
  return currentRelations(world, state).flatMap((r) => {
    if (r.a === npcId) return [{ other: r.b, kind: r.kind, label: RELATION_KIND_LABEL[r.kind], note: r.note }];
    if (r.b === npcId) return [{ other: r.a, kind: r.kind, label: r.kind === 'master' ? '스승·주인 (나는 제자)' : RELATION_KIND_LABEL[r.kind], note: r.note }];
    return [];
  });
}

export const reputationOf = (world: WorldPackage, saved: Record<EntityId, number>, factionId: EntityId) =>
  saved[factionId] ?? world.factions?.find((f) => f.id === factionId)?.reputation ?? 0;

export function reputationLabel(n: number): string {
  return n >= 60 ? '숭앙' : n >= 30 ? '우호' : n >= 10 ? '호의' : n > -10 ? '중립' : n > -30 ? '냉담' : n > -60 ? '적대' : '원수';
}

export function secretTrustOf(world: WorldPackage, npcId: EntityId): number {
  return world.characters.find((x) => x.id === npcId)?.secretTrust ?? DEFAULT_SECRET_TRUST;
}

/** 비밀 상태의 지식을 지금 털어놓을 수 있는가 (엔진이 강제한다) */
export function canShareSecret(world: WorldPackage, npcId: EntityId, rel: Partial<Relationship>): boolean {
  const r = { ...ZERO, ...rel };
  const fear = world.characters.find((x) => x.id === npcId)?.secretFear;
  return r.trust >= secretTrustOf(world, npcId) || (fear !== undefined && r.fear >= fear);
}

/** 동행 기준 충족 여부. 미충족이면 이유를 돌려준다. */
export function joinBlocker(spec: CompanionSpec, rel: Partial<Relationship>): string | null {
  const r = { ...ZERO, ...rel };
  if (spec.minTrust !== undefined && r.trust < spec.minTrust) return '아직 충분히 믿지 않는다';
  if (spec.minAffinity !== undefined && r.affinity < spec.minAffinity) return '아직 함께 다닐 만큼 호감이 없다';
  if (wantsToLeave(r)) return '적대적이다';
  return null;
}

export function describeDelta(d: Partial<Relationship>): string {
  return AXES.filter((a) => d[a]).map((a) => `${AXIS_NAMES[a]} ${d[a]! > 0 ? '+' : ''}${d[a]}`).join(', ');
}
