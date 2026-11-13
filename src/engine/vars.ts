/** 세계 수치 + 엔진이 두는 긴장 축 (v0.113, 설계 v6 3.4절) */
import type { WorldPackage, WorldVar } from './schema';

export const TENSION = 'drama';
export const TENSION_START = 2;
export const TENSION_VAR: WorldVar = {
  id: TENSION, name: '긴장', initial: TENSION_START, min: 0, max: 10, visible: true,
  labels: [[0, '고요'], [3, '술렁임'], [5, '팽팽함'], [7, '폭발 직전'], [9, '파국 직전']],
};
/** 세계 수치 + 긴장 (세계가 tension을 직접 정했으면 그것을 쓴다) */
export function worldVars(world: Pick<WorldPackage, 'vars'>): WorldVar[] {
  const vs = world.vars ?? [];
  return vs.some((v) => v.id === TENSION) ? vs : [...vs, TENSION_VAR];
}
