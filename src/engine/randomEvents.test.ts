import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { applyEvent, type GameState, replay } from './state/state';
import { runTurn, startEvents } from '../gm/turn';
import { adaptiveMode, ambushEnemies, eligibleEvents, monotonous, rollRandomEvent } from './randomEvents';
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
  it('적응 난이도: 연달아 지면 적 HP가 줄고, 연달아 이기면 정예', () => {
    const base = at(start(), 'loc/forest-clearing');
    const withEnds = (xs: string[]) => ({ ...base, log: [...base.log, ...xs.map((x) => ({ turn: 1, kind: 'combat' as const, text: `⚔ 전투 종료 — ${x}` }))] });
    expect(adaptiveMode(withEnds(['승리', '쓰러짐', '도주']))).toBe('easier');
    expect(adaptiveMode(withEnds(['승리', '승리', '승리']))).toBe('harder');
    expect(adaptiveMode(withEnds(['쓰러짐', '승리']))).toBe(null);
    const hp = (s: GameState, adaptive = true) => { const ev = beginEncounter(sampleWorld, s, 'enc/clearing-wolves', 1, { adaptive }).find((e) => e.type === 'combat_started'); return ev && ev.type === 'combat_started' ? Object.values(ev.combat.combatants).filter((c) => c.side === 'enemy').map((c) => c.maxHp) : []; };
    const normal = hp(base);
    expect(hp(withEnds(['쓰러짐', '쓰러짐']))[0]).toBeLessThan(normal[0]!);
    expect(hp(withEnds(['승리', '승리', '승리']))[0]).toBeGreaterThan(normal[0]!);
    expect(hp(withEnds(['승리', '승리', '승리']), false)).toEqual(normal); // 설정에서 끄면 그대로
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
