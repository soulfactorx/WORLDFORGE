import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { createRng } from './dice/rng';
import { LEAD_DC, rollLeads } from './leads';
import { replay } from './state/state';
import { startEvents } from '../gm/turn';
import { presentCharacters } from '../gm/context';

/** 실마리 (v0.89): 엔진이 d20으로 굴려 세계가 먼저 다가온다 */
const hero = () => createCharacter({ name: '나', classId: 'bard', method: 'standard', abilities: suggestedStandardArray('bard'), skills: ['persuasion', 'insight', 'perception'] });
const base = () => replay(startEvents(sampleWorld, hero(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const at = (loc: string) => ({ ...base(), player: { ...base().player, locationId: loc } });
const many = <T,>(f: (seed: number) => T, n = 200) => Array.from({ length: n }, (_, i) => f(i * 7919 + 1));

describe('실마리 (v0.89)', () => {
  const npc = sampleWorld.characters.find((c) => [...sampleWorld.beliefs].some((b) => b.holder === c.id && b.state !== 'secret'))!;
  const s = at(npc.locationId);
  const present = presentCharacters(sampleWorld, s);

  it('말문: 말하는 인물이 플레이어가 모르는, 비밀이 아닌 지식을 먼저 꺼낸다 — 주사위에 따라', () => {
    const rolls = many((seed) => rollLeads(sampleWorld, s, createRng(seed), { speakers: [npc.id], present, quiet: 0 }).leads.find((l) => l.kind === 'tell'));
    const hit = rolls.filter(Boolean);
    expect(hit.length).toBeGreaterThan(60);   // DC 10 + 설득 숙련 → 대체로 성공하지만
    expect(hit.length).toBeLessThan(200);     // 늘 성공하지는 않는다
    for (const l of hit) {
      const belief = sampleWorld.beliefs.find((b) => b.holder === npc.id && b.claim === l!.claimId)!;
      expect(belief.state).not.toBe('secret');
      expect(l!.text).toContain('🎲 말문');
    }
  });

  it('낌새: 비밀은 내용이 아니라 주제만 드러나고, 같은 인물·주제는 한 번만', () => {
    const holder = sampleWorld.characters.find((c) => sampleWorld.beliefs.some((b) => b.holder === c.id && b.state === 'secret' && sampleWorld.facts.some((f) => f.id === sampleWorld.claims.find((x) => x.id === b.claim)?.relatesTo && f.protectedTopic)))!;
    const st = at(holder.locationId);
    const pr = presentCharacters(sampleWorld, st);
    const hints = many((seed) => rollLeads(sampleWorld, st, createRng(seed), { speakers: [holder.id], present: pr, quiet: 0 }).leads.find((l) => l.kind === 'hint')).filter(Boolean);
    expect(hints.length).toBeGreaterThan(0);
    const h = hints[0]!;
    const secretStatements = sampleWorld.beliefs.filter((b) => b.holder === holder.id && b.state === 'secret').map((b) => sampleWorld.claims.find((c) => c.id === b.claim)!.statement);
    for (const text of secretStatements) expect(h.text).not.toContain(text);
    expect(h.key).toMatch(/^hint:/);
    const again = many((seed) => rollLeads(sampleWorld, { ...st, leadKeys: [h.key!] }, createRng(seed), { speakers: [holder.id], present: pr, quiet: 0 }).leads.filter((l) => l.kind === 'hint' && l.key === h.key).length);
    expect(again.every((n) => n === 0)).toBe(true);
  });

  it('눈썰미: 찾을 것이 있는 장소에서 눈에 걸린다 — 판정이 필요한 것은 낌새만', () => {
    const loc = sampleWorld.locations.find((l) => l.discoveries?.some((d) => d.check))!;
    const st = at(loc.id);
    const found = many((seed) => rollLeads(sampleWorld, st, createRng(seed), { speakers: [], present: [], quiet: 0 }).leads.find((l) => l.kind === 'notice' || l.kind === 'found')).filter(Boolean);
    expect(found.length).toBeGreaterThan(40);
    for (const l of found) if (l!.kind === 'notice') { expect(l!.text).toContain('살펴볼 만하다'); expect(l!.text).not.toContain(sampleWorld.claims.find((c) => c.id === l!.claimId)!.statement); }
  });

  it('다가옴: 아무도 말하지 않으면 그 자리의 인물이 먼저 말을 걸 수 있고, 조용할수록 쉬워진다', () => {
    const rate = (quiet: number) => many((seed) => rollLeads(sampleWorld, s, createRng(seed), { speakers: [], present, quiet }).approach).filter(Boolean).length;
    expect(rate(0)).toBeGreaterThan(0);
    expect(rate(4)).toBeGreaterThan(rate(0));
    expect(LEAD_DC.tell).toBeLessThan(LEAD_DC.hint);
  });
});
