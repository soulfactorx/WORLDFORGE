/**
 * 적 데이터 (설계 v3 4.5) — 장르별 적 세트.
 * 하이 판타지: SRD 5.2.1 (CC-BY-4.0) 몬스터를 기반으로 이 게임의 존 전투에 맞게 옮김.
 * 무협: 자체 창작.
 */
import type { Ability } from '../character/rules';
import type { Abilities } from '../character/sheet';
import type { CardDef, Condition, Inflict } from './cards';
import type { CustomMonster, MonsterAttack, MonsterSpecial, WorldPackage } from '../schema';

export type EnemyRole = 'minion' | 'brute' | 'skirmisher' | 'artillery' | 'controller' | 'leader' | 'boss';

export interface MonsterPhase {
  /** HP가 최대치의 이 비율 이하로 떨어지면 */
  below: number;
  /** 전투 기록에 남는 말 */
  line: string;
  /** 새로 쓰는 카드 */
  addCards?: CardDef[];
  /** 방어도 변화 */
  ac?: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  ac: number;
  hp: number;
  /** 처치 경험치 (SRD 5.2.1 도전 지수 기준) */
  xp: number;
  /** 도전 지수 (표시용) */
  cr: string;
  abilities: Abilities;
  cards: CardDef[];
  /** 어울리는 장르 */
  genres: string[];
  role: EnemyRole;
  /** 내성 숙련 (명중·내성 DC 계산용) */
  saves?: Ability[];
  /** 원거리 공격을 선호 (후열에 머문다) */
  preferRanged?: boolean;
  /** 무리 전술: 대상과 같은 존에 다른 아군이 있으면 공격에 이점 */
  packTactics?: boolean;
  /** HP가 이 비율 이하가 되면 도망친다 (0 = 끝까지 싸움) */
  fleeAt?: number;
  /** 횟수 제한이 있는 특수 기술 (카드의 resource 키 → 횟수) */
  resources?: Record<string, number>;
  /** 보스 단계 */
  phases?: MonsterPhase[];
  /** 상태 이상 면역 */
  immune?: Condition[];
  /** 외형·성격 한 줄 (AI 서술 참고) */
  look: string;
}

// ---------------------------------------------------------------- 카드 도우미

type Atk = { toHit: number; dmg: string; bonus: number; type: string; range?: number; ability?: 'str' | 'dex'; count?: number; prone?: { save: Ability; dc: number }; inflict?: Inflict };
const melee = (id: string, name: string, a: Atk): CardDef => ({
  id: `monster/${id}`, name, desc: '', kind: 'monster', cost: 'action', target: 'enemy',
  effect: { type: 'attack', attack: { kind: 'melee', ability: a.ability ?? 'str', damage: a.dmg, damageType: a.type, range: 0, toHit: a.toHit, damageBonus: a.bonus }, ...(a.count ? { count: a.count } : {}), ...(a.prone ? { knockProne: a.prone } : {}), ...(a.inflict ? { inflict: a.inflict } : {}) },
});
const ranged = (id: string, name: string, a: Atk): CardDef => ({
  id: `monster/${id}`, name, desc: '', kind: 'monster', cost: 'action', target: 'enemy',
  effect: { type: 'attack', attack: { kind: 'ranged', ability: a.ability ?? 'dex', damage: a.dmg, damageType: a.type, range: a.range ?? 3, toHit: a.toHit, damageBonus: a.bonus }, ...(a.count ? { count: a.count } : {}), ...(a.inflict ? { inflict: a.inflict } : {}) },
});
type SaveSpec = { save: Ability; dc: number; dmg: string; type: string; range: number; half?: boolean; resource?: string; inflict?: { condition: Condition; rounds: number } };
/** 내성 피해에 붙는 상태 이상은 같은 내성에 실패하면 걸린다 */
const withInflict = (s: SaveSpec) => (s.inflict ? { inflict: { ...s.inflict, save: s.save, dc: s.dc } } : {});
const saveAtk = (id: string, name: string, s: SaveSpec): CardDef => ({
  id: `monster/${id}`, name, desc: '', kind: 'monster', cost: 'action', target: 'enemy', ...(s.resource ? { resource: s.resource } : {}),
  effect: { type: 'save_damage', save: s.save, damage: s.dmg, damageType: s.type, range: s.range, half: s.half, dc: s.dc, ...withInflict(s) },
});
const area = (id: string, name: string, s: SaveSpec): CardDef => ({
  id: `monster/${id}`, name, desc: '', kind: 'monster', cost: 'action', target: 'area', ...(s.resource ? { resource: s.resource } : {}),
  effect: { type: 'area_save', save: s.save, damage: s.dmg, damageType: s.type, range: s.range, half: true, dc: s.dc, ...withInflict(s) },
});
const UNDEAD: Condition[] = ['poisoned', 'frightened'];
const escape = (id: string, name: string): CardDef => ({ id: `monster/${id}`, name, desc: '', kind: 'monster', cost: 'bonus', target: 'self', effect: { type: 'disengage' } });

const ab = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });
const F = ['high_fantasy', 'romance'];
const W = ['wuxia'];

const LIST: MonsterDef[] = [
  // ======================================================== 하이 판타지 (SRD 5.2.1 기반)
  { id: 'goblin_warrior', name: '고블린 전사', ac: 15, hp: 10, xp: 50, cr: '1/4', abilities: ab(8, 15, 10, 10, 8, 8), genres: F, role: 'skirmisher', preferRanged: true, fleeAt: 0.3,
    look: '누런 눈의 작은 인간형. 녹슨 시미터와 짧은 활.',
    cards: [melee('goblin/scimitar', '시미터', { toHit: 4, dmg: '1d6', bonus: 2, type: '참격', ability: 'dex' }), ranged('goblin/shortbow', '숏보우', { toHit: 4, dmg: '1d6', bonus: 2, type: '관통' }), { ...escape('goblin/nimble_escape', '재빠른 도주') }] },
  { id: 'goblin_boss', name: '고블린 두목', ac: 17, hp: 21, xp: 200, cr: '1', abilities: ab(10, 15, 10, 10, 8, 10), genres: F, role: 'leader',
    look: '쇠사슬 갑옷을 걸친 덩치 큰 고블린. 졸개들을 발로 차며 부린다.',
    cards: [melee('goblin_boss/scimitar', '시미터 연격', { toHit: 4, dmg: '1d6', bonus: 2, type: '참격', ability: 'dex', count: 2 }), ranged('goblin_boss/shortbow', '숏보우', { toHit: 4, dmg: '1d6', bonus: 2, type: '관통' })] },
  { id: 'wolf', name: '늑대', ac: 12, hp: 11, xp: 50, cr: '1/4', abilities: ab(14, 15, 12, 3, 12, 6), genres: F, role: 'skirmisher', packTactics: true, fleeAt: 0.25,
    look: '잿빛 털의 굶주린 늑대. 무리로 사냥한다.',
    cards: [melee('wolf/bite', '물기', { toHit: 4, dmg: '1d6', bonus: 2, type: '관통', prone: { save: 'str', dc: 11 } })] },
  { id: 'dire_wolf', name: '다이어 울프', ac: 14, hp: 22, xp: 200, cr: '1', abilities: ab(17, 15, 15, 3, 12, 7), genres: F, role: 'brute', packTactics: true,
    look: '말만 한 크기의 거대한 늑대. 숨결에서 피 냄새가 난다.',
    cards: [melee('dire_wolf/bite', '물기', { toHit: 5, dmg: '1d10', bonus: 3, type: '관통', prone: { save: 'str', dc: 13 } })] },
  { id: 'bandit', name: '산적', ac: 12, hp: 11, xp: 25, cr: '1/8', abilities: ab(11, 12, 12, 10, 10, 10), genres: F, role: 'minion', fleeAt: 0.4,
    look: '누더기 가죽옷에 낡은 칼. 겁이 많지만 수로 덤빈다.',
    cards: [melee('bandit/scimitar', '시미터', { toHit: 3, dmg: '1d6', bonus: 1, type: '참격', ability: 'dex' }), ranged('bandit/crossbow', '경쇠뇌', { toHit: 3, dmg: '1d8', bonus: 1, type: '관통', range: 2 })] },
  { id: 'bandit_captain', name: '산적 두목', ac: 15, hp: 52, xp: 450, cr: '2', abilities: ab(15, 16, 14, 14, 11, 14), genres: F, role: 'leader', saves: ['str', 'dex', 'wis'],
    look: '깃털 모자에 흉터투성이 얼굴. 칼 두 자루를 능숙하게 쓴다.',
    cards: [melee('bandit_captain/scimitar', '쌍검 연격', { toHit: 5, dmg: '1d6', bonus: 3, type: '참격', ability: 'dex', count: 2 }), ranged('bandit_captain/dagger', '단검 투척', { toHit: 5, dmg: '1d4', bonus: 3, type: '관통', range: 2, count: 2 })] },
  { id: 'tough', name: '불한당', ac: 12, hp: 32, xp: 100, cr: '1/2', abilities: ab(15, 11, 14, 10, 10, 11), genres: F, role: 'brute', packTactics: true, fleeAt: 0.3,
    look: '어깨가 떡 벌어진 깡패. 철퇴를 어깨에 걸치고 있다.',
    cards: [melee('tough/mace', '철퇴', { toHit: 4, dmg: '1d6', bonus: 2, type: '타격' }), ranged('tough/crossbow', '중쇠뇌', { toHit: 2, dmg: '1d10', bonus: 0, type: '관통', range: 2 })] },
  { id: 'cultist', name: '광신도', ac: 12, hp: 9, xp: 25, cr: '1/8', abilities: ab(11, 12, 10, 10, 11, 10), genres: F, role: 'minion',
    look: '피 묻은 두건을 쓴 신도. 낫을 쥐고 무언가를 중얼거린다.',
    cards: [melee('cultist/sickle', '낫', { toHit: 3, dmg: '1d4', bonus: 1, type: '참격', ability: 'dex' })] },
  { id: 'cult_fanatic', name: '광신도 사제', ac: 13, hp: 33, xp: 450, cr: '2', abilities: ab(11, 14, 12, 10, 13, 14), genres: F, role: 'controller', saves: ['wis'], resources: { dark_word: 2 },
    look: '검은 법의의 사제. 손끝에서 검은 연기가 피어오른다.',
    cards: [melee('cult_fanatic/dagger', '의식용 단검 연격', { toHit: 4, dmg: '1d4', bonus: 2, type: '관통', ability: 'dex', count: 2 }),
      saveAtk('cult_fanatic/inflict', '고통의 말', { save: 'con', dc: 12, dmg: '3d10', type: '사령', range: 1, half: true, resource: 'dark_word' })] },
  { id: 'skeleton', name: '해골 병사', ac: 13, hp: 13, xp: 50, cr: '1/4', abilities: ab(10, 16, 15, 6, 8, 5), genres: F, role: 'skirmisher', immune: UNDEAD,
    look: '녹슨 갑옷 조각을 걸친 해골. 텅 빈 눈구멍에 푸른 불빛.',
    cards: [melee('skeleton/shortsword', '숏소드', { toHit: 5, dmg: '1d6', bonus: 3, type: '관통', ability: 'dex' }), ranged('skeleton/shortbow', '숏보우', { toHit: 5, dmg: '1d6', bonus: 3, type: '관통' })] },
  { id: 'zombie', name: '좀비', ac: 8, hp: 15, xp: 50, cr: '1/4', abilities: ab(13, 6, 16, 3, 6, 5), genres: F, role: 'brute', immune: UNDEAD,
    look: '썩어 가는 시체. 느리지만 쓰러뜨려도 다시 일어날 듯하다.',
    cards: [melee('zombie/slam', '후려치기', { toHit: 3, dmg: '1d8', bonus: 1, type: '타격' })] },
  { id: 'ghoul', name: '구울', ac: 12, hp: 22, xp: 200, cr: '1', abilities: ab(13, 15, 10, 7, 10, 6), genres: F, role: 'skirmisher', packTactics: true, immune: UNDEAD,
    look: '잿빛 피부에 길게 찢어진 입. 시체 썩는 냄새가 난다.',
    cards: [melee('ghoul/claws', '마비의 손톱', { toHit: 4, dmg: '1d4', bonus: 2, type: '참격', ability: 'dex', count: 2, inflict: { condition: 'stunned', save: 'con', dc: 10, rounds: 1 } }), melee('ghoul/bite', '물기', { toHit: 2, dmg: '2d6', bonus: 2, type: '관통' })] },
  { id: 'hobgoblin_warrior', name: '홉고블린 전사', ac: 18, hp: 11, xp: 100, cr: '1/2', abilities: ab(13, 12, 12, 10, 10, 9), genres: F, role: 'brute', packTactics: true,
    look: '붉은 피부에 규율 잡힌 군인. 반짝이는 판금과 긴 칼.',
    cards: [melee('hobgoblin/longsword', '롱소드', { toHit: 3, dmg: '2d10', bonus: 1, type: '참격' }), ranged('hobgoblin/longbow', '롱보우', { toHit: 3, dmg: '1d8', bonus: 1, type: '관통', range: 3 })] },
  { id: 'bugbear_warrior', name: '버그베어 전사', ac: 14, hp: 33, xp: 200, cr: '1', abilities: ab(15, 14, 13, 8, 11, 9), genres: F, role: 'brute',
    look: '털북숭이 거구. 놀라울 만큼 조용히 다가온다.',
    cards: [melee('bugbear/morningstar', '모닝스타', { toHit: 4, dmg: '2d8', bonus: 2, type: '관통' }), ranged('bugbear/javelin', '투창', { toHit: 4, dmg: '1d6', bonus: 2, type: '관통', range: 2, ability: 'str' })] },
  { id: 'gnoll_warrior', name: '놀 전사', ac: 15, hp: 27, xp: 100, cr: '1/2', abilities: ab(14, 12, 11, 6, 10, 7), genres: F, role: 'skirmisher', packTactics: true,
    look: '하이에나 머리의 짐승 인간. 낄낄대는 웃음소리.',
    cards: [melee('gnoll/rend', '물어뜯기', { toHit: 4, dmg: '1d6', bonus: 2, type: '관통' }), ranged('gnoll/bow', '뼈 활', { toHit: 3, dmg: '1d10', bonus: 1, type: '관통' })] },
  { id: 'animated_armor', name: '움직이는 갑옷', ac: 18, hp: 33, xp: 200, cr: '1', abilities: ab(14, 11, 13, 1, 3, 1), genres: F, role: 'brute', immune: ['poisoned', 'frightened', 'blinded'],
    look: '속이 텅 빈 판금 갑옷이 삐걱이며 걸어온다.',
    cards: [melee('armor/slam', '강타 연격', { toHit: 4, dmg: '1d6', bonus: 2, type: '타격', count: 2 })] },
  { id: 'giant_spider', name: '거대 거미', ac: 14, hp: 26, xp: 200, cr: '1', abilities: ab(14, 16, 12, 2, 11, 4), genres: F, role: 'controller', resources: { web: 1 },
    look: '마차 바퀴만 한 털북숭이 거미. 독니에서 진액이 떨어진다.',
    cards: [melee('spider/bite', '독니', { toHit: 5, dmg: '1d8', bonus: 3, type: '관통', ability: 'dex', inflict: { condition: 'poisoned', save: 'con', dc: 11, rounds: 2 } }),
      saveAtk('spider/web', '거미줄', { save: 'dex', dc: 13, dmg: '1d6', type: '독', range: 2, half: true, resource: 'web', inflict: { condition: 'restrained', rounds: 2 } })] },
  { id: 'brown_bear', name: '불곰', ac: 11, hp: 22, xp: 200, cr: '1', abilities: ab(17, 12, 15, 2, 13, 7), genres: F, role: 'brute',
    look: '거대한 불곰. 일어서면 사람 둘 키다.',
    cards: [melee('bear/maul', '물고 할퀴기', { toHit: 5, dmg: '1d8', bonus: 3, type: '참격', count: 2 })] },
  { id: 'ogre', name: '오우거', ac: 11, hp: 68, xp: 450, cr: '2', abilities: ab(19, 8, 16, 5, 7, 7), genres: F, role: 'brute',
    look: '집채만 한 거인. 통나무 같은 몽둥이를 끌고 다닌다.',
    cards: [melee('ogre/greatclub', '거대 몽둥이', { toHit: 6, dmg: '2d8', bonus: 4, type: '타격', prone: { save: 'str', dc: 14 } }), ranged('ogre/javelin', '투창', { toHit: 6, dmg: '2d6', bonus: 4, type: '관통', range: 2, ability: 'str' })] },
  { id: 'owlbear', name: '아울베어', ac: 13, hp: 59, xp: 700, cr: '3', abilities: ab(20, 12, 17, 3, 12, 7), genres: F, role: 'brute',
    look: '부엉이 머리에 곰의 몸. 귀를 찢는 울음.',
    cards: [melee('owlbear/rend', '할퀴기 연격', { toHit: 7, dmg: '2d8', bonus: 5, type: '참격', count: 2 })] },
  { id: 'knight', name: '흑기사', ac: 18, hp: 52, xp: 700, cr: '3', abilities: ab(16, 11, 14, 11, 11, 15), genres: F, role: 'boss', saves: ['con', 'wis'], resources: { rally: 1 },
    look: '검은 판금 갑옷의 기사. 투구 너머로 눈빛만 보인다.',
    cards: [melee('knight/greatsword', '대검 연격', { toHit: 5, dmg: '2d6', bonus: 3, type: '참격', count: 2 }), ranged('knight/crossbow', '중쇠뇌', { toHit: 2, dmg: '1d10', bonus: 0, type: '관통', range: 2 })],
    phases: [{ below: 0.5, line: '흑기사가 투구를 벗어 던진다 — "이제부터가 진짜다!"', ac: -2, addCards: [melee('knight/fury', '분노의 일격', { toHit: 6, dmg: '4d6', bonus: 3, type: '참격' })] }] },

  // ---- 고레벨 (6~10레벨 파티)
  { id: 'troll', name: '트롤', ac: 15, hp: 94, xp: 1800, cr: '5', abilities: ab(18, 13, 20, 7, 9, 7), genres: F, role: 'brute',
    look: '녹회색 피부의 거구. 베인 상처가 눈앞에서 아문다.',
    cards: [melee('troll/rend', '할퀴고 물기 연격', { toHit: 7, dmg: '2d6', bonus: 4, type: '참격', count: 3 })] },
  { id: 'wyvern', name: '와이번', ac: 14, hp: 110, xp: 2300, cr: '6', abilities: ab(19, 10, 16, 5, 12, 6), genres: F, role: 'skirmisher',
    look: '가죽 날개의 비룡. 꼬리 끝 독침에서 진액이 떨어진다.',
    cards: [melee('wyvern/bite', '물기', { toHit: 7, dmg: '2d6', bonus: 4, type: '관통' }), melee('wyvern/sting', '독침', { toHit: 7, dmg: '2d6', bonus: 4, type: '독', inflict: { condition: 'poisoned', save: 'con', dc: 15, rounds: 2 } })] },
  { id: 'young_red_dragon', name: '젊은 붉은 용', ac: 18, hp: 178, xp: 5900, cr: '10', abilities: ab(23, 10, 21, 14, 11, 19), genres: F, role: 'boss', saves: ['dex', 'con', 'wis', 'cha'], resources: { breath: 1 },
    look: '붉은 비늘의 용. 숨을 들이쉴 때마다 목구멍 안이 붉게 달아오른다.',
    cards: [melee('dragon/rend', '물기와 할퀴기', { toHit: 10, dmg: '2d10', bonus: 6, type: '참격', count: 3 }), area('dragon/breath', '화염 숨결', { save: 'dex', dc: 17, dmg: '16d6', type: '화염', range: 2, resource: 'breath' })],
    phases: [{ below: 0.5, line: '용이 날개를 펼치며 포효한다 — 공기가 타오른다!', addCards: [area('dragon/breath2', '두 번째 숨결', { save: 'dex', dc: 17, dmg: '12d6', type: '화염', range: 2 })] }] },

  // ======================================================== 무협 (자체 창작)
  { id: 'wx_bandit', name: '산적 졸개', ac: 12, hp: 11, xp: 25, cr: '1/8', abilities: ab(12, 12, 12, 8, 10, 8), genres: W, role: 'minion', fleeAt: 0.4,
    look: '머리에 띠를 두른 산채 졸개. 박도를 휘두르며 소리친다.',
    cards: [melee('wx_bandit/blade', '박도', { toHit: 3, dmg: '1d6', bonus: 1, type: '참격' }), ranged('wx_bandit/dart', '표창', { toHit: 3, dmg: '1d4', bonus: 1, type: '관통', range: 2 })] },
  { id: 'wx_bandit_chief', name: '산채 두목', ac: 15, hp: 45, xp: 450, cr: '2', abilities: ab(17, 12, 15, 9, 10, 12), genres: W, role: 'leader', saves: ['str', 'con'],
    look: '호랑이 가죽을 걸친 거한. 귀두대도를 한 손으로 휘두른다.',
    cards: [melee('wx_bandit_chief/saber', '귀두대도 연환', { toHit: 5, dmg: '1d10', bonus: 3, type: '참격', count: 2 })],
    phases: [{ below: 0.4, line: '두목이 피를 토하며 웃는다 — "광사도법(狂沙刀法)!"', addCards: [area('wx_bandit_chief/sweep', '광사도법', { save: 'dex', dc: 13, dmg: '3d8', type: '참격', range: 0 })] }] },
  { id: 'wx_ronin', name: '낭인 검객', ac: 14, hp: 27, xp: 100, cr: '1/2', abilities: ab(12, 15, 12, 10, 11, 9), genres: W, role: 'skirmisher', fleeAt: 0.25,
    look: '해진 무복에 삿갓. 돈만 주면 누구의 칼이든 된다.',
    cards: [melee('wx_ronin/sword', '쾌검', { toHit: 4, dmg: '1d8', bonus: 2, type: '참격', ability: 'dex' })] },
  { id: 'wx_black_path', name: '흑도 무인', ac: 13, hp: 32, xp: 200, cr: '1', abilities: ab(15, 13, 14, 9, 10, 9), genres: W, role: 'brute', packTactics: true,
    look: '검은 무복의 흑도 무인. 쇠붙이를 박은 권갑을 끼었다.',
    cards: [melee('wx_black_path/fist', '철권 연타', { toHit: 4, dmg: '1d6', bonus: 2, type: '타격', count: 2 })] },
  { id: 'wx_sect_master', name: '사파 고수', ac: 15, hp: 52, xp: 700, cr: '3', abilities: ab(14, 17, 14, 12, 13, 12), genres: W, role: 'leader', saves: ['dex', 'wis'], resources: { palm: 2 },
    look: '날카로운 눈매의 중년 무인. 소매 끝에 기가 맺혀 펄럭인다.',
    cards: [melee('wx_sect_master/sword', '연환검', { toHit: 5, dmg: '1d8', bonus: 3, type: '참격', ability: 'dex', count: 2 }),
      saveAtk('wx_sect_master/palm', '벽공장', { save: 'con', dc: 13, dmg: '3d8', type: '역장', range: 2, half: true, resource: 'palm' }),
      melee('wx_sect_master/acupoint', '점혈수', { toHit: 5, dmg: '1d4', bonus: 3, type: '타격', ability: 'dex', inflict: { condition: 'stunned', save: 'con', dc: 13, rounds: 1 } })] },
  { id: 'wx_assassin', name: '살수', ac: 15, hp: 33, xp: 450, cr: '2', abilities: ab(11, 17, 12, 12, 12, 9), genres: W, role: 'skirmisher', preferRanged: true, fleeAt: 0.3,
    look: '복면을 쓴 흑의 살수. 기척이 거의 없다.',
    cards: [melee('wx_assassin/dagger', '비수 연격', { toHit: 5, dmg: '1d4', bonus: 3, type: '관통', ability: 'dex', count: 2 }), ranged('wx_assassin/needle', '독침', { toHit: 5, dmg: '1d6', bonus: 3, type: '독', range: 3 }), escape('wx_assassin/vanish', '은형보')] },
  { id: 'wx_poisoner', name: '독문 제자', ac: 12, hp: 22, xp: 200, cr: '1', abilities: ab(10, 14, 12, 13, 12, 9), genres: W, role: 'controller', preferRanged: true, resources: { poison_palm: 2 },
    look: '푸른빛 손톱의 창백한 무인. 주변 풀잎이 시든다.',
    cards: [ranged('wx_poisoner/needle', '취혼침', { toHit: 4, dmg: '1d6', bonus: 2, type: '독', range: 3, inflict: { condition: 'poisoned', save: 'con', dc: 12, rounds: 2 } }),
      saveAtk('wx_poisoner/palm', '독사장', { save: 'con', dc: 12, dmg: '2d8', type: '독', range: 1, half: true, resource: 'poison_palm', inflict: { condition: 'poisoned', rounds: 3 } })] },
  { id: 'wx_cultist', name: '마교도', ac: 13, hp: 16, xp: 50, cr: '1/4', abilities: ab(12, 13, 12, 9, 9, 10), genres: W, role: 'minion', packTactics: true,
    look: '붉은 띠를 맨 마교 신도. 눈동자에 광기가 서려 있다.',
    cards: [melee('wx_cultist/saber', '곡도', { toHit: 3, dmg: '1d6', bonus: 1, type: '참격' })] },
  { id: 'wx_cult_elder', name: '마교 장로', ac: 16, hp: 85, xp: 1800, cr: '5', abilities: ab(16, 15, 16, 14, 14, 16), genres: W, role: 'boss', saves: ['con', 'wis'], resources: { blood_art: 1 },
    look: '핏빛 장포의 노마두. 웃을 때마다 공기가 무거워진다.',
    cards: [melee('wx_cult_elder/palm', '혈마장 연격', { toHit: 7, dmg: '2d8', bonus: 4, type: '사령', count: 2 }),
      area('wx_cult_elder/blood', '혈우마공', { save: 'con', dc: 15, dmg: '4d8', type: '사령', range: 1, resource: 'blood_art' })],
    phases: [{ below: 0.5, line: '장로의 눈이 붉게 물든다 — "천마해체대법(天魔解體大法)!"', ac: 1, addCards: [area('wx_cult_elder/heaven', '천마해체대법', { save: 'dex', dc: 15, dmg: '5d8', type: '사령', range: 0 })] }] },
  { id: 'wx_jiangshi', name: '강시', ac: 10, hp: 30, xp: 100, cr: '1/2', abilities: ab(15, 6, 16, 3, 6, 5), genres: W, role: 'brute', immune: UNDEAD,
    look: '부적을 이마에 붙인 시체. 두 팔을 뻗고 뛰어온다.',
    cards: [melee('wx_jiangshi/claw', '강시조', { toHit: 4, dmg: '1d8', bonus: 2, type: '참격', inflict: { condition: 'restrained', save: 'str', dc: 12, rounds: 1 } })] },
  { id: 'wx_fox_spirit', name: '구미호', ac: 13, hp: 27, xp: 450, cr: '2', abilities: ab(10, 16, 12, 14, 14, 18), genres: W, role: 'controller', preferRanged: true, resources: { charm: 2 }, fleeAt: 0.3,
    look: '흰 비단옷의 아름다운 여인. 그림자에 꼬리가 여럿 비친다.',
    cards: [melee('wx_fox/claw', '여우 손톱', { toHit: 5, dmg: '1d6', bonus: 3, type: '참격', ability: 'dex' }),
      saveAtk('wx_fox/charm', '미혼술', { save: 'wis', dc: 13, dmg: '3d6', type: '정신', range: 2, half: true, resource: 'charm', inflict: { condition: 'blinded', rounds: 1 } })] },
  { id: 'wx_tiger', name: '산군(호랑이)', ac: 12, hp: 37, xp: 200, cr: '1', abilities: ab(17, 15, 14, 3, 12, 8), genres: W, role: 'brute',
    look: '산을 다스린다는 거대한 범. 울음에 숲이 숨을 죽인다.',
    cards: [melee('wx_tiger/pounce', '덮치기', { toHit: 5, dmg: '1d10', bonus: 3, type: '참격', prone: { save: 'str', dc: 13 } })] },
  { id: 'wx_viper', name: '독사', ac: 13, hp: 7, xp: 25, cr: '1/8', abilities: ab(4, 16, 11, 1, 10, 3), genres: W, role: 'minion',
    look: '풀숲에 숨은 독사. 비늘이 푸르게 번들거린다.',
    cards: [melee('wx_viper/bite', '독니', { toHit: 5, dmg: '1d4', bonus: 3, type: '독', ability: 'dex', inflict: { condition: 'poisoned', save: 'con', dc: 10, rounds: 2 } })] },
  { id: 'wx_soldier', name: '관병', ac: 16, hp: 16, xp: 50, cr: '1/4', abilities: ab(13, 12, 12, 10, 11, 10), genres: W, role: 'minion', packTactics: true,
    look: '붉은 전포에 창을 든 관병. 대열을 지어 다가온다.',
    cards: [melee('wx_soldier/spear', '창', { toHit: 3, dmg: '1d8', bonus: 1, type: '관통' }), ranged('wx_soldier/crossbow', '노', { toHit: 3, dmg: '1d8', bonus: 1, type: '관통', range: 3 })] },
  { id: 'wx_vengeful_ghost', name: '원귀', ac: 11, hp: 22, xp: 200, cr: '1', abilities: ab(7, 13, 10, 10, 12, 15), genres: W, role: 'controller', resources: { wail: 2 }, immune: UNDEAD,
    look: '흐트러진 머리의 창백한 혼령. 서늘한 곡소리가 따른다.',
    cards: [melee('wx_ghost/touch', '한기', { toHit: 4, dmg: '2d6', bonus: 1, type: '사령', ability: 'dex' }),
      area('wx_ghost/wail', '원한의 곡성', { save: 'wis', dc: 12, dmg: '2d8', type: '정신', range: 1, resource: 'wail', inflict: { condition: 'frightened', rounds: 2 } })] },
  // ---- 고레벨 (6~10레벨 파티)
  { id: 'wx_sword_saint', name: '검성', ac: 18, hp: 120, xp: 2900, cr: '7', abilities: ab(16, 20, 16, 14, 16, 14), genres: W, role: 'leader', saves: ['dex', 'wis'], resources: { sword_qi: 2 },
    look: '백발의 노검객. 칼을 뽑지 않았는데도 주위 공기가 갈라진다.',
    cards: [melee('wx_sword_saint/strikes', '천검일섬 연격', { toHit: 9, dmg: '1d10', bonus: 5, type: '참격', ability: 'dex', count: 3 }),
      saveAtk('wx_sword_saint/qi', '검기', { save: 'dex', dc: 16, dmg: '6d8', type: '역장', range: 2, half: true, resource: 'sword_qi' })] },
  { id: 'wx_demon_lord', name: '마두', ac: 18, hp: 160, xp: 5000, cr: '9', abilities: ab(20, 16, 20, 16, 16, 20), genres: W, role: 'boss', saves: ['con', 'wis', 'cha'], resources: { demon_art: 1 },
    look: '핏빛 기운을 두른 마도의 거두. 눈빛만으로 사람을 얼어붙게 한다.',
    cards: [melee('wx_demon_lord/palm', '마라장 연격', { toHit: 10, dmg: '2d10', bonus: 5, type: '사령', count: 2 }),
      area('wx_demon_lord/gaze', '마안', { save: 'wis', dc: 17, dmg: '4d10', type: '정신', range: 1, resource: 'demon_art', inflict: { condition: 'frightened', rounds: 2 } })],
    phases: [{ below: 0.4, line: '마두가 피를 토하며 웃는다 — "천마강림!"', ac: 1, addCards: [area('wx_demon_lord/descent', '천마강림', { save: 'con', dc: 17, dmg: '10d8', type: '사령', range: 0 })] }] },
];

export const MONSTERS: Record<string, MonsterDef> = Object.fromEntries(LIST.map((m) => [m.id, m]));

/** 이 장르에 쓰는 적 (없으면 판타지) */
export function monstersFor(genre?: string): MonsterDef[] {
  const g = genre === 'wuxia' ? 'wuxia' : 'high_fantasy';
  return LIST.filter((m) => m.genres.includes(g));
}

/** 모든 몬스터 카드 (보스 단계 카드 포함) */
export const ALL_MONSTER_CARDS: CardDef[] = LIST.flatMap((m) => [...m.cards, ...(m.phases ?? []).flatMap((p) => p.addCards ?? [])]);

// ---------------------------------------------------------------- 조우 난이도 (SRD 5.2.1 경험치 예산)

/** 캐릭터 레벨별 1인 예산 [낮음, 보통, 높음] */
const BUDGET: Record<number, [number, number, number]> = {
  1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500], 5: [500, 750, 1100],
  6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100], 9: [1300, 2000, 2600], 10: [1600, 2300, 3100],
};

export type Difficulty = 'easy' | 'moderate' | 'hard' | 'deadly';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', moderate: '보통', hard: '어려움', deadly: '치명적' };

export function encounterDifficulty(monsterIds: string[], partyLevels: number[], table: Record<string, MonsterDef> = MONSTERS): { xp: number; difficulty: Difficulty; budget: [number, number, number] } {
  const xp = monsterIds.reduce((s, id) => s + (table[id]?.xp ?? 0), 0);
  const budget = partyLevels.reduce<[number, number, number]>((acc, lv) => { const b = BUDGET[Math.max(1, Math.min(10, lv))]!; return [acc[0] + b[0], acc[1] + b[1], acc[2] + b[2]]; }, [0, 0, 0]);
  const difficulty: Difficulty = xp <= budget[0] ? 'easy' : xp <= budget[1] ? 'moderate' : xp <= budget[2] ? 'hard' : 'deadly';
  return { xp, difficulty, budget };
}

// ---------------------------------------------------------------- 세계만의 적 (설계 v3 4.5 · R7 규칙 패키지)

const slugOf = (s: string) => s.replace(/^mon\//, '').replace(/[^a-z0-9_-]+/gi, '_');

function attackCard(m: CustomMonster, a: MonsterAttack, i: number, tag = ''): CardDef {
  const id = `${slugOf(m.id)}/${tag}a${i}`;
  const spec: Atk = { toHit: a.toHit, dmg: a.damage, bonus: a.bonus, type: a.type, ...(a.range ? { range: a.range } : {}), ...(a.count && a.count > 1 ? { count: a.count } : {}),
    ...(a.knockProne ? { prone: a.knockProne } : {}), ...(a.inflict ? { inflict: a.inflict } : {}) };
  return a.kind === 'ranged' ? ranged(`custom/${id}`, a.name, spec) : melee(`custom/${id}`, a.name, spec);
}

function specialCard(m: CustomMonster, sp: MonsterSpecial, i: number, tag = ''): CardDef {
  const id = `custom/${slugOf(m.id)}/${tag}s${i}`;
  const spec: SaveSpec = { save: sp.save, dc: sp.dc, dmg: sp.damage, type: sp.type, range: sp.range, half: true, ...(sp.uses ? { resource: `${tag}s${i}` } : {}), ...(sp.inflict ? { inflict: sp.inflict } : {}) };
  return sp.kind === 'area' ? area(id, sp.name, spec) : saveAtk(id, sp.name, spec);
}

/** 제작자 형식 → 엔진 적 정의 */
export function compileMonster(m: CustomMonster): MonsterDef {
  const resources: Record<string, number> = {};
  (m.specials ?? []).forEach((sp, i) => { if (sp.uses) resources[`s${i}`] = sp.uses; });
  (m.phases ?? []).forEach((ph, p) => (ph.specials ?? []).forEach((sp, i) => { if (sp.uses) resources[`p${p}s${i}`] = sp.uses; }));
  return {
    id: m.id, name: m.name, ac: m.ac, hp: m.hp, xp: m.xp, cr: m.cr, abilities: { ...m.abilities }, genres: [], role: m.role, look: m.look,
    ...(m.saves?.length ? { saves: m.saves } : {}), ...(m.preferRanged ? { preferRanged: true } : {}), ...(m.packTactics ? { packTactics: true } : {}),
    ...(m.fleeAt ? { fleeAt: m.fleeAt } : {}), ...(m.immune?.length ? { immune: m.immune } : {}), ...(Object.keys(resources).length ? { resources } : {}),
    cards: [...m.attacks.map((a, i) => attackCard(m, a, i)), ...(m.specials ?? []).map((sp, i) => specialCard(m, sp, i))],
    ...(m.phases?.length ? { phases: m.phases.map((ph, p) => ({
      below: ph.below, line: ph.line, ...(ph.ac ? { ac: ph.ac } : {}),
      addCards: [...(ph.attacks ?? []).map((a, i) => attackCard(m, a, i, `p${p}`)), ...(ph.specials ?? []).map((sp, i) => specialCard(m, sp, i, `p${p}`))],
    })) } : {}),
  };
}

/** 이 세계에서 쓸 수 있는 모든 적 (세계만의 적이 같은 ID의 기본 적보다 먼저) */
export function monsterTable(world?: Pick<WorldPackage, 'monsters'>): Record<string, MonsterDef> {
  const own = world?.monsters ?? [];
  if (!own.length) return MONSTERS;
  const out: Record<string, MonsterDef> = { ...MONSTERS };
  for (const m of own) { try { out[m.id] = compileMonster(m); } catch { /* 검사기가 알린다 */ } }
  return out;
}

/** 이 세계의 장르 적 + 세계만의 적 */
export function monstersOfWorld(world: Pick<WorldPackage, 'monsters' | 'genre'>): MonsterDef[] {
  return [...(world.monsters ?? []).map((m) => { try { return compileMonster(m); } catch { return null; } }).filter((x): x is MonsterDef => !!x), ...monstersFor(world.genre?.id)];
}
