import { describe, expect, it } from 'vitest';
import { createRng } from '../dice/rng';
import { type CharacterSheet, classResources, createCharacter, suggestedStandardArray } from '../character/sheet';
import { applyEffects, currentActorId, dying, endTurn, handOf, planCompanionAction, planEnemyAction, resolveCard, rollDeathSave, startCombat, unusableReason, validTargets } from './combat';

/**
 * 무작위 전투 시뮬레이션: AI가 계획한 행동이 항상 규칙상 유효한지, 전투가 항상 끝나는지 확인한다.
 * (v0.11 개발 중 동료 AI가 자기 전용 치료를 쓰러진 아군에게 쓰려다 전투가 멈추는 버그를 잡은 테스트)
 */
const make = (classId: string, skills: string[], name = '나'): CharacterSheet =>
  createCharacter({ name, classId, method: 'standard', abilities: suggestedStandardArray(classId), skills: skills as never });
const SKILLS: Record<string, string[]> = {
  fighter: ['athletics', 'perception'], rogue: ['stealth', 'perception', 'investigation', 'acrobatics'],
  cleric: ['insight', 'medicine'], wizard: ['arcana', 'history'],
};

describe('전투 퍼즈', () => {
  it('AI 계획은 항상 유효하고 전투는 끝난다', () => {
    const classes = Object.keys(SKILLS);
    const encounters = [
      [{ monsterId: 'goblin_warrior', zone: 2 }, { monsterId: 'goblin_warrior', zone: 3 }],
      [{ monsterId: 'wolf', zone: 2 }, { monsterId: 'wolf', zone: 3 }],
      [{ monsterId: 'wolf', zone: 2 }, { monsterId: 'goblin_warrior', zone: 3 }, { monsterId: 'goblin_warrior', zone: 3 }],
    ];
    let fights = 0;
    const stuck: string[] = [];
    for (let seed = 0; seed < 600; seed++) {
      const rng = createRng(seed);
      const pc = classes[seed % 4]!, ally = classes[(seed >> 2) % 4]!;
      let cs = startCombat({ id: 'e', enemies: encounters[seed % 3]! }, make(pc, SKILLS[pc]!), rng,
        seed % 5 === 0 ? [] : [{ id: 'npc/a', name: '동료', sheet: make(ally, SKILLS[ally]!, '동료') }]);
      for (let step = 0; step < 600 && !cs.outcome; step++) {
        const id = currentActorId(cs);
        const a = cs.combatants[id]!;
        let plan: { cardId: string; target: string | number | null } | null = null;
        if (dying(a)) {
          cs = applyEffects(cs, rollDeathSave(a, rng).effects);
          if (!cs.outcome) cs = endTurn(cs);
          continue;
        }
        if (a.hp <= 0) plan = null;
        else if (a.isPlayer) {
          // 플레이어: 쓸 수 있는 첫 공격 카드 → 없으면 앞으로 이동
          for (const c of handOf(a)) {
            if (unusableReason(cs, id, c)) continue;
            if (['attack', 'save_damage', 'auto_damage'].includes(c.effect.type) || (c.effect.type === 'move' && cs.economy.action)) {
              plan = { cardId: c.id, target: validTargets(cs, id, c).at(-1)! };
              break;
            }
          }
        } else plan = a.side === 'enemy' ? planEnemyAction(cs) : planCompanionAction(cs);
        if (!plan) { cs = endTurn(cs); continue; }
        expect(() => resolveCard(cs, id, plan!.cardId, plan!.target, createRng(seed + step)), `seed ${seed} ${id} ${JSON.stringify(plan)}`).not.toThrow();
        cs = applyEffects(cs, resolveCard(cs, id, plan.cardId, plan.target, rng).effects);
      }
      if (cs.outcome) fights++;
      else if (stuck.length < 4) stuck.push(`seed ${seed} pc=${pc} ally=${ally}: ` + Object.values(cs.combatants).map((c) => `${c.id}@${c.zone} hp${c.hp}/${c.maxHp}${c.prone ? ' prone' : ''}${c.stable ? ' stable' : ''}${c.dead ? ' dead' : ''}`).join(', ') + ` round ${cs.round}`);
    }
    expect(stuck).toEqual([]);
    expect(fights).toBeGreaterThan(590);
  });
});

describe('전투 퍼즈 — 장르별 적 세트 (설계 v3 R2)', () => {
  it('모든 적이 들어간 전투는 규칙상 유효하게 끝나고, 보스 단계·도망이 동작한다', async () => {
    const { MONSTERS } = await import('./monsters');
    const ids = Object.keys(MONSTERS);
    const classes = Object.keys(SKILLS);
    let fights = 0, phases = 0, escapes = 0, conditions = 0;
    const stuck: string[] = [];
    for (let seed = 0; seed < 800; seed++) {
      const rng = createRng(1000 + seed);
      const pc = classes[seed % 4]!;
      const enemies = [ids[seed % ids.length]!, ids[(seed * 7 + 3) % ids.length]!].map((monsterId, i) => ({ monsterId, zone: 2 + (i % 2) }));
      // 강한 적이 섞여도 끝나도록 레벨 3~5 파티 + 동료 (4~5레벨 능력도 함께 검사)
      const level = 3 + (seed % 3);
      const hero = { ...make(pc, SKILLS[pc]!), level, hp: 30, maxHp: 30, resources: classResources(pc, level) };
      const ally = classes[(seed >> 2) % 4]!;
      let cs = startCombat({ id: 'e', enemies }, hero, rng, [{ id: 'npc/a', name: '동료', sheet: { ...make(ally, SKILLS[ally]!, '동료'), level, hp: 30, maxHp: 30, resources: classResources(ally, level) } }]);
      for (let step = 0; step < 800 && !cs.outcome; step++) {
        const id = currentActorId(cs);
        const a = cs.combatants[id]!;
        if (dying(a)) { cs = applyEffects(cs, rollDeathSave(a, rng).effects); if (!cs.outcome) cs = endTurn(cs); continue; }
        let plan: { cardId: string; target: string | number | null } | null = null;
        if (a.hp <= 0) plan = null;
        else if (a.isPlayer) {
          for (const c of handOf(a)) {
            if (unusableReason(cs, id, c)) continue;
            if (['attack', 'save_damage', 'auto_damage'].includes(c.effect.type) || (c.effect.type === 'move' && cs.economy.action)) { plan = { cardId: c.id, target: validTargets(cs, id, c).at(-1)! }; break; }
          }
        } else plan = a.side === 'enemy' ? planEnemyAction(cs) : planCompanionAction(cs);
        if (!plan) { cs = endTurn(cs); continue; }
        expect(() => resolveCard(cs, id, plan!.cardId, plan!.target, createRng(seed + step)), `seed ${seed} ${id} ${JSON.stringify(plan)}`).not.toThrow();
        const r = resolveCard(cs, id, plan.cardId, plan.target, rng);
        if (r.effects.some((e) => e.kind === 'phase')) phases++;
        if (r.effects.some((e) => e.kind === 'escaped')) escapes++;
        if (r.effects.some((e) => e.kind === 'condition')) conditions++;
        cs = applyEffects(cs, r.effects);
      }
      if (cs.outcome) fights++;
      else if (stuck.length < 4) stuck.push(`seed ${seed} ${enemies.map((e) => e.monsterId).join('+')}: round ${cs.round}`);
    }
    expect(stuck).toEqual([]);
    expect(fights).toBeGreaterThan(790);
    expect(phases).toBeGreaterThan(0);
    expect(escapes).toBeGreaterThan(0);
    expect(conditions).toBeGreaterThan(0);
  });
});

describe('전투 퍼즈 — 하위 직업·특성 (v0.37)', () => {
  it('직업 8종 × 무작위 하위 직업·특성: 아무 카드나 아무 대상에 써도 규칙상 유효하고 전투는 끝난다', async () => {
    const { CLASSES } = await import('../character/rules');
    const { levelUp } = await import('../character/progression');
    const { applyBuildChoice, FEATS, needsSubclass, subclassesOf } = await import('../character/build');
    const classes = Object.keys(CLASSES);
    const build = (cls: string, level: number, r: () => number, name: string) => {
      let s = createCharacter({ name, classId: cls, method: 'standard', abilities: suggestedStandardArray(cls), skills: CLASSES[cls]!.skillOptions.slice(0, CLASSES[cls]!.skillChoices) as never });
      while (s.level < level) {
        s = levelUp(s, { defer: true }).sheet;
        if (needsSubclass(s)) s = applyBuildChoice(s, 'subclass', subclassesOf(cls)[r() < 0.5 ? 0 : 1]!.id)!.sheet;
        while (s.pending?.length) {
          const left = Object.keys(FEATS).filter((f) => !s.feats?.includes(f));
          s = applyBuildChoice(s, r() < 0.3 ? 'asi' : 'feat', left[Math.floor(r() * left.length)]!)!.sheet;
        }
      }
      return s;
    };
    let fights = 0;
    const used = new Set<string>();
    const stuck: string[] = [];
    for (let seed = 0; seed < 480; seed++) {
      const rng = createRng(5000 + seed);
      const r = () => rng.next();
      const level = 3 + (seed % 6);
      const pc = classes[seed % 8]!, ally = classes[(seed >> 3) % 8]!;
      let cs = startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 2 }, { monsterId: 'wolf', zone: 3 }, { monsterId: 'goblin_warrior', zone: 2 }] }, build(pc, level, r, '나'), rng,
        [{ id: 'npc/a', name: '동료', sheet: build(ally, level, r, '동료') }]);
      for (let step = 0; step < 800 && !cs.outcome; step++) {
        const id = currentActorId(cs);
        const a = cs.combatants[id]!;
        if (dying(a)) { cs = applyEffects(cs, rollDeathSave(a, rng).effects); if (!cs.outcome) cs = endTurn(cs); continue; }
        let plan: { cardId: string; target: string | number | null } | null = null;
        if (a.hp <= 0) plan = null;
        else if (a.isPlayer) {
          const usable = handOf(a).filter((c) => !unusableReason(cs, id, c) && c.effect.type !== 'flee' && (c.cost !== 'move' || c.effect.type !== 'move' || r() < 0.3));
          // 공격 카드 위주로, 가끔은 아무 카드나 (새 카드도 모두 써 보도록)
          const pick = usable.map((c) => [r(), c] as const).sort((x, y) => x[0] - y[0]).map(([, c]) => c).filter((c) => c.kind !== 'basic' && (r() < 0.6 || ['attack', 'save_damage', 'area_save', 'auto_damage'].includes(c.effect.type)))[0] ?? usable.find((c) => c.effect.type === 'move' && cs.economy.action);
          if (pick) { const ts = validTargets(cs, id, pick); plan = { cardId: pick.id, target: ts[Math.floor(r() * ts.length)]! }; }
        } else plan = a.side === 'enemy' ? planEnemyAction(cs) : planCompanionAction(cs);
        if (!plan) { cs = endTurn(cs); continue; }
        expect(() => resolveCard(cs, id, plan!.cardId, plan!.target, createRng(seed + step)), `seed ${seed} ${id} ${JSON.stringify(plan)}`).not.toThrow();
        used.add(plan.cardId);
        cs = applyEffects(cs, resolveCard(cs, id, plan.cardId, plan.target, rng).effects);
      }
      if (cs.outcome) fights++;
      else if (stuck.length < 4) stuck.push(`seed ${seed} ${pc}/${ally} lv${level}: round ${cs.round}`);
    }
    expect(stuck).toEqual([]);
    expect(fights).toBeGreaterThan(470);
    for (const c of ['fighter/guard', 'cleric/war_strike', 'wizard/portent', 'bard/cutting_words', 'paladin/sacred_weapon', 'paladin/vow', 'warlock/fey_presence']) expect(used, c).toContain(c);
  });
});
