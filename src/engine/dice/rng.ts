/**
 * 시드 기반 결정적 난수 생성기 (mulberry32).
 * 같은 시드 + 같은 호출 순서 → 항상 같은 결과. 리플레이·버그 재현·되돌리기에 사용한다.
 * Math.random()은 엔진 코드에서 사용하지 않는다.
 */
export interface Rng {
  /** [0, 1) 실수 */
  next(): number;
  /** 현재 내부 상태 (세이브에 저장해 이어서 굴릴 수 있음) */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state: () => s,
  };
}

/** 1..sides 정수 */
export function rollDie(rng: Rng, sides: number): number {
  if (!Number.isInteger(sides) || sides < 1) throw new Error(`invalid die: d${sides}`);
  return Math.floor(rng.next() * sides) + 1;
}
