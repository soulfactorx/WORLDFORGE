import { describe, expect, it } from 'vitest';
import { CLASS_PRESETS, GENRE_CLASS_PRESET } from '../data/classPresets';
import { GENRES } from '../data/genres';
import { romanceSample } from '../data/sample-genres';
import { sampleWorld } from '../data/sample-world';
import { BUILTIN } from '../storage/packages';
import { buildDirectorContext, buildNarratorContext } from '../gm/context';
import { startEvents } from '../gm/turn';
import { CLASSES } from './character/rules';
import { createCharacter, suggestedStandardArray, validateCreation } from './character/sheet';
import { classesFor, classLabel, recommendedSkills, skillOptionsOf } from './classes';
import { validateWorld } from './package/validate';
import { replay } from './state/state';

describe('직업 프리셋 (v0.56)', () => {
  it('모든 프리셋: 규칙 직업이 있고, 후보·추천 기술이 맞다', () => {
    for (const p of CLASS_PRESETS) {
      expect(new Set(p.classes.map((c) => c.id)).size, p.id).toBe(p.classes.length);
      for (const c of p.classes) {
        const base = CLASSES[c.base];
        expect(base, `${p.id}/${c.id}`).toBeTruthy();
        if (c.skillOptions) expect(c.skillOptions.length, `${p.id}/${c.id}`).toBeGreaterThanOrEqual(base!.skillChoices);
        const opts = skillOptionsOf(c);
        for (const s of c.skills ?? []) expect(opts, `${p.id}/${c.id} ${s}`).toContain(s);
        if (p.id !== 'fantasy') expect(recommendedSkills(c).length, `${p.id}/${c.id}`).toBe(base!.skillChoices);
      }
    }
  });
  it('모든 장르에 기본 프리셋이 있다', () => {
    for (const g of GENRES) expect(CLASS_PRESETS.some((p) => p.id === GENRE_CLASS_PRESET[g.id]), g.id).toBe(true);
  });
  it('로맨스 세계는 궁정 로맨스 직업, 판타지는 기본 8직업', () => {
    expect(classesFor(romanceSample).map((c) => c.name)).toContain('사교계 인사');
    expect(classesFor(sampleWorld).map((c) => c.name)).toContain('파이터');
  });
  it('세계가 정한 직업이 먼저, 알 수 없는 규칙 직업은 뺀다', () => {
    const w = { ...sampleWorld, classes: [{ id: 'chef', name: '요리사', base: 'ranger' }, { id: 'x', name: '이상', base: 'nope' }] };
    expect(classesFor(w).map((c) => c.name)).toEqual(['요리사']);
  });
});

describe('직업으로 주인공 만들기', () => {
  const socialite = classesFor(romanceSample).find((c) => c.id === 'socialite')!;
  it('역할 이름이 시트에 남고 규칙은 base를 따른다', () => {
    const sh = createCharacter({ name: '나', classId: socialite.base, method: 'standard', abilities: suggestedStandardArray('bard'), skills: recommendedSkills(socialite), role: { id: socialite.id, name: socialite.name, skillOptions: skillOptionsOf(socialite) } });
    expect(sh.classId).toBe('bard');
    expect(sh.roleName).toBe('사교계 인사');
    expect(classLabel(romanceSample, sh)).toBe('사교계 인사');
  });
  it('역할의 기술 후보 밖은 거절, 후보 안은 base 후보가 아니어도 허용', () => {
    const president = classesFor({ genre: { id: 'romance' }, classes: CLASS_PRESETS.find((p) => p.id === 'romance_academy')!.classes }).find((c) => c.id === 'president')!;
    const role = { id: president.id, name: president.name, skillOptions: skillOptionsOf(president) };
    // history는 팔라딘 기본 후보가 아니지만 학생회장 후보에는 있다
    expect(validateCreation({ name: 'a', classId: 'paladin', method: 'standard', abilities: suggestedStandardArray('paladin'), skills: ['history', 'persuasion'], role })).toEqual([]);
    expect(validateCreation({ name: 'a', classId: 'paladin', method: 'standard', abilities: suggestedStandardArray('paladin'), skills: ['religion', 'persuasion'], role }).length).toBe(1);
  });
  it('역할이 없는 옛 시트는 세계 직업 이름으로 보인다 (로맨스의 파이터 = 기사)', () => {
    expect(classLabel(romanceSample, { classId: 'fighter' })).toBe('기사');
    expect(classLabel(undefined, { classId: 'fighter' })).toBe('파이터');
  });
  it('AI 컨텍스트에 주인공 직업이 들어간다', () => {
    const sh = createCharacter({ name: '로즈', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: recommendedSkills(socialite), role: { id: socialite.id, name: socialite.name, skillOptions: skillOptionsOf(socialite) } });
    const s = replay(startEvents(romanceSample, sh, 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    for (const ctx of [buildNarratorContext(romanceSample, s), buildDirectorContext(romanceSample, s)]) {
      expect(ctx).toContain('로즈 — 사교계 인사 1레벨');
      expect(ctx).not.toContain('바드');
    }
  });
});

describe('직업 검증', () => {
  it('잘못된 규칙 직업·기술·겹친 ID', () => {
    const w = { ...sampleWorld, classes: [{ id: 'a', name: 'A', base: 'nope' }, { id: 'b', name: 'B', base: 'bard', skills: ['flying'] }, { id: 'b', name: 'C', base: 'fighter' }] };
    const errs = validateWorld(w).filter((i) => i.level === 'error' && i.path.startsWith('classes')).map((i) => i.path);
    expect(errs).toEqual(expect.arrayContaining(['classes[0].base', 'classes[1].skills[0]', 'classes[2].id']));
  });
  it('내장 세계와 모든 프리셋을 넣은 세계는 직업 오류가 없다', () => {
    for (const w of BUILTIN) expect(validateWorld(w).filter((i) => i.path.startsWith('classes'))).toEqual([]);
    for (const p of CLASS_PRESETS) expect(validateWorld({ ...sampleWorld, classes: p.classes }).filter((i) => i.path.startsWith('classes')), p.id).toEqual([]);
  });
});
