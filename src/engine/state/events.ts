import type { Belief, EntityId } from '../schema';
import type { D20Test } from '../dice/dice';

/**
 * 세이브의 진실의 원본은 이 이벤트 로그다.
 * 현재 상태는 이벤트를 순서대로 적용(reduce)해서 얻는다 → 되돌리기 = 마지막 턴 이벤트 제거 후 재적용.
 */
export type GameEvent =
  | { type: 'game_started'; packageId: string; packageVersion: string; seed: number; locationId: EntityId; playerName: string }
  | { type: 'player_input'; text: string }
  | { type: 'check_rolled'; skill: string; reason: string; result: D20Test; rngState: number }
  | { type: 'narration'; text: string }
  | { type: 'moved'; to: EntityId }
  | { type: 'knowledge_revealed'; belief: Belief }
  | { type: 'time_advanced'; minutes: number };

export interface StoredEvent {
  saveId: string;
  seq: number;
  turn: number;
  event: GameEvent;
}
