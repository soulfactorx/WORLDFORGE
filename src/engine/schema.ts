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
  /** AI 생성 보조를 써서 만든 패키지인지 (투명성, v0.10) */
  aiAssisted?: boolean;
  /**
   * 개인용 세계 (v0.13): 다른 사람의 작품(캐릭터 카드 등)으로 만든 세계.
   * 이 브라우저에서 혼자 플레이할 수만 있고 패키지·세이브 내보내기가 막힌다.
   */
  private?: { source: string; note: string; /** 원본 카드 지문 (기기 간 이동용, v0.19) */ cardHash?: string };
}

export interface Location {
  id: EntityId;
  name: string;
  /** 플레이어가 그 장소에 있을 때 감각으로 알 수 있는 묘사 */
  description: string;
  connections: EntityId[];
  /** AI가 이 장소의 세부사항을 지어낼 수 있는 범위 (기본 'minor') */
  improvisation?: Improvisation;
  /** 이 장소를 조사해 알아낼 수 있는 것 (v0.8) */
  discoveries?: Discovery[];
}

/** 탐험으로 얻는 지식. check가 있으면 같은 턴에 그 판정에 성공해야 한다. */
export interface Discovery {
  claim: EntityId;
  /** 기술 ID (예: investigation, perception) */
  check?: string;
  /** Director에게만 주는 힌트: 어떻게 하면 발견하는가 */
  hint: string;
  /** 발견했을 때 플레이어의 지식 상태 (기본 confirmed: 직접 봤으므로) */
  state?: 'confirmed' | 'partial';
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
  /** 동료로 영입할 수 있는 NPC의 전투 능력과 영입 조건 (v0.5) */
  companion?: CompanionSpec;
  /** 플레이어에 대한 초기 관계 (v0.6, 기본 모두 0). 친밀·원한은 설계 v3 4.2 */
  relationship?: Partial<Record<RelationAxis, number>>;
  /** 연인 관계가 될 수 있는 인물 (설계 v3 4.2) */
  romanceable?: boolean;
  /** 소속 세력 ID (설계 v3 4.4) */
  faction?: EntityId;
  /** 비밀 상태의 지식을 털어놓는 데 필요한 신뢰 (v0.6, 기본 40) */
  secretTrust?: number;
  /** 두려움이 이 값 이상이면 신뢰가 부족해도 비밀을 털어놓는다 (v0.8, 기본 없음) */
  secretFear?: number;
  /** 배경 이야기 — 이 인물 자신이 아는 과거 (NPC 연기에만 쓰임, v0.12) */
  background?: string;
  /** 처음 만났을 때의 말 (참고용, v0.12) */
  greeting?: string;
  /** 초상화 data URL (png/jpeg/webp, 최대 300KB, v0.12) */
  portrait?: string;
  /** 성별 (이미지 고르기용, v0.13) */
  gender?: 'M' | 'F';
  /** 외부에서 가져온 인물의 출처 (v0.12) */
  source?: { format: 'charx' | 'ccv3' | 'ccv2' | 'ccv1'; name: string; creator?: string; version?: string; importedAt: string };
}

/** 관계 6축 (설계 v3 4.2): 호감·신뢰·존경·두려움 + 친밀·원한 */
export type RelationAxis = 'affinity' | 'trust' | 'respect' | 'fear' | 'intimacy' | 'grudge';

/** 세력 (설계 v3 4.4). 평판은 -100~100 */
export interface Faction {
  id: EntityId;
  name: string;
  description: string;
  /** 처음 평판 (기본 0) */
  reputation?: number;
}

export type NpcRelationKind = 'family' | 'ally' | 'rival' | 'lover' | 'master' | 'enemy';

/** NPC ↔ NPC 관계 (설계 v3 4.3). master는 a가 b의 스승·주인 */
export interface NpcRelation {
  a: EntityId;
  b: EntityId;
  kind: NpcRelationKind;
  /** 한 줄 설명 (NPC 연기에 쓰임) */
  note?: string;
}

/**
 * 관계 사건 (설계 v3 4.2): 조건이 맞으면 열리는 그 인물의 결정적 장면.
 * 열리면 GM과 그 인물에게 힌트가 간다. resolveFlag가 세워지면 닫힌다 (없으면 몇 턴 뒤 닫힘).
 */
export interface RelationBeat {
  id: EntityId;
  npcId: EntityId;
  name: string;
  condition: Condition;
  /** GM·인물에게 주는 장면 방향 (예: "그가 과거의 비밀을 털어놓는다") */
  hint: string;
  resolveFlag?: string;
}

export interface CompanionSpec {
  classId: string;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  /** Actor(해당 NPC)에게만 주는 동행 조건. NPC가 대화 중 스스로 판단한다. */
  joinCondition: string;
  /** 엔진이 강제하는 최소 관계 (v0.6) */
  minTrust?: number;
  minAffinity?: number;
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

// ------------------------------------------------------------ 시나리오 (v0.8)

/**
 * 선언형 조건식 (설계 리뷰 4.3절). 스크립트를 실행하지 않고 엔진이 평가한다.
 * 빈 all은 항상 참.
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { knows: EntityId; min?: KnowledgeState }
  | { at: EntityId }
  | { cleared: EntityId }
  | { inParty: EntityId }
  | { relationship: EntityId; axis: RelationAxis; gte?: number; lte?: number }
  /** 관계 단계 (예: ["친구", "절친", "연인"]) */
  | { stage: EntityId; in: string[] }
  /** 세력 평판 (설계 v3 4.4) */
  | { reputation: EntityId; gte?: number; lte?: number }
  | { flag: string }
  | { questDone: EntityId }
  | { level: number };

export interface QuestStage {
  /** 플레이어 수첩에 보이는 현재 목표 */
  objective: string;
  /** Director에게만 주는 진행 힌트 */
  hint: string;
  complete: Condition;
}

export interface Quest {
  id: EntityId;
  name: string;
  kind: 'main' | 'side';
  /** 시작 조건 */
  start: Condition;
  stages: QuestStage[];
  rewards?: { xp?: number; relationship?: ({ npcId: EntityId } & Partial<Record<RelationAxis, number>>)[]; reputation?: { factionId: EntityId; delta: number }[] };
}

/** Director가 이야기 속 사건을 기록하는 플래그. 선언된 것만, 지정 장소에서만 세울 수 있다. */
export interface StoryFlag {
  id: string;
  /** Director에게: 언제 이 플래그를 세우는가 */
  when: string;
  locationId?: EntityId;
  /** 이 조건이 참일 때만 세울 수 있다 */
  requires?: Condition;
}

export interface Ending {
  id: EntityId;
  name: string;
  condition: Condition;
  /** 서술 AI에게 주는 에필로그 방향 */
  epilogue: string;
}

// ------------------------------------------------------------ 이미지 에셋 (v0.13)

/**
 * 이미지 에셋 정보. 이미지 자체는 패키지 JSON이 아니라 브라우저 저장소(IndexedDB)에 따로 둔다.
 * - character: 인물 이미지. tags = 표정·상황 (예: smile, angry, night). 'default'는 기본 모습
 * - scene: 장소·상황 이미지 (locationId가 있으면 그 장소)
 * - map: 지도 / cover: 표지 / other: 분류되지 않음
 */
export interface AssetMeta {
  id: string;
  name: string;
  kind: 'character' | 'scene' | 'map' | 'cover' | 'other';
  characterId?: EntityId;
  locationId?: EntityId;
  gender?: 'M' | 'F';
  tags: string[];
  mime: string;
  size: number;
}

export interface Calendar {
  /** 연호 (예: 제국력) */
  era: string;
  year: number;
  month: number;
  day: number;
  /** 카운트다운 (예: 파멸의 날) */
  countdown?: { label: string; year: number; month: number; day: number };
}

/** 시작 방식 (v0.13): 새 게임을 시작할 때 고른다. 없으면 start를 쓴다 */
export interface StartOption {
  id: string;
  name: string;
  /** 플레이어에게 보이는 설명 */
  description: string;
  locationId: EntityId;
  openingScene: string;
  /** 이 방식으로 시작하면 플레이어가 처음부터 아는 명제 */
  knows?: EntityId[];
}

export interface WorldPackage {
  manifest: PackageManifest;
  locations: Location[];
  characters: Character[];
  facts: Fact[];
  claims: Claim[];
  beliefs: Belief[];
  encounters?: Encounter[];
  quests?: Quest[];
  flags?: StoryFlag[];
  endings?: Ending[];
  /** 세력·NPC 관계·관계 사건 (설계 v3 4.2~4.4) */
  factions?: Faction[];
  relations?: NpcRelation[];
  relationBeats?: RelationBeat[];
  start: {
    locationId: EntityId;
    /** 플레이어가 깨어났을 때의 첫 장면 */
    openingScene: string;
  };
  /** 시작 방식 선택지 (v0.13) */
  starts?: StartOption[];
  /** 장르 (설계 v3 2장): 프로필 ID와 세계별 설정 */
  genre?: { id: string; levelCap?: number; currency?: string; terms?: Record<string, string> };
  /** 달력 (v0.15): 게임 시작일과 카운트다운. 하루가 지나면 날짜가 넘어간다 (월 길이는 양력 기준) */
  calendar?: Calendar;
  /** 서술 문체 지침 (v0.13). 서술 AI에게 참고로 준다 */
  style?: string;
  /** 이미지 에셋 목록 (v0.13) */
  assets?: AssetMeta[];
}
