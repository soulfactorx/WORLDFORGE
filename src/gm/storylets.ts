/**
 * 갈래 카드 → 이벤트 (v0.115, 설계 v6 M5).
 *  - 펼치기: 예약된 카드(후폭풍·다른 길) > GM이 고른 카드 > 잔잔할 때 엔진이 뽑은 카드
 *  - 고르기: 갈림길의 판정(3단) → 성공·대가·실패의 효과 → 후폭풍 예약. 걸린 것은 부르는 쪽이 stakeEvents로 적용한다.
 */
import { checkModifier } from '../engine/character/sheet';
import type { SkillId } from '../engine/character/rules';
import { withDcMod } from '../engine/difficulty';
import { checkTier, DC_TIERS, d20Test, TIER_LABEL } from '../engine/dice/dice';
import { createRng } from '../engine/dice/rng';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState } from '../engine/state/state';
import { activeStorylet, drawStorylet, dueStorylet, eligibleStorylets, optionKey, parseOptionKey } from '../engine/storylets';
import { presentCharacters } from './context';
import { effectEvents } from './story';
import { costOf, failForwardOf } from './tiers';

type Tier = 'success' | 'cost' | 'fail';

/** 갈림길을 고른다 — 판정 · 효과 · 후폭풍. stake는 부르는 쪽이 적용한다 */
export function chooseOptionEvents(world: WorldPackage, state: GameState, key: string): { events: GameEvent[]; lines: string[]; tier?: Tier; stake?: string; encounterId?: string } | null {
  const hit = parseOptionKey(world, key);
  if (!hit || activeStorylet(world, state)?.id !== hit.card.id) return null;
  const { card, option } = hit;
  const out: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { out.push(e); s = applyEvent(s, e, state.turn); };
  const lines: string[] = [];
  let tier: Tier | undefined;
  let encounterId: string | undefined;
  if (option.check) {
    const rng = createRng(s.rngState);
    const spec = { kind: 'skill' as const, skill: option.check.skill as SkillId };
    const breakdown = checkModifier(s.player.sheet, spec);
    const base = DC_TIERS[option.check.dc] ?? 15;
    const result = d20Test(rng, breakdown.total, withDcMod(base, s.dcMod), 'normal');
    push({ type: 'check_rolled', skill: breakdown.label, reason: `${card.title}: ${option.label}`, result, rngState: rng.state(), breakdown, tiered: true, ...(s.dcMod ? { dcBase: base } : {}) });
    tier = checkTier(result);
    lines.push(`판정 (엔진 확정): ${breakdown.label} ${TIER_LABEL[tier]}`);
  }
  const ok = tier !== 'fail';
  if (ok && option.success?.length) effectEvents(world, s, option.success, card.title).forEach(push);
  const trng = createRng((s.rngState ^ Math.imul(state.turn + 13, 2654435761)) >>> 0);
  const ctx = { skillOrAbility: option.check?.skill, present: presentCharacters(world, s) };
  if (tier === 'cost') {
    if (option.cost?.length) { effectEvents(world, s, option.cost, `${card.title}: 대가`).forEach(push); lines.push('대가 (엔진 확정): 갈림길에 정해진 대가를 치른다'); }
    else { const c = costOf(world, s, trng, ctx); c.events.forEach(push); lines.push(`대가 (엔진 확정): ${c.line}`); }
  } else if (tier === 'fail') {
    if (option.fail?.length) { effectEvents(world, s, option.fail, `${card.title}: 실패`).forEach(push); lines.push('실패 — 상황이 바뀐다 (엔진 확정)'); }
    else { const f = failForwardOf(world, s, trng, ctx); f.events.forEach(push); encounterId = f.encounterId; lines.push(`실패 — 상황이 바뀐다 (엔진 확정): ${f.line}`); }
  }
  const text = ok ? option.successText : option.failText;
  if (text) lines.push(`이 갈림길의 결과: ${text}`);
  push({ type: 'storylet_chosen', id: card.id, optionId: option.id, label: option.label, ...(tier ? { tier } : {}) });
  if (ok) for (const f of option.fallout ?? []) push({ type: 'storylet_queued', id: f.storylet, due: state.turn + Math.max(1, f.inTurns) });
  lines.unshift(`플레이어가 갈래 카드 「${card.title}」에서 고른 길: ${option.label}`);
  return { events: out, lines, ...(tier ? { tier } : {}), ...(option.stake ? { stake: option.stake } : {}), ...(encounterId ? { encounterId } : {}) };
}

/**
 * 이 턴에 펼칠 카드: 예약된 것 > GM이 고른 것(덱에 있을 때) > 잔잔하면 엔진이 뽑는다.
 * 전투·장면이 시작됐거나 이미 펼친 카드가 있으면 펼치지 않는다 (예약된 것은 예외 — 후폭풍은 미루지 않는다).
 */
export function openStoryletEvents(world: WorldPackage, s: GameState, opts: { pick?: string; quiet: boolean }): GameEvent[] {
  if (!world.storylets?.length || s.combat || s.scene || s.playerDead) return [];
  const due = dueStorylet(world, s);
  if (due) return [{ type: 'storylet_opened', id: due.id, title: due.title }];
  if (activeStorylet(world, s)) return [];
  const deck = eligibleStorylets(world, s);
  const picked = opts.pick ? deck.find((c) => c.id === opts.pick) : undefined;
  if (picked) return [{ type: 'storylet_opened', id: picked.id, title: picked.title }];
  if (!opts.quiet) return [];
  const drawn = drawStorylet(deck, createRng((s.rngState ^ Math.imul(s.turn + 17, 40503)) >>> 0).next());
  return drawn ? [{ type: 'storylet_opened', id: drawn.id, title: drawn.title }] : [];
}

/** 서술자에게: 이번에 펼쳐진 카드 */
export function openedLines(world: WorldPackage, events: GameEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type !== 'storylet_opened') return [];
    const c = world.storylets?.find((x) => x.id === e.id);
    return c ? [`갈래 카드가 펼쳐진다 (엔진 확정): 「${c.title}」 — ${c.situation} 서술은 이 상황이 플레이어 앞에 펼쳐지는 순간을 그리고, 플레이어가 정해야 하는 갈림길 앞에서 멈춘다 (대신 고르지 않는다).`] : [];
  });
}

/** 선택지를 만드는 쪽에게: 지금 펼쳐진 카드의 갈림길 */
export function cardChoiceBlock(world: WorldPackage, s: GameState): string {
  const c = activeStorylet(world, s);
  if (!c) return '';
  return `\n\n## 지금 펼쳐진 갈래 카드: 「${c.title}」 (선택지에 갈림길을 하나씩 담는다 — option에 그 ID, stake에 그 갈림길의 걸린 것. 글은 지금 장면에 맞게 다듬되 뜻은 바꾸지 않는다. 나머지 자리에는 다른 선택지를 둘 수 있다)\n${c.options.map((o) => `- ${optionKey(c.id, o.id)}: ${o.label}${o.stake ? ` [stake ${o.stake}]` : ''}${o.check ? ` [판정 ${o.check.skill}]` : ''}`).join('\n')}`;
}

/** GM 판단에게: 지금 펼칠 수 있는 카드 (덱) */
export function deckBlock(world: WorldPackage, s: GameState): string {
  if (!world.storylets?.length) return '';
  const active = activeStorylet(world, s);
  const deck = eligibleStorylets(world, s).slice(0, 8);
  return `\n\n## 갈래 카드 덱 (엔진)${active ? `\n지금 펼쳐져 있는 카드: 「${active.title}」 — 플레이어가 아직 고르지 않았다` : ''}\n${deck.length ? `펼칠 수 있는 카드 (지금 장면·강도 곡선에 맞으면 storylet에 ID 하나. 플레이어가 하던 일이 한창이면 비운다):\n${deck.map((c) => `- ${c.id}: ${c.title}${c.tags?.length ? ` [${c.tags.join(',')}]` : ''} — ${c.situation.slice(0, 90)}`).join('\n')}` : '(지금 펼칠 수 있는 카드 없음)'}`;
}
