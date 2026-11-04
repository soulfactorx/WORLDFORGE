import type { Belief, EntityId } from '../schema';
import type { GameEvent, StoredEvent } from './events';
import { type CharacterSheet, legacyCharacter } from '../character/sheet';
import type { ImprovisedFact } from '../canon';
import { josa } from '../text/josa';
import { applyDelta, describeDelta, type Relationship } from '../relationship';
import { applyEffects, type CombatState, endTurn, type PartyOrder, ZONE_NAMES } from '../combat/combat';
import { classResources, resourcesOf } from '../character/sheet';

export interface LogEntry {
  turn: number;
  kind: 'player' | 'narration' | 'check' | 'knowledge' | 'combat' | 'relation' | 'progress' | 'quest';
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
  /** 진행 중인 전투 */
  combat?: CombatState;
  /** 끝난 조우 (승리한 조우는 다시 일어나지 않는다) */
  clearedEncounters: string[];
  /** 동행 중인 동료 (NPC ID → 캐릭터 시트) */
  party: Record<EntityId, CharacterSheet>;
  partyOrders: Record<EntityId, PartyOrder>;
  /** 패키지 기본값과 다른 NPC 위치 (동료에서 빠진 NPC 등) */
  npcLocations: Record<EntityId, EntityId>;
  /** NPC → 플레이어 관계 (바뀐 NPC만 저장. 없으면 패키지 초기값) */
  relationships: Record<EntityId, Relationship>;
  /** 퀘스트 진행 (v0.8) */
  quests: Record<EntityId, { stage: number; done: boolean }>;
  /** 이야기 플래그 (v0.8) */
  flags: string[];
  /** 도달한 결말 ID */
  ending?: string;
  /** 플레이어 사망 (턴 되돌리기로만 돌아갈 수 있다) */
  playerDead?: boolean;
  /** 죽은 NPC */
  deadNpcs: string[];
  log: LogEntry[];
}

export const MAX_PARTY = 2;

export const NPC_MEMORY_LIMIT = 12;

const KNOWLEDGE_LABEL: Record<Belief['state'], string> = {
  rumor: '소문', partial: '들은 이야기', confirmed: '확인됨', mistaken: '잘못 앎', secret: '비밀',
};

export function initialState(): GameState {
  return {
    packageId: '', packageVersion: '', turn: 0, rngState: 0, worldMinutes: 8 * 60,
    player: { name: '', locationId: '', sheet: legacyCharacter('') }, beliefs: [], improvisedFacts: [], npcMemory: {}, clearedEncounters: [], party: {}, partyOrders: {}, npcLocations: {}, relationships: {}, quests: {}, flags: [], deadNpcs: [], log: [],
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
    case 'combat_started': {
      const names = Object.values(e.combat.combatants).filter((c) => c.side === 'enemy').map((c) => `${c.name}(${ZONE_NAMES[c.zone]})`).join(', ');
      const order = e.combat.order.map((id) => `${e.combat.combatants[id]!.name} ${e.combat.combatants[id]!.initiative}`).join(' → ');
      return { ...s, combat: e.combat, rngState: e.rngState,
        log: [...s.log, { turn, kind: 'combat', text: `⚔ 전투 시작 — ${names}\n우선권: ${order}` }] };
    }
    case 'combat_action': {
      if (!s.combat) return s;
      return { ...s, combat: applyEffects(s.combat, e.effects), rngState: e.rngState,
        log: [...s.log, ...e.log.map((text) => ({ turn, kind: 'combat' as const, text }))] };
    }
    case 'combat_turn_ended':
      return s.combat ? { ...s, combat: endTurn(s.combat) } : s;
    case 'combat_ended': {
      const label = e.playerDead ? '사망' : { victory: '승리', defeat: '쓰러짐', fled: '도주' }[e.outcome];
      return {
        ...s, combat: undefined, playerDead: e.playerDead || s.playerDead,
        clearedEncounters: e.outcome === 'victory' && s.combat ? [...s.clearedEncounters, s.combat.encounterId] : s.clearedEncounters,
        player: { ...s.player, sheet: { ...s.player.sheet, hp: e.hp, resources: e.resources } },
        party: Object.fromEntries(Object.entries(s.party).map(([id, sh]) => [id, e.party?.[id] ? { ...sh, ...e.party[id] } : sh])),
        log: [...s.log, { turn, kind: 'combat', text: `⚔ 전투 종료 — ${label}` }],
      };
    }
    case 'companion_joined': {
      const { [e.npcId]: _, ...npcLocations } = s.npcLocations;
      return { ...s, party: { ...s.party, [e.npcId]: e.sheet }, npcLocations,
        log: [...s.log, { turn, kind: 'knowledge', text: `${josa(e.sheet.name, '이/가')} 동료가 되었다.` }] };
    }
    case 'companion_left': {
      const { [e.npcId]: left, ...party } = s.party;
      const { [e.npcId]: _o, ...partyOrders } = s.partyOrders;
      return { ...s, party, partyOrders, npcLocations: { ...s.npcLocations, [e.npcId]: e.locationId },
        log: [...s.log, { turn, kind: 'knowledge', text: `${josa(left?.name ?? e.npcId, '이/가')} 일행을 떠났다.` }] };
    }
    case 'quest_started':
      return { ...s, quests: { ...s.quests, [e.questId]: { stage: 0, done: false } },
        log: [...s.log, { turn, kind: 'quest', text: `새 임무 — ${e.name}: ${e.objective}` }] };
    case 'quest_advanced':
      return { ...s, quests: { ...s.quests, [e.questId]: { stage: e.stage, done: false } },
        log: [...s.log, { turn, kind: 'quest', text: `임무 갱신 — ${e.name}: ${e.objective}` }] };
    case 'quest_completed':
      return { ...s, quests: { ...s.quests, [e.questId]: { stage: e.stages, done: true } },
        log: [...s.log, { turn, kind: 'quest', text: `임무 완료 — ${e.name}` }] };
    case 'flag_set':
      return s.flags.includes(e.flag) ? s : { ...s, flags: [...s.flags, e.flag] };
    case 'ending_reached':
      return { ...s, ending: e.endingId, log: [...s.log, { turn, kind: 'quest', text: `◆ 결말 — ${e.name}` }] };
    case 'xp_gained': {
      const upd = (sh: CharacterSheet) => ({ ...sh, xp: (sh.xp ?? 0) + e.amount });
      const next = e.who === 'player' ? { ...s, player: { ...s.player, sheet: upd(s.player.sheet) } }
        : s.party[e.who] ? { ...s, party: { ...s.party, [e.who]: upd(s.party[e.who]!) } } : s;
      return e.who === 'player'
        ? { ...next, log: [...next.log, { turn, kind: 'progress', text: `경험치 +${e.amount} (${e.reason})` }] }
        : next;
    }
    case 'level_up': {
      const name = e.who === 'player' ? '당신' : e.sheet.name;
      const text = `★ ${josa(name, '은/는')} ${e.sheet.level}레벨이 되었다 — 최대 HP +${e.hpGain}${e.features.length ? `, 새 능력: ${e.features.join(', ')}` : ''}`;
      const next = e.who === 'player' ? { ...s, player: { ...s.player, sheet: e.sheet } }
        : s.party[e.who] ? { ...s, party: { ...s.party, [e.who]: e.sheet } } : s;
      return { ...next, log: [...next.log, { turn, kind: 'progress', text }] };
    }
    case 'relationship_changed': {
      const base = s.relationships[e.npcId] ?? e.base ?? { affinity: 0, trust: 0, respect: 0, fear: 0 };
      return { ...s, relationships: { ...s.relationships, [e.npcId]: applyDelta(base, e.delta) },
        log: [...s.log, { turn, kind: 'relation', text: `${e.name ?? e.npcId}: ${describeDelta(e.delta)} — ${e.reason}` }] };
    }
    case 'companion_died': {
      const { [e.npcId]: _p, ...party } = s.party;
      const { [e.npcId]: _o, ...partyOrders } = s.partyOrders;
      return { ...s, party, partyOrders, deadNpcs: [...s.deadNpcs, e.npcId],
        log: [...s.log, { turn, kind: 'combat', text: `✝ ${josa(e.name, '이/가')} 숨을 거두었다.` }] };
    }
    case 'party_order':
      return { ...s, partyOrders: { ...s.partyOrders, [e.npcId]: e.order } };
    case 'rested': {
      const sheet = s.player.sheet;
      if (e.kind === 'long') {
        const party = Object.fromEntries(Object.entries(s.party).map(([id, sh]) => [id, { ...sh, hp: sh.maxHp, resources: classResources(sh.classId, sh.level) }]));
        return { ...s, worldMinutes: s.worldMinutes + 8 * 60, party,
          player: { ...s.player, sheet: { ...sheet, hp: sheet.maxHp, resources: classResources(sheet.classId, sheet.level) } },
          log: [...s.log, { turn, kind: 'check', text: '긴 휴식 (8시간) — HP와 자원 모두 회복' }] };
      }
      // 짧은 휴식 (SRD 5.2.1): 재기의 바람 1회, 행동 연쇄 전부, 신성 변환 1회, 위저드 비전 회복(긴 휴식당 1번)
      const shortRest = (sh: CharacterSheet): CharacterSheet => {
        const res = structuredClone(resourcesOf(sh));
        const regain = (k: string, n: number) => { const r = res[k]; if (r) r.cur = Math.min(r.max, r.cur + n); };
        regain('second_wind', 1);
        regain('action_surge', 99);
        regain('channel_divinity', 1);
        if (res.arcane_recovery && res.arcane_recovery.cur > 0) {
          let budget = Math.ceil(sh.level / 2);
          let recovered = false;
          for (const lv of [2, 1]) {
            const slot = res[`slot${lv}`];
            while (slot && slot.cur < slot.max && budget >= lv) { slot.cur++; budget -= lv; recovered = true; }
          }
          if (recovered) res.arcane_recovery.cur--;
        }
        return { ...sh, resources: res };
      };
      const res = shortRest(sheet).resources!;
      const party = Object.fromEntries(Object.entries(s.party).map(([id, sh]) => [id, shortRest(sh)]));
      return { ...s, worldMinutes: s.worldMinutes + 60, party, player: { ...s.player, sheet: { ...sheet, resources: res } },
        log: [...s.log, { turn, kind: 'check', text: '짧은 휴식 (1시간) — 짧은 휴식 능력 회복' }] };
    }
    case 'time_advanced':
      return { ...s, worldMinutes: s.worldMinutes + e.minutes };
  }
}

export function replay(events: StoredEvent[]): GameState {
  return [...events].sort((a, b) => a.seq - b.seq).reduce((s, e) => applyEvent(s, e.event, e.turn), initialState());
}
