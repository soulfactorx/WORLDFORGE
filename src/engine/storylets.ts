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

/**
 * 임무 → 갈래 카드 초안 (v0.115, 설계 v6 6장): 단계마다 카드 한 장 — 접근법이 갈림길이 되고, 성공하면 그 단계가 끝난다.
 * 조우·장면으로 풀리는 단계(via)와 이미 카드가 있는 단계는 건너뛴다. 제작자가 다듬는 초안이다 (갈림길을 더하고, 걸린 것을 가르고).
 */
export function questDraftCards(world: WorldPackage): Storylet[] {
  const have = new Set((world.storylets ?? []).flatMap((c) => (c.when && 'questStage' in c.when ? [`${c.when.questStage}#${c.when.is}`] : [])));
  const ids = new Set((world.storylets ?? []).map((c) => c.id));
  const out: Storylet[] = [];
  for (const q of world.quests ?? []) {
    q.stages.forEach((st, i) => {
      if (st.via?.encounter || st.via?.scene || have.has(`${q.id}#${i}`)) return;
      let id = `card/${q.id.replace(/^[a-z]+\//, '').replace(/[^a-z0-9_-]/gi, '-')}-${i + 1}`;
      while (ids.has(id)) id += 'x';
      ids.add(id);
      const advance = [{ advanceQuest: q.id }];
      const ways = (q.approaches ?? []).slice(0, 3).map((a, j) => ({
        id: `way${j + 1}`, label: a.hint.slice(0, 50),
        ...(a.risk ? { stake: 'escalate' } : {}),
        ...(a.skills?.[0] ? { check: { skill: a.skills[0], dc: 'medium' as const } } : {}),
        success: advance,
      }));
      const options = ways.length ? ways : [{ id: 'go', label: st.objective.slice(0, 50), success: advance }];
      options.push({ id: 'later', label: '지금은 물러나 다른 길을 찾는다', stake: 'defuse' } as (typeof options)[number]);
      out.push({ id, title: `${q.name} ${i + 1}: ${st.objective.slice(0, 30)}`, quest: q.id, tags: [q.kind === 'main' ? 'main' : 'side'],
        when: { questStage: q.id, is: i }, situation: `${st.objective}${q.motive ? ` — ${q.motive}` : ''}`, options });
    });
  }
  return out;
}
