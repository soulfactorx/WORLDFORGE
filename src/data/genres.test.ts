import { describe, expect, it } from 'vitest';
import { sampleWorld } from './sample-world';
import { GENRES, genreOf } from './genres';
import { classesFor } from '../engine/classes';
import { traitsFor } from '../engine/traits';
import { profileFor } from '../engine/profile';
import { monstersOfWorld } from '../engine/combat/monsters';
import { genreGuide, reskinner } from '../engine/genre';
import { validateWorld } from '../engine/package/validate';
import type { WorldPackage } from '../engine/schema';

const withGenre = (genre: WorldPackage['genre']): WorldPackage => ({ ...structuredClone(sampleWorld), genre });

describe('장르 프리셋·사용자 정의 (v0.81)', () => {
  it('새 프리셋 장르는 저마다 직업·성향·양식·기본 적을 갖는다 (없으면 바탕 장르)', () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(13);
    for (const g of GENRES) {
      const w = withGenre({ id: g.id });
      expect([g.id, classesFor(w).length > 0, traitsFor(w).length > 0, (profileFor(w).fields?.length ?? 0) > 0, monstersOfWorld(w).length > 0]).toEqual([g.id, true, true, true, true]);
      expect(validateWorld(w).some((i) => i.path === 'genre.id')).toBe(false);
    }
    expect(classesFor(withGenre({ id: 'cyberpunk' })).map((c) => c.name)).toContain('해커');
    expect(classesFor(withGenre({ id: 'joseon' })).map((c) => c.name)).toContain('검객');
    expect(traitsFor(withGenre({ id: 'school' })).map((t) => t.id)).toEqual(['warmth', 'boldness']); // 바탕 장르: 로맨스
    expect(reskinner(withGenre({ id: 'sf' }))('파이터의 롱소드')).toContain('해병');
  });

  it('사용자 정의 장르: 이름·분위기·전투 빈도·바탕 장르·용어가 적용되고, 분위기가 비면 검사기가 막는다', () => {
    const w = withGenre({ id: 'custom', custom: { label: '스팀펑크 모험', tone: '증기와 톱니바퀴의 도시. 발명과 모험.', combat: 'rare', base: 'wuxia' }, terms: { 파이터: '기관사' } });
    const g = genreOf(w.genre!.id, w.genre!.custom);
    expect(g.label).toBe('스팀펑크 모험');
    expect(g.combat).toBe('rare');
    expect(genreGuide(w)).toContain('장르: 스팀펑크 모험. 증기와 톱니바퀴의 도시');
    expect(traitsFor(w).map((t) => t.id)).toEqual(['justice', 'loyalty']); // 바탕: 무협
    expect(reskinner(w)('파이터')).toBe('기관사');
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
    const bad = withGenre({ id: 'custom', custom: { label: 'x', tone: '' } });
    expect(validateWorld(bad).some((i) => i.path === 'genre.custom.tone' && i.level === 'error')).toBe(true);
    expect(genreOf('custom', { label: 'x', tone: '' }).id).toBe('high_fantasy'); // 분위기가 없으면 기본으로
  });
});
