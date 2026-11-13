/**
 * 기류와 국면 (v0.113, 설계 v6 M3 3.4절) — 순수 함수.
 *  - 긴장(tension, 0~10): 모든 세계에 있는 기류 축. 실패·전투·징조·사건으로 오르고, 휴식·해결로 내린다.
 *  - 국면: 축과 이야기 상태로 정해지는 세계의 공기. 바뀌면 문체·음악·색·인물 태도·닫힌 장소가 함께 바뀐다.
 *  - 강도 곡선: 최근 긴장의 흐름을 보고 "오름 · 정점 · 숨 돌림"을 GM에게 알린다.
 */
import { genreProfile } from './genre';
import { evalCondition } from './scenario';
import type { Phase, WorldPackage } from './schema';
import { checkTier } from './dice/dice';
import type { GameEvent } from './state/events';
import type { GameState } from './state/state';

export { TENSION, TENSION_START, TENSION_VAR, worldVars } from './vars';
import { TENSION, TENSION_START } from './vars';
export const tensionOf = (s: GameState) => s.vars?.[TENSION] ?? TENSION_START;

/** 국면에 들어온 뒤 이 턴 수 안에는 다시 옮기지 않는다 (긴장이 문턱에서 오르내릴 때 깜빡이지 않게) */
export const MIN_PHASE_TURNS = 3;

/** 국면을 정하지 않은 세계의 기본 국면 셋 — 긴장으로 움직인다. 위에서부터 고른다 */
export function defaultPhases(world: WorldPackage): Phase[] {
  const rare = genreProfile(world).combat === 'rare';
  return [
    { id: 'phase/crisis', name: '위기', tint: 'dark', music: rare ? 'tense' : 'dark', enter: { var: TENSION, gte: 7 },
      tone: '위기 — 모든 것이 터지기 직전이다. 짧은 문장, 다급한 소리, 선택을 재촉하는 압박. 인물들은 본심을 드러내고, 미뤄 둔 일이 한꺼번에 몰려온다.',
      announce: '공기가 무거워졌다 — 이제 무엇이든 터질 수 있다.' },
    { id: 'phase/stir', name: '술렁임', tint: 'tense', music: 'tense', enter: { all: [{ var: TENSION, gte: 4 }, { var: TENSION, lte: 6 }] },
      tone: '술렁임 — 평온 아래로 불안이 번진다. 소문, 엇갈리는 시선, 서두르는 발걸음. 문장은 조금 빨라지고, 사람들은 편을 고르기 시작한다.',
      announce: '무언가 달라졌다 — 사람들이 술렁이기 시작한다.' },
    { id: 'phase/calm', name: '평온', tint: 'calm', music: 'calm', enter: { var: TENSION, lte: 3 },
      tone: '평온 — 일상의 결과 사람 사이의 온기를 살린다. 여유 있는 문장, 작은 웃음과 호기심. 그러나 그 아래 씨앗 하나는 늘 보인다.',
      announce: '숨을 돌릴 틈이 생겼다.' },
  ];
}

export function phasesOf(world: WorldPackage): Phase[] {
  if (world.phases?.length) return world.phases;
  return world.autoPhases === false ? [] : defaultPhases(world);
}
export function currentPhase(world: WorldPackage, s: GameState): Phase | undefined {
  const ps = phasesOf(world);
  return ps.find((p) => p.id === s.phase);
}

/** 지금 옮겨 갈 국면 (없으면 undefined). 처음에는 들어갈 수 있는 첫 국면, 없으면 첫 국면 */
export function nextPhase(world: WorldPackage, s: GameState): Phase | undefined {
  const ps = phasesOf(world);
  if (!ps.length) return undefined;
  if (!s.phase) return ps.find((p) => !p.from?.length && evalCondition(world, s, p.enter)) ?? ps[0];
  if (s.phaseSince !== undefined && s.turn - s.phaseSince < MIN_PHASE_TURNS) return undefined;
  const hit = ps.find((p) => (!p.from?.length || p.from.includes(s.phase!)) && evalCondition(world, s, p.enter));
  return hit && hit.id !== s.phase ? hit : undefined;
}

/**
 * 이 턴에 일어난 일로 긴장이 얼마나 움직이는가 (엔진 규칙).
 * 실패 +1 · 전투 시작 +1 · 기습 +1 · 징조 +1 · 세상의 사건 +1 · 임무 실패 +2 / 임무 완료 −2 · 긴 휴식 −2 · 짧은 휴식 −1 · 전투 승리 −1 · 패배 +1
 */
export function tensionDelta(events: GameEvent[]): { delta: number; why: string[] } {
  let delta = 0; const why: string[] = [];
  const add = (n: number, w: string) => { delta += n; why.push(`${n > 0 ? '+' : ''}${n} ${w}`); };
  for (const e of events) {
    if (e.type === 'check_rolled' && e.tiered && checkTier(e.result) === 'fail') add(1, '실패');
    else if (e.type === 'combat_started') add(1, '전투');
    else if (e.type === 'clock_reached') add(1, '징조');
    else if (e.type === 'world_event' && !e.skipped) add(1, '세상의 사건');
    else if (e.type === 'quest_failed') add(2, '임무 실패');
    else if (e.type === 'quest_completed') add(-2, '임무 완료');
    else if (e.type === 'rested') add(e.kind === 'long' ? -2 : -1, '휴식');
    else if (e.type === 'combat_ended') add(e.outcome === 'victory' ? -1 : 1, e.outcome === 'victory' ? '승리' : '패배·도주');
  }
  return { delta, why };
}

/** 강도 곡선 (최근 긴장의 흐름) → GM에게 주는 한 줄. 특별하지 않으면 null */
export function intensityHint(s: GameState): { kind: 'rise' | 'peak' | 'breather' | 'build'; text: string } | null {
  const t = [...(s.tensionTrail ?? []), tensionOf(s)].slice(-5);
  const last = t.at(-1)!;
  if (t.length >= 3 && t.slice(-3).every((x) => x >= 7)) return { kind: 'peak', text: '정점 — 쌓인 것을 지금 터뜨린다 (대결·폭로·붕괴). 터진 뒤에는 숨 돌릴 틈을 준다.' };
  if (t.length >= 4 && t.slice(-4).every((x) => x <= 2)) return { kind: 'rise', text: '너무 잔잔하다 — 오름: 새 위협·요구·소식으로 긴장을 끌어올린다.' };
  const peak = Math.max(...t);
  if (peak >= 7 && last <= peak - 3) return { kind: 'breather', text: '숨 돌림 — 큰일이 지나갔다. 인물과 가까워지는 장면, 그리고 다음 오름의 씨앗 하나.' };
  if (t.length >= 3 && last >= t[0]! + 2) return { kind: 'build', text: '오름 — 압박이 쌓이고 있다. 놓치지 말고 한 겹 더 조인다.' };
  return null;
}

/** 국면이 닫은 장소인가 */
export function closedHere(world: WorldPackage, s: GameState, locationId: string): boolean {
  return !!currentPhase(world, s)?.closed?.includes(locationId);
}
