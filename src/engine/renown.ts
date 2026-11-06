/**
 * 명성 · 칭호 · 등급 (설계 v4 E4) — "강해진 것이 보인다".
 * 칭호는 기록(쓰러뜨린 적·완료한 임무·관계·알게 된 것·끝낸 줄기)에서 엔진이 준다. 세계가 칭호를 더 정할 수도 있다 (조건 DSL).
 * 명성 = 얻은 칭호의 명성 합. 등급 = 레벨 + 명성으로 정해지는 장르별 사다리 (모험가 F→S, 무협 삼류→생사경, 로맨스 사교계 평판).
 * 레벨·판정 규칙은 d20 그대로 (D1) — 등급은 이름과 세계의 반응을 바꾼다.
 */
import { genreProfile } from './genre';
import { MONSTERS, monsterTable } from './combat/monsters';
import { stageFor } from './relationship';
import { evalCondition } from './scenario';
import type { Condition, WorldPackage } from './schema';
import type { GameState } from './state/state';

export interface TitleDef { id: string; name: string; desc: string; renown: number; condition?: Condition }

const totalKills = (s: GameState) => Object.values(s.kills ?? {}).reduce((a, n) => a + n, 0);
const questsDone = (s: GameState) => Object.values(s.quests).filter((q) => q.done && !q.failed).length;
const jobsDone = (s: GameState) => Object.values(s.jobs ?? {}).reduce((a, j) => a + (j.done ?? 0), 0);
const stages = (w: WorldPackage, s: GameState) => Object.keys(s.relationships).map((id) => stageFor(w, s.relationships, id));

/** 엔진이 주는 기본 칭호 */
const BUILTIN: (TitleDef & { test: (w: WorldPackage, s: GameState) => boolean })[] = [
  { id: 'title/first-win', name: '첫 승리', desc: '처음으로 적을 쓰러뜨렸다', renown: 2, test: (_w, s) => totalKills(s) >= 1 },
  { id: 'title/fighter', name: '노련한 싸움꾼', desc: '적 10을 쓰러뜨렸다', renown: 5, test: (_w, s) => totalKills(s) >= 10 },
  { id: 'title/warlord', name: '전장의 이름', desc: '적 40을 쓰러뜨렸다', renown: 10, test: (_w, s) => totalKills(s) >= 40 },
  { id: 'title/giant-slayer', name: '거물 사냥꾼', desc: '보스를 쓰러뜨렸다', renown: 10, test: (w, s) => Object.keys(s.kills ?? {}).some((id) => (monsterTable(w)[id] ?? MONSTERS[id])?.role === 'boss') },
  { id: 'title/helper', name: '믿을 만한 해결사', desc: '임무 3개를 해냈다', renown: 5, test: (_w, s) => questsDone(s) >= 3 },
  { id: 'title/fixer', name: '이름난 해결사', desc: '임무 8개를 해냈다', renown: 10, test: (_w, s) => questsDone(s) >= 8 },
  { id: 'title/regular', name: '의뢰판의 단골', desc: '의뢰 5건을 끝냈다', renown: 5, test: (_w, s) => jobsDone(s) >= 5 },
  { id: 'title/friend', name: '좋은 벗', desc: '누군가와 친구가 되었다', renown: 3, test: (w, s) => stages(w, s).some((x) => x === '친구' || x === '절친' || x === '연인') },
  { id: 'title/beloved', name: '누군가의 연인', desc: '연인이 생겼다', renown: 5, test: (w, s) => stages(w, s).includes('연인') },
  { id: 'title/seeker', name: '진실을 좇는 자', desc: '확인된 사실 10개를 알아냈다', renown: 5, test: (_w, s) => s.beliefs.filter((b) => b.holder === 'player' && b.state === 'confirmed').length >= 10 },
  { id: 'title/protagonist', name: '이야기의 주인공', desc: '이야기 줄기 하나를 끝까지 이끌었다', renown: 10, test: (_w, s) => Object.values(s.arcs ?? {}).some((a) => a.done && !a.failed) },
];

export function allTitles(world: WorldPackage): TitleDef[] {
  return [...BUILTIN.map(({ test: _t, ...t }) => t), ...(world.titles ?? []).map((t) => ({ ...t, desc: t.desc ?? '', renown: t.renown ?? 5 }))];
}

/** 지금 조건을 채웠지만 아직 받지 않은 칭호 */
export function newTitles(world: WorldPackage, state: GameState): TitleDef[] {
  const have = new Set(state.titles ?? []);
  const builtin = BUILTIN.filter((t) => !have.has(t.id) && t.test(world, state)).map(({ test: _t, ...t }) => t);
  const own = (world.titles ?? []).filter((t) => !have.has(t.id) && evalCondition(world, state, t.condition)).map((t) => ({ ...t, desc: t.desc ?? '', renown: t.renown ?? 5 }));
  return [...builtin, ...own];
}

export function renownOf(world: WorldPackage, state: GameState): number {
  const defs = new Map(allTitles(world).map((t) => [t.id, t.renown]));
  return (state.titles ?? []).reduce((a, id) => a + (defs.get(id) ?? 0), 0);
}

export const RENOWN_TIERS = [[0, '무명'], [5, '알려짐'], [15, '이름남'], [30, '유명'], [60, '전설']] as const;
export const renownTier = (renown: number) => [...RENOWN_TIERS].reverse().find(([n]) => renown >= n)![1];

/** 장르별 등급 사다리 */
const LADDERS: Record<string, { label: string; ranks: string[] }> = {
  default: { label: '모험가 등급', ranks: ['F급', 'E급', 'D급', 'C급', 'B급', 'A급', 'S급'] },
  wuxia: { label: '무공 경지', ranks: ['삼류', '이류', '일류', '절정', '초절정', '화경', '현경', '생사경'] },
  romance: { label: '사교계 평판', ranks: ['무명', '화제의 인물', '사교계의 신성', '사교계의 꽃', '사교계의 전설'] },
};
/** 등급 점수 상한 (레벨 10 + 명성 60) */
const MAX_SCORE = 150;

export interface Rank { label: string; name: string; index: number; next?: string; progress: number }

export function rankOf(world: WorldPackage, state: GameState): Rank {
  const g = world.genre?.id ?? '';
  const ladder = LADDERS[g] ?? LADDERS.default!;
  const renown = renownOf(world, state);
  // 전투가 드문 장르(로맨스)는 명성이 등급을 정한다
  const score = genreProfile(world).combat === 'rare' ? renown * 2.5 : (state.player.sheet.level - 1) * 10 + renown;
  const step = MAX_SCORE / (ladder.ranks.length - 1);
  const index = Math.max(0, Math.min(ladder.ranks.length - 1, Math.floor(score / step)));
  const next = ladder.ranks[index + 1];
  return { label: ladder.label, name: ladder.ranks[index]!, index, ...(next ? { next } : {}), progress: next ? Math.min(1, (score - index * step) / step) : 1 };
}
