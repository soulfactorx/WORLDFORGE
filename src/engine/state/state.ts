import type { Belief, EntityId } from '../schema';
import type { GameEvent, StoredEvent } from './events';
import { type CharacterSheet, legacyCharacter } from '../character/sheet';
import type { ImprovisedFact } from '../canon';

export interface LogEntry {
  turn: number;
  kind: 'player' | 'narration' | 'check' | 'knowledge';
  text: string;
}

export interface GameState {
  packageId: string;
  packageVersion: string;
  turn: number;
  rngState: number;
  worldMinutes: number;
  player: { name: string; locationId: EntityId; sheet: CharacterSheet };
  /** 세이브 중 획득한 지식 (패키지의 초기 Belief 위에 덧씌워짐) */
  beliefs: Belief[];
  /** AI가 지어내 기록된 사실 (Canon L2) */
  improvisedFacts: ImprovisedFact[];
  /** NPC별 플레이어와의 최근 대화 (Actor 기억). 오래된 것은 잘라낸다. */
  npcMemory: Record<EntityId, string[]>;
  log: LogEntry[];
}

export const NPC_MEMORY_LIMIT = 12;

const KNOWLEDGE_LABEL: Record<Belief['state'], string> = {
  rumor: '소문', partial: '들은 이야기', confirmed: '확인됨', mistaken: '잘못 앎', secret: '비밀',
};

export function initialState(): GameState {
  return {
    packageId: '', packageVersion: '', turn: 0, rngState: 0, worldMinutes: 8 * 60,
    player: { name: '', locationId: '', sheet: legacyCharacter('') }, beliefs: [], improvisedFacts: [], npcMemory: {}, log: [],
  };
}

export function applyEvent(s: GameState, e: GameEvent, turn: number): GameState {
  switch (e.type) {
    case 'game_started':
      return { ...initialState(), packageId: e.packageId, packageVersion: e.packageVersion, rngState: e.seed,
        player: { name: e.playerName, locationId: e.locationId, sheet: e.character ?? legacyCharacter(e.playerName) } };
    case 'player_input':
      return { ...s, turn, log: [...s.log, { turn, kind: 'player', text: e.text }] };
    case 'check_rolled': {
      const r = e.result;
      const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
      const mods = e.breakdown?.parts.length
        ? e.breakdown.parts.map((p) => `${sign(p.value)}(${p.label})`).join(' ')
        : sign(r.modifier);
      const label = e.breakdown?.label ?? `${e.skill} 판정`;
      const modeLabel = e.mode === 'advantage' ? ' 이점' : e.mode === 'disadvantage' ? ' 불리점' : '';
      const text = `${label}${modeLabel} — d20(${r.rolls.join(', ')}) ${mods} = ${r.total} vs DC ${r.dc} → ${r.success ? '성공' : '실패'}`;
      return { ...s, rngState: e.rngState, log: [...s.log, { turn, kind: 'check', text }] };
    }
    case 'narration':
      return { ...s, log: [...s.log, { turn, kind: 'narration', text: e.text }] };
    case 'moved':
      return { ...s, player: { ...s.player, locationId: e.to } };
    case 'knowledge_revealed': {
      const rest = s.beliefs.filter((b) => !(b.holder === e.belief.holder && b.claim === e.belief.claim));
      const log = e.statement ? [...s.log, { turn, kind: 'knowledge' as const, text: `알게 된 것 (${KNOWLEDGE_LABEL[e.belief.state]}): ${e.statement}` }] : s.log;
      return { ...s, beliefs: [...rest, e.belief], log };
    }
    case 'npc_spoke': {
      const prev = s.npcMemory[e.npcId] ?? [];
      const lastInput = [...s.log].reverse().find((l) => l.kind === 'player' && l.turn === turn)?.text;
      const lines = [...prev, ...(lastInput ? [`플레이어: ${lastInput}`] : []), `나: ${[e.action, e.dialogue].filter(Boolean).join(' ')}`];
      return { ...s, npcMemory: { ...s.npcMemory, [e.npcId]: lines.slice(-NPC_MEMORY_LIMIT) } };
    }
    case 'fact_asserted':
      return { ...s, improvisedFacts: [...s.improvisedFacts, { subject: e.subject, statement: e.statement, turn }] };
    case 'fact_rejected':
      return s;
    case 'time_advanced':
      return { ...s, worldMinutes: s.worldMinutes + e.minutes };
  }
}

export function replay(events: StoredEvent[]): GameState {
  return [...events].sort((a, b) => a.seq - b.seq).reduce((s, e) => applyEvent(s, e.event, e.turn), initialState());
}
