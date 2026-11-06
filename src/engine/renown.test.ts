import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { wuxiaSample } from '../data/sample-genres';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { applyEvent, type GameState, replay } from './state/state';
import { startEvents } from '../gm/turn';
import { scenarioEvents } from '../gm/scenario';
import { newTitles, rankOf, renownOf } from './renown';
import { buildActorContext } from '../gm/context';
import { beginEncounter } from '../gm/combat';
import type { WorldPackage } from './schema';

const hero = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w: WorldPackage = sampleWorld) => replay(startEvents(w, hero(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const run = (w: WorldPackage, s: GameState) => scenarioEvents(w, s).events.reduce((x, e) => applyEvent(x, e, x.turn), s);

describe('명성 · 칭호 · 등급 (설계 v4 E4)', () => {
  it('기록에서 칭호가 생기고 명성이 쌓인다 (한 번씩만)', () => {
    let s = start();
    expect(newTitles(sampleWorld, s)).toEqual([]);
    s = applyEvent(s, { type: 'enemies_defeated', counts: { wolf: 10 } }, 1);
    s = run(sampleWorld, s);
    expect(s.titles).toEqual(['title/first-win', 'title/fighter']);
    expect(renownOf(sampleWorld, s)).toBe(7);
    expect(newTitles(sampleWorld, run(sampleWorld, s))).toEqual([]);
  });
  it('세계만의 칭호는 조건 DSL로', () => {
    const w = { ...sampleWorld, titles: [{ id: 'title/mist', name: '안개의 친구', renown: 15, condition: { flag: 'chose_stay' } }] };
    let s = run(w, start(w));
    expect(s.titles ?? []).not.toContain('title/mist');
    s = run(w, applyEvent(s, { type: 'flag_set', flag: 'chose_stay' }, 1));
    expect(s.titles).toContain('title/mist');
    expect(renownOf(w, s)).toBe(15);
  });
  it('등급: 레벨과 명성으로 오른다 (판타지 F→S, 무협 삼류→생사경)', () => {
    const s = start();
    expect(rankOf(sampleWorld, s)).toMatchObject({ label: '모험가 등급', name: 'F급', next: 'E급' });
    const strong = { ...s, player: { ...s.player, sheet: { ...s.player.sheet, level: 10 } }, titles: ['title/warlord', 'title/giant-slayer', 'title/fixer', 'title/protagonist', 'title/beloved', 'title/seeker', 'title/regular', 'title/helper', 'title/fighter'] };
    expect(rankOf(sampleWorld, strong).name).toBe('S급');
    const ws = start(wuxiaSample);
    expect(rankOf(wuxiaSample, ws)).toMatchObject({ label: '무공 경지', name: '삼류' });
  });
  it('이름이 알려지면 NPC가 소문으로 안다', () => {
    const s = { ...start(), titles: ['title/first-win', 'title/fighter'] };
    const bran = sampleWorld.characters.find((c) => c.id === 'npc/bran')!;
    expect(buildActorContext(sampleWorld, s, bran)).toContain('이 낯선 이에 대해 들은 소문');
    expect(buildActorContext(sampleWorld, start(), bran)).not.toContain('들은 소문');
  });
  it('압도적으로 쉬운 조우: 적이 일찍 달아나고 기록에 기세가 남는다', () => {
    let s = start();
    s = { ...s, player: { ...s.player, locationId: 'loc/forest-clearing', sheet: { ...s.player.sheet, level: 8, maxHp: 80, hp: 80 } } };
    const evs = beginEncounter(sampleWorld, s, 'enc/clearing-wolves', 1);
    const started = evs.find((e) => e.type === 'combat_started');
    expect(started && started.type === 'combat_started' && started.combat.overmatched).toBe(true);
    const low = { ...s, player: { ...s.player, sheet: { ...s.player.sheet, level: 1 } } };
    const evs1 = beginEncounter(sampleWorld, low, 'enc/clearing-wolves', 1);
    const st1 = evs1.find((e) => e.type === 'combat_started');
    expect(st1 && st1.type === 'combat_started' && st1.combat.overmatched).toBeFalsy();
  });
});
