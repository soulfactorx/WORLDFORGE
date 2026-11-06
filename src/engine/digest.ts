/**
 * 보상 연출 · 세션 훅 (설계 v4 E2). 모두 엔진 상태만으로 만든다 (AI 호출 없음).
 * - rewardDiff: 한 턴에 얻은 것 요약 ("이번 턴 보상")
 * - levelUpInfo: 레벨업 화면 내용 (새 능력·새 카드)
 * - todoThree: 수첩의 "지금 할 일" 세 갈래 (메인·사이드·관계)
 * - openQuestions: "궁금한 것" — 아직 확인되지 않은 알게 된 것
 * - recap: 이어하기 "지난 이야기"
 */
import { CLASS_KITS, kitCards } from './combat/cards';
import { ALL_CARDS } from './combat/combat';
import { subclassCards, subclassFeatures, pendingChoices } from './character/build';
import { knowledgeOf } from './knowledge/knowledge';
import { displayName } from './names';
import { HOSTILE_STAGES, stageFor } from './relationship';
import { activeBeats, activeQuests } from './scenario';
import type { ItemRarity, WorldPackage } from './schema';
import { awakenStage, effectiveItem, itemDef, rarityOf } from './items';
import type { GameState } from './state/state';
import { allJobs } from './jobs';
import { allTitles, rankOf } from './renown';
import { calendarDate } from './calendar';

export interface RewardLine { icon: string; text: string; rarity?: ItemRarity; itemId?: string }

/** 두 상태 사이에 플레이어가 얻은 것 (한 턴 전후) */
export function rewardDiff(world: WorldPackage, before: GameState, after: GameState): RewardLine[] {
  const out: RewardLine[] = [];
  const xp = (after.player.sheet.xp ?? 0) - (before.player.sheet.xp ?? 0);
  if (after.player.sheet.level > before.player.sheet.level) out.push({ icon: '★', text: `${after.player.sheet.level}레벨!` });
  if (xp > 0) out.push({ icon: '✦', text: `경험치 +${xp}` });
  const money = after.money - before.money;
  if (money > 0) out.push({ icon: '💰', text: `+${money}` });
  for (const [id, n] of Object.entries(after.inventory)) {
    const d = n - (before.inventory[id] ?? 0);
    const def = itemDef(world, id);
    if (d > 0) out.push({ icon: '🎒', text: `${def?.name ?? itemName(id)}${d > 1 ? ` ×${d}` : ''}`, rarity: rarityOf(def), itemId: id });
  }
  // 유물이 깨어났다
  for (const id of Object.keys(after.inventory)) {
    const def = itemDef(world, id);
    if (!def?.awaken?.length) continue;
    const b = awakenStage(world, before, def), a = awakenStage(world, after, def);
    if (a > b) out.push({ icon: '⚔', text: `${effectiveItem(world, after, def).name} — 깨어났다`, rarity: 'legendary', itemId: id });
  }
  for (const card of after.grantedCards?.player ?? []) if (!(before.grantedCards?.player ?? []).includes(card)) out.push({ icon: '🃏', text: ALL_CARDS[card]?.name ?? card });
  const known = after.beliefs.filter((b) => b.holder === 'player').length - before.beliefs.filter((b) => b.holder === 'player').length;
  if (known > 0) out.push({ icon: '📖', text: `알게 된 것 ${known}` });
  const titlesBefore = new Set(before.xpKeys ?? []);
  for (const k of after.xpKeys ?? []) if (!titlesBefore.has(k) && k.startsWith('stage:')) out.push({ icon: '♡', text: k.split(':')[2]! });
  // 칭호·등급 (설계 v4 E4)
  const defs = new Map(allTitles(world).map((t) => [t.id, t]));
  for (const id of after.titles ?? []) if (!(before.titles ?? []).includes(id)) out.push({ icon: '🏅', text: defs.get(id)?.name ?? id });
  const rb = rankOf(world, before), ra = rankOf(world, after);
  if (ra.index > rb.index) out.push({ icon: '♛', text: `${ra.label}: ${ra.name}`, rarity: 'epic' });
  for (const [id, q] of Object.entries(after.quests)) if (q.done && !q.failed && !before.quests[id]?.done) out.push({ icon: '◆', text: `완료: ${world.quests?.find((x) => x.id === id)?.name ?? id}` });
  return out;
}

const itemName = (id: string) => id.split('/').pop() ?? id;

/** 레벨업 화면: 이 레벨에서 새로 생긴 능력과 카드 */
export function levelUpInfo(before: GameState['player']['sheet'], after: GameState['player']['sheet']) {
  const kit = CLASS_KITS[after.classId];
  const levels = Array.from({ length: after.level - before.level }, (_, i) => before.level + 1 + i);
  const features = levels.flatMap((lv) => [...(kit?.features?.[lv] ?? []), ...subclassFeatures(after.subclass, lv)]);
  const had = new Set([...(kit ? kitCards(kit, before.level) : []), ...subclassCards(before.subclass, before.level)]);
  const cards = [...(kit ? kitCards(kit, after.level) : []), ...subclassCards(after.subclass, after.level)].filter((c) => !had.has(c)).map((c) => ALL_CARDS[c]).filter((c) => !!c);
  return { levels, hpGain: after.maxHp - before.maxHp, features, cards, pending: pendingChoices(after) };
}

export interface Todo { main?: string; side?: string; bond?: string }

/** 지금 할 일 세 갈래: 메인 · 사이드 · 관계 */
export function todoThree(world: WorldPackage, state: GameState): Todo {
  const qs = activeQuests(world, state);
  const mainQ = qs.find((q) => q.quest.kind !== 'side');
  const arc = (world.arcs ?? []).find((a) => state.arcs?.[a.id] && !state.arcs[a.id]!.done);
  const ch = arc ? arc.chapters[state.arcs![arc.id]!.chapter] : undefined;
  const main = mainQ ? `${mainQ.quest.name}: ${mainQ.stage.objective}` : ch ? `${arc!.name} — ${ch.goal ?? ch.name}` : undefined;
  const sideQ = qs.find((q) => q !== mainQ && q.quest.kind === 'side');
  const job = allJobs(world).find((j) => state.jobs?.[j.id]?.active);
  const side = sideQ ? `${sideQ.quest.name}: ${sideQ.stage.objective}` : job ? `의뢰: ${job.name}` : undefined;
  // 관계: 열린 관계 사건이 있으면 그 사람 (내용은 비밀 — "할 말이 있는 듯하다"), 없으면 가장 가까워질 여지가 있는 사람
  const beat = activeBeats(world, state).find((b) => !state.deadNpcs.includes(b.npcId));
  const beatNpc = beat ? world.characters.find((c) => c.id === beat.npcId) : undefined;
  let bond: string | undefined = beatNpc ? `${displayName(state, beatNpc)}에게 할 말이 있는 듯하다` : undefined;
  if (!bond) {
    const met = Object.keys(state.relationships).map((id) => world.characters.find((c) => c.id === id)).filter((c) => !!c && !state.deadNpcs.includes(c.id));
    const best = met.map((c) => ({ c: c!, st: stageFor(world, state.relationships, c!.id), aff: state.relationships[c!.id]?.affinity ?? 0 }))
      .filter((x) => !HOSTILE_STAGES.includes(x.st) && x.st !== '연인' && x.st !== '절친')
      .sort((a, b) => b.aff - a.aff)[0];
    if (best) bond = `${displayName(state, best.c)}와(과) 더 가까워질 수 있다 (지금: ${best.st})`;
  }
  return { ...(main ? { main } : {}), ...(side ? { side } : {}), ...(bond ? { bond } : {}) };
}

/** 궁금한 것: 소문·일부만 아는 것 (아직 확인되지 않음) */
export function openQuestions(world: WorldPackage, state: GameState, max = 5): string[] {
  return knowledgeOf(world, state.beliefs, 'player').filter((k) => k.state === 'rumor' || k.state === 'partial').slice(-max).map((k) => k.statement);
}

export interface Recap { where: string; when: string; last: string; todo: Todo; questions: string[]; pending: number }

/** 이어하기: 지난 이야기 */
export function recap(world: WorldPackage, state: GameState): Recap {
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  const date = calendarDate(world, state.worldMinutes);
  const lastNarr = [...state.log].reverse().find((l) => l.kind === 'narration')?.text ?? '';
  const flat = lastNarr.replace(/\s+/g, ' ').trim();
  const last = flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
  const hh = String(Math.floor(state.worldMinutes / 60) % 24).padStart(2, '0');
  return { where: loc?.name ?? '', when: date?.label ?? `${hh}시`, last, todo: todoThree(world, state), questions: openQuestions(world, state, 3), pending: pendingChoices(state.player.sheet) };
}
