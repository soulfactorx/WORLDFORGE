import type { Belief, EntityId, Improvisation, KnowledgeState, WorldPackage } from './schema';

/** AI가 서술 중 지어내 기록된 사실 (Canon L2). 기록된 뒤에는 확정 사실로 취급한다. */
export interface ImprovisedFact {
  subject: EntityId;
  statement: string;
  turn: number;
}

export interface ProposedFact {
  subject: string;
  statement: string;
}

export interface FactDecision {
  fact: ProposedFact;
  accepted: boolean;
  reason?: string;
}

export const MAX_FACTS_PER_TURN = 5;
export const MAX_FACT_LENGTH = 200;

export function improvisationOf(world: WorldPackage, id: EntityId): Improvisation | null {
  const c = world.characters.find((x) => x.id === id);
  if (c) return c.improvisation;
  const l = world.locations.find((x) => x.id === id);
  if (l) return l.improvisation ?? 'minor';
  return null;
}

/** 대상 엔티티의 보호 주제 이름표 (내용은 포함하지 않는다) */
export function protectedTopicsOf(world: WorldPackage, id: EntityId): string[] {
  return world.facts.filter((f) => f.protectedTopic && f.subjects?.includes(id)).map((f) => f.protectedTopic!);
}

export function establishedFactsOf(facts: ImprovisedFact[], id: EntityId): string[] {
  return facts.filter((f) => f.subject === id).map((f) => f.statement);
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * 즉흥 사실 검증: 장면 안의 엔티티인지, 즉흥 허용 범위인지, 중복·길이·개수 제한.
 * 의미적 모순(L0/L1과의 충돌)은 보호 주제 이름표로 예방하며, 여기서는 구조적 규칙만 검사한다.
 */
export function validateImprovisedFacts(
  world: WorldPackage,
  existing: ImprovisedFact[],
  sceneSubjects: EntityId[],
  proposed: ProposedFact[],
): FactDecision[] {
  const seen = new Set(existing.map((f) => `${f.subject}|${norm(f.statement)}`));
  let accepted = 0;
  return proposed.map((fact) => {
    const reject = (reason: string): FactDecision => ({ fact, accepted: false, reason });
    const statement = norm(fact.statement);
    if (!statement) return reject('빈 문장');
    if (statement.length > MAX_FACT_LENGTH) return reject('너무 긴 문장');
    if (!sceneSubjects.includes(fact.subject)) return reject('장면에 없는 대상');
    const policy = improvisationOf(world, fact.subject);
    if (policy === null) return reject('알 수 없는 대상');
    if (policy === 'none') return reject('즉흥 설정이 금지된 대상');
    const key = `${fact.subject}|${statement}`;
    if (seen.has(key)) return reject('이미 기록된 사실');
    if (accepted >= MAX_FACTS_PER_TURN) return reject('턴당 기록 한도 초과');
    seen.add(key);
    accepted++;
    return { fact: { subject: fact.subject, statement }, accepted: true };
  });
}

/**
 * NPC가 플레이어에게 명제를 말했을 때 플레이어가 갖게 되는 지식 상태.
 * 한 사람에게 들은 말은 검증되지 않았으므로 최대 'partial'. 소문은 소문으로 전해진다.
 */
export function playerStateFromNpc(npcState: KnowledgeState): KnowledgeState {
  return npcState === 'rumor' || npcState === 'mistaken' ? 'rumor' : 'partial';
}

/** NPC가 실제로 그 명제를 알고 있을 때만 전달을 허용한다 (모르는 것을 말할 수 없다). */
export function shareableBelief(world: WorldPackage, saveBeliefs: Belief[], npcId: EntityId, claimId: EntityId): Belief | null {
  const all = [...world.beliefs, ...saveBeliefs].filter((b) => b.holder === npcId && b.claim === claimId);
  return all.at(-1) ?? null;
}
