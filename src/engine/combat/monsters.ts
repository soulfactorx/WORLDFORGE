/** 몬스터 데이터 — SRD 5.2.1 (CC-BY-4.0) 기반 */
import type { Abilities } from '../character/sheet';
import type { CardDef } from './cards';

export interface MonsterDef {
  id: string;
  name: string;
  ac: number;
  hp: number;
  /** 처치 경험치 (SRD 5.2.1: 도전 지수 1/4 = 50 XP) */
  xp: number;
  abilities: Abilities;
  cards: CardDef[];
  /** 원거리 공격을 선호 (후열에 머문다) */
  preferRanged?: boolean;
  /** 무리 전술: 대상과 같은 존에 다른 아군이 있으면 공격에 이점 */
  packTactics?: boolean;
}

export const MONSTERS: Record<string, MonsterDef> = {
  goblin_warrior: {
    id: 'goblin_warrior', name: '고블린 전사', ac: 15, hp: 10, xp: 50,
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    preferRanged: true,
    cards: [
      { id: 'monster/goblin/scimitar', name: '시미터', desc: '', kind: 'monster', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'melee', ability: 'dex', damage: '1d6', damageType: '참격', range: 0, toHit: 4, damageBonus: 2 } } },
      { id: 'monster/goblin/shortbow', name: '숏보우', desc: '', kind: 'monster', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'ranged', ability: 'dex', damage: '1d6', damageType: '관통', range: 3, toHit: 4, damageBonus: 2 } } },
      // 재빠른 도주: 보너스 행동으로 후퇴
      { id: 'monster/goblin/nimble_escape', name: '재빠른 도주', desc: '', kind: 'monster', cost: 'bonus', target: 'self', effect: { type: 'disengage' } },
    ],
  },
  wolf: {
    id: 'wolf', name: '늑대', ac: 12, hp: 11, xp: 50,
    abilities: { str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    packTactics: true,
    cards: [
      // 물리면 근력 내성(DC 11)에 실패하면 넘어진다
      { id: 'monster/wolf/bite', name: '물기', desc: '', kind: 'monster', cost: 'action', target: 'enemy', effect: { type: 'attack', attack: { kind: 'melee', ability: 'str', damage: '1d6', damageType: '관통', range: 0, toHit: 4, damageBonus: 2 }, knockProne: { save: 'str', dc: 11 } } },
    ],
  },
};
