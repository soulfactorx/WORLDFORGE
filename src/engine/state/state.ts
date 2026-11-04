import type { Belief, EntityId } from '../schema';
import type { GameEvent, StoredEvent } from './events';
import { type CharacterSheet, legacyCharacter } from '../character/sheet';

export interface LogEntry {
  turn: number;
  kind: 'player' | 'narration' | 'check';
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
  log: LogEntry[];
}

export function initialState(): GameState {
  return {
    packageId: '', packageVersion: '', turn: 0, rngState: 0, worldMinutes: 8 * 60,
    player: { name: '', locationId: '', sheet: legacyCharacter('') }, beliefs: [], log: [],
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
      return { ...s, beliefs: [...rest, e.belief] };
    }
    case 'time_advanced':
      return { ...s, worldMinutes: s.worldMinutes + e.minutes };
  }
}

export function replay(events: StoredEvent[]): GameState {
  return [...events].sort((a, b) => a.seq - b.seq).reduce((s, e) => applyEvent(s, e.event, e.turn), initialState());
}
