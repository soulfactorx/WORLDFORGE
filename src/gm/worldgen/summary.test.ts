import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import type { WorldPackage } from '../../engine/schema';
import { worldSummary } from './generate';
import { SPINE_MARK } from './spine';

/** v0.100: 이야기 단계에 보내는 세계 요약 줄이기 */
function bigWorld(): WorldPackage {
  const w = structuredClone(sampleWorld);
  const base = w.characters[0]!;
  // 인물 30명, 모두가 아는 설정 하나, 비밀 하나, 뼈대와 먼 설정 하나
  w.characters = Array.from({ length: 30 }, (_, i) => ({ ...base, id: `npc/p${i}`, name: `인물${i}번`, romanceable: false, companion: undefined, locationId: i === 0 ? w.start.locationId : 'loc/elsewhere' })) as WorldPackage['characters'];
  w.relations = [];
  w.facts = [{ id: 'fact/secret', statement: '비밀의 진실', secrecy: 4 } as WorldPackage['facts'][number]];
  w.claims = [
    { id: 'claim/common', statement: `세상이 다 아는 설정. ${'가'.repeat(300)}`, truth: 'true' },
    { id: 'claim/secret', statement: '인물5번이 숨기는 것', truth: 'true', relatesTo: 'fact/secret' },
    { id: 'claim/far', statement: '아무와도 이어지지 않는 먼 설정', truth: 'true' },
    { id: 'claim/some', statement: '여덟 명이 아는 소문', truth: 'true' },
  ] as WorldPackage['claims'];
  w.beliefs = [
    ...w.characters.map((c) => ({ holder: c.id, claim: 'claim/common', state: 'confirmed' as const })),
    { holder: 'npc/p5', claim: 'claim/secret', state: 'secret' as const },
    ...w.characters.slice(10, 18).map((c) => ({ holder: c.id, claim: 'claim/some', state: 'rumor' as const })),
    { holder: 'npc/p29', claim: 'claim/some', state: 'secret' as const },
  ];
  return w;
}

describe('세계 요약 줄이기', () => {
  it('full: 지금까지와 같다 (아는 사람 전원, 문장 전체)', () => {
    const w = bigWorld();
    const s = worldSummary(w);
    expect(s).toBe(worldSummary(w, { level: 'full' }));
    expect(s).toContain('p29(confirmed)');
    expect(s).toContain('가'.repeat(300));
  });
  it('holders: 목록만 줄인다 — 대부분이 알면 "대부분", 많으면 앞의 몇 명 + 외 N명, 비밀로 쥔 사람은 남긴다', () => {
    const s = worldSummary(bigWorld(), { level: 'holders' });
    expect(s).toContain('대부분의 인물이 안다');
    expect(s).not.toContain('p29(confirmed)');
    expect(s).toMatch(/claim\/?some|some \(true\)/);
    const some = s.split('\n').find((l) => l.startsWith('- some'))!;
    expect(some).toContain('p29(secret)');
    expect(some).toContain('외 3명');
    expect(s).toContain('가'.repeat(300)); // 문장은 그대로
    expect(s.length).toBeLessThan(worldSummary(bigWorld()).length);
  });
  it('short: 문장을 120자로 — fullText면 자르지 않는다 (세계 규칙 단계)', () => {
    const s = worldSummary(bigWorld(), { level: 'short' });
    expect(s).not.toContain('가'.repeat(200));
    expect(worldSummary(bigWorld(), { level: 'short', fullText: true })).toContain('가'.repeat(300));
  });
  it('focus: 뼈대가 없으면 short와 같고, 있으면 뼈대와 이어진 인물·명제만 남긴다', () => {
    const w = bigWorld();
    expect(worldSummary(w, { level: 'focus' })).toBe(worldSummary(w, { level: 'short' }));
    w.gmNotes = `${SPINE_MARK}\n중심 갈등: 인물5번이 인물7번을 속인다 (p7)`;
    const s = worldSummary(w, { level: 'focus' });
    const people = s.split('## 인물')[1]!.split('## ')[0]!;
    expect(people).toContain('p5:');
    expect(people).toContain('p7:');
    expect(people).toContain('p0:'); // 시작 장소의 인물
    expect(people).not.toContain('p20:');
    expect(s).toContain('인물 27명은 줄였다');
    expect(s).toContain('- secret'); // 비밀은 남는다
    expect(s).not.toContain('- far');
    expect(s).not.toContain('- common');
    expect(s).toContain('명제 2개는 줄였다');
  });
});
