import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import { evalCondition } from '../engine/scenario';
import type { WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { beginEncounter, playerCombatAction, playerEndTurn, playerGear } from './combat';
import { buyItem, equipItem, sellItem, useItem } from './economy';
import { effectEvents } from './story';
import { runTurn, startEvents } from './turn';

const world = (): WorldPackage => {
  const w = structuredClone(sampleWorld);
  w.factions = [...(w.factions ?? []), { id: 'fac/village', name: '마을', description: '' }];
  w.items = [{ id: 'item/amulet', name: '은 부적', description: '장로가 준 부적', kind: 'key' }];
  const gate = w.locations.find((l) => l.id === 'loc/village-gate')!;
  gate.shop = { name: '행상', items: ['std/potion-healing', 'std/chain-shirt', 'std/shield'], factionId: 'fac/village' };
  gate.pickups = [{ itemId: 'std/rope', hint: '성문 옆에 밧줄 한 묶음이 걸려 있다' }];
  w.characters.find((c) => c.id === 'npc/bran')!.gives = [{ itemId: 'item/amulet', condition: { relationship: 'npc/bran', axis: 'trust', gte: -20 } }];
  return w;
};
const fighter = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w: WorldPackage) => replay(startEvents(w, fighter(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);
const at = (s: GameState, loc: string): GameState => ({ ...s, player: { ...s.player, locationId: loc } });

describe('경제 (설계 v3 6.4)', () => {
  it('검사기 통과 · 처음 소지금 15와 치유 물약', () => {
    const w = world();
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
    const s = start(w);
    expect(s.money).toBe(15);
    expect(s.inventory).toEqual({ 'std/potion-healing': 1 });
  });
  it('상점: 사고 팔기, 평판으로 값이 바뀌고 아주 나쁘면 거절', () => {
    const w = world();
    let s = at({ ...start(w), money: 100 }, 'loc/village-gate');
    s = apply(s, buyItem(w, s, 'std/potion-healing'));
    expect(s.money).toBe(50);
    expect(s.inventory['std/potion-healing']).toBe(2);
    expect(() => buyItem(w, s, 'std/longsword')).toThrow();
    expect(() => buyItem(w, { ...s, money: 10 }, 'std/potion-healing')).toThrow(/모자란다/);
    s = apply(s, sellItem(w, s, 'std/potion-healing'));
    expect(s.money).toBe(75);
    s = { ...s, reputation: { 'fac/village': 40 } };
    expect(buyItem(w, s, 'std/potion-healing')[0]).toMatchObject({ delta: -45 });
    expect(() => buyItem(w, { ...s, reputation: { 'fac/village': -70 } }, 'std/potion-healing')).toThrow(/거절/);
  });
  it('물약 사용 (전투 밖)', () => {
    const w = world();
    let s = start(w);
    s = { ...s, player: { ...s.player, sheet: { ...s.player.sheet, hp: 3 } } };
    s = apply(s, useItem(w, s, 'std/potion-healing'));
    expect(s.player.sheet.hp).toBeGreaterThan(3);
    expect(s.inventory['std/potion-healing']).toBeUndefined();
    expect(() => useItem(w, s, 'std/potion-healing')).toThrow();
  });
  it('장비: 갑옷·방패가 AC를 바꾸고, 무기 카드를 더하고, 물약은 전투 카드가 된다', () => {
    const w = world();
    let s = start(w);
    expect(playerGear(w, s).ac).toBe(16); // 파이터 기본 체인 메일
    s = apply(s, [{ type: 'item_gained', itemId: 'std/chain-shirt', name: '', n: 1, reason: '' }, { type: 'item_gained', itemId: 'std/shield', name: '', n: 1, reason: '' }, { type: 'item_gained', itemId: 'std/shortbow', name: '', n: 1, reason: '' }]);
    s = apply(s, [...equipItem(w, s, 'std/chain-shirt'), ...equipItem(w, s, 'std/shield'), ...equipItem(w, s, 'std/shortbow')]);
    const g = playerGear(w, s);
    expect(g.ac).toBe(13 + 1 + 2); // 사슬 셔츠(민첩 +1) + 방패
    expect(g.cards).toEqual(['weapon/shortbow']);
    expect(g.items?.[0]?.card.id).toBe('item/std/potion-healing');
    s = apply(s, [{ type: 'item_lost', itemId: 'std/shield', name: '방패', n: 1, reason: '' }]);
    expect(s.equipped.shield).toBeUndefined();
  });
  it('전투 중 물약을 쓰면 끝난 뒤 소지품에서 빠지고, 이기면 전리품', () => {
    const w = world();
    let s = at(start(w), 'loc/forest-clearing');
    s = { ...s, player: { ...s.player, sheet: { ...s.player.sheet, hp: s.player.sheet.maxHp - 2 } } };
    s = apply(s, beginEncounter(w, s, 'enc/clearing-wolves', 1));
    let drank = false;
    for (let i = 0; i < 300 && s.combat; i++) {
      const cs = s.combat;
      const me = cs.combatants.player!;
      if (cs.order[cs.turnIndex] !== 'player') break;
      if (!drank && me.resources['item:std/potion-healing']?.cur) {
        s = apply(s, playerCombatAction(w, s, 'item/std/potion-healing', 'player'));
        drank = true;
        continue;
      }
      const foe = Object.values(s.combat!.combatants).find((c) => c.side === 'enemy' && c.hp > 0 && c.zone === me.zone);
      try { s = apply(s, foe ? playerCombatAction(w, s, 'weapon/longsword', foe.id) : playerCombatAction(w, s, 'basic/move', me.zone + 1)); } catch { /* 이동·공격 불가 */ }
      if (s.combat) s = apply(s, playerEndTurn(w, s));
    }
    expect(drank).toBe(true);
    expect(s.combat).toBeUndefined();
    expect(s.inventory['std/potion-healing']).toBeUndefined();
    expect(Object.keys(s.player.sheet.resources ?? {}).some((k) => k.startsWith('item:'))).toBe(false);
    if (s.log.some((l) => l.text.includes('승리'))) expect(s.money).toBeGreaterThan(15);
  });
  it('조건·효과: hasItem·money, giveItem·takeItem·money', () => {
    const w = world();
    let s = start(w);
    expect(evalCondition(w, s, { hasItem: 'std/potion-healing' })).toBe(true);
    expect(evalCondition(w, s, { money: 20 })).toBe(false);
    s = apply(s, effectEvents(w, s, [{ giveItem: 'item/amulet' }, { money: 10 }, { takeItem: 'std/potion-healing' }, { money: -100 }], '테스트'));
    expect(s.inventory).toEqual({ 'item/amulet': 1 });
    expect(s.money).toBe(0);
  });
});

describe('줍기·받기 (엔진 검증)', () => {
  const mock = (dir: object, actor: object): LlmClient => ({
    stream: async (_r, on) => { on('서술'); return '서술'; },
    json: async <T,>(r: { system: string }) => {
      if (r.system.includes('판단 모듈')) return { action_summary: '행동', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [{ npc_id: 'npc/bran', reacting_to: '인사' }], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', ...dir } as T;
      if (r.system.includes('한 명의 NPC')) return { action: '', dialogue: '받아라.', shared_claims: [], party_decision: 'none', relationship_change: { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0, reason: '' }, expression: '', ...actor } as T;
      if (r.system.includes('안내자')) return { summary: '', suggestion: '', choices: [] } as T;
      return { facts: [] } as T;
    },
  });
  it('선언된 것만 한 번씩 얻는다', async () => {
    const w = world();
    const s = at(start(w), 'loc/village-gate');
    const r = await runTurn(mock({ take_items: ['loc/village-gate#0', 'loc/nowhere#0'] }, { give_items: ['npc/bran#0', 'npc/bran#9'] }), w, s, '밧줄을 줍고 인사한다', () => {});
    expect(r.state.inventory['std/rope']).toBe(1);
    expect(r.state.inventory['item/amulet']).toBe(1);
    const r2 = await runTurn(mock({ take_items: ['loc/village-gate#0'] }, { give_items: ['npc/bran#0'] }), w, r.state, '또 줍는다', () => {});
    expect(r2.state.inventory['std/rope']).toBe(1);
    expect(r2.state.inventory['item/amulet']).toBe(1);
  });
});
