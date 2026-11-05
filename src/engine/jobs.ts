/**
 * 의뢰판 (설계 v3 6.3) — 순수 함수. 반복 가능한 의뢰의 상태와 토벌 조우.
 */
import { type MonsterDef, MONSTERS } from './combat/monsters';
import { evalCondition } from './scenario';
import type { Encounter, Job, WorldPackage } from './schema';
import type { GameState } from './state/state';

export type JobStatus = 'available' | 'locked' | 'active' | 'done';

export function boardHere(world: WorldPackage, state: GameState) {
  return world.locations.find((l) => l.id === state.player.locationId)?.board;
}

export function allJobs(world: WorldPackage): Job[] {
  return world.locations.flatMap((l) => l.board?.jobs ?? []);
}

export function jobStatus(world: WorldPackage, state: GameState, job: Job): JobStatus {
  const j = state.jobs?.[job.id];
  if (j?.active) return 'active';
  if (j && j.done > 0 && job.repeatable === false) return 'done';
  if (job.requires && !evalCondition(world, state, job.requires)) return 'locked';
  return 'available';
}

/** 진행 중인 의뢰의 토벌 조우 ID */
export const jobEncounterId = (job: Job, instance: number) => `${job.id}#${instance}`;

/** 진행 중인 토벌 의뢰가 만든 조우 (아직 이기지 않은 것) */
export function jobEncounters(world: WorldPackage, state: GameState): Encounter[] {
  return allJobs(world).flatMap((job) => {
    const a = state.jobs?.[job.id]?.active;
    if (!a || !job.enemies?.length) return [];
    const id = jobEncounterId(job, a.instance);
    if (state.clearedEncounters.includes(id)) return [];
    return [{ id, name: job.name, locationId: job.locationId, enemies: job.enemies, trigger: job.hint ?? `의뢰 "${job.name}"의 표적이 이곳에 있다. 플레이어가 찾아 나서거나 마주치면 싸움이 시작된다.` }];
  });
}

/** 토벌 의뢰의 적 경험치 합 (보상 기준) */
export const jobThreatXp = (job: Job, table: Record<string, MonsterDef> = MONSTERS) => (job.enemies ?? []).reduce((s, e) => s + (table[e.monsterId]?.xp ?? 0), 0);

/** 보상이 정해지지 않은 의뢰의 기본 보상: 위협도에 비례한 돈 */
export function jobRewards(job: Job, table: Record<string, MonsterDef> = MONSTERS) {
  if (job.rewards) return job.rewards;
  const xp = jobThreatXp(job, table);
  return { money: xp ? Math.max(10, Math.round(xp / 4)) : 25 };
}

/** 이번 평가에서 끝나거나 실패한 의뢰 */
export interface JobTransition { job: Job; kind: 'completed' | 'failed'; reason?: string }
export function jobTransitions(world: WorldPackage, state: GameState): JobTransition[] {
  return allJobs(world).flatMap((job): JobTransition[] => {
    const a = state.jobs?.[job.id]?.active;
    if (!a) return [];
    const done = job.enemies?.length ? state.clearedEncounters.includes(jobEncounterId(job, a.instance)) : !!job.complete && evalCondition(world, state, job.complete);
    if (done) return [{ job, kind: 'completed' }];
    if (job.timeLimit && state.worldMinutes - a.acceptedAt > job.timeLimit.days * 1440) return [{ job, kind: 'failed', reason: '기한이 지났다' }];
    return [];
  });
}
