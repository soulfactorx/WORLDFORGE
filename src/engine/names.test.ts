import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { validateWorld } from './package/validate';
import { appearanceOf, epithetOf, isPlaceholderText } from './names';
import type { Character } from './schema';

describe('자리표시 외형 (v0.75.1)', () => {
  const npc = (appearance: string, gender?: 'M' | 'F'): Character => ({ ...structuredClone(sampleWorld.characters[0]!), appearance, ...(gender ? { gender } : {}) });

  it('"원문에 없음" 같은 글은 별칭이 되지 않는다', () => {
    for (const t of ['원문에 없음', '원문에 없음.', '(외형 정보 없음)', '정보 없음', '알 수 없음', 'Unknown', 'N/A', '-', '']) expect([t, isPlaceholderText(t)]).toEqual([t, true]);
    expect(epithetOf(npc('원문에 없음'))).toBe('낯선 인물');
    expect(epithetOf(npc('원문에 없음', 'F'))).toBe('낯선 여자');
    expect(epithetOf(npc('(외형 정보 없음)', 'M'))).toBe('낯선 남자');
    expect(appearanceOf(npc('원문에 없음'))).toContain('지어내지 말고');
  });

  it('진짜 외형은 그대로', () => {
    expect(isPlaceholderText('없음을 모르는 소년')).toBe(false);
    expect(epithetOf(npc('턱수염이 희끗한 중년 경비병. 창을 든다'))).toBe('턱수염이 희끗한 중년 경비병');
  });

  it('검사기가 자리표시 외형을 경고한다', () => {
    const w = structuredClone(sampleWorld);
    w.characters[0]!.appearance = '원문에 없음';
    const hit = validateWorld(w).find((i) => i.path === 'characters[0].appearance');
    expect(hit?.level).toBe('warning');
    expect(hit?.message).toContain('낯선 인물');
  });

  it('외형 문장을 통째로 호칭으로 쓰지 않는다 (v0.79.2): 호칭 칸 → 짧은 명사구 → 낯선 …', () => {
    expect(epithetOf(npc('앞치마 위로 소매를 접어 올린 팔뚝에 힘이 들어가 있다', 'F'))).toBe('낯선 여자');
    expect(epithetOf(npc('소매를 걷어붙이고 국자를 든 채', 'F'))).toBe('낯선 여자');
    expect(epithetOf(npc('큰 안경을 쓴 작은 체구의 소녀. 카디건 소매가 길다'))).toBe('큰 안경을 쓴 작은 체구의 소녀');
    expect(epithetOf({ ...npc('앞치마 위로 소매를 접어 올린 팔뚝에 힘이 들어가 있다', 'F'), alias: '앞치마 차림의 하숙집 주인' })).toBe('앞치마 차림의 하숙집 주인');
  });
});
