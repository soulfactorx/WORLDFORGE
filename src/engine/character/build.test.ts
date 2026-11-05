import { describe, expect, it } from 'vitest';
import { CLASSES } from './rules';
import { type CharacterSheet, createCharacter, suggestedStandardArray } from './sheet';
import { levelUp } from './progression';
import { applyBuildChoice, autoBuild, FEATS, needsSubclass, pendingChoices, SUBCLASSES, subclassesOf } from './build';
import { ALL_CARDS, applyEffects, cardById, handOf, resolveCard, sheetCombatant, startCombat, validTargets } from '../combat/combat';
import { createRng } from '../dice/rng';
import { replay } from '../state/state';
import type { GameEvent, StoredEvent } from '../state/events';
import { progressEvents } from '../../gm/progression';

const sk = (cls: string) => CLASSES[cls]!.skillOptions.slice(0, CLASSES[cls]!.skillChoices);
const make = (cls: string) => createCharacter({ name: '나', classId: cls, method: 'standard', abilities: suggestedStandardArray(cls), skills: sk(cls) });
const toLevel = (cls: string, lv: number, defer = true) => { let s: CharacterSheet = make(cls); while (s.level < lv) s = levelUp(s, { defer }).sheet; return s; };
const choose = (s: CharacterSheet, kind: 'subclass' | 'asi' | 'feat', v = '') => applyBuildChoice(s, kind, v)!.sheet;
const first = (cs: ReturnType<typeof startCombat>) => ({ ...cs, order: ['player', ...cs.order.filter((x) => x !== 'player')], turnIndex: 0 });

describe('하위 직업 · 특성', () => {
  it('직업마다 하위 직업 2개 (SRD 하나, 자체 창작 하나), 카드는 모두 정의되어 있다', () => {
    for (const c of Object.keys(CLASSES)) {
      const subs = subclassesOf(c);
      expect(subs.length).toBe(2);
      expect(subs.filter((s) => s.srd).length).toBe(1);
    }
    for (const s of Object.values(SUBCLASSES)) for (const ids of Object.values(s.cards ?? {})) for (const id of ids) expect(ALL_CARDS[id], id).toBeTruthy();
    expect(Object.keys(FEATS).length).toBe(6);
  });

  it('플레이어: 3레벨에 하위 직업, 4레벨에 능력치 향상/특성을 고를 때까지 대기', () => {
    const s3 = toLevel('fighter', 3);
    expect(needsSubclass(s3)).toBe(true);
    expect(levelUp(toLevel('fighter', 2), { defer: true }).features).toContain('하위 직업 (캐릭터 창에서 고르기)');
    const s4 = levelUp(s3, { defer: true });
    expect(s4.sheet.pending).toEqual([4]);
    expect(s4.sheet.abilities.str).toBe(make('fighter').abilities.str); // 자동으로 오르지 않는다
    expect(pendingChoices(s4.sheet)).toBe(2);
    expect(applyBuildChoice(s4.sheet, 'subclass', 'thief')).toBeNull(); // 다른 직업의 하위 직업
    const g = choose(s4.sheet, 'subclass', 'guardian');
    expect(g.subclass).toBe('guardian');
    const a = choose(g, 'asi');
    expect(a.abilities.str).toBe(g.abilities.str + 2);
    expect(a.pending).toEqual([]);
    expect(applyBuildChoice(a, 'asi', '')).toBeNull(); // 남은 선택 없음
  });

  it('동료는 자동으로 고른다 (첫 하위 직업, 능력치 향상)', () => {
    const s = toLevel('cleric', 4, false);
    expect(s.subclass).toBe('life');
    expect(s.pending ?? []).toEqual([]);
    expect(s.abilities.wis).toBe(make('cleric').abilities.wis + 2);
  });

  it('특성: 강인함은 지난 레벨과 앞으로의 레벨 모두 HP +2, 회복력은 건강 내성 숙련, 같은 특성은 두 번 못 고른다', () => {
    const s = toLevel('wizard', 4);
    const t = choose(s, 'feat', 'tough');
    expect(t.maxHp).toBe(s.maxHp + 8);
    expect(t.feats).toEqual(['tough']);
    const t5 = levelUp(t, { defer: true }).sheet;
    expect(t5.maxHp - t.maxHp).toBe(levelUp(s, { defer: true }).sheet.maxHp - s.maxHp + 2);
    const r = choose(s, 'feat', 'resilient');
    expect(r.saveProficiencies).toContain('con');
    expect(r.abilities.con).toBe(s.abilities.con + 1);
    const w8 = { ...t, level: 8, pending: [8] };
    expect(applyBuildChoice(w8, 'feat', 'tough')).toBeNull();
  });

  it('build_choice 이벤트: 엔진이 검증하고, 고를 수 없는 선택은 무시', () => {
    const sheet = toLevel('rogue', 2);
    const start = { type: 'game_started', packageId: 'p', packageVersion: '0', seed: 1, locationId: 'loc/a', playerName: '나', character: sheet } as const;
    const wrap = (evs: GameEvent[]): StoredEvent[] => evs.map((event, seq) => ({ saveId: 's', seq, turn: 1, event }));
    let s = replay(wrap([start]));
    const evs = progressEvents(s, [{ who: 'player', amount: 900 }], '테스트');
    expect(evs.filter((e) => e.type === 'level_up').length).toBe(1);
    s = replay(wrap([start, ...evs,
      { type: 'build_choice', who: 'player', kind: 'subclass', value: 'champion' },
      { type: 'build_choice', who: 'player', kind: 'subclass', value: 'duelist' },
      { type: 'build_choice', who: 'player', kind: 'subclass', value: 'thief' }]));
    expect(s.player.sheet.subclass).toBe('duelist');
    expect(s.log.at(-1)!.text).toContain('결투가');
  });

  it('카드와 자원: 하위 직업 카드가 손패에, 자원은 긴 휴식에 회복', () => {
    const war = choose(toLevel('cleric', 3), 'subclass', 'war');
    expect(war.resources?.war_priest).toEqual({ cur: 3, max: 3 });
    expect(handOf(sheetCombatant(war, 'player', '나', true, 1)).map((c) => c.id)).toContain('cleric/war_strike');
    const fiend = choose(toLevel('warlock', 5), 'subclass', 'fiend');
    expect(sheetCombatant(fiend, 'player', '나', true, 1).cards).toEqual(expect.arrayContaining(['spell/burning_hands', 'spell/fireball']));
    expect(toLevel('paladin', 3).resources?.channel_divinity).toEqual({ cur: 2, max: 2 });
  });

  it('전투 효과: 수호자 감싸기, 방어 전문가 AC, 경계 우선권, 용맹 추가 공격, 챔피언 치명타', () => {
    const g = choose(toLevel('fighter', 3), 'subclass', 'guardian');
    const cs = first(startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 2 }] }, g, createRng(1), [{ id: 'npc/a', name: '동료', sheet: make('fighter') }]));
    expect(cs.combatants.player!.critRange).toBe(20);
    expect(validTargets(cs, 'player', cardById('fighter/guard'))).toEqual(['npc/a']);
    const r = resolveCard(cs, 'player', 'fighter/guard', 'npc/a', createRng(2));
    expect(applyEffects(cs, r.effects).combatants['npc/a']!.dodging).toBe(true);
    const champ = choose(toLevel('fighter', 3), 'subclass', 'champion');
    expect(sheetCombatant(champ, 'p', '나', true, 1).critRange).toBe(19);
    const f4 = choose(choose(toLevel('fighter', 4), 'subclass', 'champion'), 'feat', 'defense');
    expect(sheetCombatant(f4, 'p', '나', true, 1).ac).toBe(sheetCombatant(champ, 'p', '나', true, 1).ac + 1);
    const al = choose(choose(toLevel('wizard', 4), 'subclass', 'evoker'), 'feat', 'alert');
    expect(sheetCombatant(al, 'p', '나', true, 1).initBonus).toBe(2);
    const valor = choose(toLevel('bard', 6), 'subclass', 'valor');
    expect(sheetCombatant(valor, 'p', '나', true, 1).extraAttack).toBe(true);
    expect(sheetCombatant(choose(toLevel('bard', 6), 'subclass', 'lore'), 'p', '나', true, 1).extraAttack).toBeUndefined();
  });

  it('생명 영역: 회복 주문 +2 + 슬롯 레벨, 요정의 위압: 내 존의 적 공포', () => {
    const base = toLevel('cleric', 3);
    const heal = (s: CharacterSheet) => {
      const hurt = { ...s, hp: 1 };
      const cs = first(startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 3 }] }, hurt, createRng(1)));
      return applyEffects(cs, resolveCard(cs, 'player', 'spell/cure_wounds', 'player', createRng(5)).effects).combatants.player!.hp;
    };
    expect(heal(choose(base, 'subclass', 'life'))).toBe(heal(choose(base, 'subclass', 'war')) + 3);
    const fey = choose(toLevel('warlock', 3), 'subclass', 'archfey');
    const cs = first(startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 2 }, { monsterId: 'bandit', zone: 2 }] }, fey, createRng(1)));
    const near = { ...cs, combatants: { ...cs.combatants, player: { ...cs.combatants.player!, zone: 2 } } };
    expect(validTargets(near, 'player', cardById('warlock/fey_presence'))).toEqual([2]);
    let scared = 0;
    for (let seed = 1; seed < 20; seed++) {
      const r = resolveCard(near, 'player', 'warlock/fey_presence', 2, createRng(seed));
      scared += r.effects.filter((e) => e.kind === 'condition' && e.condition === 'frightened').length;
      expect(r.effects.some((e) => e.kind === 'hp')).toBe(false);
    }
    expect(scared).toBeGreaterThan(0);
  });

  it('무작위 빌드로 10레벨까지 오르면 남은 선택이 없다', () => {
    const rng = (() => { const r = createRng(7); return () => r.next(); })();
    for (const c of Object.keys(CLASSES)) {
      let s = make(c);
      while (s.level < 10) {
        s = levelUp(s, { defer: true }).sheet;
        const subs = subclassesOf(c);
        if (needsSubclass(s)) s = choose(s, 'subclass', subs[Math.floor(rng() * 2)]!.id);
        while (s.pending?.length) {
          const left = Object.keys(FEATS).filter((f) => !s.feats?.includes(f));
          s = rng() < 0.5 ? choose(s, 'asi') : choose(s, 'feat', left[Math.floor(rng() * left.length)]!);
        }
      }
      expect(pendingChoices(s)).toBe(0);
      expect(autoBuild(s).texts).toEqual([]);
      expect(sheetCombatant(s, 'p', '나', true, 1).hp).toBe(s.hp);
    }
  });
});
