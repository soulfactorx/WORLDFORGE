import { type Rng, rollDie } from './rng';

export interface DiceRoll {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
}

const NOTATION = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

/** "2d6+3", "d20", "1d8-1" 형식의 주사위 표기를 굴린다. */
export function roll(rng: Rng, notation: string): DiceRoll {
  const m = NOTATION.exec(notation);
  if (!m) throw new Error(`invalid dice notation: ${notation}`);
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  const modifier = m[3] ? Number(m[3].replace(/\s/g, '')) : 0;
  if (count < 1 || count > 100) throw new Error(`dice count out of range: ${count}`);
  const rolls = Array.from({ length: count }, () => rollDie(rng, sides));
  return { notation, rolls, modifier, total: rolls.reduce((a, b) => a + b, 0) + modifier };
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface D20Test {
  rolls: number[];
  kept: number;
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
  natural20: boolean;
  natural1: boolean;
}

/**
 * d20 판정 (능력 판정 / 내성 굴림 / 명중 굴림 공통).
 * 이점/불리점은 2d20 중 높은/낮은 값을 사용한다.
 */
export function d20Test(rng: Rng, modifier: number, dc: number, mode: RollMode = 'normal'): D20Test {
  const rolls = mode === 'normal' ? [rollDie(rng, 20)] : [rollDie(rng, 20), rollDie(rng, 20)];
  const kept = mode === 'advantage' ? Math.max(...rolls) : mode === 'disadvantage' ? Math.min(...rolls) : rolls[0]!;
  const total = kept + modifier;
  return { rolls, kept, modifier, total, dc, success: total >= dc, natural20: kept === 20, natural1: kept === 1 };
}

/** 능력치 → 수정치 */
export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);

/** AI가 DC를 임의 숫자로 지정하지 못하도록 난이도 등급만 허용한다. */
export const DC_TIERS = { very_easy: 5, easy: 10, medium: 15, hard: 20, very_hard: 25, nearly_impossible: 30 } as const;
export type DcTier = keyof typeof DC_TIERS;
