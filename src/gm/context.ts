import { establishedFactsOf, improvisationOf, protectedTopicsOf } from '../engine/canon';
import { knowledgeOf } from '../engine/knowledge/knowledge';
import type { Character, EntityId, WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';

/**
 * Context Builder — 역할별로 서로 다른 정보만 준다 (설계 리뷰 2.2절).
 *  - Director: 플레이어가 감각으로 알 수 있는 장면 + 장면 인물 목록. 비밀·NPC 지식 없음.
 *  - Actor:    해당 NPC 한 명의 프로필·지식·기억만. 다른 NPC의 지식이나 세계의 진실 없음.
 *  - Narrator: 장면 + 플레이어 지식 + Actor가 확정한 대사. NPC 지식 없음.
 * 세계의 진실(facts.statement)은 어떤 프롬프트에도 직접 들어가지 않는다.
 */

export function presentCharacters(world: WorldPackage, state: GameState): Character[] {
  return world.characters.filter((c) => c.locationId === state.player.locationId);
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
    '## 최근 진행', ...recentLog(state),
  ].join('\n');
}

export function buildActorContext(world: WorldPackage, state: GameState, npc: Character): string {
  const knows = knowledgeOf(world, state.beliefs, npc.id);
  const claimIds = [...world.beliefs, ...state.beliefs].filter((b) => b.holder === npc.id).map((b) => b.claim);
  const claimLines = [...new Set(claimIds)].map((id) => {
    const c = world.claims.find((x) => x.id === id);
    const st = knows.find((k) => k.statement === c?.statement)?.state;
    return c ? `- [${id}] (${st}) ${c.statement}${st === 'secret' ? '  ← 비밀: 쉽게 말하지 않는다' : ''}` : '';
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
    '## 이 낯선 이와의 지난 대화', ...(state.npcMemory[npc.id]?.length ? state.npcMemory[npc.id]! : ['(처음 만난다)']),
  ].join('\n');
}

export function buildNarratorContext(world: WorldPackage, state: GameState): string {
  const npcs = presentCharacters(world, state).map((c) => [
    `- ${c.name} [${c.id}] — 외형: ${c.appearance}`,
    ...canonBlock(world, state, c.id),
  ].join('\n'));
  return [
    ...sceneHeader(world, state),
    ...canonBlock(world, state, state.player.locationId, ''), '',
    '## 이동 가능한 곳', ...exits(world, state), '',
    '## 이 장소에 있는 인물', ...(npcs.length ? npcs : ['(없음)']), '',
    '## 플레이어의 몸 상태', `HP ${state.player.sheet.hp}/${state.player.sheet.maxHp}${state.player.sheet.hp <= state.player.sheet.maxHp / 3 ? ' (심하게 다침)' : ''}`, '',
    '## 플레이어가 알고 있는 것', ...playerKnowledge(world, state), '',
    '## 최근 진행', ...recentLog(state),
  ].join('\n');
}
