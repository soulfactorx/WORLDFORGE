import { describe, expect, it } from 'vitest';
import { createRng } from '../dice/rng';
import { classResources, createCharacter, suggestedStandardArray, type CharacterSheet } from '../character/sheet';
import {
  applyEffects, cardById, scaleDice, slotFor, type CombatState, currentActorId, endTurn, planEnemyAction, resolveCard, rollDamage,
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
