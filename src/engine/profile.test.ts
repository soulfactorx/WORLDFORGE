import { describe, expect, it } from 'vitest';
import { romanceSample } from '../data/sample-genres';
import { sampleWorld } from '../data/sample-world';
import { buildActorContext, buildDirectorContext, buildNarratorContext } from '../gm/context';
import { startEvents } from '../gm/turn';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { validateWorld } from './package/validate';
import { gendersOf, profileErrors, profileFor, profileLine } from './profile';
import type { WorldPackage } from './schema';
import { replay } from './state/state';

describe('주인공 정보 양식 (v0.68)', () => {
  it('세계가 정하지 않으면 장르 기본 양식 (로맨스: 신분·첫인상), 성별은 기본 셋', () => {
    expect(profileFor(romanceSample).fields!.map((f) => f.label)).toEqual(['나이', '신분', '외모', '첫인상']);
    expect(profileFor(sampleWorld).fields!.some((f) => f.label === '종족')).toBe(true);
    expect(gendersOf(profileFor(sampleWorld))).toEqual(['남성', '여성', '밝히지 않음']);
    expect(gendersOf({ noGender: true })).toEqual([]);
  });
  it('필수 칸·성별 확인', () => {
    const p = { fields: [{ id: 'clan', label: '가문', kind: 'text' as const, required: true }] };
    expect(profileErrors(p, '', {})).toEqual(['성별을 고르세요.', '가문을(를) 적으세요.']);
    expect(profileErrors(p, '여성', { clan: '로즈' })).toEqual([]);
  });
  it('시트에 남고, 서술·판단 AI는 전부, NPC는 보이는 것만 안다', () => {
    const sh = createCharacter({ name: '로즈', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: ['persuasion', 'performance', 'insight'], gender: '여성', profile: { age: '19', status: '몰락 귀족', looks: '은발에 푸른 눈', impression: '' } });
    expect(sh.gender).toBe('여성');
    expect(sh.profile).toEqual({ age: '19', status: '몰락 귀족', looks: '은발에 푸른 눈' });
    expect(profileLine(romanceSample, sh)).toBe('성별: 여성 · 나이: 19 · 신분: 몰락 귀족 · 외모: 은발에 푸른 눈');
    expect(profileLine(romanceSample, sh, true)).toBe('성별: 여성 · 신분: 몰락 귀족 · 외모: 은발에 푸른 눈');
    const s = replay(startEvents(romanceSample, sh, 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    expect(buildNarratorContext(romanceSample, s)).toContain('나이: 19');
    expect(buildDirectorContext(romanceSample, s)).toContain('성별: 여성');
    const actor = buildActorContext(romanceSample, s, romanceSample.characters[0]!);
    expect(actor).toContain('이 낯선 이의 겉모습');
    expect(actor).toContain('은발에 푸른 눈');
    expect(actor).not.toContain('나이: 19');
  });
  it('검사기: ID·이름·선택지', () => {
    const w: WorldPackage = { ...sampleWorld, playerProfile: { fields: [{ id: 'Bad Id', label: '', kind: 'select' }, { id: 'x', label: 'X', kind: 'text' }, { id: 'x', label: 'Y', kind: 'text' }] } };
    const paths = validateWorld(w).filter((i) => i.level === 'error' && i.path.startsWith('playerProfile')).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['playerProfile.fields[0].id', 'playerProfile.fields[0].label', 'playerProfile.fields[0].options', 'playerProfile.fields[2].id']));
  });
});
