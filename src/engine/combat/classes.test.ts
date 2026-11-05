import { describe, expect, it } from 'vitest';
import { CLASSES } from '../character/rules';
import { classResources, createCharacter, suggestedStandardArray, type CharacterSheet } from '../character/sheet';
import { levelUp } from '../character/progression';
import { createRng } from '../dice/rng';
import { applyEffects, cardById, currentActorId, dying, endTurn, handOf, planCompanionAction, planEnemyAction, resolveCard, rollDeathSave, startCombat, unusableReason, validTargets } from './combat';
import { encounterDifficulty } from './monsters';

const sk = (cls: string) => CLASSES[cls]!.skillOptions.slice(0, CLASSES[cls]!.skillChoices);
const make = (cls: string) => createCharacter({ name: '나', classId: cls, method: 'standard', abilities: suggestedStandardArray(cls), skills: sk(cls) });
const toLevel = (cls: string, lv: number) => { let s: CharacterSheet = make(cls); const feats: string[] = []; while (s.level < lv) { const r = levelUp(s); s = r.sheet; feats.push(...r.features); } return { s, feats }; };

describe('직업 8종 · 레벨 10', () => {
  it('8종 모두 만들어지고 10레벨까지 오른다 (능력치 향상 4·8레벨, 파이터 6, 로그 10)', () => {
    expect(Object.keys(CLASSES)).toEqual(['fighter', 'rogue', 'cleric', 'wizard', 'bard', 'ranger', 'paladin', 'warlock']);
    for (const c of Object.keys(CLASSES)) {
      const { s, feats } = toLevel(c, 10);
      expect(s.level).toBe(10);
      const asi = feats.filter((f) => f.startsWith('능력치 향상')).length;
      expect(asi).toBe(c === 'fighter' || c === 'rogue' ? 3 : 2);
    }
  });
  it('주문 슬롯: 전업 시전자 5레벨 슬롯까지, 반 시전자, 워락 계약 슬롯', () => {
    expect(classResources('wizard', 10)).toMatchObject({ slot1: { max: 4 }, slot4: { max: 3 }, slot5: { max: 2 } });
    expect(classResources('bard', 9)).toMatchObject({ slot5: { max: 1 }, bardic_inspiration: { max: 4 } });
    expect(classResources('paladin', 9)).toMatchObject({ slot1: { max: 4 }, slot2: { max: 3 }, slot3: { max: 2 }, lay_on_hands: { max: 3 } });
    expect(classResources('ranger', 1)).toMatchObject({ slot1: { max: 2 } });
    expect(classResources('warlock', 1)).toEqual({ slot1: { cur: 1, max: 1 } });
    expect(classResources('warlock', 7)).toEqual({ slot4: { cur: 2, max: 2 } });
    expect(classResources('fighter', 10).second_wind!.max).toBe(4);
  });
  it('음유 영감·사냥꾼의 표식: 다음 공격이 이점', () => {
    const cs0 = startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 2 }] }, make('bard'), createRng(1), [{ id: 'npc/a', name: '동료', sheet: make('fighter') }]);
    const cs = { ...cs0, order: ['player', ...cs0.order.filter((x) => x !== 'player')], turnIndex: 0 };
    expect(validTargets(cs, 'player', cardById('bard/inspiration'))).toEqual(['npc/a']);
    const r = resolveCard(cs, 'player', 'bard/inspiration', 'npc/a', createRng(2));
    expect(applyEffects(cs, r.effects).combatants['npc/a']!.aimed).toBe(true);
    const rg = startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 2 }] }, make('ranger'), createRng(1));
    const rc = { ...rg, order: ['player', ...rg.order.filter((x) => x !== 'player')], turnIndex: 0 };
    const m = resolveCard(rc, 'player', 'ranger/hunters_mark', 'bandit#1', createRng(3));
    expect(applyEffects(rc, m.effects).combatants['bandit#1']!.marked).toBe(true);
    expect(m.effects).toContainEqual({ kind: 'resource', target: 'player', key: 'slot1', delta: -1 });
  });
  it('추가 공격(레인저·팔라딘 5), 회피(로그 7), 보호의 오라(팔라딘 6)', () => {
    const p = startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 2 }] }, toLevel('paladin', 6).s, createRng(1), [{ id: 'npc/r', name: '로그', sheet: toLevel('rogue', 7).s }]);
    expect(p.combatants.player).toMatchObject({ extraAttack: true, aura: expect.any(Number) });
    expect(p.combatants['npc/r']!.evasion).toBe(true);
    expect(startCombat({ id: 'e', enemies: [] }, toLevel('ranger', 5).s, createRng(1)).combatants.player!.extraAttack).toBe(true);
  });
  it('10레벨 난이도 예산과 고레벨 적', () => {
    expect(encounterDifficulty(['young_red_dragon'], [10, 10]).difficulty).toBe('hard'); // 5900 XP vs 2인 예산 3200·4600·6200
    expect(encounterDifficulty(['troll'], [1, 1]).difficulty).toBe('deadly');
  });
  it('전투 퍼즈: 8종 × 1·5·10레벨, 고레벨 적까지 규칙대로 끝난다', () => {
    const classes = Object.keys(CLASSES);
    const foes = ['bandit', 'troll', 'wyvern', 'young_red_dragon', 'wx_sword_saint', 'wx_demon_lord', 'goblin_warrior'];
    let fights = 0;
    for (let seed = 0; seed < 240; seed++) {
      const rng = createRng(500 + seed);
      const lv = [1, 5, 10][seed % 3]!;
      const pc = classes[seed % 8]!, ally = classes[(seed >> 3) % 8]!;
      const enemies = (lv === 1 ? ['goblin_warrior', 'bandit'] : [foes[seed % foes.length]!]).map((monsterId) => ({ monsterId, zone: 2 }));
      let cs = startCombat({ id: 'e', enemies }, toLevel(pc, lv).s, rng, [{ id: 'npc/a', name: '동료', sheet: toLevel(ally, lv).s }]);
      for (let step = 0; step < 900 && !cs.outcome; step++) {
        const id = currentActorId(cs);
        const a = cs.combatants[id]!;
        if (dying(a)) { cs = applyEffects(cs, rollDeathSave(a, rng).effects); if (!cs.outcome) cs = endTurn(cs); continue; }
        let plan: { cardId: string; target: string | number | null } | null = null;
        if (a.hp <= 0) plan = null;
        else if (a.isPlayer) {
          for (const c of handOf(a)) {
            if (unusableReason(cs, id, c)) continue;
            if (['attack', 'save_damage', 'auto_damage', 'area_save', 'mark', 'inspire'].includes(c.effect.type) || (c.effect.type === 'move' && cs.economy.action)) { plan = { cardId: c.id, target: validTargets(cs, id, c).at(-1)! }; break; }
          }
        } else plan = a.side === 'enemy' ? planEnemyAction(cs) : planCompanionAction(cs);
        if (!plan) { cs = endTurn(cs); continue; }
        expect(() => resolveCard(cs, id, plan!.cardId, plan!.target, createRng(seed + step)), `seed ${seed} ${pc} ${id} ${JSON.stringify(plan)}`).not.toThrow();
        cs = applyEffects(cs, resolveCard(cs, id, plan.cardId, plan.target, rng).effects);
      }
      if (cs.outcome) fights++;
    }
    expect(fights).toBe(240);
  });
});
