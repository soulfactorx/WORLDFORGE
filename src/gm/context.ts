import { knowledgeOf } from '../engine/knowledge/knowledge';
import type { WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';

/**
 * Context Builder: 플레이어 시점에서 감각으로 알 수 있는 것 + 플레이어가 아는 것만 모은다.
 * 세계의 진실(facts)은 절대 이 컨텍스트에 직접 들어가지 않는다.
 *
 * TODO(Phase 0): NPC 대사를 별도 Actor 호출로 분리 (설계 리뷰 2.2절).
 * 지금은 장면에 있는 NPC의 "자기 지식"만 함께 넣는다 — 그 자리에 없는 누구도 모르는 비밀은 들어가지 않는다.
 */
export function buildSceneContext(world: WorldPackage, state: GameState): string {
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  if (!loc) throw new Error(`unknown location: ${state.player.locationId}`);
  const exits = loc.connections.map((id) => {
    const l = world.locations.find((x) => x.id === id);
    return `- ${id}: ${l?.name ?? id}`;
  });
  const npcs = world.characters.filter((c) => c.locationId === loc.id).map((c) => {
    const knows = knowledgeOf(world, state.beliefs, c.id).map((k) => `    · (${k.state}) ${k.statement}`);
    return [
      `- ${c.name} [${c.id}]`,
      `  외형: ${c.appearance}`,
      `  성격: ${c.personality}`,
      `  말투: ${c.speech}`,
      `  이 인물이 아는 것 (이 외에는 모른다):`,
      ...(knows.length ? knows : ['    · (없음)']),
    ].join('\n');
  });
  const playerKnows = knowledgeOf(world, state.beliefs, 'player').map((k) => `- (${k.state}) ${k.statement}`);
  const hh = Math.floor(state.worldMinutes / 60) % 24, mm = state.worldMinutes % 60;
  const recent = state.log.slice(-8).map((e) => `[${e.kind}] ${e.text}`);

  return [
    `## 현재 장소: ${loc.name}`,
    loc.description,
    `시각: ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    '',
    '## 이동 가능한 곳',
    ...exits,
    '',
    '## 이 장소에 있는 인물',
    ...(npcs.length ? npcs : ['(없음)']),
    '',
    '## 플레이어의 몸 상태',
    `HP ${state.player.sheet.hp}/${state.player.sheet.maxHp}`,
    '',
    '## 플레이어가 알고 있는 것',
    ...(playerKnows.length ? playerKnows : ['(아무것도 모른다 — 이 세계에 막 소환되었다)']),
    '',
    '## 최근 진행',
    ...recent,
  ].join('\n');
}
