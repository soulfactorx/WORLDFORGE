import type { Belief, EntityId } from '../schema';
import type { D20Test, RollMode } from '../dice/dice';
import type { CharacterSheet, ModifierBreakdown } from '../character/sheet';
import type { Relationship } from '../relationship';
import type { CombatEffect, CombatState, Outcome, PartyOrder, Target } from '../combat/combat';

/**
 * 세이브의 진실의 원본은 이 이벤트 로그다.
 * 현재 상태는 이벤트를 순서대로 적용(reduce)해서 얻는다 → 되돌리기 = 마지막 턴 이벤트 제거 후 재적용.
 */
export type GameEvent =
  /** character는 v0.2부터. v0.1 세이브에는 없으므로 리플레이 시 기본 시트로 대체한다. */
  /** startId: 고른 시작 방식 (v0.13) */
  | { type: 'game_started'; packageId: string; packageVersion: string; seed: number; locationId: EntityId; playerName: string; character?: CharacterSheet; startId?: string }
  /** use: 플레이어가 쓰겠다고 고른 기술·능력치 (v0.16) 예: 'skill:persuasion', 'ability:str' */
  | { type: 'player_input'; text: string; use?: string }
  /** breakdown은 v0.2부터 (수정치 구성: 능력치 + 숙련 등) */
  | { type: 'check_rolled'; skill: string; reason: string; result: D20Test; rngState: number; breakdown?: ModifierBreakdown; mode?: RollMode }
  /** images: 이 장면에 보여줄 이미지 (v0.13). 엔진이 고른 에셋 ID와 설명 */
  | { type: 'narration'; text: string; images?: NarrationImage[] }
  | { type: 'moved'; to: EntityId }
  /** statement는 화면 표시용 (v0.3부터) */
  | { type: 'knowledge_revealed'; belief: Belief; statement?: string }
  /** NPC 대사 (Actor 출력). 서술에 녹아들고, NPC 대화 기억으로 쓰인다. */
  | { type: 'npc_spoke'; npcId: EntityId; dialogue: string; action: string }
  /** AI가 지어내 기록된 사실 (Canon L2) */
  | { type: 'fact_asserted'; subject: EntityId; statement: string }
  /** 전투 (v0.4). 모든 주사위 결과는 effects로 확정되어 저장된다. */
  | { type: 'combat_started'; combat: CombatState; rngState: number }
  | { type: 'combat_action'; actorId: string; cardId: string; target: Target; effects: CombatEffect[]; log: string[]; rngState: number }
  | { type: 'combat_turn_ended' }
  /** party: 동료별 전투 후 HP·자원 (v0.5) */
  /** playerDead: 플레이어가 죽음 내성에 실패해 사망 (v0.11) */
  | { type: 'combat_ended'; outcome: Outcome; playerDead?: boolean; hp: number; resources: Record<string, { cur: number; max: number }>; party?: Record<string, { hp: number; resources: Record<string, { cur: number; max: number }> }> }
  /** 시나리오 (v0.8) */
  | { type: 'quest_started'; questId: EntityId; name: string; objective: string }
  | { type: 'quest_advanced'; questId: EntityId; name: string; stage: number; objective: string }
  | { type: 'quest_completed'; questId: EntityId; name: string; stages: number }
  /** 퀘스트 2.0 (설계 v3 6장) */
  | { type: 'quest_failed'; questId: EntityId; name: string; reason: string }
  | { type: 'enemies_defeated'; counts: Record<string, number> }
  | { type: 'job_accepted'; jobId: EntityId; name: string; instance: number }
  | { type: 'job_completed'; jobId: EntityId; name: string }
  | { type: 'job_failed'; jobId: EntityId; name: string; reason: string }
  | { type: 'card_granted'; who: string; whoName: string; cardId: string; name: string }
  /** 지속되는 세계 (설계 v3 7장) */
  | { type: 'sim_day'; day: number }
  | { type: 'rumor_spread'; beliefs: Belief[] }
  | { type: 'faction_acted'; factionId: EntityId; name: string; news?: string }
  | { type: 'flag_set'; flag: string }
  | { type: 'ending_reached'; endingId: EntityId; name: string }
  /** 경험치·레벨업 (v0.7). who = 'player' 또는 동료 NPC ID */
  | { type: 'xp_gained'; who: string; amount: number; reason: string; /** 한 번만 주는 보상의 열쇠 (예: 관계 단계·장 완료) */ key?: string }
  | { type: 'level_up'; who: string; sheet: CharacterSheet; hpGain: number; features: string[] }
  /** 세계 수치 변화 (v0.43). label: 보이는 수치의 단계가 바뀌면 기록에 남긴다 */
  | { type: 'var_changed'; varId: string; value: number; name: string; label?: string }
  /** 임무가 이 결과로 끝났다 (v0.43) */
  | { type: 'quest_outcome'; questId: EntityId; questName: string; outcomeId: string; name: string; text?: string }
  | { type: 'npc_approached'; beatId: EntityId; npcId: EntityId; mode: 'visit' | 'message'; to?: EntityId; stay: number; text: string }
  | { type: 'goal_started'; goalId: EntityId; npcId: EntityId }
  | { type: 'scene_started'; sceneId: EntityId; name: string; run: import('./state').SceneRun; intro?: string }
  | { type: 'scene_action'; run: import('./state').SceneRun; line: string; rngState: number; images?: string[] }
  | { type: 'scene_ended'; sceneId: EntityId; endId: string; name: string; outcome: 'success' | 'failure' | 'neutral' | 'abandoned'; text?: string; image?: string }
  | { type: 'goal_ended'; goalId: EntityId; npcId: EntityId; outcome: 'done' | 'stopped'; announce?: string }
  | { type: 'npc_relation_changed'; key: string; kind: import('../schema').NpcRelationKind | 'none'; note?: string; text?: string }
  /** 돌발 사건 (v0.42, 설계 v4 E5) */
  | { type: 'random_event'; eventId: EntityId; name: string; kind: 'ambush' | 'meeting' | 'news' | 'opportunity'; text: string; day: number }
  /** 칭호를 얻음 (v0.41, 설계 v4 E4) */
  | { type: 'title_earned'; titleId: EntityId; name: string; desc: string }
  /** 플레이어가 인물의 이름을 알게 됨 (v0.37.5) */
  | { type: 'names_learned'; ids: EntityId[] }
  /** 하위 직업·능력치 향상·특성 선택 (v0.37). 엔진이 검증하고, 고를 수 없는 선택은 무시된다 */
  | { type: 'build_choice'; who: string; kind: 'subclass' | 'asi' | 'feat'; value: string }
  /** 동료 (v0.5) */
  | { type: 'companion_joined'; npcId: EntityId; sheet: CharacterSheet }
  | { type: 'companion_left'; npcId: EntityId; locationId: EntityId }
  /** 동료가 전투에서 죽었다 (v0.11, 되돌릴 수 없음 — 턴 되돌리기 제외) */
  | { type: 'companion_died'; npcId: EntityId; name: string }
  | { type: 'party_order'; npcId: EntityId; order: PartyOrder }
  /**
   * 관계 변화 (v0.6). delta는 엔진이 한도로 자른 값.
   * base: 이 NPC의 첫 관계 변화일 때의 패키지 초기값 (리듀서는 세계 패키지를 모르므로 이벤트에 싣는다)
   */
  | { type: 'relationship_changed'; npcId: EntityId; delta: Partial<Relationship>; reason: string; name?: string; base?: Relationship }
  /** 관계 단계가 바뀌었다 (설계 v3 4.2, 기록용) */
  | { type: 'relation_stage'; npcId: EntityId; name: string; from: string; to: string }
  /** 세력 평판 변화 (설계 v3 4.4). base: 첫 변화일 때의 패키지 초기값 */
  | { type: 'reputation_changed'; factionId: EntityId; name: string; delta: number; reason: string; base?: number }
  /** 관계 사건이 열리고 닫힌다 (설계 v3 4.2) */
  | { type: 'beat_opened'; beatId: EntityId; npcId: EntityId; name: string }
  | { type: 'beat_closed'; beatId: EntityId }
  /** 이야기 엔진 (설계 v3 5장) */
  | { type: 'arc_started'; arcId: EntityId; name: string; chapter: string }
  | { type: 'chapter_completed'; arcId: EntityId; index: number; name: string; next?: string; /** 다음 장 예고 (수첩 한 줄) */ preview?: string }
  | { type: 'arc_ended'; arcId: EntityId; name: string; failed: boolean }
  /** 시계 값 갱신. minutes: 시간 눈금을 마지막으로 잰 시각, onFired: 발동한 조건 눈금 번호 */
  | { type: 'clock_changed'; clockId: EntityId; value: number; minutes: number; onFired?: number[] }
  | { type: 'clock_reached'; clockId: EntityId; segment: number; omen?: string }
  | { type: 'world_event'; eventId: EntityId; name: string; skipped: boolean; announce?: string }
  | { type: 'npc_moved'; npcId: EntityId; to: EntityId }
  | { type: 'npc_killed'; npcId: EntityId; name: string }
  | { type: 'choice_offered'; choiceId: EntityId; name: string }
  | { type: 'choice_made'; choiceId: EntityId; optionId: string; text: string }
  /** 소지품 (설계 v3 6.4). key: 주운 것·받은 것이면 다시 얻지 않도록 기록 */
  | { type: 'item_gained'; itemId: EntityId; name: string; n: number; reason: string; key?: string }
  | { type: 'item_lost'; itemId: EntityId; name: string; n: number; reason: string }
  | { type: 'money_changed'; delta: number; reason: string; currency?: string }
  | { type: 'item_equipped'; slot: 'weapon' | 'armor' | 'shield' | 'trinket'; itemId?: EntityId; name?: string }
  /** 전투 밖에서 소모품 사용 (HP 회복은 이벤트에 확정값으로) */
  | { type: 'item_used'; itemId: EntityId; name: string; heal: number; cures?: string[]; rngState: number }
  /** 휴식 (v0.4). 짧은 휴식 1시간, 긴 휴식 8시간 */
  | { type: 'rested'; kind: 'short' | 'long' }
  /** 검증에서 거부된 즉흥 사실 (기록되지 않음, 디버그용) */
  | { type: 'fact_rejected'; subject: string; statement: string; reason: string }
  | { type: 'time_advanced'; minutes: number }
  /** GM 안내 (v0.14): 이번 턴 상황 요약 + 진행 제안 + 선택지 */
  | { type: 'gm_guide'; summary: string; suggestion: string; choices: string[]; images?: { id: string; caption: string }[]; choiceSkills?: string[]; /** 선택지 성격 (v0.58): advance·bond·bold·wild */ choiceKinds?: string[] };

export interface StoredEvent {
  saveId: string;
  seq: number;
  turn: number;
  event: GameEvent;
}

/** 서술 이미지 (v0.59): para = 그 인물이 나온 문단 번호(빈 줄로 나눈 0부터), 없으면 서술 맨 앞.
 * bg = 배경(장소) 이미지 — new: 장소가 바뀌었거나 장면이 바뀜, same: 같은 장소의 배경을 다시 보여 줌 */
export interface NarrationImage { id: string; caption: string; para?: number; bg?: 'new' | 'same' }
