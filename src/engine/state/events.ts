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
  | { type: 'game_started'; packageId: string; packageVersion: string; seed: number; locationId: EntityId; playerName: string; character?: CharacterSheet }
  | { type: 'player_input'; text: string }
  /** breakdown은 v0.2부터 (수정치 구성: 능력치 + 숙련 등) */
  | { type: 'check_rolled'; skill: string; reason: string; result: D20Test; rngState: number; breakdown?: ModifierBreakdown; mode?: RollMode }
  | { type: 'narration'; text: string }
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
  | { type: 'combat_ended'; outcome: Outcome; hp: number; resources: Record<string, { cur: number; max: number }>; party?: Record<string, { hp: number; resources: Record<string, { cur: number; max: number }> }> }
  /** 동료 (v0.5) */
  | { type: 'companion_joined'; npcId: EntityId; sheet: CharacterSheet }
  | { type: 'companion_left'; npcId: EntityId; locationId: EntityId }
  | { type: 'party_order'; npcId: EntityId; order: PartyOrder }
  /**
   * 관계 변화 (v0.6). delta는 엔진이 한도로 자른 값.
   * base: 이 NPC의 첫 관계 변화일 때의 패키지 초기값 (리듀서는 세계 패키지를 모르므로 이벤트에 싣는다)
   */
  | { type: 'relationship_changed'; npcId: EntityId; delta: Partial<Relationship>; reason: string; name?: string; base?: Relationship }
  /** 휴식 (v0.4). 짧은 휴식 1시간, 긴 휴식 8시간 */
  | { type: 'rested'; kind: 'short' | 'long' }
  /** 검증에서 거부된 즉흥 사실 (기록되지 않음, 디버그용) */
  | { type: 'fact_rejected'; subject: string; statement: string; reason: string }
  | { type: 'time_advanced'; minutes: number };

export interface StoredEvent {
  saveId: string;
  seq: number;
  turn: number;
  event: GameEvent;
}
