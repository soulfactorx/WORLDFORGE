import { describe, expect, it } from 'vitest';
import { replay } from './state';
import type { StoredEvent } from './events';

const ev = (seq: number, turn: number, event: StoredEvent['event']): StoredEvent => ({ saveId: 's', seq, turn, event });

describe('replay', () => {
  it('이벤트 로그로 상태를 재구성한다', () => {
    const s = replay([
      ev(0, 0, { type: 'game_started', packageId: 'p', packageVersion: '0.1.0', seed: 1, locationId: 'loc/a', playerName: '나' }),
      ev(1, 1, { type: 'player_input', text: '주변을 본다' }),
      ev(2, 1, { type: 'moved', to: 'loc/b' }),
      ev(3, 1, { type: 'time_advanced', minutes: 10 }),
    ]);
    expect(s.player.locationId).toBe('loc/b');
    expect(s.turn).toBe(1);
    expect(s.worldMinutes).toBe(8 * 60 + 10);
  });
  it('seq 순서가 섞여 있어도 같은 결과', () => {
    const a = [ev(0, 0, { type: 'game_started', packageId: 'p', packageVersion: '0', seed: 1, locationId: 'x', playerName: '' }), ev(1, 1, { type: 'moved', to: 'y' }), ev(2, 2, { type: 'moved', to: 'z' })];
    expect(replay([...a].reverse()).player.locationId).toBe('z');
  });
});

describe('v0.1 세이브 호환', () => {
  it('character가 없는 game_started는 기본 시트로 재구성된다', () => {
    const s = replay([ev(0, 0, { type: 'game_started', packageId: 'p', packageVersion: '0.1.0', seed: 1, locationId: 'x', playerName: '옛 세이브' })]);
    expect(s.player.sheet.abilities.wis).toBe(10);
    expect(s.player.sheet.name).toBe('옛 세이브');
  });
});

describe('레벨업·휴식 이벤트', () => {
  it('경험치와 레벨업, 짧은 휴식의 비전 회복', () => {
    const wizard = { name: '나', classId: 'wizard', level: 3, abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
      skillProficiencies: [], saveProficiencies: ['int', 'wis'], maxHp: 15, hp: 15, xp: 900,
      resources: { slot1: { cur: 0, max: 4 }, slot2: { cur: 0, max: 2 }, arcane_recovery: { cur: 1, max: 1 } } } as const;
    const s = replay([
      ev(0, 0, { type: 'game_started', packageId: 'p', packageVersion: '0', seed: 1, locationId: 'x', playerName: '나', character: structuredClone(wizard) as never }),
      ev(1, 1, { type: 'xp_gained', who: 'player', amount: 50, reason: '테스트' }),
      ev(2, 1, { type: 'rested', kind: 'short' }),
    ]);
    expect(s.player.sheet.xp).toBe(950);
    // 3레벨 → 회복 예산 2: 2레벨 슬롯 1개
    expect(s.player.sheet.resources?.slot2?.cur).toBe(1);
    expect(s.player.sheet.resources?.slot1?.cur).toBe(0);
    expect(s.player.sheet.resources?.arcane_recovery?.cur).toBe(0);
    expect(s.log.some((l) => l.kind === 'progress' && l.text.includes('+50'))).toBe(true);
  });
});
