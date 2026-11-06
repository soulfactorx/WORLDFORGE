import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { applyEvent, type GameState, replay } from './state/state';
import { startEvents } from '../gm/turn';
import { awakenStage, effectiveItem, equippedAc, gearBonus, itemDef, rollLoot } from './items';
import { createRng } from './dice/rng';
import { equipItem, learnItem } from '../gm/economy';
import { playerGear } from '../gm/combat';
import { sheetCombatant } from './combat/combat';
import { levelSpan } from './character/progression';
import { validateWorld } from './package/validate';
import { CLASS_KITS } from './combat/cards';

const hero = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = () => replay(startEvents(sampleWorld, hero(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const give = (s: GameState, itemId: string) => applyEvent(s, { type: 'item_gained', itemId, name: itemId, n: 1, reason: '테스트' }, 1);
const apply = (s: GameState, evs: ReturnType<typeof equipItem>) => evs.reduce((x, e) => applyEvent(x, e, 1), s);

describe('아이템 2.0 (설계 v4 E3)', () => {
  it('샘플 세계(유물 포함)는 검사기를 통과한다', () => {
    expect(validateWorld(sampleWorld).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('마법 무기: 명중·피해 보너스가 전투원에 들어가고, 장신구는 AC·내성을 올린다', () => {
    let s = give(give(start(), 'std/longsword-1'), 'std/cloak-protection');
    const acBefore = equippedAc(sampleWorld, s, 1, CLASS_KITS.fighter!.ac, false);
    s = apply(s, equipItem(sampleWorld, s, 'std/longsword-1'));
    s = apply(s, equipItem(sampleWorld, s, 'std/cloak-protection'));
    expect(s.equipped.trinket).toBe('std/cloak-protection');
    expect(gearBonus(sampleWorld, s)).toMatchObject({ attack: 1, damage: 1, ac: 1, save: 1 });
    expect(equippedAc(sampleWorld, s, 1, CLASS_KITS.fighter!.ac, false)).toBe(acBefore + 1);
    const c = sheetCombatant(s.player.sheet, 'player', '나', true, 1, playerGear(sampleWorld, s));
    expect(c).toMatchObject({ gearAttack: 1, gearDamage: 1, gearSave: 1 });
  });
  it('장비하면 카드가 생긴다 (화염의 검 → 불꽃 베기)', () => {
    let s = give(start(), 'std/flame-tongue');
    s = apply(s, equipItem(sampleWorld, s, 'std/flame-tongue'));
    expect(playerGear(sampleWorld, s).cards).toContain('weapon/flame_tongue');
  });
  it('비급: 익히면 카드를 영구히 얻고 사라진다, 두 번은 못 익힌다', () => {
    let s = give(give(start(), 'std/manual-heavy-blow'), 'std/manual-heavy-blow');
    s = apply(s, learnItem(sampleWorld, s, 'std/manual-heavy-blow'));
    expect(s.grantedCards.player).toContain('tech/heavy_blow');
    expect(s.inventory['std/manual-heavy-blow']).toBe(1);
    expect(() => learnItem(sampleWorld, s, 'std/manual-heavy-blow')).toThrow('이미 익힌');
  });
  it('유물: 조건이 맞을 때마다 깨어나 이름·보너스가 쌓인다', () => {
    let s = give(start(), 'item/mist-charm');
    const def = itemDef(sampleWorld, 'item/mist-charm')!;
    expect(awakenStage(sampleWorld, s, def)).toBe(0);
    s = applyEvent(s, { type: 'knowledge_revealed', belief: { holder: 'player', claim: 'claim/altar-fresh-ash', state: 'confirmed' } }, 1);
    expect(effectiveItem(sampleWorld, s, def)).toMatchObject({ stage: 1, name: '깨어난 안개 부적', bonus: { save: 1 } });
    s = { ...s, player: { ...s.player, sheet: { ...s.player.sheet, level: 4 } } };
    expect(effectiveItem(sampleWorld, s, def)).toMatchObject({ stage: 2, name: '안개 수호자의 부적', bonus: { save: 1, ac: 1 } });
  });
  it('전리품 굴림: 같은 씨앗이면 같은 결과, 1레벨은 희귀 이상이 없고, 보스는 반드시 고급 이상', () => {
    const roll = (seed: number, level: number, boss = false) => rollLoot(sampleWorld, createRng(seed), { level, threatXp: 100, levelSpan: levelSpan(level), boss });
    expect(roll(5, 1)?.id).toBe(roll(5, 1)?.id);
    const low = Array.from({ length: 300 }, (_, i) => roll(i, 1)).filter(Boolean);
    expect(low.length).toBeGreaterThan(30);
    expect(low.every((x) => !['rare', 'epic', 'legendary'].includes(x!.rarity ?? 'common'))).toBe(true);
    const boss = Array.from({ length: 100 }, (_, i) => roll(i, 6, true));
    expect(boss.every((x) => x && x.rarity && x.rarity !== 'common')).toBe(true);
    expect(boss.some((x) => x!.rarity === 'epic')).toBe(true);
    expect(boss.some((x) => x!.awaken?.length)).toBe(false); // 유물은 굴림에 나오지 않는다
  });
});
