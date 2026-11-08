/**
 * 세계의 직업 (v0.56): 보이는 직업(이름·소개·기술) → 규칙상 직업(base).
 */
import { genreKey } from './genre';
import { GENRE_CLASS_PRESET, presetById } from '../data/classPresets';
import { CLASSES, type SkillId } from './character/rules';
import { SUBCLASSES, subclassesOf } from './character/build';
import type { CharacterSheet } from './character/sheet';
import type { WorldClass, WorldPackage } from './schema';

/** 이 세계에서 고를 수 있는 직업 (세계 정의 → 장르 기본 프리셋 → 기본 8직업) */
export function classesFor(world: Pick<WorldPackage, 'classes' | 'genre'>): WorldClass[] {
  const own = (world.classes ?? []).filter((c) => CLASSES[c.base]);
  if (own.length) return own;
  return presetById(GENRE_CLASS_PRESET[world.genre?.id ?? 'high_fantasy'] ?? GENRE_CLASS_PRESET[genreKey(world)] ?? 'fantasy')?.classes ?? presetById('fantasy')!.classes;
}

/** 고를 수 있는 기술 후보 */
export function skillOptionsOf(wc: WorldClass): SkillId[] {
  const base = CLASSES[wc.base]!;
  const own = (wc.skillOptions ?? []).filter((s): s is SkillId => s in SKILL_SET);
  return own.length >= base.skillChoices ? own : base.skillOptions;
}
const SKILL_SET: Record<string, true> = Object.fromEntries(Object.values(CLASSES).flatMap((c) => c.skillOptions).map((s) => [s, true]));

/** 처음 골라 둘 기술 (후보 안에서, 개수 맞춤) */
export function recommendedSkills(wc: WorldClass): SkillId[] {
  const opts = skillOptionsOf(wc);
  return [...new Set((wc.skills ?? []).filter((s): s is SkillId => opts.includes(s as SkillId)))].slice(0, CLASSES[wc.base]!.skillChoices);
}

/** 동료의 직업: 세계 직업(role)이 있으면 그 규칙 직업과 이름, 없으면 classId (v0.57.1) */
export function companionClass(world: Pick<WorldPackage, 'classes' | 'genre'>, spec: { classId: string; role?: string }): { classId: string; role?: { id: string; name: string } } {
  const wc = spec.role ? classesFor(world).find((c) => c.id === spec.role) : undefined;
  return wc ? { classId: wc.base, role: { id: wc.id, name: wc.name } } : { classId: spec.classId };
}

/** 화면에 보일 직업 이름: 시트에 저장된 역할 → 세계 직업 중 같은 base → 엔진 이름(장르 용어 바꾸기) */
export function classLabel(world: Pick<WorldPackage, 'classes' | 'genre'> | undefined, sheet: Pick<CharacterSheet, 'classId' | 'roleName'>, rs: (s: string) => string = (s) => s): string {
  if (sheet.roleName) return sheet.roleName;
  const wc = world ? classesFor(world).find((c) => c.base === sheet.classId) : undefined;
  return wc?.name ?? rs(CLASSES[sheet.classId]?.name ?? '직업 없음');
}

// ---------------------------------------------------------------- 하위 직업 (v0.67)

/** 이 인물(시트)의 세계 직업 */
export function worldClassOf(world: Pick<WorldPackage, 'classes' | 'genre'> | undefined, sheet: Pick<CharacterSheet, 'classId' | 'role'>): WorldClass | undefined {
  if (!world) return undefined;
  const list = classesFor(world);
  return (sheet.role ? list.find((c) => c.id === sheet.role) : undefined) ?? list.find((c) => c.base === sheet.classId);
}

export interface SubclassOption { id: string; name: string; blurb?: string; ruleBlurb: string }
/** 3레벨에 고를 수 있는 하위 직업: 엔진 하위 직업에 세계 이름·소개를 입히고, 숨긴 것은 뺀다 (모두 숨기면 엔진 목록) */
export function subclassOptions(world: Pick<WorldPackage, 'classes' | 'genre'> | undefined, sheet: Pick<CharacterSheet, 'classId' | 'role'>, rs: (s: string) => string = (s) => s): SubclassOption[] {
  const wc = worldClassOf(world, sheet);
  const all = subclassesOf(sheet.classId).map((s) => {
    const own = wc?.subclasses?.find((x) => x.base === s.id);
    return { id: s.id, name: own?.name?.trim() || rs(s.name), ...(own?.blurb ? { blurb: own.blurb } : {}), ruleBlurb: rs(s.blurb), hidden: !!own?.hidden };
  });
  const shown = all.filter((s) => !s.hidden);
  return (shown.length ? shown : all).map(({ hidden: _h, ...s }) => s);
}
/** 화면에 보일 하위 직업 이름 */
export function subclassLabel(world: Pick<WorldPackage, 'classes' | 'genre'> | undefined, sheet: Pick<CharacterSheet, 'classId' | 'role' | 'subclass'>, rs: (s: string) => string = (s) => s): string {
  if (!sheet.subclass) return '';
  const own = worldClassOf(world, sheet)?.subclasses?.find((x) => x.base === sheet.subclass);
  return own?.name?.trim() || rs(SUBCLASSES[sheet.subclass]?.name ?? sheet.subclass);
}
