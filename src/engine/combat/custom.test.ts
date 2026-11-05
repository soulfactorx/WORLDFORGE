import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../character/sheet';
import { createRng } from '../dice/rng';
import { applyPack, buildRulesPack, planImport } from '../package/packs';
import { validateWorld } from '../package/validate';
import type { CustomMonster, WorldPackage } from '../schema';
import { applyEffects, currentActorId, dying, endTurn, handOf, planCompanionAction, planEnemyAction, resolveCard, rollDeathSave, startCombat, unusableReason, validTargets } from './combat';
import { compileMonster, encounterDifficulty, monsterTable } from './monsters';
import { scenarioDraftSchema } from '../../gm/worldgen/draft';

const wraith: CustomMonster = {
  id: 'mon/sand-wraith', name: '모래 망령', look: '모래바람 속의 일그러진 형체', role: 'boss', cr: '2', xp: 450, ac: 13, hp: 40,
  abilities: { str: 10, dex: 15, con: 14, int: 8, wis: 12, cha: 14 }, immune: ['poisoned'],
  attacks: [{ name: '모래 손톱', kind: 'melee', toHit: 5, damage: '1d6', bonus: 3, type: '참격', count: 2, inflict: { condition: 'blinded', save: 'con', dc: 12, rounds: 1 } }],
  specials: [{ name: '모래 폭풍', kind: 'area', save: 'dex', dc: 13, damage: '3d6', type: '참격', range: 1, uses: 1 }],
  phases: [{ below: 0.5, line: '망령이 울부짖는다!', ac: 1, attacks: [{ name: '흡혼', kind: 'melee', toHit: 6, damage: '3d8', bonus: 2, type: '사령' }] }],
};
const world = (): WorldPackage => ({
  ...structuredClone(sampleWorld), monsters: [wraith],
  encounters: [...(sampleWorld.encounters ?? []), { id: 'enc/wraith', name: '모래 망령', locationId: 'loc/old-road', enemies: [{ monsterId: 'mon/sand-wraith', zone: 2 }], trigger: '…' }],
});
const make = (cls: string, sk: string[]) => createCharacter({ name: '나', classId: cls, method: 'standard', abilities: suggestedStandardArray(cls), skills: sk as never });

describe('세계만의 적', () => {
  it('제작자 형식을 전투 카드로 바꾸고, 검사기·난이도·AI 스키마에 들어간다', () => {
    const m = compileMonster(wraith);
    expect(m.cards.map((c) => c.id)).toEqual(['monster/custom/sand-wraith/a0', 'monster/custom/sand-wraith/s0']);
    expect(m.resources).toEqual({ s0: 1 });
    expect(m.phases![0]!.addCards![0]!.name).toBe('흡혼');
    const w = world();
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
    expect(encounterDifficulty(['mon/sand-wraith'], [1, 1], monsterTable(w)).xp).toBe(450);
    expect(JSON.stringify(scenarioDraftSchema(Object.keys(monsterTable(w))))).toContain('mon/sand-wraith');
    const bad = { ...w, monsters: [{ ...wraith, id: 'sand', attacks: [] }] };
    expect(validateWorld(bad).filter((i) => i.level === 'error').map((i) => i.path)).toEqual(expect.arrayContaining(['monsters[0].id', 'monsters[0].attacks', 'encounters[2].enemies[0].monsterId']));
  });
  it('전투가 규칙대로 끝나고, 보스 단계·기술·상태 이상이 동작한다', () => {
    const table = monsterTable(world());
    let phases = 0, specials = 0, blinded = 0, fights = 0;
    for (let seed = 0; seed < 120; seed++) {
      const rng = createRng(seed);
      const hero = { ...make('fighter', ['athletics', 'perception']), level: 4, hp: 40, maxHp: 40 };
      let cs = startCombat({ id: 'enc/wraith', enemies: [{ monsterId: 'mon/sand-wraith', zone: 2 }] }, hero, rng, [], {}, table);
      expect(cs.combatants['mon/sand-wraith#1']!.immune).toEqual(['poisoned']);
      for (let step = 0; step < 400 && !cs.outcome; step++) {
        const id = currentActorId(cs);
        const a = cs.combatants[id]!;
        if (dying(a)) { cs = applyEffects(cs, rollDeathSave(a, rng).effects); if (!cs.outcome) cs = endTurn(cs); continue; }
        let plan: { cardId: string; target: string | number | null } | null = null;
        if (a.hp <= 0) plan = null;
        else if (a.isPlayer) {
          for (const c of handOf(a)) {
            if (unusableReason(cs, id, c)) continue;
            if (c.effect.type === 'attack' || (c.effect.type === 'move' && cs.economy.action)) { plan = { cardId: c.id, target: validTargets(cs, id, c).at(-1)! }; break; }
          }
        } else plan = a.side === 'enemy' ? planEnemyAction(cs) : planCompanionAction(cs);
        if (!plan) { cs = endTurn(cs); continue; }
        const r = resolveCard(cs, id, plan.cardId, plan.target, rng);
        if (r.effects.some((e) => e.kind === 'phase')) phases++;
        if (plan.cardId.endsWith('/s0')) specials++;
        if (r.effects.some((e) => e.kind === 'condition' && e.condition === 'blinded')) blinded++;
        cs = applyEffects(cs, r.effects);
      }
      if (cs.outcome) fights++;
    }
    expect(fights).toBe(120);
    expect(phases).toBeGreaterThan(0);
    expect(specials).toBeGreaterThan(0);
    expect(blinded).toBeGreaterThan(0);
  });
  it('규칙 패키지로 주고받는다 (ID가 겹치면 고른다)', () => {
    const pack = buildRulesPack(world(), { id: 'test.desert-rules', name: '사막 규칙', version: '1.0.0', author: '나', license: 'CC-BY-4.0' });
    expect(pack.monsters?.map((m) => m.id)).toEqual(['mon/sand-wraith']);
    const into = applyPack(sampleWorld, pack);
    expect(into.world.monsters?.map((m) => m.id)).toEqual(['mon/sand-wraith']);
    expect(planImport(into.world, pack).conflicts).toEqual([{ kind: '적', id: 'mon/sand-wraith', existing: '모래 망령', incoming: '모래 망령' }]);
    const again = applyPack(into.world, pack);
    expect(again.world.monsters?.map((m) => m.id)).toEqual(['mon/sand-wraith', 'mon/sand-wraith-2']);
  });
});
