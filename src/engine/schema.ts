/**
 * 세계관 패키지 스키마 v0 (최소 집합).
 * 설계 리뷰 문서(docs/design-review-v2.md) 2.3절의 Fact / Claim / Belief 모델을 따른다.
 * Phase 0에서 엔진이 소비하며 검증한 뒤 v1로 동결한다.
 */

export type EntityId = string;

export interface PackageManifest {
  id: string;            // 예: "soulfactor.mistvale"
  type: 'world';
  name: string;
  version: string;       // semver
  schemaVersion: '0';
  author: string;
  license: string;
  contentRating: 'all' | 'teen' | 'mature';
  locales: string[];
}

export interface Location {
  id: EntityId;
  name: string;
  /** 플레이어가 그 장소에 있을 때 감각으로 알 수 있는 묘사 */
  description: string;
  connections: EntityId[];
  /** AI가 이 장소의 세부사항을 지어낼 수 있는 범위 (기본 'minor') */
  improvisation?: Improvisation;
}

/**
 * AI 즉흥 설정 허용 범위 (Canon 계층 L2, 설계 리뷰 2.1절)
 * - none: 세부사항을 지어낼 수 없다 (핵심 플롯 인물·장소)
 * - minor: 작은 세부사항(가족, 취향, 물건 등)은 지어낼 수 있고, 지어낸 것은 기록되어 이후 확정된다
 * - free: 자유롭게 지어낼 수 있다 (무명 행인 등)
 */
export type Improvisation = 'none' | 'minor' | 'free';

export interface Character {
  id: EntityId;
  name: string;
  appearance: string;
  personality: string;
  speech: string;
  locationId: EntityId;
  improvisation: Improvisation;
}

/** 세계의 실제 진실 (L0 Canon). 프롬프트에는 해당 Belief를 가진 주체에게만 들어간다. */
export interface Fact {
  id: EntityId;
  statement: string;
  /** 0 = 상식, 5 = 극비 */
  secrecy: 0 | 1 | 2 | 3 | 4 | 5;
  /** 이 사실과 관련된 엔티티 ID */
  subjects?: EntityId[];
  /**
   * 보호 주제: 내용을 드러내지 않는 짧은 이름표 (예: "제단의 정체").
   * AI는 이 주제에 대해 새 설정을 지어내지 못한다. 내용(statement)은 AI에게 전달되지 않는다.
   */
  protectedTopic?: string;
}

/** 누군가 믿을 수 있는 명제. 거짓일 수도 있다. */
export interface Claim {
  id: EntityId;
  statement: string;
  truth: 'true' | 'false' | 'partial';
  relatesTo?: EntityId;
}

export type KnowledgeState = 'rumor' | 'partial' | 'confirmed' | 'mistaken' | 'secret';

export interface Belief {
  /** "player" | 캐릭터 ID | "group:<이름>" */
  holder: string;
  claim: EntityId;
  state: KnowledgeState;
  source?: string;
}

/** 전투 조우. Director가 조건(hint)에 맞을 때 시작을 요청하고 엔진이 검증한다. */
export interface Encounter {
  id: EntityId;
  name: string;
  locationId: EntityId;
  /** zone: 2 = 적 전열, 3 = 적 후열 */
  enemies: { monsterId: string; zone: 2 | 3 }[];
  /** Director에게만 주는 발동 조건 힌트 (플레이어에게 직접 보이지 않음) */
  trigger: string;
}

export interface WorldPackage {
  manifest: PackageManifest;
  locations: Location[];
  characters: Character[];
  facts: Fact[];
  claims: Claim[];
  beliefs: Belief[];
  encounters?: Encounter[];
  start: {
    locationId: EntityId;
    /** 플레이어가 깨어났을 때의 첫 장면 */
    openingScene: string;
  };
}
