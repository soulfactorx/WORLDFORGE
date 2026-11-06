import type { Belief, EntityId } from '../schema';
import type { GameEvent, StoredEvent } from './events';
import { type CharacterSheet, legacyCharacter } from '../character/sheet';
import type { ImprovisedFact } from '../canon';
import { josa } from '../text/josa';
import { applyDelta, describeDelta, type Relationship } from '../relationship';
import { applyEffects, type CombatState, endTurn, type PartyOrder, ZONE_NAMES } from '../combat/combat';
import { classResources, resourcesOf } from '../character/sheet';
import { applyBuildChoice } from '../character/build';
import { ABILITY_NAMES, type Ability, SKILLS, type SkillId } from '../character/rules';

export interface LogEntry {
  turn: number;
  kind: 'player' | 'narration' | 'check' | 'knowledge' | 'combat' | 'relation' | 'progress' | 'quest' | 'guide' | 'omen';
  text: string;
  images?: { id: string; caption: string }[];
  /** guide: 진행 제안과 선택지 */
  suggestion?: string;
  choices?: string[];
  /** 선택지별 기술 ID ('' = 판정 없음) (v0.16) */
  choiceSkills?: string[];
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
  /** 세력 평판 (바뀐 세력만, 설계 v3 4.4) */
  reputation: Record<EntityId, number>;
  /** 관계 사건: 열린 턴과 닫혔는지 */
  beats: Record<EntityId, { turn: number; done: boolean }>;
  /** 이야기 엔진 (설계 v3 5장): 줄기 진행 (chapter = 끝낸 장 수) */
  arcs: Record<EntityId, { chapter: number; done: boolean; failed?: boolean }>;
  clocks: Record<EntityId, { value: number; minutes: number; onFired: number[]; reached: number[] }>;
  /** 일어난(또는 막힌) 연표 사건 */
  worldEvents: Record<EntityId, { turn: number; skipped: boolean }>;
  /** 소지품·소지금·장비 (설계 v3 6.4) */
  inventory: Record<EntityId, number>;
  money: number;
  equipped: { weapon?: EntityId; armor?: EntityId; shield?: EntityId; trinket?: EntityId };
  /** 이미 주운 것·받은 것 ("loc/…#0", "npc/…#1") */
  taken: string[];
  /** 결정적 선택: 나타난 턴과 고른 선택지 */
  choices: Record<EntityId, { turn: number; chosen?: string }>;
  /** 퀘스트 진행 (v0.8) */
  quests: Record<EntityId, { stage: number; done: boolean; failed?: boolean; startedAt?: number }>;
  /** 쓰러뜨린 적 (몬스터 ID → 수) */
  kills: Record<string, number>;
  /** 의뢰 (설계 v3 6.3): 끝낸 수·실패 수·진행 중인 것 */
  jobs: Record<EntityId, { done: number; failed: number; active?: { instance: number; acceptedAt: number } }>;
  /** 지속되는 세계: 마지막으로 계산한 날 (게임 시작 후 날 수) */
  simDay?: number;
  /** 보상으로 얻은 전용 카드 ('player' 또는 동료 ID → 카드) */
  grantedCards: Record<string, string[]>;
  /** 이야기 플래그 (v0.8) */
  flags: string[];
  /** 도달한 결말 ID */
  ending?: string;
  /** 플레이어 사망 (턴 되돌리기로만 돌아갈 수 있다) */
  playerDead?: boolean;
  /** 죽은 NPC */
  deadNpcs: string[];
  /** 플레이어가 이름을 아는 인물 (v0.37.5). 없으면(이전 세이브) 모두 아는 것으로 본다 */
  namesKnown?: EntityId[];
  /** 지금 장소에 도착한 턴 (v0.37.6). 조우 조건("두 턴 이상 머물면")을 판단할 수 있게 Director에게 보여 준다 */
  arrivedTurn?: number;
  /** 이미 받은 1회성 경험치 보상 열쇠 (v0.38) */
  xpKeys?: string[];
  log: LogEntry[];
}

export const MAX_PARTY = 2;

/** 'skill:persuasion' → '설득', 'ability:str' → '근력' */
export function useLabel(use: string): string {
  const [kind, id] = use.split(':');
  if (kind === 'skill' && id && id in SKILLS) return SKILLS[id as SkillId].name;
  if (kind === 'ability' && id && id in ABILITY_NAMES) return ABILITY_NAMES[id as Ability];
  return use;
}

export const NPC_MEMORY_LIMIT = 12;

const KNOWLEDGE_LABEL: Record<Belief['state'], string> = {
  rumor: '소문', partial: '들은 이야기', confirmed: '확인됨', mistaken: '잘못 앎', secret: '비밀',
};

export function initialState(): GameState {
  return {
    packageId: '', packageVersion: '', turn: 0, rngState: 0, worldMinutes: 8 * 60,
    player: { name: '', locationId: '', sheet: legacyCharacter('') }, beliefs: [], improvisedFacts: [], npcMemory: {}, clearedEncounters: [], party: {}, partyOrders: {}, npcLocations: {}, relationships: {}, reputation: {}, beats: {}, arcs: {}, clocks: {}, worldEvents: {}, choices: {}, inventory: {}, money: 0, equipped: {}, taken: [], kills: {}, jobs: {}, grantedCards: {}, quests: {}, flags: [], deadNpcs: [], log: [],
  };
}

export function applyEvent(s: GameState, e: GameEvent, turn: number): GameState {
  switch (e.type) {
    case 'game_started':
      return { ...initialState(), namesKnown: [], arrivedTurn: 0, packageId: e.packageId, packageVersion: e.packageVersion, rngState: e.seed,
        player: { name: e.playerName, locationId: e.locationId, sheet: e.character ?? legacyCharacter(e.playerName) } };
    case 'player_input':
      return { ...s, turn, log: [...s.log, { turn, kind: 'player', text: e.use ? `${e.text}  [${useLabel(e.use)}]` : e.text }] };
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
      return { ...s, log: [...s.log, { turn, kind: 'narration', text: e.text, ...(e.images?.length ? { images: e.images } : {}) }] };
    case 'moved':
      return { ...s, player: { ...s.player, locationId: e.to }, arrivedTurn: turn };
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
      return { ...s, party: { ...s.party, [e.npcId]: e.sheet }, npcLocations, ...(s.namesKnown && !s.namesKnown.includes(e.npcId) ? { namesKnown: [...s.namesKnown, e.npcId] } : {}),
        log: [...s.log, { turn, kind: 'knowledge', text: `${josa(e.sheet.name, '이/가')} 동료가 되었다.` }] };
    }
    case 'companion_left': {
      const { [e.npcId]: left, ...party } = s.party;
      const { [e.npcId]: _o, ...partyOrders } = s.partyOrders;
      return { ...s, party, partyOrders, npcLocations: { ...s.npcLocations, [e.npcId]: e.locationId },
        log: [...s.log, { turn, kind: 'knowledge', text: `${josa(left?.name ?? e.npcId, '이/가')} 일행을 떠났다.` }] };
    }
    case 'quest_started':
      return { ...s, quests: { ...s.quests, [e.questId]: { stage: 0, done: false, startedAt: s.worldMinutes } },
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
      const keyed = e.key ? { ...next, xpKeys: [...(s.xpKeys ?? []), e.key] } : next;
      return e.who === 'player'
        ? { ...keyed, log: [...keyed.log, { turn, kind: 'progress', text: `경험치 +${e.amount} (${e.reason})` }] }
        : keyed;
    }
    case 'level_up': {
      const name = e.who === 'player' ? '당신' : e.sheet.name;
      const text = `★ ${josa(name, '은/는')} ${e.sheet.level}레벨이 되었다 — 최대 HP +${e.hpGain}${e.features.length ? `, 새 능력: ${e.features.join(', ')}` : ''}`;
      const next = e.who === 'player' ? { ...s, player: { ...s.player, sheet: e.sheet } }
        : s.party[e.who] ? { ...s, party: { ...s.party, [e.who]: e.sheet } } : s;
      return { ...next, log: [...next.log, { turn, kind: 'progress', text }] };
    }
    case 'names_learned':
      return s.namesKnown ? { ...s, namesKnown: [...new Set([...s.namesKnown, ...e.ids])] } : s;
    case 'build_choice': {
      const sheet = e.who === 'player' ? s.player.sheet : s.party[e.who];
      const r = sheet ? applyBuildChoice(sheet, e.kind, e.value) : null;
      if (!sheet || !r) return s;
      const name = e.who === 'player' ? '당신' : sheet.name;
      const next = e.who === 'player' ? { ...s, player: { ...s.player, sheet: r.sheet } } : { ...s, party: { ...s.party, [e.who]: r.sheet } };
      return { ...next, log: [...next.log, { turn, kind: 'progress', text: `★ ${name} — ${r.text}` }] };
    }
    case 'relationship_changed': {
      const base = s.relationships[e.npcId] ?? e.base ?? {};
      return { ...s, relationships: { ...s.relationships, [e.npcId]: applyDelta(base, e.delta) },
        log: [...s.log, { turn, kind: 'relation', text: `${e.name ?? e.npcId}: ${describeDelta(e.delta)} — ${e.reason}` }] };
    }
    case 'relation_stage':
      return { ...s, log: [...s.log, { turn, kind: 'relation', text: `♡ ${e.name}와(과)의 사이: ${e.from} → ${e.to}` }] };
    case 'reputation_changed': {
      const rep = s.reputation ?? {};
      const cur = rep[e.factionId] ?? e.base ?? 0;
      return { ...s, reputation: { ...rep, [e.factionId]: Math.max(-100, Math.min(100, cur + e.delta)) },
        log: [...s.log, { turn, kind: 'relation', text: `${e.name} 평판 ${e.delta > 0 ? '+' : ''}${e.delta} — ${e.reason}` }] };
    }
    case 'beat_opened':
      return { ...s, beats: { ...(s.beats ?? {}), [e.beatId]: { turn, done: false } } };
    case 'arc_started':
      return { ...s, arcs: { ...(s.arcs ?? {}), [e.arcId]: { chapter: 0, done: false } },
        log: [...s.log, { turn, kind: 'quest', text: `새 이야기 — ${e.name}: ${e.chapter}` }] };
    case 'chapter_completed': {
      const a = s.arcs?.[e.arcId] ?? { chapter: 0, done: false };
      return { ...s, arcs: { ...(s.arcs ?? {}), [e.arcId]: { ...a, chapter: e.index + 1 } },
        log: e.next ? [...s.log, { turn, kind: 'quest', text: `◆ ${e.name} — 장 완료. 다음 장: 「${e.next}」${e.preview ? ` — ${e.preview}` : ''}` }] : s.log };
    }
    case 'arc_ended': {
      const a = s.arcs?.[e.arcId] ?? { chapter: 0, done: false };
      return { ...s, arcs: { ...(s.arcs ?? {}), [e.arcId]: { ...a, done: true, ...(e.failed ? { failed: true } : {}) } },
        log: [...s.log, { turn, kind: 'quest', text: `이야기 ${e.failed ? '실패' : '완료'} — ${e.name}` }] };
    }
    case 'clock_changed': {
      const c = s.clocks?.[e.clockId] ?? { value: 0, minutes: e.minutes, onFired: [], reached: [] };
      return { ...s, clocks: { ...(s.clocks ?? {}), [e.clockId]: { ...c, value: e.value, minutes: e.minutes, onFired: [...c.onFired, ...(e.onFired ?? [])] } } };
    }
    case 'clock_reached': {
      const c = s.clocks?.[e.clockId] ?? { value: 0, minutes: 0, onFired: [], reached: [] };
      return { ...s, clocks: { ...(s.clocks ?? {}), [e.clockId]: { ...c, reached: [...c.reached, e.segment] } },
        log: e.omen ? [...s.log, { turn, kind: 'omen', text: e.omen }] : s.log };
    }
    case 'world_event':
      return { ...s, worldEvents: { ...(s.worldEvents ?? {}), [e.eventId]: { turn, skipped: e.skipped } },
        log: e.announce && !e.skipped ? [...s.log, { turn, kind: 'omen', text: e.announce }] : s.log };
    case 'npc_moved':
      return s.party[e.npcId] ? s : { ...s, npcLocations: { ...s.npcLocations, [e.npcId]: e.to } };
    case 'npc_killed': {
      if (s.deadNpcs.includes(e.npcId)) return s;
      const { [e.npcId]: _p, ...party } = s.party;
      const { [e.npcId]: _o, ...partyOrders } = s.partyOrders;
      return { ...s, party, partyOrders, deadNpcs: [...s.deadNpcs, e.npcId] };
    }
    case 'choice_offered':
      return { ...s, choices: { ...(s.choices ?? {}), [e.choiceId]: { turn } } };
    case 'choice_made':
      return { ...s, choices: { ...(s.choices ?? {}), [e.choiceId]: { turn: s.choices?.[e.choiceId]?.turn ?? turn, chosen: e.optionId } },
        log: [...s.log, { turn, kind: 'quest', text: `◆ 결정 — ${e.text}` }] };
    case 'quest_failed': {
      const q = s.quests[e.questId] ?? { stage: 0, done: false };
      return { ...s, quests: { ...s.quests, [e.questId]: { ...q, done: true, failed: true } },
        log: [...s.log, { turn, kind: 'quest', text: `임무 실패 — ${e.name} (${e.reason})` }] };
    }
    case 'enemies_defeated': {
      const kills = { ...(s.kills ?? {}) };
      for (const [id, n] of Object.entries(e.counts)) kills[id] = (kills[id] ?? 0) + n;
      return { ...s, kills };
    }
    case 'job_accepted': {
      const j = s.jobs?.[e.jobId] ?? { done: 0, failed: 0 };
      return { ...s, jobs: { ...(s.jobs ?? {}), [e.jobId]: { ...j, active: { instance: e.instance, acceptedAt: s.worldMinutes } } },
        log: [...s.log, { turn, kind: 'quest', text: `의뢰 수락 — ${e.name}` }] };
    }
    case 'job_completed': case 'job_failed': {
      const j = s.jobs?.[e.jobId] ?? { done: 0, failed: 0 };
      const next = e.type === 'job_completed' ? { done: j.done + 1, failed: j.failed } : { done: j.done, failed: j.failed + 1 };
      return { ...s, jobs: { ...(s.jobs ?? {}), [e.jobId]: next },
        log: [...s.log, { turn, kind: 'quest', text: e.type === 'job_completed' ? `의뢰 완료 — ${e.name}` : `의뢰 실패 — ${e.name} (${e.reason})` }] };
    }
    case 'card_granted': {
      const g = { ...(s.grantedCards ?? {}) };
      g[e.who] = [...new Set([...(g[e.who] ?? []), e.cardId])];
      return { ...s, grantedCards: g, log: [...s.log, { turn, kind: 'progress', text: `★ 새 기술 — ${e.whoName}: ${e.name}` }] };
    }
    case 'sim_day':
      return { ...s, simDay: e.day };
    case 'rumor_spread': {
      const keys = new Set(e.beliefs.map((b) => `${b.holder}|${b.claim}`));
      return { ...s, beliefs: [...s.beliefs.filter((b) => !keys.has(`${b.holder}|${b.claim}`)), ...e.beliefs] };
    }
    case 'faction_acted':
      return e.news ? { ...s, log: [...s.log, { turn, kind: 'omen', text: e.news }] } : s;
    case 'item_gained': {
      const inv = { ...(s.inventory ?? {}) };
      inv[e.itemId] = (inv[e.itemId] ?? 0) + e.n;
      return { ...s, inventory: inv, taken: e.key ? [...(s.taken ?? []), e.key] : s.taken ?? [],
        log: [...s.log, { turn, kind: 'progress', text: `얻음: ${e.name}${e.n > 1 ? ` ×${e.n}` : ''} (${e.reason})` }] };
    }
    case 'item_lost': {
      const inv = { ...(s.inventory ?? {}) };
      const left = Math.max(0, (inv[e.itemId] ?? 0) - e.n);
      if (left) inv[e.itemId] = left; else delete inv[e.itemId];
      // 다 잃은 장비는 벗겨진다
      const eq = { ...(s.equipped ?? {}) };
      if (!left) for (const k of ['weapon', 'armor', 'shield', 'trinket'] as const) if (eq[k] === e.itemId) delete eq[k];
      return { ...s, inventory: inv, equipped: eq,
        log: e.reason ? [...s.log, { turn, kind: 'progress', text: `잃음: ${e.name}${e.n > 1 ? ` ×${e.n}` : ''} (${e.reason})` }] : s.log };
    }
    case 'money_changed':
      return { ...s, money: Math.max(0, (s.money ?? 0) + e.delta),
        log: [...s.log, { turn, kind: 'progress', text: `${e.currency ?? '소지금'} ${e.delta > 0 ? '+' : ''}${e.delta} (${e.reason})` }] };
    case 'item_equipped': {
      const eq = { ...(s.equipped ?? {}) };
      if (e.itemId) eq[e.slot] = e.itemId; else delete eq[e.slot];
      return { ...s, equipped: eq };
    }
    case 'item_used': {
      const sheet = s.player.sheet;
      return { ...s, rngState: e.rngState, player: { ...s.player, sheet: { ...sheet, hp: Math.min(sheet.maxHp, sheet.hp + e.heal) } },
        log: [...s.log, { turn, kind: 'check', text: `${e.name} 사용 — HP ${e.heal} 회복 (${sheet.hp} → ${Math.min(sheet.maxHp, sheet.hp + e.heal)})` }] };
    }
    case 'beat_closed':
      return { ...s, beats: { ...(s.beats ?? {}), [e.beatId]: { turn: s.beats?.[e.beatId]?.turn ?? turn, done: true } } };
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
        const party = Object.fromEntries(Object.entries(s.party).map(([id, sh]) => [id, { ...sh, hp: sh.maxHp, resources: classResources(sh.classId, sh.level, sh.subclass) }]));
        return { ...s, worldMinutes: s.worldMinutes + 8 * 60, party,
          player: { ...s.player, sheet: { ...sheet, hp: sheet.maxHp, resources: classResources(sheet.classId, sheet.level, sheet.subclass) } },
          log: [...s.log, { turn, kind: 'check', text: '긴 휴식 (8시간) — HP와 자원 모두 회복' }] };
      }
      // 짧은 휴식 (SRD 5.2.1): 재기의 바람 1회, 행동 연쇄 전부, 신성 변환 1회, 위저드 비전 회복(긴 휴식당 1번)
      const shortRest = (sh: CharacterSheet): CharacterSheet => {
        const res = structuredClone(resourcesOf(sh));
        const regain = (k: string, n: number) => { const r = res[k]; if (r) r.cur = Math.min(r.max, r.cur + n); };
        regain('second_wind', 1);
        regain('action_surge', 99);
        regain('channel_divinity', 1);
        regain('fey_presence', 99);
        // 워락 계약 슬롯은 짧은 휴식에 모두 회복, 바드 5레벨부터 음유 영감도
        if (sh.classId === 'warlock') for (const k of Object.keys(res)) if (k.startsWith('slot')) regain(k, 99);
        if (sh.classId === 'bard' && sh.level >= 5) regain('bardic_inspiration', 99);
        if (res.arcane_recovery && res.arcane_recovery.cur > 0) {
          let budget = Math.ceil(sh.level / 2);
          let recovered = false;
          for (const lv of [5, 4, 3, 2, 1]) {
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
    case 'gm_guide':
      return { ...s, log: [...s.log, { turn, kind: 'guide', text: e.summary, suggestion: e.suggestion, choices: e.choices, ...(e.images?.length ? { images: e.images } : {}), ...(e.choiceSkills ? { choiceSkills: e.choiceSkills } : {}) }] };
  }
}

export function replay(events: StoredEvent[]): GameState {
  return [...events].sort((a, b) => a.seq - b.seq).reduce((s, e) => applyEvent(s, e.event, e.turn), initialState());
}
