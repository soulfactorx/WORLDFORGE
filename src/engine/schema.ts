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
}

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

export interface WorldPackage {
  manifest: PackageManifest;
  locations: Location[];
  characters: Character[];
  facts: Fact[];
  claims: Claim[];
  beliefs: Belief[];
  start: {
    locationId: EntityId;
    /** 플레이어가 깨어났을 때의 첫 장면 */
    openingScene: string;
  };
}
