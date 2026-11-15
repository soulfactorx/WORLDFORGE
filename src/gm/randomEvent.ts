/**
 * 돌발 사건 적용 (v0.128): 엔진이 굴린 돌발 사건을 상태에 반영하고, 서술 AI에게 줄 줄을 만든다.
 * 두 턴 방식(한 번 호출 · 정확 모드)이 함께 쓴다.
 * GM 즉흥 등장: 만남이면 세계에 맞는 엑스트라 인물을, 기습이면 세계에 맞는 적을 서술 AI가 지어낸다 (세계의 중요한 사실은 새로 만들지 않는다).
 */
import { createRng } from '../engine/dice/rng';
import { rollLoot } from '../engine/items';
import { ambushEnemies, improvOf } from '../engine/randomEvents';
import type { RandomEvent, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';
import { currentDay } from '../engine/world';
import { beginAdhocEncounter } from './combat';
import { effectEvents } from './story';

/** 즉흥 등장 안내 (서술 AI에게) */
export function improvHint(world: WorldPackage, kind: RandomEvent['kind']): string {
  const im = improvOf(world);
  if (kind === 'meeting') return ` — GM 즉흥 등장: 이 세계에 어울리는 이름 없는 엑스트라 한 명을 지어내 등장시킨다${im.cast?.trim() ? ` (이 세계에 흔한 사람들: ${im.cast.trim()})` : ''}. 그 인물이 원하는 것 하나와 플레이어에게 건네는 말·부탁·제안으로 작은 일을 만든다. 세계의 중요한 사실·주요 인물의 비밀은 새로 만들지 않는다.`;
  if (kind === 'ambush') return `${im.foes?.trim() ? ` 적은 이 세계에 흔한 것으로 묘사한다 (예: ${im.foes.trim()}).` : ''}`;
  return '';
}

/**
 * 돌발 사건을 반영한다. push는 이벤트를 상태에 적용하는 함수.
 * 돌려주는 것: 서술 AI에게 줄 줄들, 기습으로 전투가 시작됐는지
 */
export function applyRandomEvent(world: WorldPackage, s: GameState, rev: RandomEvent, turn: number, push: (e: GameEvent) => void): { lines: string[]; ambushed: boolean } {
  const lines: string[] = [];
  const rrng = createRng((s.rngState + Math.imul(turn + 7, 40503)) >>> 0);
  push({ type: 'random_event', eventId: rev.id, name: rev.name, kind: rev.kind, text: rev.text, day: currentDay(s) });
  effectEvents(world, s, rev.effects ?? [], rev.name).forEach(push);
  if (rev.kind === 'ambush') {
    const enemies = rev.enemies?.length ? rev.enemies : ambushEnemies(world, s, rrng);
    if (enemies.length) {
      beginAdhocEncounter(world, s, { id: `${rev.id}#${turn}`, enemies }, turn).forEach(push);
      lines.push(`돌발 사건 — 기습 (엔진 확정): ${rev.text} 전투가 시작된다.${improvHint(world, 'ambush')} 서술은 적이 나타나는 순간에서 멈춘다 (결과를 서술하지 않는다).`);
      return { lines, ambushed: true };
    }
    return { lines, ambushed: false };
  }
  if (rev.kind === 'opportunity' && !rev.effects?.length) {
    const found = rollLoot(world, rrng, { level: s.player.sheet.level, threatXp: 0, levelSpan: 1, boss: true });
    if (found) { push({ type: 'item_gained', itemId: found.id, name: found.name, n: 1, reason: rev.name }); lines.push(`돌발 사건 (엔진 확정): ${rev.text} — ${found.name}을(를) 얻었다`); }
    else lines.push(`돌발 사건 (엔진 확정): ${rev.text}`);
  } else if (rev.kind === 'news' && !rev.effects?.length) {
    const known = new Set(s.beliefs.filter((b) => b.holder === 'player').map((b) => b.claim));
    const rumors = world.beliefs.filter((b) => b.holder !== 'player' && b.state === 'rumor' && !known.has(b.claim));
    const pick = rumors[Math.floor(rrng.next() * rumors.length)];
    const claim = pick && world.claims.find((c) => c.id === pick.claim);
    if (claim) { push({ type: 'knowledge_revealed', belief: { holder: 'player', claim: claim.id, state: 'rumor', source: 'rumor' }, statement: claim.statement }); lines.push(`돌발 사건 (엔진 확정): ${rev.text} — 들린 소문: "${claim.statement}" (소문일 뿐 사실인지 모른다)`); }
    else lines.push(`돌발 사건 (엔진 확정): ${rev.text} (특별한 내용은 없다 — 분위기만)`);
  } else {
    lines.push(`돌발 사건 (엔진 확정): ${rev.text}${rev.kind === 'meeting' ? improvHint(world, 'meeting') : ''}`);
  }
  return { lines, ambushed: false };
}
