import { describe, expect, it } from 'vitest';
import { addScenario, SCENARIO_DRAFT_SCHEMA, type ScenarioDraft, WORLD_DRAFT_SCHEMA, type WorldDraft, worldFromDraft } from './draft';
import { validateWorld } from '../../engine/package/validate';

/** AI 응답이 스키마를 다 지키지 않아도(필드 누락·빈 목록) 초안 변환이 죽지 않는다 (v0.46.3) */
type S = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, S>; items?: S; anyOf?: S[] };
function gen(s: S, r: () => number, depth = 0): unknown {
  if (s.anyOf) return gen(s.anyOf[Math.floor(r() * s.anyOf.length)]!, r, depth);
  if (s.enum) return s.enum[Math.floor(r() * s.enum.length)];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) if (r() < 0.75) o[k] = gen(v, r, depth + 1);
    return o;
  }
  if (t === 'array') return depth > 6 ? [] : Array.from({ length: Math.floor(r() * 4) }, () => gen(s.items ?? {}, r, depth + 1));
  if (t === 'integer' || t === 'number') return Math.floor(r() * 7) - 1;
  if (t === 'boolean') return r() < 0.5;
  return ['a', 'b', 'c', '', '광장'][Math.floor(r() * 5)];
}
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

describe('초안 변환 퍼징', () => {
  it('무작위로 필드가 빠진 세계·이야기 초안 300개', () => {
    for (let i = 0; i < 300; i++) {
      const r = rng(i + 1);
      const wd = gen(WORLD_DRAFT_SCHEMA as S, r) as WorldDraft;
      let w;
      w = worldFromDraft(wd, { id: `f${i}`, contentRating: 'teen' }).world;
      const sd = gen(SCENARIO_DRAFT_SCHEMA as S, r) as ScenarioDraft;
      w = addScenario(w, sd).world;
      expect(() => validateWorld(w)).not.toThrow();
    }
  });
});
