import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { startCombat } from './combat/combat';
import { createRng } from './dice/rng';
import { npcLevel, npcSheet, npcStatLine, npcXp } from './npcStats';
import { opposeMod, sceneActions } from './scene';
import { validateWorld } from './package/validate';
import type { Character, SceneDef, WorldPackage } from './schema';
import { replay, type GameState } from './state/state';
import { startEvents } from '../gm/turn';

const play = (w: WorldPackage, level = 1): GameState => {
  const s = replay(startEvents(w, createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] }), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
  return { ...s, player: { ...s.player, sheet: { ...s.player.sheet, level } } };
};

describe('NPC 캐릭터 데이터 (v0.79)', () => {
  const npc = (stats?: Character['stats']): Character => ({ ...structuredClone(sampleWorld.characters[0]!), ...(stats ? { stats } : {}) });

  it('성장: 주인공을 따라(기본) · 시간 · 고정', () => {
    const s = play(sampleWorld, 4);
    expect(npcLevel(npc(), s)).toBe(4);
    expect(npcLevel(npc({ level: 6 }), s)).toBe(6); // 기준 레벨 아래로는 안 내려간다
    expect(npcLevel(npc({ offset: -2 }), s)).toBe(2);
    expect(npcLevel(npc({ growth: 'fixed', level: 3 }), s)).toBe(3);
    expect(npcLevel(npc({ growth: 'time', level: 1, everyDays: 2 }), { ...s, worldMinutes: 8 * 60 + 5 * 1440 })).toBe(3);
    expect(npcLevel(npc({ offset: 20 }), s)).toBe(10);
  });

  it('시트: 세계 직업·능력치·기술·성향을 쓰고, 그 레벨까지 자동 성장', () => {
    const s = play(sampleWorld, 5);
    const sh = npcSheet(sampleWorld, s, npc({ classId: 'wizard', abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 12, cha: 10 }, traits: { good: 40 } }));
    expect(sh.classId).toBe('wizard');
    expect(sh.level).toBe(5);
    expect(sh.maxHp).toBeGreaterThan(10);
    expect(sh.skillProficiencies.length).toBeGreaterThan(0);
    expect(sh.traits).toEqual({ good: 40 });
    expect(sh.xp).toBe(6500); // 동료가 되면 이 경험치에서 이어서 자란다
    expect(npcStatLine(sampleWorld, s, npc({ classId: 'wizard', abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 12, cha: 10 } }))).toMatch(/5레벨 .* · 지능 19\(\+4\) 높음.* · 근력 8\(-1\) 낮음/);
  });

  it('장면: 상대의 맞서는 기술이 DC에 더해진다 (설득 → 통찰), 끌 수 있다', () => {
    const s = play(sampleWorld, 1);
    const wise = npcSheet(sampleWorld, s, npc({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 } }));
    const def: SceneDef = { id: 'scene/t', name: 't', description: '', npcId: sampleWorld.characters[0]!.id, gauges: [{ id: 'g', name: 'g', start: 0 }],
      actions: [{ id: 'talk', name: '설득', check: 'skill:persuasion', dc: 12 }], ends: [{ id: 'e', name: 'e', when: { round: 9 }, outcome: 'neutral' }] };
    const om = opposeMod(def.actions[0]!, wise)!;
    expect(om.label).toBe('통찰');
    expect(om.value).toBe(4);
    const run = { sceneId: def.id, gauges: { g: 0 }, states: [], round: 0, used: [], log: [] };
    expect(sceneActions(def, run, s.player.sheet, wise)[0]!.dc).toBe(16);
    expect(sceneActions({ ...def, oppose: false }, run, s.player.sheet, wise)[0]!.dc).toBe(12);
  });

  it('전투: "npc:인물ID" 적은 그 인물의 시트로 싸우고, 검사기도 받아 준다', () => {
    const s = play(sampleWorld, 3);
    const c = sampleWorld.characters[0]!;
    const sheet = npcSheet(sampleWorld, s, c);
    const cs = startCombat({ id: 'enc/duel', enemies: [{ monsterId: `npc:${c.id}`, zone: 2 }] }, s.player.sheet, createRng(1), [], {}, undefined, { [`npc:${c.id}`]: { name: c.name, sheet } });
    const foe = Object.values(cs.combatants).find((x) => x.side === 'enemy')!;
    expect(foe.name).toBe(c.name);
    expect(foe.level).toBe(3);
    expect(foe.maxHp).toBe(sheet.maxHp);
    expect(foe.xp).toBe(npcXp(3));
    const w = structuredClone(sampleWorld);
    w.encounters = [...(w.encounters ?? []), { id: 'enc/npc', name: '결투', locationId: w.locations[0]!.id, enemies: [{ monsterId: `npc:${c.id}`, zone: 2 }], trigger: '결투 신청' }];
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
    w.encounters.at(-1)!.enemies[0]!.monsterId = 'npc:npc/nobody';
    expect(validateWorld(w).some((i) => i.level === 'error' && i.path.includes('enemies'))).toBe(true);
  });
});
