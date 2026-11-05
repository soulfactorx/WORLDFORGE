import { establishedFactsOf, improvisationOf, protectedTopicsOf } from '../engine/canon';
import { knowledgeOf } from '../engine/knowledge/knowledge';
import { AXES, AXIS_NAMES, canShareSecret, joinBlocker, loyaltyOf, OBEY_LOYALTY, relationsOf, relationshipOf, reputationLabel, reputationOf, secretTrustOf, stageFor, stageOf } from '../engine/relationship';
import { activeBeats } from '../engine/scenario';
import { npcLocationOf } from '../engine/world';
import type { Character, EntityId, WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';
import { calendarDate } from '../engine/calendar';

const dateLabel = (world: WorldPackage, minutes: number) => { const d = calendarDate(world, minutes); return d ? `${d.label}${d.countdown ? ` (${d.countdown})` : ''} ` : ''; };

/**
 * Context Builder — 역할별로 서로 다른 정보만 준다 (설계 리뷰 2.2절).
 *  - Director: 플레이어가 감각으로 알 수 있는 장면 + 장면 인물 목록. 비밀·NPC 지식 없음.
 *  - Actor:    해당 NPC 한 명의 프로필·지식·기억만. 다른 NPC의 지식이나 세계의 진실 없음.
 *  - Narrator: 장면 + 플레이어 지식 + Actor가 확정한 대사. NPC 지식 없음.
 * 세계의 진실(facts.statement)은 어떤 프롬프트에도 직접 들어가지 않는다.
 */

/** NPC의 현재 위치: 동료면 플레이어 곁, 아니면 세이브의 위치 변경 또는 패키지 기본값 */
/** NPC의 현재 위치 (동료 → 옮긴 곳 → 일정 → 기본, engine/world) */
export function npcLocation(state: GameState, c: Character): EntityId {
  return npcLocationOf(state, c);
}

export function presentCharacters(world: WorldPackage, state: GameState): Character[] {
  return world.characters.filter((c) => !state.deadNpcs?.includes(c.id) && npcLocation(state, c) === state.player.locationId);
}

function partyLines(world: WorldPackage, state: GameState): string[] {
  const ids = Object.keys(state.party);
  if (!ids.length) return ['(없음 — 혼자다)'];
  return ids.map((id) => {
    const sh = state.party[id]!;
    return `- ${sh.name} [${id}] HP ${sh.hp}/${sh.maxHp}`;
  });
}

export function sceneSubjects(world: WorldPackage, state: GameState): EntityId[] {
  return [state.player.locationId, ...presentCharacters(world, state).map((c) => c.id)];
}

const POLICY_TEXT = { none: '지어내기 금지 — 설명에 없는 흔적·단서·이상 징후를 덧붙이지 않는다', minor: '작은 세부사항만 지어낼 수 있음', free: '자유롭게 지어낼 수 있음' } as const;

/** 엔티티별 확정된 세부사항 + 즉흥 허용 범위 + 보호 주제 (Narrator·Actor 공용) */
function canonBlock(world: WorldPackage, state: GameState, id: EntityId, indent = '  '): string[] {
  const facts = establishedFactsOf(state.improvisedFacts, id);
  const topics = protectedTopicsOf(world, id);
  const policy = improvisationOf(world, id) ?? 'minor';
  return [
    `${indent}즉흥 설정: ${POLICY_TEXT[policy]}`,
    ...(facts.length ? [`${indent}이미 확정된 세부사항 (반드시 일관되게):`, ...facts.map((f) => `${indent}  · ${f}`)] : []),
    ...(topics.length ? [`${indent}보호 주제 (언급·추측·창작 금지): ${topics.join(' / ')}`] : []),
  ];
}

function sceneHeader(world: WorldPackage, state: GameState): string[] {
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  if (!loc) throw new Error(`unknown location: ${state.player.locationId}`);
  const hh = Math.floor(state.worldMinutes / 60) % 24, mm = state.worldMinutes % 60;
  return [
    `## 현재 장소: ${loc.name} [${loc.id}]`,
    loc.description,
    `시각: ${dateLabel(world, state.worldMinutes)}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  ];
}

function exits(world: WorldPackage, state: GameState): string[] {
  const loc = world.locations.find((l) => l.id === state.player.locationId)!;
  return loc.connections.map((id) => `- ${id}: ${world.locations.find((x) => x.id === id)?.name ?? id}`);
}

function recentLog(state: GameState, n = 8): string[] {
  return state.log.slice(-n).map((e) => `[${e.kind}] ${e.text}`);
}

function playerKnowledge(world: WorldPackage, state: GameState): string[] {
  const k = knowledgeOf(world, state.beliefs, 'player').map((x) => x.source === 'start'
    ? `- (처음부터 알던 것: 원작·사전 지식 — 아직 일어나지 않았거나 바뀔 수 있는 일일 수 있다) ${x.statement}`
    : `- (${x.state}) ${x.statement}`);
  return k.length ? k : ['(아무것도 모른다 — 이 세계에 막 소환되었다)'];
}

export function buildDirectorContext(world: WorldPackage, state: GameState): string {
  const npcs = presentCharacters(world, state).map((c) => `- ${c.id}: ${c.appearance}`);
  return [
    ...sceneHeader(world, state), '',
    '## 이동 가능한 곳', ...exits(world, state), '',
    '## 이 장소에 있는 인물', ...(npcs.length ? npcs : ['(없음)']), '',
    '## 플레이어와 동행 중인 동료', ...partyLines(world, state), '',
    '## 최근 진행', ...recentLog(state),
  ].join('\n');
}

const MAX_ACTOR_CLAIMS = 80;

export function buildActorContext(world: WorldPackage, state: GameState, npc: Character): string {
  const rel = relationshipOf(world, state.relationships, npc.id);
  const knows = knowledgeOf(world, state.beliefs, npc.id);
  const claimIds = [...world.beliefs, ...state.beliefs].filter((b) => b.holder === npc.id).map((b) => b.claim);
  const claimLines = [...new Set(claimIds)].map((id) => {
    const c = world.claims.find((x) => x.id === id);
    const st = knows.find((k) => k.statement === c?.statement)?.state;
    const secretNote = st !== 'secret' ? '' : canShareSecret(world, npc.id, rel)
      ? '  ← 비밀: 이제 털어놓을 수는 있지만, 꼭 필요할 때만'
      : '  ← 비밀: 지금 신뢰로는 절대 말하지 않는다';
    return c ? `- [${id}] (${st}) ${c.statement}${secretNote}` : '';
  }).filter(Boolean);
  // 아는 것이 너무 많으면(큰 세계) 지금 장면과 관련된 것 위주로 줄인다: 비밀 → 이 장소·이 자리 인물이 나오는 것 → 나머지
  if (claimLines.length > MAX_ACTOR_CLAIMS) {
    const here = world.locations.find((l) => l.id === state.player.locationId)?.name ?? '';
    const names = [here, ...presentCharacters(world, state).map((c) => c.name)].filter((n) => n.length >= 2);
    const rank = (l: string) => (l.includes('← 비밀') ? 0 : names.some((n) => l.includes(n)) ? 1 : 2);
    const kept = claimLines.map((l, i) => ({ l, i, r: rank(l) })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, MAX_ACTOR_CLAIMS).sort((a, b) => a.i - b.i).map((x) => x.l);
    claimLines.length = 0;
    claimLines.push(...kept, `- (그 밖에도 아는 것이 더 있다. 위 목록에 없는 일은 어렴풋하게만 기억한다)`);
  }
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  return [
    `## 너는 ${npc.name} [${npc.id}]`,
    `외형: ${npc.appearance}`,
    `성격: ${npc.personality}`,
    `말투: ${npc.speech}`,
    ...(npc.background ? [`배경: ${npc.background}`] : []),
    ...(npc.greeting && !state.npcMemory[npc.id]?.length ? [`처음 만났을 때 하는 말 (참고): ${npc.greeting}`] : []),
    ...canonBlock(world, state, npc.id, ''), '',
    `## 지금 있는 곳: ${loc?.name}`, '',
    '## 네가 아는 것 (이 목록 밖의 세계 사실은 모른다)', ...(claimLines.length ? claimLines : ['(특별히 아는 것 없음)']), '',
    `## 이 낯선 이에 대한 너의 감정: ${stageOf(rel, !!npc.romanceable)}`,
    AXES.map((a) => `${AXIS_NAMES[a]} ${rel[a]}`).join(' · ') + '  (-100 ~ 100)',
    `비밀을 털어놓으려면 신뢰 ${secretTrustOf(world, npc.id)} 이상이 필요하다.`,
    npc.romanceable
      ? '너는 이 사람과 연인이 될 수도 있다. 감정은 친밀과 호감이 쌓이는 만큼만 천천히 깊어진다. 서두르지 않는다.'
      : '너는 이 사람에게 연애 감정을 품지 않는다. 가까워져도 우정이나 신뢰로 남는다.',
    ...(state.party[npc.id] ? [`동료로서의 충성도: ${loyaltyOf(rel)} / 100${loyaltyOf(rel) < OBEY_LOYALTY ? ' — 낮다. 지시를 따르기 싫고, 불만을 드러낸다.' : ''}`] : []),
    ...relationLines(world, state, npc), '',
    ...beatLines(world, state, npc),
    '## 이 낯선 이와의 지난 대화', ...(state.npcMemory[npc.id]?.length ? state.npcMemory[npc.id]! : ['(처음 만난다)']), '',
    '## 동행', ...(state.party[npc.id]
      ? ['너는 지금 이 낯선 이와 함께 다니는 동료다. 크게 실망하거나 위험이 지나치면 떠날 수 있다.']
      : npc.companion
        ? [
          `너는 아직 동료가 아니다. 함께 가자는 제안을 받으면 다음 기준으로 스스로 판단한다: ${npc.companion.joinCondition}`,
          ...(joinBlocker(npc.companion, rel) ? [`지금은 동행할 수 없다 (${joinBlocker(npc.companion, rel)}). 제안을 받으면 거절한다.`] : []),
        ]
        : ['너는 누구와도 동행하지 않는다. 동행 제안은 거절한다.']),
  ].join('\n');
}

/** 다른 인물과의 관계 + 그 인물과 플레이어의 사이 (파급을 연기에 반영) / 세력 */
function relationLines(world: WorldPackage, state: GameState, npc: Character): string[] {
  const rels = relationsOf(world, npc.id).flatMap((r) => {
    const o = world.characters.find((c) => c.id === r.other);
    if (!o) return [];
    const met = state.relationships[o.id] || state.npcMemory[o.id]?.length;
    return [`- ${o.name}: ${r.label}${r.note ? ` — ${r.note}` : ''}${state.deadNpcs.includes(o.id) ? ' (죽었다)' : met ? ` / 이 낯선 이와 ${o.name}의 사이: ${stageFor(world, state.relationships, o.id)}` : ''}`];
  });
  const f = npc.faction ? world.factions?.find((x) => x.id === npc.faction) : undefined;
  return [
    ...(rels.length ? ['', '## 너와 다른 인물의 관계', ...rels] : []),
    ...(f ? ['', `## 너의 소속: ${f.name} — ${f.description}`, `이 낯선 이에 대한 ${f.name}의 평판: ${reputationLabel(reputationOf(world, state.reputation ?? {}, f.id))}`] : []),
  ];
}

function beatLines(world: WorldPackage, state: GameState, npc: Character): string[] {
  const mine = activeBeats(world, state).filter((b) => b.npcId === npc.id);
  return mine.length ? ['## 지금 너의 마음 (때가 무르익었다)', ...mine.map((b) => `- ${b.name}: ${b.hint}`), ''] : [];
}

export function buildNarratorContext(world: WorldPackage, state: GameState): string {
  const npcs = presentCharacters(world, state).map((c) => [
    `- ${c.name} [${c.id}] — 외형: ${c.appearance} — 플레이어를 대하는 태도: ${stageFor(world, state.relationships, c.id)}`,
    ...canonBlock(world, state, c.id),
  ].join('\n'));
  return [
    ...sceneHeader(world, state),
    ...canonBlock(world, state, state.player.locationId, ''), '',
    '## 이동 가능한 곳', ...exits(world, state), '',
    '## 이 장소에 있는 인물', ...(npcs.length ? npcs : ['(없음)']), '',
    '## 동행 중인 동료', ...partyLines(world, state), '',
    '## 플레이어의 몸 상태', `HP ${state.player.sheet.hp}/${state.player.sheet.maxHp}${state.player.sheet.hp <= state.player.sheet.maxHp / 3 ? ' (심하게 다침)' : ''}`, '',
    '## 플레이어가 알고 있는 것', ...playerKnowledge(world, state), '',
    '## 최근 진행', ...recentLog(state),
  ].join('\n');
}
