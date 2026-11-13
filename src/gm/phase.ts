/**
 * 기류·국면 → 이벤트 (v0.113, 설계 v6 M3).
 * 턴(또는 전투)에서 일어난 일로 긴장을 움직이고, 그 결과 국면이 바뀌면 바꾼다. 결과는 서술 앞에서 확정된다.
 */
import { currentPhase, intensityHint, nextPhase, phasesOf, TENSION, tensionDelta, tensionOf } from '../engine/phase';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { effectEvents } from './story';

/** 이 턴의 일로 긴장 변화 → 국면 전환. extra: 엔진이 따로 정한 긴장 변화 (예: 잔잔함) */
export function phaseEvents(world: WorldPackage, state: GameState, turnEvents: GameEvent[], extra: { delta: number; why: string }[] = []): GameEvent[] {
  if (!phasesOf(world).length && world.autoPhases === false) return [];
  const out: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { out.push(e); s = applyEvent(s, e, state.turn); };
  const t = tensionDelta(turnEvents);
  const delta = t.delta + extra.reduce((a, x) => a + x.delta, 0);
  if (delta) {
    const why = [...t.why, ...extra.map((x) => `${x.delta > 0 ? '+' : ''}${x.delta} ${x.why}`)].join(', ');
    effectEvents(world, s, [{ var: TENSION, add: delta }], `긴장 (${why})`).forEach(push);
  }
  const next = nextPhase(world, s);
  if (next) {
    const from = currentPhase(world, s);
    push({ type: 'phase_changed', ...(from ? { from: from.id, fromName: from.name } : {}), to: next.id, name: next.name, ...(from && next.announce ? { announce: next.announce } : {}) });
    if (from && next.effects?.length) effectEvents(world, s, next.effects, `국면: ${next.name}`).forEach(push);
  }
  return out;
}

/** 서술·GM 프롬프트에 넣는 국면 블록 (플레이어도 느끼는 공기만 — 비밀 없음) */
export function phaseBlock(world: WorldPackage, s: GameState, opts: { director?: boolean; npcIds?: string[] } = {}): string {
  const ph = currentPhase(world, s);
  if (!ph) return '';
  const att = Object.entries(ph.attitudes ?? {}).filter(([id]) => !opts.npcIds || opts.npcIds.includes(id))
    .map(([id, a]) => `- ${world.characters.find((c) => c.id === id)?.name ?? id}: ${a}`);
  const closed = (ph.closed ?? []).map((id) => world.locations.find((l) => l.id === id)?.name ?? id);
  const hint = opts.director ? intensityHint(s) : null;
  return [
    `\n\n## 지금 국면: ${ph.name} (긴장 ${tensionOf(s)}/10)`,
    ph.tone,
    ...(att.length ? ['이 국면의 인물들:', ...att] : []),
    ...(closed.length ? [`이 국면에는 갈 수 없는 곳: ${closed.join(', ')}`] : []),
    ...(hint ? [`강도 곡선 (엔진): ${hint.text}`] : []),
  ].join('\n');
}

/** 국면 전환 → 서술자에게 주는 한 줄 */
export function phaseTransitionLines(world: WorldPackage, events: GameEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type !== 'phase_changed' || !e.from) return [];
    const ph = phasesOf(world).find((p) => p.id === e.to);
    return [`국면 전환 (엔진 확정): ${e.fromName} → ${e.name}.${e.announce ? ` ${e.announce}` : ''} 세계의 공기가 바뀌는 순간을 서술의 중심에 둔다 — 빛·소리·사람들의 태도가 달라진다. 이번 서술부터 새 국면의 문체로: ${ph?.tone ?? ''}`];
  });
}
