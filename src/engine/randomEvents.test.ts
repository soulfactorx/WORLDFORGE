import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { applyEvent, type GameState, replay } from './state/state';
import { runTurn, startEvents } from '../gm/turn';
import { ambushEnemies, eligibleEvents, monotonous, rollRandomEvent } from './randomEvents';
import { createRng } from './dice/rng';
import { beginEncounter } from '../gm/combat';
import type { WorldPackage } from './schema';
import type { LlmClient } from '../llm/types';
import { validateWorld } from './package/validate';

const hero = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = (w: WorldPackage = sampleWorld, seed = 7) => replay(startEvents(w, hero(), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const at = (s: GameState, loc: string) => ({ ...s, player: { ...s.player, locationId: loc } });

describe('돌발 사건 · 템포 · 적응 난이도 (설계 v4 E5)', () => {
  it('기본 표: 기습은 위험한 곳(조우가 정해진 장소)에서만', () => {
    const s = start();
    expect(eligibleEvents(sampleWorld, at(s, 'loc/forest-clearing')).map((e) => e.id)).toContain('rand/ambush');
    expect(eligibleEvents(sampleWorld, at(s, 'loc/inn')).map((e) => e.id)).not.toContain('rand/ambush');
    expect(eligibleEvents({ ...sampleWorld, randomEvents: [] }, s)).toEqual([]); // []면 끔
  });
  it('같은 사건은 쿨다운 동안 다시 안 일어나고, 직전 3턴 안에는 쉰다', () => {
    let s = at(start(), 'loc/forest-clearing');
    s = applyEvent(s, { type: 'random_event', eventId: 'rand/ambush', name: '기습', kind: 'ambush', text: 'x', day: 0 }, 1);
    expect(eligibleEvents(sampleWorld, s).map((e) => e.id)).not.toContain('rand/ambush');
    const hits = Array.from({ length: 50 }, (_, i) => rollRandomEvent(sampleWorld, { ...s, turn: 2 }, createRng(i), 'move')).filter(Boolean);
    expect(hits).toEqual([]);
  });
  it('단조로우면 확률이 오른다 (같은 씨앗 → 같은 결과)', () => {
    const quiet = { ...at(start(), 'loc/forest-clearing'), turn: 20, log: [] } as GameState;
    expect(monotonous(quiet)).toBe(true);
    const n = (s: GameState) => Array.from({ length: 400 }, (_, i) => rollRandomEvent(sampleWorld, s, createRng(i), 'move')).filter(Boolean).length;
    const busy = { ...quiet, log: [{ turn: 19, kind: 'combat' as const, text: '전투' }] };
    expect(n(quiet)).toBeGreaterThan(n(busy) * 1.5);
    expect(rollRandomEvent(sampleWorld, quiet, createRng(3), 'move')?.id).toBe(rollRandomEvent(sampleWorld, quiet, createRng(3), 'move')?.id);
  });
  it('기본 기습의 적은 파티 레벨에 맞다', () => {
    const s = start();
    const e = ambushEnemies(sampleWorld, s, createRng(1));
    expect(e.length).toBeGreaterThan(0);
  });
  it('게임 난이도 (v0.91): DC 보정이 전투에서 적의 방어도·체력에 적용된다 (적응 난이도는 없다)', () => {
    const base = at(start(), 'loc/forest-clearing');
    const foes = (s: GameState) => { const ev = beginEncounter(sampleWorld, s, 'enc/clearing-wolves', 1).find((e) => e.type === 'combat_started'); return ev && ev.type === 'combat_started' ? Object.values(ev.combat.combatants).filter((c) => c.side === 'enemy').map((c) => ({ hp: c.maxHp, ac: c.ac })) : []; };
    const normal = foes(base);
    const easy = foes({ ...base, dcMod: -4 });
    const hard = foes({ ...base, dcMod: 4 });
    expect(easy[0]!.hp).toBeLessThan(normal[0]!.hp);
    expect(easy[0]!.ac).toBe(normal[0]!.ac - 2);
    expect(hard[0]!.hp).toBeGreaterThan(normal[0]!.hp);
    expect(hard[0]!.ac).toBe(normal[0]!.ac + 2);
    // 연달아 지거나 이겨도 저절로 바뀌지 않는다
    const lost = { ...base, log: [...base.log, ...['쓰러짐', '쓰러짐'].map((x) => ({ turn: 1, kind: 'combat' as const, text: `⚔ 전투 종료 — ${x}` }))] };
    expect(foes(lost)).toEqual(normal);
  });
  it('턴: 이동하면 돌발 사건이 일어날 수 있고, 기습이면 전투가 시작된다', async () => {
    const w: WorldPackage = { ...structuredClone(sampleWorld), randomEvents: [{ id: 'rand/wolf', name: '늑대', kind: 'ambush', text: '늑대가 튀어나온다!', where: ['loc/village-gate'], enemies: [{ monsterId: 'wolf', zone: 2 }] }] };
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
    const llm: LlmClient = {
      stream: async (_r, onText) => { onText('.'); return '.'; },
      json: async <T,>(r: { system: string }) => (r.system.includes('판단 모듈')
        ? { action_summary: '이동', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: 'loc/village-gate', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '' }
        : r.system.includes('안내자') ? { summary: '.', suggestion: '', choices: [] } : { facts: [] }) as T,
    };
    let fought = 0;
    for (let seed = 1; seed <= 30 && !fought; seed++) {
      const r = await runTurn(llm, w, start(w, seed), '마을로 간다', () => {});
      if (r.events.some((e) => e.type === 'random_event')) { expect(r.state.combat).toBeTruthy(); fought++; }
    }
    expect(fought).toBe(1);
  });
});
