/**
 * 판정 3단 결과의 대가와 전개 (v0.112, 설계 v6 3.2절).
 * "대가 있는 성공"이면 대가 하나를, "실패"면 상황을 바꾸는 전개 하나를 엔진이 고른다. AI는 그것을 연출만 한다.
 * 같은 상태·같은 주사위에서는 늘 같은 결과다 (rng는 호출하는 쪽이 세이브의 주사위 상태로 만든다).
 */
import { genreProfile } from '../engine/genre';
import type { Rng } from '../engine/dice/rng';
import type { Character, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';
import { displayName } from '../engine/names';
import { josa } from '../engine/text/josa';
import { relationshipEvents } from './relationship';
import { availableEncounters } from './combat';
import { currencyName } from './economy';

/** 몸을 쓰는 판정 (다칠 수 있다) */
const PHYSICAL = new Set(['athletics', 'acrobatics', 'stealth', 'sleight_of_hand', 'survival', 'str', 'dex', 'con']);

export interface TierOutcome {
  /** 엔진이 확정한 상태 변화 */
  events: GameEvent[];
  /** 서술자에게 전할 한 줄 */
  line: string;
  /** 대가·전개의 종류 (디버그·시험용) */
  kind: string;
  /** 실패가 부른 조우 (호출하는 쪽이 시작한다) */
  encounterId?: string;
}

interface Ctx { skillOrAbility?: string; present: Character[] }

const pick = <T,>(rng: Rng, xs: T[]): T => xs[Math.floor(rng.next() * xs.length) % xs.length]!;
const witness = (s: GameState, ctx: Ctx) => ctx.present.filter((c) => !s.party[c.id] && !s.deadNpcs.includes(c.id));

/** 대가 있는 성공: 원하는 것은 얻되 대가 하나 */
export function costOf(world: WorldPackage, s: GameState, rng: Rng, ctx: Ctx): TierOutcome {
  const options: (() => TierOutcome)[] = [
    () => ({ kind: 'time', line: '생각보다 훨씬 오래 걸렸다 (1시간이 더 흐른다)', events: [{ type: 'time_advanced', minutes: 60 }] }),
  ];
  const seen = witness(s, ctx);
  if (seen.length) options.push(() => {
    const npc = pick(rng, seen);
    return { kind: 'seen', line: `${josa(displayName(s, npc), '이/가')} 그 모습을 지켜봤다 — 그를 대하는 눈빛이 조금 달라진다`, events: relationshipEvents(world, s, npc, { trust: -2 }, '판정의 대가: 그 모습을 봤다') };
  });
  if (PHYSICAL.has(ctx.skillOrAbility ?? '') && s.player.sheet.hp > 2) options.push(() => {
    const n = Math.min(s.player.sheet.hp - 1, 1 + Math.floor(rng.next() * 4) + Math.floor(s.player.sheet.level / 3));
    return { kind: 'hurt', line: `몸이 상했다 (HP −${n})`, events: [{ type: 'hp_changed', delta: -n, reason: '판정의 대가' }] };
  });
  if (s.money > 0) options.push(() => {
    const n = Math.min(s.money, 3 + Math.floor(rng.next() * 10));
    return { kind: 'money', line: `값을 치렀다 (${currencyName(world)} −${n})`, events: [{ type: 'money_changed', delta: -n, reason: '판정의 대가', currency: currencyName(world) }] };
  });
  return pick(rng, options)();
}

/** 실패: 원하는 것을 못 얻고, 상황이 바뀐다 */
export function failForwardOf(world: WorldPackage, s: GameState, rng: Rng, ctx: Ctx): TierOutcome {
  const options: (() => TierOutcome)[] = [
    () => ({ kind: 'lost', line: '기회가 지나갔다 — 같은 방법은 더 통하지 않는다. 다른 길을 찾아야 한다 (1시간이 흐른다)', events: [{ type: 'time_advanced', minutes: 60 }] }),
  ];
  const seen = witness(s, ctx);
  if (seen.length) options.push(() => {
    const npc = pick(rng, seen);
    return { kind: 'wary', line: `${josa(displayName(s, npc), '이/가')} 경계하기 시작한다 — 무엇을 하려 했는지 눈치챈 것 같다`, events: relationshipEvents(world, s, npc, { trust: -4, fear: 2 }, '판정 실패: 경계한다') };
  });
  if (PHYSICAL.has(ctx.skillOrAbility ?? '') && s.player.sheet.hp > 2) options.push(() => {
    const n = Math.min(s.player.sheet.hp - 1, 2 + Math.floor(rng.next() * 6));
    return { kind: 'hurt', line: `일이 틀어지며 다쳤다 (HP −${n})`, events: [{ type: 'hp_changed', delta: -n, reason: '판정 실패' }] };
  });
  // 실패가 소란을 부른다: 이 장소에 일어날 수 있는 조우가 있으면 (전투를 드물게 쓰는 장르·초반 세 턴은 빼고)
  const encs = s.turn > 3 && genreProfile(world).combat !== 'rare' ? availableEncounters(world, s) : [];
  if (encs.length && rng.next() < 0.5) options.push(() => {
    const e = pick(rng, encs);
    return { kind: 'ambush', line: `실패가 소란을 불렀다 — ${e.name}`, events: [], encounterId: e.id };
  });
  return pick(rng, options)();
}
