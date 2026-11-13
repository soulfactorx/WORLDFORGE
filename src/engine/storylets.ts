/**
 * 갈래 카드 덱 (v0.115, 설계 v6 M5 3.5절) — 순수 함수.
 * 이야기는 줄이 아니라 덱이다: 조건(국면·축·관계·원장·플래그)이 맞는 카드들 가운데서 다음 장면을 뽑는다.
 * 같은 세계라도 플레이어의 선택에 따라 덱이 다른 카드로 채워진다.
 */
import { currentPhase } from './phase';
import { evalCondition } from './scenario';
import type { Storylet, StoryletOption, WorldPackage } from './schema';
import type { GameState } from './state/state';

/** 펼친 카드를 고르지 않고 두면 이 턴 수 뒤 접힌다 */
export const CARD_TURNS = 3;

export const storyletOf = (world: WorldPackage, id: string | undefined) => (id ? world.storylets?.find((x) => x.id === id) : undefined);
export const optionKey = (card: string, opt: string) => `${card}#${opt}`;
export function parseOptionKey(world: WorldPackage, key: string | undefined): { card: Storylet; option: StoryletOption } | null {
  if (!key) return null;
  const i = key.lastIndexOf('#');
  const card = storyletOf(world, key.slice(0, i));
  const option = card?.options.find((o) => o.id === key.slice(i + 1));
  return card && option ? { card, option } : null;
}

/** 지금 펼쳐져 고르기를 기다리는 카드 */
export function activeStorylet(world: WorldPackage, s: GameState): Storylet | undefined {
  const a = s.activeStorylet;
  if (!a || s.turn - a.turn > CARD_TURNS) return undefined;
  return storyletOf(world, a.id);
}

/** 이 국면에서 반전 카드를 이미 썼는가 (반전 예산: 국면마다 하나) */
function twistSpent(world: WorldPackage, s: GameState): boolean {
  const since = s.phaseSince ?? 0;
  return Object.entries(s.storylets ?? {}).some(([id, r]) => (r.done ?? -1) >= since && storyletOf(world, id)?.tags?.includes('twist'));
}

/** 지금 덱에 있는 카드 (펼칠 수 있는 것) */
export function eligibleStorylets(world: WorldPackage, s: GameState): Storylet[] {
  const phase = currentPhase(world, s)?.id;
  const twistOk = !twistSpent(world, s);
  const active = activeStorylet(world, s)?.id;
  return (world.storylets ?? []).filter((c) => {
    if (c.id === active || !c.options.length) return false;
    const r = s.storylets?.[c.id];
    if (r?.done !== undefined && (!c.repeat || s.turn - r.done < c.repeat.after)) return false;
    if (c.phases?.length && (!phase || !c.phases.includes(phase))) return false;
    if (c.locationId && c.locationId !== s.player.locationId) return false;
    if (c.tags?.includes('twist') && !twistOk) return false;
    return !c.when || evalCondition(world, s, c.when);
  });
}

/** 카드 하나를 무게대로 뽑는다 (u: 0~1 난수). 조건이 있는 카드는 기본 무게가 2 — 플레이어가 만든 상황이 먼저 */
export function drawStorylet(cards: Storylet[], u: number): Storylet | undefined {
  const w = (c: Storylet) => c.weight ?? (c.when ? 2 : 1);
  const total = cards.reduce((a, c) => a + w(c), 0);
  if (!total) return undefined;
  let x = u * total;
  return cards.find((c) => (x -= w(c)) < 0) ?? cards.at(-1);
}

/** 예약된 카드 중 이 턴에 펼칠 것 (후폭풍·다른 길) */
export function dueStorylet(world: WorldPackage, s: GameState): Storylet | undefined {
  const q = (s.storyletQueue ?? []).find((x) => x.due <= s.turn);
  return q ? storyletOf(world, q.id) : undefined;
}
