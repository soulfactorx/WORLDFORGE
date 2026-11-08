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
});
