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
  /** 이 세계에 쓴 다른 사람의 카드 파일 (v0.53): 출처 관리·제거·기기 이동 확인 */
  sources?: SourceCard[];
  /** 크로스오버 (v0.64): 만계서고에서 가져온 원래 세계들 */
  crossover?: { id: string; name: string }[];
  /** 이 세계에 넣은 콘텐츠 패키지 (설계 v3 10장 · R7) */
  includes?: { id: string; version: string; type: 'character' | 'rules'; name: string }[];
}

/** 출처 카드 (v0.53): 세계에 들어간 카드 파일 하나와, 그 카드에서 온 것들 */
export interface SourceCard {
  /** 카드 지문 (SHA-256) — 기기 간 이동 때 같은 파일인지 확인한다 */
  hash: string;
  name: string;
  creator?: string;
  fileName?: string;
  format?: string;
  importedAt: string;
  /** world = 이 카드로 세계 전체를 만듦 (뺄 수 없다) · import = 인물 탭에서 가져옴 */
  via: 'world' | 'import';
  /** 이 카드에서 온 것 (제거용) */
  ids?: { characters: string[]; facts: string[]; claims: string[]; assets: string[] };
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
  /** 이 장소에서 주울 수 있는 것 (hint: Director에게만) */
  pickups?: (ItemStack & { hint: string })[];
  shop?: Shop;
  /** 의뢰판 (설계 v3 6.3) */
  board?: JobBoard;
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
  /** 일정 (설계 v3 7장): 시각(0~23시)에 따라 있는 곳. from > to면 자정을 넘긴다 (예: 20~6시). 맞는 칸이 없으면 locationId */
  schedule?: { from: number; to: number; locationId: EntityId }[];
  /** 이 인물이 플레이어에게 줄 수 있는 것 (condition이 참일 때만, 한 번씩) */
  gives?: (ItemStack & { condition?: Condition })[];
  /** 비밀 상태의 지식을 털어놓는 데 필요한 신뢰 (v0.6, 기본 40) */
  secretTrust?: number;
  /** 두려움이 이 값 이상이면 신뢰가 부족해도 비밀을 털어놓는다 (v0.8, 기본 없음) */
  secretFear?: number;
  /** 배경 이야기 — 이 인물 자신이 아는 과거 (NPC 연기에만 쓰임, v0.12) */
  background?: string;
  /** 이름을 모를 때 부르는 말 (v0.79.2, 예: "앞치마 차림의 하숙집 주인") — 없으면 외형에서 짧은 명사구를 찾는다 */
  alias?: string;
  /** 처음 만났을 때의 말 (참고용, v0.12) */
  greeting?: string;
  /** 초상화 data URL (png/jpeg/webp, 최대 300KB, v0.12) */
  portrait?: string;
  /** 성별 (이미지 고르기용, v0.13) */
  gender?: 'M' | 'F';
  /** 캐릭터 데이터 (v0.79): 주인공과 같은 직업·레벨·능력치·성향. 전투·장면 판정에 쓰이고, 플레이 시간에 따라 자란다 */
  stats?: NpcStats;
  /** 이 인물의 목표 (설계 v4 E7) */
  goals?: NpcGoal[];
  /** 외부에서 가져온 인물의 출처 (v0.12) */
  source?: { format: 'charx' | 'ccv3' | 'ccv2' | 'ccv1' | 'risum'; name: string; creator?: string; version?: string; importedAt: string };
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
  /** 세력 행동 (설계 v3 7장): 며칠마다 조건이 맞으면 효과가 일어나고 소식이 돈다 */
  actions?: FactionAction[];
}

export interface FactionAction {
  name: string;
  /** 며칠마다 (1 = 매일) */
  every: number;
  condition?: Condition;
  effects: StoryEffect[];
  /** 플레이어에게 들리는 소식 (없으면 조용히) */
  news?: string;
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
  /** 열렸을 때 그 인물이 다른 곳에 있으면 (설계 v4 E7): visit = 플레이어를 찾아온다(기본), message = 전갈을 보낸다, none = 기다린다 */
  approach?: 'visit' | 'message' | 'none';
  /** 전갈 내용 (플레이어에게 보임) */
  message?: string;
}

/**
 * 장면 (v0.47): 제작자가 정한 수치·상태·단계·행동으로 진행하는 비전투 상호작용 — 협상·추격·의식·제작·심문·데이트 등.
 * 판정은 d20 + 기술(엔진), 결과는 이야기 효과·보상으로 이어진다. 서술 수위는 세계의 콘텐츠 등급을 따른다.
 */
export interface SceneGauge { id: string; name: string; start: number; min?: number; max?: number; /** 플레이어에게 보이는가 (기본 예) */ visible?: boolean }
export interface SceneStateDef { id: string; name: string; text?: string; /** 1 = 판정 이점, -1 = 불리 */ edge?: 1 | -1 }
export type SceneCond =
  | { gauge: string; gte?: number; lte?: number }
  | { state: string }
  | { phase: string }
  | { round: number }
  | { all: SceneCond[] }
  | { any: SceneCond[] }
  | { not: SceneCond };
export interface SceneDelta {
  gauges?: Record<string, number>;
  addStates?: string[];
  removeStates?: string[];
  /** 이 단계로 넘어간다 */
  phase?: string;
  /** 기록에 남는 한 줄 */
  text?: string;
  /** 이 결과의 그림 (에셋 ID — 세계의 이미지 또는 stock.fx-…) (v0.50) */
  image?: string;
}
export interface SceneAction {
  id: string;
  name: string;
  /** 무엇을 하는가 (버튼 설명 · 서술 재료) */
  text?: string;
  /** 판정: "skill:persuasion" · "ability:wis" (비우면 판정 없이 성공) */
  check?: string;
  dc?: number;
  /** 이 단계에서만 */
  phases?: string[];
  requires?: SceneCond;
  /** 상대의 성향과 맞춰 보는 꼬리표 (예: 칭찬, 위협) */
  tags?: string[];
  /** 행동 카드 그림 (v0.50) */
  image?: string;
  /** 장면에서 한 번만 */
  once?: boolean;
  /** 지금 수치가 굴림에 더해진다 (v0.48): 값 × per (반올림), ±max로 제한. 예: 상대의 경계 1당 −1 → { gauge: "guard", per: -1 } */
  mods?: { gauge: string; per: number; max?: number }[];
  success?: SceneDelta;
  /** 대성공 (난이도를 5 이상 넘기거나 20): 없으면 success (v0.48) */
  great?: SceneDelta;
  failure?: SceneDelta;
}

/** 상대·상황의 반작용 (v0.48): 플레이어 행동마다, 조건이 맞으면 (확률로) 수치가 움직인다 */
export interface SceneReaction { when?: SceneCond; chance?: number; delta: SceneDelta }
export interface SceneEnd {
  id: string;
  name: string;
  when: SceneCond;
  outcome: 'success' | 'failure' | 'neutral';
  text?: string;
  /** 끝 그림 (v0.50) */
  image?: string;
  effects?: StoryEffect[];
  rewards?: Rewards;
}
export interface SceneDef {
  id: EntityId;
  name: string;
  /** GM에게: 어떤 장면인가 · 언제 열리는가 */
  description: string;
  /** 상대 인물 (그 인물이 있어야 열린다) */
  npcId?: EntityId;
  /** 상대의 능력이 맞선다 (v0.79, 상대 인물이 있으면 기본 켬): 판정 DC에 상대의 맞서는 기술 보정이 더해진다 */
  oppose?: boolean;
  /** 이 장소에서만 */
  locationId?: EntityId;
  /** 열리는 조건 (기본 항상) */
  start?: Condition;
  /** 조건이 맞으면 저절로 시작 (기본: 플레이어가 버튼으로) */
  auto?: boolean;
  /** 끝난 뒤 다시 할 수 있는가 */
  repeatable?: boolean;
  gauges: SceneGauge[];
  states?: SceneStateDef[];
  /** 시작 그림 · 시작할 때 기록에 남는 글 (v0.50) */
  image?: string;
  intro?: string;
  /** 장면 서술 (v0.50): fixed = 정해진 글만 (AI 없음) · end = 끝날 때만 AI가 서술 (기본) · ai = 매 차례 AI가 장면을 서술. 플레이 설정이 우선한다 */
  narration?: 'fixed' | 'end' | 'ai';
  /** 단계 이름 (처음 것이 시작 단계) */
  phases?: { id: string; name: string; text?: string; image?: string }[];
  actions: SceneAction[];
  /** 행동마다 일어나는 반작용 (위에서부터 모두) */
  reactions?: SceneReaction[];
  /** 상대의 성향: 이 꼬리표의 행동은 판정 이점(좋아함)·불리(싫어함) */
  likes?: string[];
  dislikes?: string[];
  /** 위에서부터 처음 맞는 끝 */
  ends: SceneEnd[];
  /** 이 차례가 지나면 끝 (timeoutEnd, 없으면 마지막 끝) */
  maxRounds?: number;
  timeoutEnd?: string;
}

/** NPC 목표 (설계 v4 E7): 인물이 스스로 이루려는 일. 시작하면 날 수가 지나 이뤄지고(효과), 막는 조건이 참이 되면 꺾인다 */
export interface NpcGoal {
  /** "goal/…" — 세계 전체에서 유일 */
  id: EntityId;
  /** 무엇을 하려는가 (GM·인물 연기에) */
  text: string;
  /** 시작 후 이 날 수가 지나면 이뤄진다 */
  days: number;
  start?: Condition;
  /** 이것이 참이 되면 꺾인다 (플레이어가 막을 수 있다) */
  stop?: Condition;
  effects?: StoryEffect[];
  /** 이뤄졌을 때 플레이어에게 보이는 소식 */
  announce?: string;
  /** 꺾였을 때 소식 */
  stopped?: string;
}

/**
 * 세계만의 적 (설계 v3 4.5 · 규칙 패키지). 제작자가 쓰기 쉬운 형식 — 엔진이 전투 카드로 바꾼다.
 * 하이 판타지·무협 기본 적(SRD 기반·자체 창작)은 엔진에 있고, 이것은 그 위에 더한다.
 */
export interface CustomMonster {
  /** "mon/…" */
  id: EntityId;
  name: string;
  /** 외형·성격 한 줄 (전투 서술에 쓰임) */
  look: string;
  role: 'minion' | 'brute' | 'skirmisher' | 'artillery' | 'controller' | 'leader' | 'boss';
  /** 도전 지수 (표시·숙련 보너스용, 예: "1/2", "3") */
  cr: string;
  /** 처치 경험치 */
  xp: number;
  ac: number;
  hp: number;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  saves?: ('str' | 'dex' | 'con' | 'int' | 'wis' | 'cha')[];
  preferRanged?: boolean;
  packTactics?: boolean;
  fleeAt?: number;
  immune?: ('poisoned' | 'frightened' | 'restrained' | 'stunned' | 'blinded')[];
  attacks: MonsterAttack[];
  /** 내성 기술 (한 명) · 범위 기술 (한 존) */
  specials?: MonsterSpecial[];
  /** 보스 단계: HP가 below 비율 아래로 떨어지면 대사와 함께 새 공격·방어도 변화 */
  phases?: { below: number; line: string; ac?: number; attacks?: MonsterAttack[]; specials?: MonsterSpecial[] }[];
}

export interface MonsterAttack {
  name: string;
  kind: 'melee' | 'ranged';
  toHit: number;
  /** 주사위 (예: 1d8) */
  damage: string;
  bonus: number;
  type: string;
  /** 원거리 사거리 (존, 기본 3) */
  range?: number;
  /** 한 번에 여러 번 */
  count?: number;
  inflict?: { condition: 'poisoned' | 'frightened' | 'restrained' | 'stunned' | 'blinded'; save: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; dc: number; rounds: number };
  knockProne?: { save: 'str' | 'dex'; dc: number };
}

export interface MonsterSpecial {
  name: string;
  kind: 'save' | 'area';
  save: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  dc: number;
  damage: string;
  type: string;
  /** 사거리 (존, 범위는 0 = 자기 존) */
  range: number;
  /** 전투마다 쓸 수 있는 횟수 (없으면 제한 없음) */
  uses?: number;
  inflict?: { condition: 'poisoned' | 'frightened' | 'restrained' | 'stunned' | 'blinded'; rounds: number };
}

/** 아이템 (설계 v3 6.4). 표준 아이템(std/…)은 모든 세계에서 쓸 수 있다 */
export interface ItemDef {
  id: EntityId;
  name: string;
  description: string;
  kind: 'consumable' | 'weapon' | 'armor' | 'shield' | 'trinket' | 'scroll' | 'key' | 'treasure' | 'misc';
  /** 등급 (설계 v4 E3): 없으면 일반. 전리품 굴림·색 표시에 쓴다 */
  rarity?: ItemRarity;
  /** 장비하고 있을 때의 보너스: 무기 공격 명중·피해, AC, 모든 내성 */
  bonus?: ItemBonus;
  /** 장비하고 있을 때 손패에 들어오는 카드 */
  cards?: string[];
  /** 비급·주문서 (kind 'scroll'): 익히면 이 카드를 영구히 얻는다 (아이템은 사라진다) */
  teaches?: string;
  /** 성장하는 유물: 조건이 맞을 때마다 한 단계씩 깨어난다 (앞에서부터, 효과는 쌓인다) */
  awaken?: { condition: Condition; name: string; text?: string; bonus?: ItemBonus; cards?: string[] }[];
  /** 기본 가격 (상점은 평판으로 보정, 팔 때는 절반) */
  price?: number;
  /** 소모품: 사용하면 HP 회복 (주사위 식, 예: 2d4+2) */
  heal?: string;
  /** 소모품: 사용하면 푸는 상태 이상 */
  cures?: ('poisoned' | 'frightened' | 'restrained' | 'stunned' | 'blinded')[];
  /** 무기: 장비하면 손패에 들어오는 전투 카드 */
  card?: string;
  /** 갑옷: AC = base + 민첩 수정치 (dexMax까지) */
  armor?: { base: number; dexMax?: number };
  /** 방패 등: AC 보너스 */
  acBonus?: number;
}

/** 돌발 사건 (설계 v4 E5) */
export interface RandomEvent {
  id: EntityId;
  name: string;
  /** 플레이어에게 보이는 한 줄 + 서술의 재료 */
  text: string;
  /** ambush: 적이 나타난다 · meeting: 누군가 다가온다 · news: 소문·소식 · opportunity: 뜻밖의 기회 */
  kind: 'ambush' | 'meeting' | 'news' | 'opportunity';
  /** 일어나는 장소 (비우면 어디서나) */
  where?: EntityId[];
  /** 위험한 곳(조우가 정해진 장소)에서만 — where가 없을 때 */
  dangerous?: boolean;
  weight?: number;
  /** 같은 사건이 다시 일어나기까지 걸리는 날 (기본 1) */
  cooldownDays?: number;
  condition?: Condition;
  effects?: StoryEffect[];
  /** ambush의 적 (비우면 이 세계 장르의 적 중 레벨에 맞게) */
  enemies?: { monsterId: string; zone: number }[];
}

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_LABEL: Record<ItemRarity, string> = { common: '일반', uncommon: '고급', rare: '희귀', epic: '영웅', legendary: '유물' };
export interface ItemBonus { attack?: number; damage?: number; ac?: number; save?: number }

/** 아이템 묶음 */
export interface ItemStack { itemId: EntityId; n?: number }

/** 상점 (장소에 둔다). 세력이 있으면 그 세력 평판으로 값이 바뀌고, 평판이 아주 나쁘면 거래를 거절한다 */
export interface Shop {
  name: string;
  items: EntityId[];
  factionId?: EntityId;
  /** 플레이어의 물건을 사 주는가 (기본 예) */
  buys?: boolean;
}

/** NPC 캐릭터 데이터 (v0.79) */
export interface NpcStats {
  /** 세계 직업 ID (직업 탭) — 규칙은 그 직업의 base */
  role?: string;
  /** 규칙 직업 (role이 없을 때) */
  classId?: string;
  /** 기준 레벨 (기본 1) */
  level?: number;
  /** 성장: follow = 주인공 레벨 + offset (기준 레벨 아래로는 안 내려감, 기본) · time = 며칠마다 1레벨 · fixed = 그대로 */
  growth?: 'follow' | 'time' | 'fixed';
  offset?: number;
  everyDays?: number;
  /** 능력치 (없으면 직업 추천 배열) */
  abilities?: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  /** 성향 (주인공과 같은 축) */
  traits?: Record<string, number>;
}

export interface CompanionSpec {
  classId: string;
  /** 세계 직업 ID (v0.57.1) — 있으면 이 직업의 이름으로 보이고, 규칙은 그 직업의 base를 따른다 */
  role?: string;
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
  /** 이기면 얻는 것 (없으면 적 경험치에 비례한 돈) */
  loot?: { money?: number; items?: ItemStack[] };
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
  /** 줄기에서 끝낸 장의 수 (설계 v3 5.1). 줄기를 끝냈으면 모든 장을 끝낸 것 */
  | { chapter: EntityId; gte: number }
  | { arcDone: EntityId; failed?: boolean }
  /** 진행 시계의 칸 (설계 v3 5.3) */
  | { clock: EntityId; gte?: number; lte?: number }
  /** 결정적 선택: 이미 골랐는가 / 이 선택지를 골랐는가 */
  | { choice: EntityId; is?: string }
  /** 게임 시작 후 지난 날 수 */
  | { day: number }
  /** 소지품·소지금 (설계 v3 6.1) */
  | { hasItem: EntityId; n?: number }
  | { money: number }
  /** 퀘스트 2.0 (설계 v3 6.1): 쓰러뜨린 적 수, 인물 생존·위치, 실패한 임무 */
  | { defeated: string; n?: number }
  | { npcAlive: EntityId }
  | { npcAt: EntityId; at: EntityId }
  | { questFailed: EntityId }
  | { flag: string }
  | { questDone: EntityId }
  | { level: number }
  /** 세계 수치 (설계 v4 E6, 예: 마을 치안) */
  | { var: string; gte?: number; lte?: number }
  /** 주인공 성향 (v0.69): -100(낮은 쪽) ~ 100(높은 쪽) */
  | { trait: string; gte?: number; lte?: number }
  /** 임무가 어떤 결과로 끝났나 (is 없으면 아무 결과로든 끝남) */
  | { questOutcome: EntityId; is?: string }
  /** NPC 목표 (설계 v4 E7): 진행 중·이뤄짐·꺾임 */
  | { npcGoal: EntityId; is?: 'active' | 'done' | 'stopped' }
  /** 장면 결과 (v0.47): 끝났다 / 이 끝으로 / 이 결과(success·failure·neutral)로 */
  | { sceneEnd: EntityId; is?: string; outcome?: 'success' | 'failure' | 'neutral' };

export interface QuestStage {
  /** 플레이어 수첩에 보이는 현재 목표 */
  objective: string;
  /** Director에게만 주는 진행 힌트 */
  hint: string;
  complete: Condition;
  /** 이 단계에서 이 조건이 참이 되면 임무 실패 */
  fail?: Condition;
}

/** 퀘스트 유형 12 (설계 v3 6.1) */
export const QUEST_TYPES = ['hunt', 'escort', 'deliver', 'gather', 'investigate', 'infiltrate', 'rescue', 'defend', 'negotiate', 'survive', 'duel', 'bond'] as const;
export type QuestType = (typeof QUEST_TYPES)[number];

/** 보상 (임무·의뢰 공용). cards: 플레이어나 동료가 얻는 전용 카드 (설계 v3 4.2) */
export interface Rewards {
  /** 숫자(고정, 레벨 비율 하한 적용) 또는 'minor'(작은 보상) · 'major'(큰 보상) — 설계 v4 P1 */
  xp?: number | 'minor' | 'major';
  money?: number;
  items?: ItemStack[];
  relationship?: ({ npcId: EntityId } & Partial<Record<RelationAxis, number>>)[];
  reputation?: { factionId: EntityId; delta: number }[];
  cards?: { who: 'player' | EntityId; cardId: string }[];
}

export interface Quest {
  id: EntityId;
  name: string;
  kind: 'main' | 'side';
  /** 유형 (없으면 일반) */
  type?: QuestType;
  /** 의뢰인 (수첩에 표시) */
  giver?: EntityId;
  /** 대상 인물: 호위·구출·관계 임무에서 이 인물이 죽으면 실패 */
  target?: EntityId;
  /** 시작 조건 */
  start: Condition;
  stages: QuestStage[];
  /** 언제든 이 조건이 참이 되면 실패 */
  fail?: Condition;
  /** 시작 후 이 날 수 안에 끝내지 못하면 실패 */
  timeLimit?: { days: number };
  rewards?: Rewards;
  /** 퀘스트 2.1 (설계 v4 E6) — 동기: 왜 해야 하는가 (Director·수첩) */
  motive?: string;
  /** 접근법: 여러 길이 있다는 Director 힌트 (판정 기술·위험) */
  approaches?: { hint: string; skills?: string[]; risk?: string }[];
  /** 숨은 진실 (주장 ID) — 플레이어가 알게 되면 수첩에 표시 */
  truth?: EntityId;
  /** 단서 (주장 ID) — 수첩에 "단서 n/m" */
  clues?: EntityId[];
  /** 여러 결과: 임무를 끝낼 때 위에서부터 처음 맞는 것 하나 (효과·추가 보상) */
  outcomes?: QuestOutcome[];
}

export interface QuestOutcome {
  id: string;
  name: string;
  when: Condition;
  /** 플레이어에게 보이는 결과 한 줄 */
  text?: string;
  effects?: StoryEffect[];
  rewards?: Rewards;
}

/** 세계 수치 (설계 v4 E6): 지역 치안·숲의 위험도 같은 숫자 상태. 이야기 효과로 바뀌고 조건으로 읽힌다 */
export interface WorldVar {
  id: string;
  name: string;
  initial: number;
  min?: number;
  max?: number;
  /** 단계 이름 (값 이상이면 그 이름, 오름차순) — 예: [[0, "무법"], [40, "불안"], [70, "평온"]] */
  labels?: [number, string][];
  /** 플레이어에게 보이는가 (수첩·서술 분위기) */
  visible?: boolean;
}

/**
 * 의뢰 (설계 v3 6.3): 장소의 의뢰판에 붙는 반복 가능한 일.
 * enemies가 있으면 받을 때마다 그 장소(locationId)에 토벌 조우가 생기고, 이기면 끝난다. 없으면 complete 조건.
 * 보상이 비면 엔진이 위협도(적 경험치)로 돈을 정한다.
 */
export interface Job {
  id: EntityId;
  name: string;
  type: QuestType;
  description: string;
  locationId: EntityId;
  enemies?: { monsterId: string; zone: 2 | 3 }[];
  /** 토벌이 아닌 의뢰의 완료 조건 */
  complete?: Condition;
  /** Director 힌트 (조우 발동·진행) */
  hint?: string;
  /** 받을 수 있는 조건 (예: 평판) */
  requires?: Condition;
  timeLimit?: { days: number };
  rewards?: Rewards;
  /** 끝낸 뒤 다시 받을 수 있다 (기본 예) */
  repeatable?: boolean;
}

export interface JobBoard {
  name: string;
  jobs: Job[];
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

// ------------------------------------------------------------ 이야기 엔진 (설계 v3 5장)

/** 이야기 효과: 결정적 선택·진행 시계·연표 사건이 일으키는 상태 변화 (엔진이 적용) */
export type StoryEffect =
  | { setFlag: string }
  | { moveNpc: EntityId; to: EntityId }
  | { killNpc: EntityId }
  /** 세계 수치 바꾸기 (설계 v4 E6) */
  | { var: string; add?: number; set?: number }
  /** 주인공 성향을 움직인다 (v0.69) */
  | { trait: string; add: number }
  /** 플레이어가 이 명제를 알게 된다 (기본 소문) */
  | { reveal: EntityId; state?: 'rumor' | 'partial' | 'confirmed' }
  | { relationship: EntityId; delta: Partial<Record<RelationAxis, number>> }
  | { reputation: EntityId; delta: number }
  | { clock: EntityId; by: number }
  | { giveItem: EntityId; n?: number }
  | { takeItem: EntityId; n?: number }
  | { money: number }
  /** 두 인물의 관계가 바뀐다 (설계 v4 E7). kind none = 관계가 끊긴다 */
  | { npcRelation: EntityId; with: EntityId; kind: NpcRelationKind | 'none'; note?: string };

/** 장 (설계 v3 5.1): 줄기의 큰 단계 */
export interface Chapter {
  name: string;
  /** GM에게만: 이 장에서 무엇이 일어나야 하는가 */
  goal: string;
  /** 플레이어 수첩에 보이는 한 줄 (없으면 장 이름만) */
  summary?: string;
  complete: Condition;
  /** 이 조건이 참이 되면 줄기가 실패로 끝난다 */
  fail?: Condition;
  /** 장을 끝냈을 때 */
  effects?: StoryEffect[];
  /** 장을 끝냈을 때 경험치 (v0.57.3): 비우면 'chapter' = 다음 레벨까지 필요한 만큼. 0이면 없음 */
  xp?: number | 'minor' | 'major' | 'chapter';
}

/** 줄기 (설계 v3 5.1·15.3): 한 세계에 여러 개. 시작 조건으로 열리고, 플래그로 서로 이어진다 */
export interface Arc {
  id: EntityId;
  name: string;
  kind: 'main' | 'faction' | 'character';
  start: Condition;
  chapters: Chapter[];
}

/** 결정적 선택 (D4): 조건이 맞으면 고정 선택지가 나타나고, 고른 것이 플래그·효과로 남는다 */
export interface DecisiveChoice {
  id: EntityId;
  name: string;
  /** 플레이어에게 보이는 질문 */
  prompt: string;
  when: Condition;
  locationId?: EntityId;
  options: { id: string; text: string; effects: StoryEffect[] }[];
}

/** 진행 시계 (설계 v3 5.3): 플레이어가 움직이지 않아도 세계가 흘러간다 */
export interface Clock {
  id: EntityId;
  name: string;
  segments: number;
  /** 처음 칸 (기본 0) */
  start?: number;
  tick: ({ every: 'day' | 'hour'; by: number } | { on: Condition; by: number })[];
  /** 이 칸에 이르면: 효과 + 플레이어에게 보이는 징조 한 줄 */
  at: { segment: number; effects?: StoryEffect[]; omen?: string }[];
}

/** 연표 사건 (설계 v3 5.4): 날짜·날 수·조건에 일어나고, unless가 참이면 일어나지 않는다 */
export interface WorldEvent {
  id: EntityId;
  name: string;
  when: { day?: number; date?: { year: number; month: number; day: number }; condition?: Condition };
  unless?: Condition;
  effects: StoryEffect[];
  /** 플레이어에게 보이는 소식 (없으면 조용히 일어난다) */
  announce?: string;
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
  /** 세계 수치 (설계 v4 E6) */
  vars?: WorldVar[];
  /** 장면 (v0.47) */
  scenes?: SceneDef[];
  /** 돌발 사건 표 (설계 v4 E5): 이동·휴식 때 엔진이 굴린다. 없으면 기본 표, []면 끔 */
  randomEvents?: RandomEvent[];
  /** 이 세계만의 칭호 (설계 v4 E4): 조건을 채우면 엔진이 준다. renown 기본 5 */
  titles?: { id: EntityId; name: string; desc?: string; renown?: number; condition: Condition }[];
  /** 지속되는 세계 (설계 v3 7장): 소문 전파 (기본 켜짐) */
  simulation?: { rumors?: boolean };
  /** 이야기 엔진 (설계 v3 5장) */
  arcs?: Arc[];
  choices?: DecisiveChoice[];
  clocks?: Clock[];
  events?: WorldEvent[];
  start: {
    locationId: EntityId;
    /** 플레이어가 깨어났을 때의 첫 장면 */
    openingScene: string;
    /** 처음 소지금·소지품 (없으면 15와 치유 물약 1개) */
    money?: number;
    items?: ItemStack[];
  };
  /** 이 세계만의 아이템 (설계 v3 6.4) */
  items?: ItemDef[];
  /** 이 세계만의 적 (기본 적에 더한다) */
  monsters?: CustomMonster[];
  /** 시작 방식 선택지 (v0.13) */
  starts?: StartOption[];
  /** 장르 (설계 v3 2장): 프로필 ID와 세계별 설정 */
  genre?: { id: string; levelCap?: number; currency?: string; terms?: Record<string, string> };
  /** 달력 (v0.15): 게임 시작일과 카운트다운. 하루가 지나면 날짜가 넘어간다 (월 길이는 양력 기준) */
  calendar?: Calendar;
  /** 서술 문체 지침 (v0.13). 서술 AI에게 참고로 준다 */
  style?: string;
  /** 세계 개요 (v0.54): 플레이어도 알아도 되는 배경·분위기·규칙. 모든 AI가 참고하고 수첩 "세계 소개"에 보인다 */
  /** 시간 흐름 규칙 (v0.58) — 비우면 AI가 행동마다 걸린 시간을 고른다 */
  time?: TimeRules;
  /** 주인공 성향 축 (v0.69): 행동에 따라 움직이고 조건이 읽는다 — 비우면 장르 기본 */
  traits?: TraitAxis[];
  /** 주인공 정보 양식 (v0.68): 시작할 때 고르거나 적는 성별·나이·외모 등 — 비우면 장르 기본 */
  playerProfile?: PlayerProfile;
  /** 이 세계의 직업 목록 (v0.56) — 비우면 장르 기본 프리셋. 규칙은 base(엔진 직업)를 따르고 이름·설명·기술만 바꾼다 */
  classes?: WorldClass[];
  overview?: string;
  /** GM 메모 (v0.54): 연출 지침·숨은 설정. Director만 참고하고 플레이어에게 직접 말하지 않는다 */
  gmNotes?: string;
  /** 이미지 에셋 목록 (v0.13) */
  assets?: AssetMeta[];
}

/** 세계의 직업 (v0.56): 엔진 직업(base) 하나를 이 세계에 맞는 이름·설명·기술로 보여 준다 */
export interface WorldClass {
  id: string;
  name: string;
  /** 규칙상 직업: fighter·rogue·cleric·wizard·bard·ranger·paladin·warlock */
  base: string;
  /** 플레이어에게 보이는 소개 */
  blurb?: string;
  /** 잘하는 것 (예: 사교 · 화술 · 정보) */
  strengths?: string;
  /** 처음에 골라 둘 추천 기술 */
  skills?: string[];
  /** 고를 수 있는 기술 후보 (비우면 base 직업의 후보) */
  skillOptions?: string[];
  /** 하위 직업 (v0.67): 3레벨에 고른다. base = 엔진 하위 직업 ID (규칙은 그대로), 이름·소개를 바꾸거나 숨긴다 */
  subclasses?: WorldSubclass[];
}
export interface WorldSubclass {
  base: string;
  name: string;
  blurb?: string;
  hidden?: boolean;
}

/** 시간 흐름 (v0.58): 한 턴에 게임 속 시간이 얼마나 흐르는가. 휴식(1시간·8시간)은 따로 */
export interface TimeRules {
  /** ai = GM 판단 AI가 행동의 길이(잠깐·짧게·오래·몇 시간)를 고른다 (기본), fixed = 턴마다 같은 시간 */
  mode?: 'ai' | 'fixed';
  /** fixed: 턴마다 흐르는 분 (기본 10) */
  perTurn?: number;
  /** 장소 이동에 더해지는 분 (기본 10) */
  move?: number;
  /** ai: 단계별 분 (기본 잠깐 2 · 짧게 15 · 오래 60 · 몇 시간 180) */
  steps?: { moment?: number; short?: number; long?: number; hours?: number };
  /** 한 턴에 흐를 수 있는 최대 분, 휴식 제외 (기본 240) */
  maxPerTurn?: number;
}

/** 주인공 정보 양식 (v0.68) */
export interface PlayerProfile {
  /** 성별 선택지 (비우면 남성·여성·밝히지 않음) */
  genders?: string[];
  /** 성별을 묻지 않는다 */
  noGender?: boolean;
  fields?: ProfileField[];
}
export interface ProfileField {
  id: string;
  label: string;
  /** text = 한 줄, long = 여러 줄, select = 고르기 */
  kind: 'text' | 'long' | 'select';
  options?: string[];
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** NPC가 겉으로 보고 알 수 있는 것 (외모·옷차림·종족 등) — NPC 연기 AI에게도 알린다 */
  visible?: boolean;
}

/** 주인공 성향 축 (v0.69): -100 = low 쪽 끝, +100 = high 쪽 끝 */
export interface TraitAxis {
  id: string;
  /** 축 이름 (예: 선악) */
  name: string;
  /** 낮은 쪽 이름 (예: 악) */
  low: string;
  /** 높은 쪽 이름 (예: 선) */
  high: string;
  /** 처음 값 (기본 0) */
  initial?: number;
  /** 시작할 때 플레이어가 기울기를 고른다 (기본 예) */
  choose?: boolean;
}
