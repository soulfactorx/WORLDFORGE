import { establishedFactsOf, improvisationOf, protectedTopicsOf } from '../engine/canon';
import { knowledgeOf } from '../engine/knowledge/knowledge';
import { AXES, AXIS_NAMES, canShareSecret, joinBlocker, relationshipOf, secretTrustOf, stageOf } from '../engine/relationship';
import type { Character, EntityId, WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';

/**
 * Context Builder — 역할별로 서로 다른 정보만 준다 (설계 리뷰 2.2절).
 *  - Director: 플레이어가 감각으로 알 수 있는 장면 + 장면 인물 목록. 비밀·NPC 지식 없음.
 *  - Actor:    해당 NPC 한 명의 프로필·지식·기억만. 다른 NPC의 지식이나 세계의 진실 없음.
 *  - Narrator: 장면 + 플레이어 지식 + Actor가 확정한 대사. NPC 지식 없음.
 * 세계의 진실(facts.statement)은 어떤 프롬프트에도 직접 들어가지 않는다.
 */

/** NPC의 현재 위치: 동료면 플레이어 곁, 아니면 세이브의 위치 변경 또는 패키지 기본값 */
export function npcLocation(state: GameState, c: Character): EntityId {
  if (state.party[c.id]) return state.player.locationId;
  return state.npcLocations[c.id] ?? c.locationId;
}

export function presentCharacters(world: WorldPackage, state: GameState): Character[] {
  return world.characters.filter((c) => npcLocation(state, c) === state.player.locationId);
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

const POLICY_TEXT = { none: '지어내기 금지', minor: '작은 세부사항만 지어낼 수 있음', free: '자유롭게 지어낼 수 있음' } as const;

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
    `시각: ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
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
  const k = knowledgeOf(world, state.beliefs, 'player').map((x) => `- (${x.state}) ${x.statement}`);
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
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  return [
    `## 너는 ${npc.name} [${npc.id}]`,
    `외형: ${npc.appearance}`,
    `성격: ${npc.personality}`,
    `말투: ${npc.speech}`,
    ...canonBlock(world, state, npc.id, ''), '',
    `## 지금 있는 곳: ${loc?.name}`, '',
    '## 네가 아는 것 (이 목록 밖의 세계 사실은 모른다)', ...(claimLines.length ? claimLines : ['(특별히 아는 것 없음)']), '',
    `## 이 낯선 이에 대한 너의 감정: ${stageOf(rel)}`,
    AXES.map((a) => `${AXIS_NAMES[a]} ${rel[a]}`).join(' · ') + '  (-100 ~ 100)',
    `비밀을 털어놓으려면 신뢰 ${secretTrustOf(world, npc.id)} 이상이 필요하다.`, '',
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

export function buildNarratorContext(world: WorldPackage, state: GameState): string {
  const npcs = presentCharacters(world, state).map((c) => [
    `- ${c.name} [${c.id}] — 외형: ${c.appearance} — 플레이어를 대하는 태도: ${stageOf(relationshipOf(world, state.relationships, c.id))}`,
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
