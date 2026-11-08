/**
 * NPC 캐릭터 데이터 (v0.79): NPC도 주인공과 같은 직업·레벨·능력치·기술·성향 시트를 가진다.
 * 시트는 저장하지 않고 세계 정의 + 지금 상태(주인공 레벨·지난 날짜)에서 그때그때 계산한다 — 그래서 함께 자란다.
 * 동료가 되면 그때의 시트로 파티에 들어가고, 그 뒤로는 경험치로 자란다 (기존 방식).
 */
import { levelUp, XP_FOR_LEVEL } from './character/progression';
import { CLASSES } from './character/rules';
import { abilityModifier } from './dice/dice';
import { companionSheet, suggestedStandardArray, type CharacterSheet } from './character/sheet';
import { classesFor, recommendedSkills, skillOptionsOf } from './classes';
import type { Character, WorldPackage } from './schema';
import type { GameState } from './state/state';

export const NPC_MAX_LEVEL = 10;

/** 이 인물의 세계 직업·규칙 직업 */
export function npcClassOf(world: WorldPackage, c: Character): { base: string; role?: { id: string; name: string } } {
  const classes = classesFor(world);
  const roleId = c.stats?.role ?? c.companion?.role;
  const wc = roleId ? classes.find((k) => k.id === roleId) : undefined;
  if (wc) return { base: wc.base, role: { id: wc.id, name: wc.name } };
  const base = [c.stats?.classId, c.companion?.classId].find((x): x is string => !!x && !!CLASSES[x]) ?? 'fighter';
  const same = classes.find((k) => k.base === base);
  return { base, ...(same ? { role: { id: same.id, name: same.name } } : {}) };
}

/** 지금 레벨: 성장 방식에 따라 */
export function npcLevel(c: Character, state: Pick<GameState, 'player' | 'worldMinutes'> | null): number {
  const s = c.stats ?? {};
  const base = Math.max(1, Math.min(NPC_MAX_LEVEL, s.level ?? 1));
  if (!state) return base;
  const growth = s.growth ?? 'follow';
  let lv = base;
  if (growth === 'follow') lv = Math.max(base, state.player.sheet.level + (s.offset ?? 0));
  else if (growth === 'time') lv = base + Math.floor(Math.max(0, state.worldMinutes - 8 * 60) / 1440 / Math.max(1, s.everyDays ?? 7));
  return Math.max(1, Math.min(NPC_MAX_LEVEL, lv));
}

/** NPC 시트 (동료면 파티 시트) */
export function npcSheet(world: WorldPackage, state: GameState | null, c: Character): CharacterSheet {
  if (state?.party[c.id]) return state.party[c.id]!;
  const { base, role } = npcClassOf(world, c);
  const abilities = c.stats?.abilities ?? c.companion?.abilities ?? suggestedStandardArray(base);
  let sheet = companionSheet(c.name, base, abilities, role);
  const wc = role ? classesFor(world).find((k) => k.id === role.id) : undefined;
  const skills = wc ? [...recommendedSkills(wc), ...skillOptionsOf(wc)] : CLASSES[base]!.skillOptions;
  sheet = { ...sheet, skillProficiencies: [...new Set(skills)].slice(0, CLASSES[base]!.skillChoices), ...(c.stats?.traits ? { traits: { ...c.stats.traits } } : {}), ...(c.gender ? { gender: c.gender === 'M' ? '남성' : '여성' } : {}) };
  const target = npcLevel(c, state);
  while (sheet.level < target) sheet = levelUp(sheet).sheet;
  // 동료가 된 뒤 경험치로 이어서 자라도록 그 레벨의 경험치에서 시작
  return sheet.level > 1 ? { ...sheet, xp: XP_FOR_LEVEL[sheet.level] ?? 0 } : sheet;
}

const AB: Record<string, string> = { str: '근력', dex: '민첩', con: '건강', int: '지능', wis: '지혜', cha: '매력' };
/** AI에게 주는 한 줄 (예: "5레벨 기사 · 근력 16(+3) 높음 · 지능 8(−1) 낮음") */
export function npcStatLine(world: WorldPackage, state: GameState | null, c: Character): string {
  const sh = npcSheet(world, state, c);
  const ab = Object.entries(sh.abilities).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  const hi = ab.filter((x) => x.v >= 14).slice(0, 2).map((x) => `${AB[x.k]} ${x.v}(+${abilityModifier(x.v)}) 높음`);
  const lo = ab.filter((x) => x.v <= 9).slice(-1).map((x) => `${AB[x.k]} ${x.v}(${abilityModifier(x.v)}) 낮음`);
  return [`${sh.level}레벨 ${sh.roleName ?? CLASSES[sh.classId]?.name ?? sh.classId}`, ...hi, ...lo].join(' · ');
}

/** NPC 적을 쓰러뜨렸을 때 경험치 (레벨 기준, 같은 레벨 몬스터와 비슷하게) */
export const npcXp = (level: number) => [0, 50, 100, 200, 450, 700, 1100, 1400, 1800, 2300, 2900][Math.max(1, Math.min(10, level))]!;
