import { describe, expect, it } from 'vitest';
import { createRng } from '../dice/rng';
import { classResources, createCharacter, suggestedStandardArray, type CharacterSheet } from '../character/sheet';
import {
  applyEffects, cardById, dying, rollDeathSave, scaleDice, slotFor, type CombatState, currentActorId, endTurn, planEnemyAction, resolveCard, rollDamage,
  runEnemyTurns, runAutoTurns, planCompanionAction, startCombat, unusableReason, validTargets,
} from './combat';

const sheet = (classId: string, skills: string[]) =>
  createCharacter({ name: '나', classId, method: 'standard', abilities: suggestedStandardArray(classId), skills: skills as never });
const fighter = () => sheet('fighter', ['athletics', 'perception']);
const rogue = () => sheet('rogue', ['stealth', 'perception', 'investigation', 'acrobatics']);
const wizard = () => sheet('wizard', ['arcana', 'history']);
const cleric = () => sheet('cleric', ['insight', 'medicine']);

/** 플레이어 차례로 맞춘 전투 상태 */
function playerFirst(cs: CombatState): CombatState {
  return { ...cs, order: ['player', ...cs.order.filter((id) => id !== 'player')], turnIndex: 0 };
}

describe('전투 시작', () => {
  it('우선권 순서는 시드로 결정적이다', () => {
    const enc = { id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }, { monsterId: 'wolf', zone: 2 }] };
    const a = startCombat(enc, fighter(), createRng(9));
    const b = startCombat(enc, fighter(), createRng(9));
    expect(a.order).toEqual(b.order);
    expect(a.order).toHaveLength(3);
    expect(a.combatants['wolf#2']!.name).toBe('늑대 2');
    expect(a.combatants.player!.ac).toBe(16);
  });
});

describe('사거리와 행동 경제', () => {
  const base = () => playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'goblin_warrior', zone: 2 }] }, fighter(), createRng(1)));
  it('근접은 같은 존만', () => {
    const cs = base();
    expect(unusableReason(cs, 'player', cardById('weapon/longsword'))).toBe('사거리 안에 대상이 없다');
    expect(validTargets(cs, 'player', cardById('weapon/javelin'))).toEqual(['goblin_warrior#1']);
  });
  it('이동 후 근접 공격 가능, 행동은 한 번만', () => {
    let cs = base();
    const rng = createRng(5);
    cs = applyEffects(cs, resolveCard(cs, 'player', 'basic/move', 2, rng).effects);
    expect(unusableReason(cs, 'player', cardById('basic/move'))).toBe('이동을 이미 사용했다');
    expect(unusableReason(cs, 'player', cardById('weapon/longsword'))).toBeNull();
    cs = applyEffects(cs, resolveCard(cs, 'player', 'weapon/longsword', 'goblin_warrior#1', rng).effects);
    expect(unusableReason(cs, 'player', cardById('weapon/javelin'))).toBe('행동을 이미 사용했다');
    expect(() => resolveCard(cs, 'player', 'weapon/javelin', 'goblin_warrior#1', rng)).toThrow();
  });
  it('보너스 행동은 행동과 별개, 자원을 소모한다', () => {
    let cs = base();
    cs.combatants.player!.hp = 3;
    const rng = createRng(2);
    cs = applyEffects(cs, resolveCard(cs, 'player', 'fighter/second_wind', 'player', rng).effects);
    expect(cs.combatants.player!.hp).toBeGreaterThan(3);
    expect(cs.combatants.player!.resources.second_wind!.cur).toBe(1);
    expect(cs.economy.action).toBe(true);
  });
  it('원거리 공격은 같은 존에 적이 있으면 불리점', () => {
    let cs = base();
    cs.combatants['goblin_warrior#1']!.zone = 1;
    for (let seed = 0; seed < 20; seed++) {
      const r = resolveCard(cs, 'player', 'weapon/javelin', 'goblin_warrior#1', createRng(seed));
      expect(r.log[0]).toContain('불리점');
    }
  });
});

describe('주문과 특수 규칙', () => {
  it('마법 화살은 반드시 명중하고 주문 슬롯을 소모한다', () => {
    let cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 3 }] }, wizard(), createRng(1)));
    const r = resolveCard(cs, 'player', 'spell/magic_missile', 'wolf#1', createRng(3));
    const dmg = -(r.effects.find((e) => e.kind === 'hp') as { delta: number }).delta;
    expect(dmg).toBeGreaterThanOrEqual(6);
    expect(dmg).toBeLessThanOrEqual(15);
    cs = applyEffects(cs, r.effects);
    cs = endTurn(endTurn(cs));
    cs = playerFirst(cs);
    cs = applyEffects(cs, resolveCard(cs, 'player', 'spell/magic_missile', 'wolf#1', createRng(4)).effects);
    expect(cs.combatants.player!.resources.slot1!.cur).toBe(0);
  });
  it('치명타는 피해 주사위를 두 배로 굴린다', () => {
    expect(rollDamage(createRng(1), '1d8', true).rolls).toHaveLength(2);
    expect(rollDamage(createRng(1), '2d6+3').rolls).toHaveLength(2);
  });
  it('숨은 로그는 이점 → 암습 피해', () => {
    let cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }] }, rogue(), createRng(1)));
    cs.combatants.player!.hidden = true;
    let sneaks = 0;
    for (let seed = 0; seed < 40; seed++) {
      const r = resolveCard(cs, 'player', 'weapon/shortbow', 'wolf#1', createRng(seed));
      expect(r.log[0]).toContain('이점');
      if (r.log[0]!.includes('암습')) sneaks++;
      expect(r.effects.some((e) => e.kind === 'flag' && e.target === 'player' && e.hidden === false)).toBe(true);
    }
    expect(sneaks).toBeGreaterThan(0);
  });
  it('회피 중인 대상 공격은 불리점, 자기 차례가 오면 풀린다', () => {
    let cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }] }, fighter(), createRng(1)));
    cs.combatants['wolf#1']!.zone = 1;
    cs = applyEffects(cs, resolveCard(cs, 'player', 'basic/dodge', 'player', createRng(1)).effects);
    cs = endTurn(cs);
    expect(currentActorId(cs)).toBe('wolf#1');
    expect(resolveCard(cs, 'wolf#1', 'monster/wolf/bite', 'player', createRng(2)).log[0]).toContain('불리점');
    cs = endTurn(cs);
    expect(cs.combatants.player!.dodging).toBe(false);
  });
  it('도주는 후열에서, 적이 없을 때만', () => {
    let cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 3 }] }, fighter(), createRng(1)));
    expect(unusableReason(cs, 'player', cardById('basic/flee'))).toBe('아군 후열에서만 도주할 수 있다');
    cs = applyEffects(cs, resolveCard(cs, 'player', 'basic/move', 0, createRng(1)).effects);
    cs = applyEffects(cs, resolveCard(cs, 'player', 'basic/flee', 'player', createRng(1)).effects);
    expect(cs.outcome).toBe('fled');
  });
});

describe('적 AI와 승패', () => {
  it('늑대는 다가와서 문다', () => {
    let cs = startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }] }, fighter(), createRng(1));
    cs = { ...cs, order: ['wolf#1', 'player'], turnIndex: 0 };
    expect(planEnemyAction(cs)).toEqual({ cardId: 'basic/move', target: 1 });
    const { state, steps } = runEnemyTurns(cs, createRng(3));
    expect(steps.filter((s) => s.kind === 'action').map((s) => s.kind === 'action' && s.cardId)).toEqual(['basic/move', 'monster/wolf/bite']);
    expect(currentActorId(state)).toBe('player');
  });
  it('고블린은 후열에서 활을 쏜다', () => {
    let cs = startCombat({ id: 'e', enemies: [{ monsterId: 'goblin_warrior', zone: 3 }] }, fighter(), createRng(1));
    cs = { ...cs, order: ['goblin_warrior#1', 'player'], turnIndex: 0 };
    expect(planEnemyAction(cs)).toEqual({ cardId: 'monster/goblin/shortbow', target: 'player' });
  });
  it('적을 모두 쓰러뜨리면 승리, 플레이어가 쓰러지면 패배', () => {
    const cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 1 }] }, fighter(), createRng(1)));
    expect(applyEffects(cs, [{ kind: 'hp', target: 'wolf#1', delta: -99 }]).outcome).toBe('victory');
    expect(applyEffects(cs, [{ kind: 'hp', target: 'player', delta: -99 }]).outcome).toBe('defeat');
  });
  it('긴 전투도 결정적으로 끝난다 (시뮬레이션)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const rng = createRng(seed);
      let cs = startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }, { monsterId: 'goblin_warrior', zone: 3 }] }, fighter(), rng);
      for (let i = 0; i < 100 && !cs.outcome; i++) {
        const r = runEnemyTurns(cs, rng);
        cs = r.state;
        if (cs.outcome) break;
        // 플레이어: 가까운 적에게 근접, 없으면 이동, 그다음 재블린
        for (const [card, pickTarget] of [['weapon/longsword', 0], ['basic/move', 'fwd'], ['weapon/longsword', 0], ['weapon/javelin', 0]] as const) {
          const c = cardById(card);
          if (unusableReason(cs, 'player', c)) continue;
          const ts = validTargets(cs, 'player', c);
          const t = pickTarget === 'fwd' ? ts.find((z) => typeof z === 'number' && z > cs.combatants.player!.zone) : ts[0];
          if (t === undefined) continue;
          cs = applyEffects(cs, resolveCard(cs, 'player', card, t, rng).effects);
          if (cs.outcome) break;
        }
        if (!cs.outcome) cs = endTurn(cs);
      }
      expect(cs.outcome).toBeDefined();
    }
  });
});

describe('동료 파티', () => {
    const withParty = (seed = 1) => startCombat(
    { id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }, { monsterId: 'goblin_warrior', zone: 3 }] },
    fighter(), createRng(seed),
    [{ id: 'npc/ilse', name: '일제', sheet: { ...cleric(), name: '일제' } }],
  );
  const turnOf = (cs: CombatState, id: string): CombatState => ({ ...cs, order: [id, ...cs.order.filter((x) => x !== id)], turnIndex: 0 });

  it('동료가 아군으로 참가한다', () => {
    const cs = withParty();
    expect(cs.combatants['npc/ilse']!.side).toBe('party');
    expect(cs.order).toHaveLength(4);
  });
  it('클레릭 동료는 위급한 아군을 치료한다', () => {
    let cs = turnOf(withParty(), 'npc/ilse');
    cs.combatants.player!.hp = 2;
    expect(planCompanionAction(cs)).toEqual({ cardId: 'spell/cure_wounds', target: 'player' });
    cs = applyEffects(cs, resolveCard(cs, 'npc/ilse', 'spell/cure_wounds', 'player', createRng(1)).effects);
    expect(cs.combatants.player!.hp).toBeGreaterThan(2);
    expect(cs.combatants['npc/ilse']!.resources.slot1!.cur).toBe(1);
  });
  it('집중 공격 명령: 지정한 적을 노린다', () => {
    const cs = turnOf(withParty(), 'npc/ilse');
    expect(planCompanionAction(cs, { mode: 'focus', focus: 'goblin_warrior#1', conserve: false }))
      .toEqual({ cardId: 'spell/sacred_flame', target: 'goblin_warrior#1' });
  });
  it('자원 아끼기: 슬롯 주문을 쓰지 않는다 (위급 치료는 예외)', () => {
    const wiz = startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 3 }] }, fighter(), createRng(1),
      [{ id: 'npc/w', name: '마법사', sheet: { ...wizard(), name: '마법사' } }]);
    const cs = turnOf(wiz, 'npc/w');
    const p = planCompanionAction(cs, { mode: 'free', conserve: true });
    expect(p?.cardId).toBe('spell/fire_bolt');
  });
  it('후방 유지: 후열로 물러난다', () => {
    const cs = turnOf(withParty(), 'npc/ilse');
    expect(cs.combatants['npc/ilse']!.zone).toBe(1);
    expect(planCompanionAction(cs, { mode: 'hold_back', conserve: false })?.cardId).toBe('spell/sacred_flame');
    const noTargets: CombatState = structuredClone(cs);
    noTargets.combatants['wolf#1']!.hp = 0;
    noTargets.combatants['npc/ilse']!.cards = ['weapon/mace'];
    expect(planCompanionAction(noTargets, { mode: 'hold_back', conserve: false })).toEqual({ cardId: 'basic/move', target: 0 });
  });
  it('플레이어가 쓰러져도 동료가 남아 있으면 전투는 계속된다', () => {
    let cs = withParty();
    cs = applyEffects(cs, [{ kind: 'hp', target: 'player', delta: -99 }]);
    expect(cs.outcome).toBeUndefined();
    cs = applyEffects(cs, [{ kind: 'hp', target: 'npc/ilse', delta: -99 }]);
    expect(cs.outcome).toBe('defeat');
  });
  it('플레이어가 쓰러지면 자동 진행이 전투 끝까지 간다', () => {
    let cs = withParty(3);
    cs = applyEffects(cs, [{ kind: 'hp', target: 'player', delta: -99 }]);
    const { state } = runAutoTurns(cs, createRng(3));
    expect(state.outcome).toBeDefined();
  });
  it('암습: 대상 옆에 아군이 있으면 이점 없이도 발동', () => {
    const cs0 = startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }] }, rogue(), createRng(1),
      [{ id: 'npc/b', name: '브란', sheet: { ...fighter(), name: '브란' } }]);
    const cs = playerFirst(cs0);
    cs.combatants['npc/b']!.zone = 2;
    let sneaks = 0;
    for (let seed = 0; seed < 30; seed++) if (resolveCard(cs, 'player', 'weapon/shortbow', 'wolf#1', createRng(seed)).log[0]!.includes('암습')) sneaks++;
    expect(sneaks).toBeGreaterThan(0);
  });
});

describe('2~3레벨 능력', () => {
  const at = (sh: CharacterSheet, level: number): CharacterSheet => ({ ...sh, level, resources: classResources(sh.classId, level) });
  const fight = (sh: CharacterSheet, enemies = [{ monsterId: 'wolf', zone: 2 }, { monsterId: 'wolf', zone: 2 }]) =>
    playerFirst(startCombat({ id: 'e', enemies }, sh, createRng(1)));

  it('주문 슬롯 표와 올려 시전', () => {
    expect(classResources('wizard', 3)).toMatchObject({ slot1: { max: 4 }, slot2: { max: 2 } });
    expect(classResources('cleric', 2)).toMatchObject({ slot1: { max: 3 }, channel_divinity: { max: 2 } });
    expect(scaleDice('2d8', '2d8', 1)).toBe('4d8');
    expect(scaleDice('3d6+1', '1d6', 2)).toBe('5d6+1');
    let cs = fight(at(wizard(), 3), [{ monsterId: 'wolf', zone: 3 }]);
    cs.combatants.player!.resources.slot1!.cur = 0;
    expect(slotFor(cs.combatants.player!, 1)).toBe(2);
    const r = resolveCard(cs, 'player', 'spell/magic_missile', 'wolf#1', createRng(2));
    expect(r.log[0]).toContain('2레벨 슬롯, 1단계 상승');
    expect(r.log[0]!.match(/\(([\d+]+)\)/)![1]!.split('+')).toHaveLength(4); // 화살 4발
    cs = applyEffects(cs, r.effects);
    expect(cs.combatants.player!.resources.slot2!.cur).toBe(1);
  });
  it('행동 연쇄: 행동을 쓴 뒤 한 번 더', () => {
    let cs = fight(at(fighter(), 2));
    cs.combatants['wolf#1']!.zone = 1;
    expect(unusableReason(cs, 'player', cardById('fighter/action_surge'))).toBe('아직 행동이 남아 있다');
    cs = applyEffects(cs, resolveCard(cs, 'player', 'weapon/longsword', 'wolf#1', createRng(3)).effects);
    cs = applyEffects(cs, resolveCard(cs, 'player', 'fighter/action_surge', 'player', createRng(3)).effects);
    expect(cs.economy.action).toBe(true);
    expect(cs.combatants.player!.resources.action_surge!.cur).toBe(0);
  });
  it('투사 3레벨: 19에도 치명타', () => {
    const cs = fight(at(fighter(), 3));
    cs.combatants['wolf#1']!.zone = 1;
    expect(cs.combatants.player!.critRange).toBe(19);
    let found = false;
    for (let seed = 0; seed < 300 && !found; seed++) {
      const line = resolveCard(cs, 'player', 'weapon/longsword', 'wolf#1', createRng(seed)).log[0]!;
      if (line.includes('d20(19)')) { expect(line).toContain('치명타'); found = true; }
    }
    expect(found).toBe(true);
  });
  it('로그: 교활한 행동(보너스 이동)과 정밀 조준, 3레벨 암습 2d6', () => {
    let cs = fight(at(rogue(), 3));
    expect(cs.combatants.player!.sneakAttack).toBe('2d6');
    cs = applyEffects(cs, resolveCard(cs, 'player', 'rogue/steady_aim', 'player', createRng(1)).effects);
    expect(cs.economy.move).toBe(false);
    expect(cs.combatants.player!.aimed).toBe(true);
    const r = resolveCard(cs, 'player', 'weapon/shortbow', 'wolf#1', createRng(4));
    expect(r.log[0]).toContain('이점(조준)');
    const cs2 = fight(at(rogue(), 2));
    expect(validTargets(cs2, 'player', cardById('rogue/cunning_dash'))).toEqual([0, 2]);
  });
  it('클레릭: 치유의 말(2존, 보너스), 인도의 화살 표식', () => {
    let cs = fight(at(cleric(), 3), [{ monsterId: 'wolf', zone: 3 }]);
    cs.combatants.player!.hp = 3;
    cs = applyEffects(cs, resolveCard(cs, 'player', 'spell/healing_word', 'player', createRng(1)).effects);
    expect(cs.economy.bonus).toBe(false);
    expect(cs.combatants.player!.hp).toBeGreaterThan(3);
    for (let seed = 0; seed < 50; seed++) {
      const r = resolveCard(cs, 'player', 'spell/guiding_bolt', 'wolf#1', createRng(seed));
      if (r.log[0]!.includes('명중')) {
        const next = applyEffects(cs, r.effects);
        if (next.combatants['wolf#1']!.hp > 0) { expect(next.combatants['wolf#1']!.marked).toBe(true); return; }
      }
    }
    throw new Error('명중 사례 없음');
  });
  it('위저드: 타오르는 손길은 내 존의 모든 적에게', () => {
    const cs = fight(at(wizard(), 2));
    cs.combatants['wolf#1']!.zone = 1;
    cs.combatants['wolf#2']!.zone = 1;
    expect(validTargets(cs, 'player', cardById('spell/burning_hands'))).toEqual([1]);
    const r = resolveCard(cs, 'player', 'spell/burning_hands', 1, createRng(5));
    expect(r.log).toHaveLength(3);
    expect(r.effects.filter((e) => e.kind === 'hp')).toHaveLength(2);
  });
  it('작열 광선: 광선 3줄', () => {
    const cs = fight(at(wizard(), 3), [{ monsterId: 'goblin_warrior', zone: 3 }]);
    cs.combatants['goblin_warrior#1']!.hp = 999; cs.combatants['goblin_warrior#1']!.maxHp = 999;
    expect(resolveCard(cs, 'player', 'spell/scorching_ray', 'goblin_warrior#1', createRng(1)).log).toHaveLength(3);
  });
});

describe('기회 공격·죽음 내성·넘어짐', () => {
  const duel = (seed = 1) => {
    const cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'goblin_warrior', zone: 2 }] }, fighter(), createRng(seed)));
    cs.combatants['goblin_warrior#1']!.zone = 1;
    return cs;
  };
  it('적이 있는 존을 떠나면 기회 공격, 반응은 라운드당 한 번', () => {
    const cs = duel();
    const r = resolveCard(cs, 'player', 'basic/move', 0, createRng(2));
    expect(r.log[0]).toContain('기회 공격');
    expect(r.effects).toContainEqual({ kind: 'flag', target: 'goblin_warrior#1', reactionUsed: true });
    const after = applyEffects(cs, r.effects);
    if (after.combatants.player!.zone === 0) {
      // 같은 라운드에 다시 지나가도 반응이 없다
      after.combatants['goblin_warrior#1']!.zone = 0;
      after.economy.move = true;
      expect(resolveCard(after, 'player', 'basic/move', 1, createRng(3)).log[0]).not.toContain('기회 공격');
    }
  });
  it('후퇴하면 기회 공격이 없다, 들어가는 것은 괜찮다', () => {
    let cs = duel();
    cs = applyEffects(cs, resolveCard(cs, 'player', 'basic/disengage', 'player', createRng(1)).effects);
    const r = resolveCard(cs, 'player', 'basic/move', 0, createRng(2));
    expect(r.log.join()).not.toContain('기회 공격');
    const cs2 = duel();
    cs2.combatants['goblin_warrior#1']!.zone = 2;
    expect(resolveCard(cs2, 'player', 'basic/move', 2, createRng(2)).log.join()).not.toContain('기회 공격');
  });
  it('고블린은 붙잡히면 재빠른 도주로 후퇴 후 뒤로 빠진다', () => {
    let cs = duel();
    cs = { ...cs, order: ['goblin_warrior#1', 'player'], turnIndex: 0 };
    expect(planEnemyAction(cs)).toEqual({ cardId: 'monster/goblin/nimble_escape', target: 'goblin_warrior#1' });
    cs = applyEffects(cs, resolveCard(cs, 'goblin_warrior#1', 'monster/goblin/nimble_escape', 'goblin_warrior#1', createRng(1)).effects);
    expect(planEnemyAction(cs)).toEqual({ cardId: 'basic/move', target: 2 });
  });
  it('빈사: 죽음 내성 3성공이면 안정, 3실패면 사망, 20이면 HP 1', () => {
    const base = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 3 }] }, fighter(), createRng(1),
      [{ id: 'npc/b', name: '브란', sheet: { ...fighter(), name: '브란' } }]));
    let cs = applyEffects(base, [{ kind: 'hp', target: 'player', delta: -99 }]);
    expect(cs.combatants.player!.dead).toBe(true); // 12 HP에 99 피해: 즉사
    cs = applyEffects(base, [{ kind: 'hp', target: 'player', delta: -13 }]);
    expect(cs.combatants.player!.dead).toBeFalsy();
    expect(cs.combatants.player!.prone).toBe(true);
    expect(dying(cs.combatants.player!)).toBe(true);
    expect(cs.outcome).toBeUndefined(); // 동료가 남아 있음
    const stable = applyEffects(cs, [{ kind: 'death_save', target: 'player', success: 3, fail: 0 }]);
    expect(stable.combatants.player!.stable).toBe(true);
    const dead = applyEffects(cs, [{ kind: 'hp', target: 'player', delta: -1, crit: true }, { kind: 'death_save', target: 'player', success: 0, fail: 1 }]);
    expect(dead.combatants.player!.dead).toBe(true);
    const healed = applyEffects(cs, [{ kind: 'hp', target: 'player', delta: 5 }]);
    expect(healed.combatants.player!.hp).toBe(5);
    expect(healed.combatants.player!.deathSaves).toBeUndefined();
    let saw20 = false;
    for (let seed = 0; seed < 200 && !saw20; seed++) {
      const r = rollDeathSave(cs.combatants.player!, createRng(seed));
      if (r.log[0]!.includes('d20(20)')) { saw20 = true; expect(r.effects).toEqual([{ kind: 'hp', target: 'player', delta: 1 }]); }
    }
    expect(saw20).toBe(true);
  });
  it('빈사 아군은 차례마다 자동으로 죽음 내성을 굴리고, 동료 클레릭은 먼저 살린다', () => {
    const cs0 = startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 3 }] }, fighter(), createRng(1),
      [{ id: 'npc/i', name: '일제', sheet: { ...cleric(), name: '일제' } }]);
    let cs = applyEffects({ ...cs0, order: ['player', 'npc/i', 'wolf#1'], turnIndex: 0 }, [{ kind: 'hp', target: 'player', delta: -13 }]);
    cs = endTurn(cs);
    expect(currentActorId(cs)).toBe('npc/i');
    cs.combatants['npc/i']!.zone = cs.combatants.player!.zone;
    expect(planCompanionAction(cs)).toEqual({ cardId: 'spell/cure_wounds', target: 'player' });
    const { steps } = runAutoTurns({ ...cs, order: ['wolf#1', 'player', 'npc/i'], turnIndex: 1 }, createRng(4));
    const first = steps[0]!;
    expect(first.kind === 'action' && first.cardId).toBe('system/death_save');
  });
  it('넘어짐: 근접은 이점으로 당하고, 이동하려면 일어서야 한다', () => {
    const cs = duel();
    cs.combatants['goblin_warrior#1']!.prone = true;
    expect(resolveCard(cs, 'player', 'weapon/longsword', 'goblin_warrior#1', createRng(1)).log[0]).toContain('이점(넘어진 대상)');
    expect(resolveCard(cs, 'player', 'weapon/javelin', 'goblin_warrior#1', createRng(1)).log[0]).toContain('불리점');
    cs.combatants.player!.prone = true;
    expect(unusableReason(cs, 'player', cardById('basic/move'))).toContain('일어서야');
    const up = applyEffects(cs, resolveCard(cs, 'player', 'basic/stand', 'player', createRng(1)).effects);
    expect(up.combatants.player!.prone).toBe(false);
    expect(up.economy.move).toBe(false);
  });
  it('늑대에게 물리면 넘어질 수 있다', () => {
    let cs = startCombat({ id: 'e', enemies: [{ monsterId: 'wolf', zone: 2 }] }, wizard(), createRng(1));
    cs.combatants['wolf#1']!.zone = 1;
    cs = { ...cs, order: ['wolf#1', 'player'], turnIndex: 0 };
    let knocked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const r = resolveCard(cs, 'wolf#1', 'monster/wolf/bite', 'player', createRng(seed));
      if (r.effects.some((e) => e.kind === 'flag' && e.prone)) knocked++;
    }
    expect(knocked).toBeGreaterThan(0);
  });
});

describe('4~5레벨 전투 능력 (R2b)', () => {
  const lv = (sh: CharacterSheet, level: number): CharacterSheet => ({ ...sh, level, resources: classResources(sh.classId, level) });
  it('파이터 5레벨 추가 공격: 무기 공격이 두 번', () => {
    let cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'ogre', zone: 1 }] }, lv(fighter(), 5), createRng(3)));
    cs = { ...cs, combatants: { ...cs.combatants, 'ogre#1': { ...cs.combatants['ogre#1']!, zone: 1 } } };
    const r = resolveCard(cs, 'player', 'weapon/longsword', 'ogre#1', createRng(4));
    expect(r.log).toHaveLength(2);
    expect(cs.combatants.player!.profBonus).toBe(3);
  });
  it('위저드 5레벨: 화염구는 3레벨 슬롯, 소마법 피해 2배', () => {
    const cs = playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'goblin_warrior', zone: 3 }, { monsterId: 'goblin_warrior', zone: 3 }] }, lv(wizard(), 5), createRng(1)));
    const fb = cardById('spell/fireball');
    expect(validTargets(cs, 'player', fb)).toEqual([3]);
    const r = resolveCard(cs, 'player', 'spell/fireball', 3, createRng(2));
    expect(r.effects).toContainEqual({ kind: 'resource', target: 'player', key: 'slot3', delta: -1 });
    expect(r.log[0]).toContain('적 2명');
    const bolt = resolveCard(cs, 'player', 'spell/fire_bolt', 'goblin_warrior#1', createRng(5));
    const hit = bolt.log[0]!.match(/피해 \d+ \(([\d+]+)\)/);
    if (hit) expect(hit[1]!.split('+').length).toBeGreaterThanOrEqual(2);
  });
  it('로그 5레벨 초감각 회피: 반응으로 피해 절반, 라운드당 1번', () => {
    let cs = startCombat({ id: 'e', enemies: [{ monsterId: 'owlbear', zone: 1 }] }, lv(rogue(), 5), createRng(1));
    cs = { ...cs, order: ['owlbear#1', 'player'], turnIndex: 0, combatants: { ...cs.combatants, 'owlbear#1': { ...cs.combatants['owlbear#1']!, zone: 1 } } };
    let halved = 0;
    for (let seed = 0; seed < 30; seed++) {
      const r = resolveCard(cs, 'owlbear#1', 'monster/owlbear/rend', 'player', createRng(seed));
      const n = r.log.filter((l) => l.includes('초감각 회피')).length;
      expect(n).toBeLessThanOrEqual(1);
      halved += n;
    }
    expect(halved).toBeGreaterThan(0);
  });
});

describe('상태 이상 (R2b)', () => {
  const withCond = (cs: CombatState, id: string, conditions: Record<string, number>): CombatState =>
    ({ ...cs, combatants: { ...cs.combatants, [id]: { ...cs.combatants[id]!, conditions } } });
  const base = () => playerFirst(startCombat({ id: 'e', enemies: [{ monsterId: 'bandit', zone: 2 }] }, fighter(), createRng(1)));
  it('기절: 아무 행동도 못 하고, 적 AI는 차례를 넘긴다', () => {
    const cs = withCond(base(), 'player', { stunned: 1 });
    expect(unusableReason(cs, 'player', cardById('basic/move'))).toBe('기절해 행동할 수 없다');
    const e = withCond({ ...base(), turnIndex: base().order.indexOf('bandit#1') }, 'bandit#1', { stunned: 1 });
    expect(planEnemyAction(e)).toBeNull();
  });
  it('포박: 이동 불가 / 공포: 적에게 다가갈 수 없다', () => {
    expect(unusableReason(withCond(base(), 'player', { restrained: 1 }), 'player', cardById('basic/move'))).toBe('포박되어 움직일 수 없다');
    const f = withCond(base(), 'player', { frightened: 2 });
    expect(validTargets(f, 'player', cardById('basic/move'))).toEqual([0]);
  });
  it('공격 굴림: 중독은 불리점, 기절한 대상에는 이점', () => {
    let cs = base();
    cs = { ...cs, combatants: { ...cs.combatants, player: { ...cs.combatants.player!, zone: 2 } } };
    expect(resolveCard(withCond(cs, 'player', { poisoned: 1 }), 'player', 'weapon/longsword', 'bandit#1', createRng(2)).log[0]).toContain('불리점(중독)');
    expect(resolveCard(withCond(cs, 'bandit#1', { stunned: 1 }), 'player', 'weapon/longsword', 'bandit#1', createRng(2)).log[0]).toContain('이점(대상 기절)');
  });
  it('걸린 대상의 차례가 끝날 때마다 줄어든다', () => {
    let cs = withCond(base(), 'player', { poisoned: 2 });
    cs = endTurn(cs);
    expect(cs.combatants.player!.conditions).toEqual({ poisoned: 1 });
    while (currentActorId(cs) !== 'player') cs = endTurn(cs);
    cs = endTurn(cs);
    expect(cs.combatants.player!.conditions).toEqual({});
  });
  it('몬스터 기술로 걸리고, 언데드는 중독 면역', () => {
    let got = false;
    for (let seed = 0; seed < 40 && !got; seed++) {
      let cs = startCombat({ id: 'e', enemies: [{ monsterId: 'wx_viper', zone: 1 }] }, fighter(), createRng(seed));
      cs = { ...cs, order: ['wx_viper#1', 'player'], turnIndex: 0, combatants: { ...cs.combatants, 'wx_viper#1': { ...cs.combatants['wx_viper#1']!, zone: 1 } } };
      const r = resolveCard(cs, 'wx_viper#1', 'monster/wx_viper/bite', 'player', createRng(seed));
      if (r.effects.some((e) => e.kind === 'condition' && e.condition === 'poisoned')) got = true;
    }
    expect(got).toBe(true);
    const z = startCombat({ id: 'e', enemies: [{ monsterId: 'zombie', zone: 2 }] }, wizard(), createRng(1));
    expect(z.combatants['zombie#1']!.immune).toContain('poisoned');
  });
});
