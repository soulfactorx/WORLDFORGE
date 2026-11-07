import type { AssetMeta, Condition, SceneAction, SceneDef, SceneEnd, SceneReaction, WorldPackage } from '../engine/schema';
import { autoSceneArt } from './sceneArt';

/**
 * 격투 샘플 세계: 파이널 벨 — 항구 도시 무진의 지하 서킷에서 세계 대회 결승까지.
 * 3D 대전 격투의 손맛(가드·잡기 심리전, 띄우기와 공중 콤보, 게이지와 필살기, 간격, 카운터 히트, 상대의 패턴)을
 * 장면 엔진의 턴제 대결로 옮겼다. 대결 하나 = 장면 하나 (npcId = 상대).
 * 이미지는 앱 내장 그림(stock.*)을 쓴다.
 */
const art = (id: string, n: number, target: { characterId?: string; locationId?: string }, label: string): AssetMeta => ({
  id: `stock.${id}--${n}`, name: `기본 이미지: ${label}`, kind: target.characterId ? 'character' : 'scene', ...target, tags: target.characterId ? ['default'] : [], mime: 'image/svg+xml', size: 0,
});

// ------------------------------------------------------------ 대결 틀 (장면 엔진)

/** 이 장면을 아직 이기지 않았다 (지거나 판정이면 다시 도전할 수 있다) */
const notWon = (id: string): Condition => ({ not: { sceneEnd: id, outcome: 'success' } });
const won = (id: string): Condition => ({ sceneEnd: id, outcome: 'success' });

/** 공통 행동. tips: 행동 ID → 실패했을 때 덧붙는 코치의 한마디 (연습 시합용) */
function moves(dc: number, tips: Record<string, string> = {}): SceneAction[] {
  const t = (id: string, s: string) => (tips[id] ? `${s} ${tips[id]}` : s);
  return [
    { id: 'jab', name: '잽', text: '짧고 빠른 견제. 피해는 작지만 게이지가 찬다. 빗나가도 큰 빈틈이 없다 (중거리까지).', check: 'skill:acrobatics', dc: dc - 2, requires: { gauge: 'range', lte: 1 }, tags: ['타격', '견제'],
      success: { gauges: { foe_hp: -1, meter: 1 }, text: '잽이 코끝을 때린다' }, great: { gauges: { foe_hp: -2, meter: 2 }, text: '카운터 히트! 고개가 젖혀진다' }, failure: { text: t('jab', '잽이 허공을 가른다') } },
    { id: 'mid', name: '중단 강타', text: '몸통을 노린 묵직한 일격. 상대가 가드를 올리고 있으면 막힌다 (상대 가드 1당 −4).', check: 'skill:athletics', dc, requires: { gauge: 'range', lte: 1 }, mods: [{ gauge: 'foe_guard', per: -4 }], tags: ['타격', '중단'],
      success: { gauges: { foe_hp: -3, meter: 1 }, text: '명치에 꽂혔다' }, great: { gauges: { foe_hp: -4, meter: 1 }, addStates: ['wall'], text: '카운터 히트! 상대가 벽까지 밀려난다' }, failure: { addStates: ['stunned'], text: t('mid', '막혔다 — 손목이 저리고 빈틈이 생긴다') } },
    { id: 'low', name: '하단 쓸기', text: '발목을 쓸어 넘기는 하단기. 서서 막는 가드를 조금 뚫는다 (상대 가드 1당 −2).', check: 'skill:acrobatics', dc, requires: { gauge: 'range', lte: 1 }, mods: [{ gauge: 'foe_guard', per: -2 }], tags: ['타격', '하단'],
      success: { gauges: { foe_hp: -2, meter: 1 }, text: '정강이를 걷어찼다' }, great: { gauges: { foe_hp: -3, meter: 1 }, text: '다운! 상대가 매트를 짚는다' }, failure: { addStates: ['stunned'], text: t('low', '하단을 읽혔다 — 발이 걸린 채 굳는다') } },
    { id: 'throw', name: '잡기', text: '붙어서 멱살을 잡아 메친다. 가드를 굳힌 상대에게 강하다 (상대 가드 1당 +4). 근거리에서만.', check: 'ability:str', dc: dc + 3, requires: { gauge: 'range', lte: 0 }, mods: [{ gauge: 'foe_guard', per: 4 }], tags: ['잡기'],
      success: { gauges: { foe_hp: -3, meter: 1 }, addStates: ['wall'], text: '메쳤다! 상대가 매트에 처박힌다' }, great: { gauges: { foe_hp: -4, meter: 2 }, addStates: ['wall'], text: '완벽한 메치기 — 상대가 로프까지 굴러간다' },
      failure: { gauges: { range: 1 }, text: t('throw', '잡기를 풀었다 — 서로 튕겨 나간다') } },
    { id: 'launch', name: '띄우기', text: '턱을 올려치는 어퍼. 맞으면 상대가 떠서 공중 콤보를 이을 수 있다. 막히면 큰 빈틈 (상대 가드 1당 −4, 근거리).', check: 'skill:athletics', dc: dc + 1, requires: { gauge: 'range', lte: 0 }, mods: [{ gauge: 'foe_guard', per: -4 }], tags: ['타격', '띄우기'],
      success: { gauges: { foe_hp: -2 }, addStates: ['launched'], text: '떴다!' }, great: { gauges: { foe_hp: -3, meter: 1 }, addStates: ['launched'], text: '카운터 띄우기! 상대가 높이 솟는다' }, failure: { addStates: ['stunned'], text: t('launch', '헛쳤다 — 몸이 완전히 열렸다') } },
    { id: 'combo', name: '공중 콤보', text: '떠오른 상대에게 연타를 꽂는다. 상대가 공중에 있을 때만.', check: 'skill:acrobatics', dc: dc - 1, requires: { state: 'launched' }, tags: ['콤보'],
      success: { gauges: { foe_hp: -4, meter: 1 }, removeStates: ['launched'], text: '하나, 둘, 셋 — 콤보가 이어진다' }, great: { gauges: { foe_hp: -6, meter: 1 }, removeStates: ['launched'], addStates: ['wall'], text: '풀 콤보에 벽꽝까지!' },
      failure: { removeStates: ['launched'], text: t('combo', '콤보가 끊겼다 — 상대가 낙법으로 빠진다') } },
    { id: 'super', name: '필살기', text: '게이지 3칸을 태워 쏟아붓는 필살의 일격. 간격과 상관없이 쓸 수 있다.', check: 'ability:con', dc: dc - 2, requires: { gauge: 'meter', gte: 3 }, tags: ['필살기'],
      success: { gauges: { foe_hp: -6, meter: -3 }, text: '필살기 작렬 — 관중석이 일어선다' }, great: { gauges: { foe_hp: -8, meter: -3 }, text: '카운터 필살기! 링 전체가 울린다' }, failure: { gauges: { foe_hp: -1, meter: -3 }, text: t('super', '가드당했다 — 깎는 데 그쳤다') } },
    { id: 'guard', name: '가드', text: '팔을 올려 한 박자 버틴다. 막아 내면 게이지가 차고 경직이 풀린다. 단, 붙어 있으면 잡기에 약하다.', tags: ['가드'],
      success: { addStates: ['guarding'], removeStates: ['stunned'] } },
    { id: 'read', name: '간파', text: '상대의 다음 공격을 읽는다. 맞히면 상대가 덤빌 때 카운터를 꽂는다. 상대가 가드를 굳히고 있으면 헛수고.', check: 'skill:insight', dc, tags: ['간파'],
      success: { addStates: ['counter'], text: '어깨의 움직임이 보인다' }, great: { addStates: ['counter'], gauges: { meter: 1 }, text: '다음 수가 훤히 보인다' }, failure: { text: t('read', '읽지 못했다') } },
    { id: 'dash', name: '대시 인', text: '스텝으로 파고들어 간격을 좁힌다.', check: 'skill:acrobatics', dc: dc - 3, requires: { gauge: 'range', gte: 1 }, tags: ['이동'],
      success: { gauges: { range: -1 }, text: '한 걸음 안으로' }, great: { gauges: { range: -2 }, text: '번개 같은 대시 — 단숨에 코앞이다' }, failure: { text: t('dash', '발이 꼬였다') } },
    { id: 'back', name: '백스텝', text: '한 발 물러나 간격을 벌리고 숨을 고른다. 경직이 풀린다.', requires: { gauge: 'range', lte: 1 }, tags: ['이동'],
      success: { gauges: { range: 1 }, removeStates: ['stunned'] } },
    { id: 'taunt', name: '도발', text: '한 번뿐인 도발. 통하면 게이지가 차고 상대가 가드를 내린다.', check: 'skill:intimidation', dc, once: true, tags: ['도발'],
      success: { gauges: { meter: 2, foe_guard: -1 }, text: '상대의 눈이 뒤집힌다 — 가드를 내리고 달려든다' }, failure: { text: '상대가 코웃음 친다' } },
  ];
}

interface Foe {
  hit: number; aggro: number; punish: number; punishChance?: number;
  attack: string; punishText: string; blockText?: string;
  /** 붙어서 가드를 굳힌 나를 잡는다 */
  grab?: { chance: number; dmg: number; text: string };
  /** 자세 바꾸기 확률: 가드 올림 / 내림 */
  up: number; down: number;
  pre?: SceneReaction[]; mid?: SceneReaction[];
  /** 간격 변화 (기본: 원거리면 다가온다) */
  drift?: SceneReaction[];
}

/** 상대의 AI 패턴 — 위에서부터 차례로 */
function pattern(f: Foe): SceneReaction[] {
  return [
    ...(f.pre ?? []),
    { when: { state: 'launched' }, chance: 0.3, delta: { removeStates: ['launched'], text: '상대가 공중에서 몸을 비틀어 빠져나온다' } },
    { when: { all: [{ gauge: 'foe_guard', lte: 0 }, { gauge: 'range', lte: 1 }, { not: { state: 'launched' } }, { not: { state: 'guarding' } }, { not: { state: 'counter' } }, { not: { state: 'stunned' } }] }, chance: f.aggro,
      delta: { gauges: { my_hp: -f.hit }, text: f.attack } },
    { when: { state: 'stunned' }, chance: f.punishChance ?? 0.6, delta: { gauges: { my_hp: -f.punish }, removeStates: ['stunned'], text: f.punishText } },
    { when: { all: [{ gauge: 'foe_guard', lte: 0 }, { gauge: 'range', lte: 1 }, { not: { state: 'launched' } }, { state: 'guarding' }] }, chance: f.aggro,
      delta: { gauges: { meter: 1 }, text: f.blockText ?? '막아 냈다 — 팔이 저리지만 게이지가 찬다' } },
    { when: { all: [{ state: 'counter' }, { gauge: 'foe_guard', lte: 0 }, { not: { state: 'launched' } }] }, chance: f.aggro,
      delta: { gauges: { foe_hp: -3, meter: 1 }, removeStates: ['counter'], text: '읽었다 — 들어오는 공격 위로 카운터 히트!' } },
    { when: { state: 'counter' }, delta: { removeStates: ['counter'] } },
    ...(f.grab ? [{ when: { all: [{ state: 'guarding' }, { gauge: 'range', lte: 0 }] }, chance: f.grab.chance, delta: { gauges: { my_hp: -f.grab.dmg }, text: f.grab.text } } as SceneReaction] : []),
    { when: { state: 'guarding' }, delta: { removeStates: ['guarding'] } },
    ...(f.mid ?? []),
    ...(f.drift ?? [{ when: { gauge: 'range', gte: 2 }, chance: 0.5, delta: { gauges: { range: -1 }, text: '상대가 간격을 좁혀 온다' } }]),
    { when: { state: 'wall' }, chance: 0.4, delta: { removeStates: ['wall'], text: '상대가 벽에서 빠져나온다' } },
    { chance: f.up, delta: { gauges: { foe_guard: 1 } } },
    { chance: f.down, delta: { gauges: { foe_guard: -1 } } },
    { when: { state: 'stunned' }, chance: 0.5, delta: { removeStates: ['stunned'] } },
  ];
}

/** 체력이 바닥난 상대의 마지막 발악 */
const desperation = (dmg: number, chance: number, text: string): SceneReaction[] => [
  { when: { all: [{ gauge: 'foe_hp', lte: 6 }, { gauge: 'foe_hp', gte: 1 }, { not: { state: 'guarding' } }, { not: { state: 'launched' } }] }, chance, delta: { gauges: { my_hp: -dmg }, text } },
  { when: { all: [{ gauge: 'foe_hp', lte: 6 }, { gauge: 'foe_hp', gte: 1 }, { state: 'guarding' }] }, chance, delta: { gauges: { meter: 2 }, text: '마지막 발악을 가드로 받아 냈다!' } },
];

interface FightSpec {
  id: string; name: string; description: string; npcId: string; locationId: string; start?: Condition;
  foeHp: number; dc: number; range?: number; maxRounds?: number;
  likes?: string[]; dislikes?: string[];
  phases?: SceneDef['phases'];
  tips?: Record<string, string>;
  extraActions?: SceneAction[];
  foe: Foe;
  win: Omit<SceneEnd, 'id' | 'name' | 'when' | 'outcome'>;
  lose: Omit<SceneEnd, 'id' | 'name' | 'when' | 'outcome'>;
  draw?: Omit<SceneEnd, 'id' | 'name' | 'when' | 'outcome'>;
}

function fight(s: FightSpec): SceneDef {
  return {
    id: s.id, name: s.name, description: s.description, npcId: s.npcId, locationId: s.locationId, ...(s.start ? { start: s.start } : {}), repeatable: true,
    gauges: [
      { id: 'my_hp', name: '내 체력', start: 20, min: 0, max: 20 },
      { id: 'foe_hp', name: '상대 체력', start: s.foeHp, min: 0, max: s.foeHp },
      { id: 'meter', name: '게이지', start: 0, min: 0, max: 6 },
      { id: 'range', name: '간격 (0 근·1 중·2 원)', start: s.range ?? 1, min: 0, max: 2 },
      { id: 'foe_guard', name: '상대 가드', start: 0, min: 0, max: 1 },
    ],
    states: [
      { id: 'launched', name: '상대 공중', text: '상대가 떠올랐다 — 공중 콤보 기회', edge: 1 },
      { id: 'stunned', name: '내 경직', text: '빈틈을 드러냈다', edge: -1 },
      { id: 'guarding', name: '가드 중', text: '팔을 올려 가드를 굳혔다' },
      { id: 'counter', name: '카운터 노림', text: '상대의 다음 공격을 읽고 기다린다' },
      { id: 'wall', name: '상대 벽', text: '상대가 벽(로프)을 등졌다 — 몰아붙일 때', edge: 1 },
    ],
    ...(s.phases ? { phases: s.phases } : {}),
    likes: s.likes ?? [], dislikes: s.dislikes ?? [],
    actions: [...moves(s.dc, s.tips), ...(s.extraActions ?? [])],
    reactions: pattern(s.foe),
    ends: [
      { id: 'ko_win', name: 'KO 승리', when: { gauge: 'foe_hp', lte: 0 }, outcome: 'success', ...s.win },
      { id: 'ko_lose', name: 'KO 패배', when: { gauge: 'my_hp', lte: 0 }, outcome: 'failure', ...s.lose },
      { id: 'decision', name: '판정', when: { round: 99 }, outcome: 'neutral', text: '공이 울렸다. 둘 다 서 있다 — 심판은 무승부를 선언한다.', ...(s.draw ?? {}) },
    ],
    maxRounds: s.maxRounds ?? 16, timeoutEnd: 'decision',
  };
}

// ------------------------------------------------------------ 대결 7개

const scenes: SceneDef[] = [
  fight({
    id: 'scene/spar', name: '기초 스파링: 녹슨 종의 관장', npcId: 'npc/hwangbo', locationId: 'loc/gym', foeHp: 12, dc: 10, maxRounds: 12,
    description: '황보철 관장과의 연습 시합 (튜토리얼). 언제든 다시 할 수 있다. 관장은 일부러 가드를 올렸다 내렸다 하며 "상대 가드를 보고 고르는 법"을 가르친다: 가드 올린 상대에겐 잡기, 내린 상대에겐 타격, 덤벼 올 땐 가드나 간파. 띄우면 공중 콤보, 게이지 3칸이면 필살기.',
    tips: {
      jab: '(관장: "잽은 빗나가도 괜찮아. 계속 찔러서 게이지를 모아.")',
      mid: '(관장: "가드 올린 놈한테 강타? 그럴 땐 붙어서 잡아!")',
      low: '(관장: "하단은 읽히면 끝이야. 상대 발을 봐.")',
      throw: '(관장: "잡기는 상대가 가드를 굳혔을 때 넣는 거다.")',
      launch: '(관장: "띄우기는 크게 휘두르는 만큼 빈틈도 커. 가드 내린 순간을 노려.")',
      combo: '(관장: "떴을 때 서두르지 마. 리듬을 타.")',
      read: '(관장: "간파는 상대가 덤벼 올 때만 통해.")',
      dash: '(관장: "발! 발부터!")',
    },
    foe: { hit: 1, aggro: 0.45, punish: 2, attack: '관장의 미트 같은 손바닥이 이마를 친다 — "가드!"', punishText: '"빈틈이다!" 관장의 훅이 옆구리를 툭 친다', up: 0.5, down: 0.5,
      grab: { chance: 0.25, dmg: 2, text: '"붙어서 가드만 하면 잡힌다!" 관장이 당신을 가볍게 메친다' } },
    win: { text: '관장이 미트를 내리고 씩 웃는다. "됐다. 바닥에 내보내도 죽진 않겠어."', rewards: { xp: 'minor', relationship: [{ npcId: 'npc/hwangbo', respect: 5 }] } },
    lose: { text: '체육관 바닥에 대자로 뻗었다. 관장이 물병을 던져 준다. "몸으로 배운 건 안 잊혀. 다시."' },
    draw: { text: '종이 울렸다. 관장이 숨을 고르며 고개를 끄덕인다. "나쁘지 않아."' },
  }),
  fight({
    id: 'scene/bulldozer', name: '지하 데뷔전: 불도저 강만석', npcId: 'npc/mansuk', locationId: 'loc/pit', foeHp: 20, dc: 12, range: 1,
    start: { all: [{ sceneEnd: 'scene/spar' }, notWon('scene/bulldozer')] },
    description: '지하 격투장 \'바닥\'의 철창 링. 상대는 130kg의 전직 프로레슬러 강만석. 쉬지 않고 밀고 들어오고, 붙으면 가드째로 들어 던진다. 잽과 하단으로 간격을 유지하며 깎는 것이 정석 (좋아함: 견제·하단, 싫어함: 잡기 — 힘으로 맞잡으면 진다).',
    likes: ['견제', '하단'], dislikes: ['잡기'],
    foe: { hit: 2, aggro: 0.5, punish: 3, attack: '강만석의 래리어트가 목을 휩쓴다', punishText: '빈틈에 어깨 태클이 들어온다 — 철창에 등이 부딪힌다', up: 0.3, down: 0.5,
      mid: [
        { when: { all: [{ gauge: 'range', lte: 0 }, { not: { state: 'launched' } }, { not: { state: 'counter' } }] }, chance: 0.3, delta: { gauges: { my_hp: -3 }, text: '붙잡혔다 — 자이언트 스윙! 세상이 빙빙 돈다' } },
      ],
      drift: [{ when: { gauge: 'range', gte: 1 }, chance: 0.5, delta: { gauges: { range: -1 }, text: '강만석이 땅을 울리며 밀고 들어온다' } }] },
    win: { text: '거구가 무너진다. 철창이 흔들리고, 바닥의 관중이 처음으로 당신의 이름을 묻는다.',
      effects: [{ var: 'crowd', add: 10 }, { relationship: 'npc/mansuk', delta: { respect: 15 } }, { reveal: 'claim/mansuk-debt', state: 'partial' }],
      rewards: { xp: 100, money: 150, relationship: [{ npcId: 'npc/rat', trust: 10 }], reputation: [{ factionId: 'fac/bottom', delta: 15 }] } },
    lose: { text: '천장 조명이 빙글빙글 돈다. 강만석이 손을 내밀어 일으켜 준다. "다음 주에 또 와라, 꼬마."', effects: [{ relationship: 'npc/mansuk', delta: { affinity: 5 } }] },
  }),
  fight({
    id: 'scene/capoeira', name: '예선 1회전: 미드나잇 리아 산토스', npcId: 'npc/lia', locationId: 'loc/qualifier', foeHp: 18, dc: 13, range: 1,
    start: { all: [won('scene/bulldozer'), notWon('scene/capoeira')] },
    description: '무진 오픈 예선 1회전. 상대는 카포에라 파이터 리아 산토스. 징가(흔들리는 스텝)로 간격이 제멋대로 바뀌고, 가드를 올렸다 내렸다 하며 원거리에서도 회전 발차기가 날아온다. 춤추는 몸은 붙잡히면 약하다 (좋아함: 잡기, 싫어함: 띄우기 — 크게 휘두르면 흘려 낸다).',
    likes: ['잡기'], dislikes: ['띄우기'],
    foe: { hit: 2, aggro: 0.5, punish: 3, attack: '아래에서 솟구친 아우 바치두(뒤돌려 차기)가 어깨를 스친다', punishText: '물구나무 회전 발차기가 빈틈으로 쏟아진다', up: 0.5, down: 0.6,
      mid: [
        { when: { all: [{ gauge: 'range', gte: 2 }, { gauge: 'foe_guard', lte: 0 }, { not: { state: 'guarding' } }] }, chance: 0.4, delta: { gauges: { my_hp: -2 }, text: '메이아 루아 — 먼 거리에서 반달 발차기가 날아온다' } },
      ],
      drift: [
        { chance: 0.25, delta: { gauges: { range: 1 }, text: '징가 — 리아가 물러나며 흔들린다' } },
        { chance: 0.3, delta: { gauges: { range: -1 }, text: '징가 — 리아가 리듬을 타며 파고든다' } },
      ] },
    win: { text: '리아가 매트에 앉아 웃음을 터뜨린다. "음악이 멈췄네. 네가 이겼어."',
      effects: [{ var: 'crowd', add: 10 }, { relationship: 'npc/lia', delta: { respect: 15, affinity: 10 } }, { moveNpc: 'npc/lia', to: 'loc/harbor' }, { reveal: 'claim/lia-school', state: 'confirmed' }],
      rewards: { xp: 150, money: 200 } },
    lose: { text: '리듬을 끝내 읽지 못했다. 리아가 손을 흔든다. "다음엔 음악을 들어 봐."' },
  }),
  fight({
    id: 'scene/muaythai', name: '예선 결승: 강철 정강이 반 티엔', npcId: 'npc/vantien', locationId: 'loc/qualifier', foeHp: 22, dc: 13, range: 1,
    start: { all: [won('scene/capoeira'), notWon('scene/muaythai')] },
    description: '예선 결승. 상대는 무에타이 베테랑 반 티엔. 붙으면 목을 잡고 니킥을 퍼붓고(클린치), 헛친 공격은 반드시 팔꿈치로 되갚는다. 리듬이 정직해 읽기 쉽다 (좋아함: 간파, 싫어함: 견제 — 앞차기(팁)에 잽이 막힌다). 체력이 바닥나면 마지막 팔꿈치를 휘두른다.',
    likes: ['간파'], dislikes: ['견제'],
    foe: { hit: 3, aggro: 0.45, punish: 4, punishChance: 0.7, attack: '로우킥이 허벅지를 때린다 — 다리가 저릿하다', punishText: '헛친 팔이 돌아오기도 전에 팔꿈치가 관자놀이를 스친다', up: 0.4, down: 0.5,
      pre: desperation(4, 0.25, '반 티엔이 마지막 힘으로 날아 차는 니킥(카오 로이)!'),
      mid: [
        { when: { all: [{ gauge: 'range', lte: 0 }, { not: { state: 'launched' } }, { not: { state: 'counter' } }] }, chance: 0.35, delta: { gauges: { my_hp: -2 }, text: '클린치 — 목을 잡힌 채 니킥이 명치를 두드린다' } },
      ] },
    win: { text: '반 티엔이 무릎을 꿇은 채 고개를 숙인다. 그리고 아주 작게 말한다. "고맙다. 이걸로… 그 사람들 말을 안 들어도 되겠군."',
      effects: [{ var: 'crowd', add: 15 }, { relationship: 'npc/vantien', delta: { respect: 20, trust: 10 } }, { reveal: 'claim/vantien-order', state: 'partial' }, { moveNpc: 'npc/sera', to: 'loc/rooftop' }, { moveNpc: 'npc/vantien', to: 'loc/pit' }],
      rewards: { xp: 200, money: 300, reputation: [{ factionId: 'fac/bottom', delta: 10 }] } },
    lose: { text: '정강이가 쇠막대 같았다. 반 티엔이 링을 내려가며 중얼거린다. "도망쳐라. 이 대회는… 위험해."', effects: [{ reveal: 'claim/vantien-order', state: 'rumor' }] },
  }),
  fight({
    id: 'scene/rival', name: '옥상의 결투: 윤세라', npcId: 'npc/sera', locationId: 'loc/rooftop', foeHp: 20, dc: 13, range: 2,
    start: { all: [won('scene/muaythai'), { not: { sceneEnd: 'scene/rival' } }] },
    description: '네온 간판이 지지직거리는 폐상가 옥상. 세라핌이 키운 태권도 신동 윤세라가 공식전 전에 "진짜 실력"을 확인하자며 부른 비공식 결투. 긴 다리로 간격을 벌리고 원거리에서 뒤후리기를 꽂는다. 섣불리 들어오는 발을 노린다 (싫어함: 이동). 붙잡히면 약하다 (좋아함: 잡기). 이기든 지든 이야기는 이어진다.',
    likes: ['잡기'], dislikes: ['이동'],
    foe: { hit: 2, aggro: 0.55, punish: 3, attack: '돌려차기가 관자놀이를 스친다', punishText: '빈틈에 뒤후리기 — 발뒤꿈치가 턱을 긁는다', up: 0.4, down: 0.5,
      mid: [
        { when: { all: [{ gauge: 'range', gte: 2 }, { gauge: 'foe_guard', lte: 0 }, { not: { state: 'guarding' } }] }, chance: 0.5, delta: { gauges: { my_hp: -2 }, text: '먼 거리에서 날아든 뒤차기 — 길다, 너무 길다' } },
      ],
      drift: [
        { when: { gauge: 'range', lte: 1 }, chance: 0.3, delta: { gauges: { range: 1 }, text: '세라가 스텝을 밟아 다시 간격을 벌린다' } },
        { when: { gauge: 'range', gte: 2 }, chance: 0.3, delta: { gauges: { range: -1 }, text: '세라가 미끄러지듯 들어온다 — 발이 닿는 거리' } },
      ] },
    win: { text: '세라가 난간에 기대 숨을 몰아쉰다. "…세라핌 코치들보다 네 주먹이 더 정직하네."',
      effects: [{ relationship: 'npc/sera', delta: { respect: 20, affinity: 10 } }, { reveal: 'claim/sera-contract', state: 'partial' }, { moveNpc: 'npc/sera', to: 'loc/hotel' }],
      rewards: { xp: 150 } },
    lose: { text: '바닥에 누운 당신 위로 세라가 손을 내민다. "결승에서 보자. 그때까지 지지 마."',
      effects: [{ relationship: 'npc/sera', delta: { trust: 10, affinity: 10 } }, { reveal: 'claim/sera-contract', state: 'rumor' }, { moveNpc: 'npc/sera', to: 'loc/hotel' }],
      rewards: { xp: 'minor' } },
    draw: { text: '동이 튼다. 둘 다 옥상 바닥에 드러누워 웃는다.', effects: [{ relationship: 'npc/sera', delta: { affinity: 15 } }, { moveNpc: 'npc/sera', to: 'loc/hotel' }] },
  }),
  fight({
    id: 'scene/semi', name: '세계 대회 준결승: 아이언 펜스 이그나트', npcId: 'npc/ignat', locationId: 'loc/arena', foeHp: 24, dc: 14, range: 1,
    start: { all: [{ sceneEnd: 'scene/rival' }, notWon('scene/semi')] },
    description: '무진 돔, 세계 대회 준결승. 상대는 은퇴를 앞둔 복서 이그나트 볼코프. 숄더롤 가드로 자주 가드를 굳히고, 헛친 공격은 거의 반드시 카운터로 되갚는다 (카운터 펀처). 잽 싸움은 그의 영역 (싫어함: 견제), 복서는 다리가 약하다 (좋아함: 하단).',
    likes: ['하단'], dislikes: ['견제'],
    foe: { hit: 3, aggro: 0.4, punish: 5, punishChance: 0.85, attack: '원투 — 정확한 스트레이트가 턱 끝을 친다', punishText: '헛친 순간 크로스 카운터 — 시야가 하얗게 터진다', up: 0.55, down: 0.4,
      pre: desperation(4, 0.2, '이그나트의 마지막 라이트 훅 — 은퇴 경기를 걸고 휘두른다'),
      mid: [
        { when: { all: [{ gauge: 'foe_guard', gte: 1 }, { gauge: 'range', lte: 1 }] }, chance: 0.25, delta: { gauges: { my_hp: -1 }, text: '숄더롤 뒤에서 짧은 견제 잽이 튀어나온다' } },
      ] },
    win: { text: '이그나트가 로프에 기대 웃는다. "좋은 주먹이다. 결승의 챔피언… 왼쪽 무릎을 봐라. 내가 말했다고 하진 말고."',
      effects: [{ var: 'crowd', add: 15 }, { relationship: 'npc/ignat', delta: { respect: 20 } }, { reveal: 'claim/champion-knee', state: 'partial' }],
      rewards: { xp: 250, money: 500 } },
    lose: { text: '카운터 세 방. 정신을 차리니 링 닥터의 손전등이 보인다. 하지만 패자부활전 공지가 붙는다 — 아직 끝나지 않았다.' },
  }),
  fight({
    id: 'scene/final', name: '결승: 무패의 왕 에이든 하트', npcId: 'npc/aiden', locationId: 'loc/arena', foeHp: 28, dc: 14, range: 1, maxRounds: 20,
    start: { all: [won('scene/semi'), { choice: 'choice/bribe' }, { not: { sceneEnd: 'scene/final' } }] },
    description: '세계 대회 결승. 챔피언 에이든 하트는 팔극권과 레슬링을 섞은 완성형 파이터. 1라운드는 가드를 굳힌 채 여유롭게 받아치지만, 체력이 절반 아래로 떨어지면 숨겨 온 무릎 부상을 무시하고 진심으로 몰아친다(2라운드). 하단에 약하고(좋아함: 하단 — 다친 무릎), 잡기는 되받아친다(싫어함: 잡기). 결승은 한 번뿐이다.',
    phases: [{ id: 'p1', name: '1라운드 — 왕의 여유', text: '챔피언이 가드를 굳힌 채 받아친다' }, { id: 'p2', name: '2라운드 — 진심', text: '무릎을 무시하고 몰아친다' }],
    likes: ['하단'], dislikes: ['잡기'],
    extraActions: [
      { id: 'respect', name: '정면 승부 선언', text: '"무릎은 안 노린다. 정면으로 와!" — 관중을 등에 업고 게이지를 크게 채운다 (2라운드, 한 번).', check: 'skill:intimidation', dc: 12, phases: ['p2'], once: true, tags: ['도발'],
        success: { gauges: { meter: 3 }, removeStates: ['stunned'], text: '돔 전체가 함성으로 무너진다. 챔피언이 처음으로 웃는다' }, failure: { gauges: { meter: 1 }, text: '함성에 묻혀 목소리가 닿지 않았다' } },
    ],
    foe: { hit: 3, aggro: 0.45, punish: 4, punishChance: 0.7, attack: '철산고 — 어깨로 들이받는 한 방에 숨이 막힌다', punishText: '빈틈에 팔꿈치(정주)가 꽂힌다 — 무릎이 꺾일 뻔한다', up: 0.45, down: 0.4,
      grab: { chance: 0.3, dmg: 4, text: '가드째로 허리를 잡혔다 — 저먼 수플렉스!' },
      pre: [
        { when: { all: [{ phase: 'p1' }, { gauge: 'foe_hp', lte: 14 }] }, delta: { phase: 'p2', gauges: { foe_guard: -1, range: -2 }, removeStates: ['launched', 'wall'], text: '챔피언의 왼쪽 무릎이 꺾인다 — 그런데 눈빛이 바뀐다. 테이핑을 뜯어낸 왕이 처음으로 진심이 된다' } },
        ...desperation(5, 0.25, '에이든의 마지막 일격 — 붕격(崩擊)이 정면에서 터진다'),
      ],
      mid: [
        { when: { phase: 'p1' }, chance: 0.25, delta: { gauges: { foe_guard: 1 }, text: '챔피언이 여유롭게 가드를 굳힌다' } },
        { when: { all: [{ phase: 'p2' }, { gauge: 'foe_guard', lte: 0 }, { gauge: 'range', lte: 1 }, { not: { state: 'guarding' } }, { not: { state: 'launched' } }] }, chance: 0.3, delta: { gauges: { my_hp: -2 }, text: '진심의 연타 — 쉴 틈이 없다' } },
        { when: { phase: 'p2' }, chance: 0.3, delta: { gauges: { foe_guard: -1 } } },
        { when: { phase: 'p2' }, chance: 0.2, delta: { gauges: { foe_hp: -1 }, text: '챔피언이 무릎을 짚으며 휘청인다' } },
      ] },
    win: { text: '무패의 왕이 매트에 등을 댄다. 정적. 그리고 무진 돔이 무너질 듯한 함성. 에이든이 누운 채 웃는다. "…드디어, 진짜 시합을 했네."',
      effects: [{ var: 'crowd', set: 100 }, { relationship: 'npc/aiden', delta: { respect: 30 } }, { reveal: 'claim/champion-knee', state: 'confirmed' }],
      rewards: { xp: 'major', money: 1000 } },
    lose: { text: '마지막 기억은 천장의 조명. 그래도 관중은 당신의 이름을 연호하고 있다.', effects: [{ relationship: 'npc/aiden', delta: { respect: 20 } }, { reveal: 'claim/champion-knee', state: 'partial' }] },
    draw: { text: '20번째 공. 둘 다 서 있다. 판정단은 챔피언의 손을 든다 — 야유와 박수가 뒤섞인다.', effects: [{ relationship: 'npc/aiden', delta: { respect: 25 } }] },
  }),
];

// ------------------------------------------------------------ 세계

export const fightingSample: WorldPackage = {
  manifest: { id: 'worldforge.sample-fighting', type: 'world', name: '파이널 벨: 무진의 링 (격투 샘플)', version: '0.1.0', schemaVersion: '0', author: 'WORLDFORGE', license: 'CC-BY-4.0', contentRating: 'teen', locales: ['ko'] },
  genre: { id: 'fighting' },
  locations: [
    { id: 'loc/gym', name: '녹슨 종 체육관', improvisation: 'minor', connections: ['loc/market', 'loc/pit', 'loc/rooftop'],
      description: '항구 언덕배기 상가 2층의 낡은 체육관. 땀과 파스 냄새, 기워 붙인 샌드백, 녹이 슨 공(종) 하나가 링 기둥에 매달려 있다. 벽에는 빛바랜 우승 사진 한 장 — 사진 속 젊은 남자의 얼굴만 누군가 테이프로 가려 놓았다.',
      discoveries: [{ claim: 'claim/mentor-photo', check: 'investigation', hint: '벽의 가려진 우승 사진을 살펴보면(조사) 22년 전 무진 오픈 준우승 사진이고, 가려진 얼굴이 젊은 황보철이라는 것을 안다.' }] },
    { id: 'loc/market', name: '무진 새벽시장', improvisation: 'free', connections: ['loc/gym', 'loc/pit', 'loc/harbor', 'loc/hotel', 'loc/qualifier', 'loc/rooftop'],
      description: '생선 비린내와 국밥 김이 뒤섞인 새벽 장터. 리어카 사이로 대회 포스터가 덕지덕지 붙어 있고, 챔피언 에이든 하트의 얼굴이 웃고 있다. 골목 끝 국밥집 2층에서 키보드 두드리는 소리가 들린다.',
      shop: { name: '팔복 할매의 보양 음료 가판', items: ['std/potion-healing', 'std/potion-greater', 'std/rations', 'item/tape'] },
      board: { name: '시장 게시판', jobs: [
        { id: 'job/flyers', name: '대회 전단 돌리기', type: 'deliver', description: '시장 상인회가 무진 오픈 응원 전단을 돌릴 사람을 찾는다. 시장 골목을 한 바퀴 돌면 된다.', locationId: 'loc/market', complete: { at: 'loc/market' }, rewards: { money: 40 }, hint: '시장 골목에서 전단을 돌리는 짧은 장면으로 끝난다.' },
        { id: 'job/kids-class', name: '부두 아이들 격투 교실 보조', type: 'bond', description: '7번 부두 창고의 아이들 카포에라 교실에서 하루 보조 사범을 구한다.', locationId: 'loc/harbor', complete: { at: 'loc/harbor' }, requires: won('scene/capoeira'), rewards: { money: 60, relationship: [{ npcId: 'npc/lia', affinity: 5 }] }, hint: '부두 창고에서 아이들에게 낙법과 스텝을 가르친다.' },
        { id: 'job/sparring', name: '스파링 파트너 구함', type: 'duel', description: '녹슨 종 체육관 관장이 제대로 된 스파링 상대를 구한다 — 관장을 이겨 보라는 뜻이다.', locationId: 'loc/gym', complete: won('scene/spar'), repeatable: false, rewards: { money: 50 } },
      ] } },
    { id: 'loc/pit', name: '지하 격투장 \'바닥\'', improvisation: 'minor', connections: ['loc/gym', 'loc/market', 'loc/harbor'],
      description: '폐업한 수산물 냉동창고 지하. 녹슨 철창으로 두른 팔각 링, 담배 연기 대신 전자담배 수증기, 현금 다발이 오가는 관중석. 천장의 형광등 하나가 쉬지 않고 깜빡인다. 여기서 이기면 예선 추천장을 받는다.',
      discoveries: [{ claim: 'claim/bracket-rumor', check: 'perception', hint: '관중석의 베팅 브로커들 대화를 엿들으면(지각) 세계 대회 대진표가 이미 짜여 있다는 소문을 듣는다.' }] },
    { id: 'loc/harbor', name: '7번 부두 창고', improvisation: 'minor', connections: ['loc/pit', 'loc/market'],
      description: '바닷바람이 철문 틈으로 휘파람을 부는 낡은 창고. 바닥에 매트가 깔려 있고 벽에는 아이들이 그린 크레파스 그림. 밤이면 세라핌 로고가 찍힌 컨테이너 트럭이 조용히 드나든다.',
      discoveries: [{ claim: 'claim/betting-ledger', check: 'investigation', hint: '밤에 드나드는 세라핌 트럭의 운송장을 뒤지면(조사) 불법 베팅 장부 사본 상자를 찾는다.', state: 'confirmed' }] },
    { id: 'loc/qualifier', name: '무진 시민체육관 (예선 경기장)', improvisation: 'minor', connections: ['loc/market', 'loc/hotel', 'loc/arena'],
      description: '관중석 칠이 벗겨진 시민체육관. 링 두 개가 동시에 돌아가고, 마이크를 든 장내 아나운서의 목이 쉬어 있다. 매트에 밴 송진 냄새와 아이싱 스프레이 냄새.' },
    { id: 'loc/hotel', name: '그랜드 해운 호텔 선수 숙소', improvisation: 'minor', connections: ['loc/market', 'loc/qualifier', 'loc/arena', 'loc/tower', 'loc/rooftop'],
      description: '대회 공식 숙소. 로비에는 세라핌 스포츠의 금빛 배너, 복도에는 얼음 주머니를 든 트레이너들. 챔피언 전용 층은 경호원이 지키고, 그 층 쓰레기통에서만 유독 진통제 포장지가 나온다.',
      discoveries: [{ claim: 'claim/champion-knee', check: 'medicine', hint: '챔피언 층에서 나온 의료 폐기물과 테이핑 흔적을 살피면(의학) 무릎 인대 부상을 진통제로 버티고 있다는 것을 안다.', state: 'partial' }] },
    { id: 'loc/rooftop', name: '폐상가 옥상', improvisation: 'minor', connections: ['loc/gym', 'loc/market', 'loc/hotel'],
      description: '불 꺼진 상가 옥상. 반쯤 나간 네온 간판 "무진 볼링"이 지지직거리며 깜빡이고, 멀리 무진 돔의 조명이 바다를 하얗게 물들인다. 바닥에 누군가 분필로 원을 그려 놓았다 — 링이다.' },
    { id: 'loc/tower', name: '세라핌 타워', improvisation: 'none', connections: ['loc/hotel'],
      description: '유리와 강철로 된 스폰서 사옥. 로비 대형 화면에서 에이든 하트의 하이라이트가 무한 반복된다. 42층 대표실로 가는 엘리베이터는 카드키가 있어야 움직인다.',
      discoveries: [{ claim: 'claim/fixing', check: 'investigation', hint: '대표실 비서 책상의 대진표 초안과 판정단 명단을 맞춰 보면(조사) 결승 판정단이 세라핌 쪽 사람으로 채워졌다는 것을 안다.', state: 'partial' }] },
    { id: 'loc/arena', name: '무진 돔 (세계 대회 아레나)', improvisation: 'none', connections: ['loc/hotel', 'loc/qualifier'],
      description: '3만 석 돔. 링 위로 쏟아지는 백색 조명, 바닥까지 울리는 함성, 대형 화면에 뜬 체력 게이지. 선수 입장로의 어둠 속에서 자기 심장 소리가 들린다.' },
  ],
  characters: [
    { id: 'npc/hwangbo', name: '황보철', gender: 'M', locationId: 'loc/gym', improvisation: 'none',
      appearance: '예순 줄의 땅딸막한 사내. 주먹 마디가 모두 뭉개졌고 왼쪽 무릎을 조금 끈다. 늘 수건을 목에 걸고 있다.',
      personality: '무뚝뚝하고 잔소리가 많지만 제자의 몸 상태를 누구보다 먼저 알아챈다. 자기 과거 이야기만 나오면 입을 닫는다.',
      speech: '짧은 반말. "가드." "발." "다시." 칭찬은 거의 안 한다.',
      background: '직함: 녹슨 종 체육관 관장 · 전 복싱·팔극권 코치\n22년 전 무진 오픈 결승에서 졌다. 그날 이후 링에 서지 않았다.',
      greeting: '"문 닫는다. …아, 너 그 신문 광고 보고 온 놈이냐. 장갑 껴."',
      relationship: { trust: 10, respect: 0 }, secretTrust: 50,
      gives: [{ itemId: 'item/rusty-gloves', condition: won('scene/spar') }] },
    { id: 'npc/sera', name: '윤세라', gender: 'F', locationId: 'loc/hotel', improvisation: 'minor', romanceable: true, faction: 'fac/seraphim',
      appearance: '스물두 살. 하얀 도복 하의에 세라핌 로고가 박힌 트레이닝 재킷, 높이 묶은 포니테일. 다리가 길고 서 있는 자세부터 곧다.',
      personality: '자존심이 세고 지는 걸 못 참는다. 세라핌의 "작품" 취급에 지쳐 있고, 진짜 실력으로 인정받고 싶어 한다.',
      speech: '빠르고 날 선 반말. "뭘 봐. 덤빌 거면 덤벼." 마음을 열면 말끝이 부드러워진다.',
      background: '직함: 태권도 신동 · 세라핌 스포츠 소속 선수\n열여섯에 세라핌과 10년 계약을 맺었다. 계약서에 "구단 지시에 따른 경기 운영" 조항이 있다.',
      relationship: { respect: 0, affinity: -5 }, secretTrust: 45,
      companion: { classId: 'fighter', abilities: { str: 12, dex: 16, con: 13, int: 10, wis: 12, cha: 13 }, joinCondition: '세라핌의 뒷거래를 함께 파헤치기로 하고, 링 위에서 서로를 인정했다면 곁에서 싸운다. 승부를 돈으로 사는 쪽에 서면 등을 돌린다.', minTrust: 20 } },
    { id: 'npc/mansuk', name: '강만석', gender: 'M', locationId: 'loc/pit', improvisation: 'minor', faction: 'fac/bottom',
      appearance: '130kg의 거구. 반쯤 벗어진 머리, 귀가 만두처럼 뭉개졌고, 낡은 레슬링 타이츠 위에 시장 앞치마를 걸쳤다.',
      personality: '호탕하고 정이 많다. 링 위에서는 불도저, 내려오면 동네 큰형.',
      speech: '걸걸한 경상도 사투리 반말. "꼬마야, 밥은 묵고 다니나?"',
      background: '직함: 지하 서킷 \'바닥\'의 문지기 · 전 프로레슬러\n문 닫은 레슬링 단체 후배들의 밀린 월급을 지하 시합 상금으로 대신 갚고 있다.' },
    { id: 'npc/lia', name: '리아 산토스', gender: 'F', locationId: 'loc/qualifier', improvisation: 'minor',
      appearance: '스물여섯. 곱슬머리를 두건으로 묶고 맨발로 다닌다. 발목에 실 팔찌가 여러 겹.',
      personality: '밝고 장난스럽지만 아이들 이야기만 나오면 진지해진다. 싸움을 춤이라 부른다.',
      speech: '노래하듯 가벼운 반말, 가끔 포르투갈어 감탄사. "이봐, 리듬을 타!"',
      background: '직함: 카포에라 파이터 · 부두 아이들 교실 사범\n항구 노동자 아이들에게 무료로 카포에라를 가르치고, 상금은 창고 임대료로 쓴다. 세라핌이 창고 부지를 사들이려 한다.' },
    { id: 'npc/vantien', name: '반 티엔', gender: 'M', locationId: 'loc/qualifier', improvisation: 'minor',
      appearance: '서른다섯. 정강이에 흉터가 줄지어 있고 손목에 낡은 몽콘(머리띠)을 감았다. 표정이 거의 없다.',
      personality: '과묵하고 예의 바르다. 빚 때문에 원치 않는 일을 강요받고 있지만 선을 넘지 않으려 버틴다.',
      speech: '짧고 정중한 존댓말. "좋은 시합을 합시다."',
      background: '직함: 무에타이 베테랑\n고향 체육관을 살리려 세라핌에서 돈을 빌렸다. 그 대가로 "유망주를 다치게 하라"는 지시를 받았다.',
      secretTrust: 40, secretFear: 60 },
    { id: 'npc/ignat', name: '이그나트 볼코프', gender: 'M', locationId: 'loc/arena', improvisation: 'minor',
      appearance: '마흔 살의 백발 섞인 복서. 코가 여러 번 부러졌고, 눈빛은 놀랄 만큼 맑다.',
      personality: '노련하고 유머가 있다. 마지막 대회를 깨끗하게 끝내고 싶어 한다. 세라핌의 뒷거래를 눈치챘지만 증거가 없다.',
      speech: '느릿한 존댓말 섞인 반말. "젊은이, 주먹은 거짓말을 안 해."',
      background: '직함: 전 헤비급 복싱 세계 랭커 · "아이언 펜스"\n이번 대회가 은퇴전이다. 딸이 관중석에 온다.' },
    { id: 'npc/aiden', name: '에이든 하트', gender: 'M', locationId: 'loc/arena', improvisation: 'none', faction: 'fac/seraphim',
      appearance: '서른 살의 챔피언. 금빛 가운, 완벽한 미소, 광고판에서 막 걸어 나온 듯한 몸. 왼쪽 무릎에 늘 두꺼운 테이핑.',
      personality: '카메라 앞에서는 여유로운 왕, 혼자일 때는 지쳐 있다. 자신이 "만들어진 챔피언"이라는 사실을 알고 괴로워한다.',
      speech: '부드럽고 자신감 있는 존댓말. "좋은 경기 기대할게요." 진심일 때만 반말이 튀어나온다.',
      background: '직함: 무진 오픈 4연패 챔피언 · 세라핌 스포츠 간판\n2년 전 무릎 인대를 다쳤다. 세라핌은 부상을 숨기고 진통제와 짜인 대진표로 그를 지켜 왔다.',
      secretTrust: 50 },
    { id: 'npc/seo', name: '서도겸', gender: 'M', locationId: 'loc/tower', improvisation: 'none', faction: 'fac/seraphim',
      appearance: '쉰다섯. 회색 쓰리피스 정장, 은테 안경, 손목에 시계 대신 묵주. 웃을 때도 눈은 웃지 않는다.',
      personality: '정중하고 계산적이다. 격투를 "콘텐츠", 선수를 "자산"이라 부른다. 돈으로 안 되는 일은 없다고 믿는다.',
      speech: '느리고 공손한 존댓말. "선수님, 우리 서로 손해 보는 일은 하지 맙시다."',
      background: '직함: 세라핌 스포츠&미디어 대표 · 무진 오픈 주최사\n22년 전엔 젊은 매니저로 결승 조작을 처음 짰다. 지금은 베팅 조직과 손잡고 대진표와 판정을 통째로 산다.',
      goals: [
        { id: 'goal/rig-final', text: '결승 판정단을 세라핌 쪽 사람으로 채우고, 에이든의 5연패를 확정해 베팅 수익을 챙긴다.', days: 5, start: won('scene/muaythai'),
          stop: { any: [{ flag: 'fixing_exposed' }, { flag: 'bribe_recorded' }] }, effects: [{ var: 'pressure', add: 25 }, { setFlag: 'bracket_rigged' }],
          announce: '📰 결승 판정단 다섯 명 중 넷이 세라핌 계열 인사로 교체되었다는 소식이 돈다.', stopped: '📰 세라핌의 판정단 교체 계획이 언론에 새어 나가 흐지부지되었다.' },
      ] },
    { id: 'npc/haneul', name: '민하늘', gender: 'F', locationId: 'loc/market', improvisation: 'minor',
      appearance: '스물넷. 큼직한 후드티에 카메라 두 대, 손등에 볼펜으로 적은 메모. 눈 밑 다크서클이 훈장처럼 진하다.',
      personality: '집요하고 정의감이 강하다. 격투를 사랑해서 격투판의 썩은 부분을 못 참는다. 어머니 성을 쓰고, 아버지 이야기는 하지 않는다.',
      speech: '빠르고 수다스러운 반말. "잠깐, 방금 그거 다시 말해 줘. 녹음 좀 하게."',
      background: '직함: 격투 전문 1인 미디어 기자\n세라핌의 승부조작을 1년째 쫓고 있다. 어릴 때 큰 수술을 받았고, 수술비를 누가 냈는지는 모른다.',
      relationship: { affinity: 5 },
      companion: { classId: 'bard', abilities: { str: 8, dex: 14, con: 12, int: 14, wis: 12, cha: 15 }, joinCondition: '세라핌의 뒷거래를 함께 취재하기로 하면 카메라를 들고 따라온다. 취재원을 팔아넘기는 사람과는 일하지 않는다.', minTrust: 15 } },
    { id: 'npc/rat', name: '박쥐꼬리', gender: 'M', locationId: 'loc/pit', improvisation: 'free', faction: 'fac/bottom',
      appearance: '마흔 줄의 깡마른 사내. 뒷머리를 쥐꼬리처럼 가늘게 길렀다. 손가락마다 반지, 귀에 이어폰 세 개.',
      personality: '돈 냄새에 밝은 지하 프로모터. 의리는 없지만 정보는 정확하다.',
      speech: '능글맞은 반말. "어이 신인, 오늘 배당이 아주 좋아."',
      background: '직함: 지하 서킷 \'바닥\' 프로모터 · 정보통\n세라핌 쪽 베팅 브로커들과도 거래한다.' },
  ],
  facts: [
    { id: 'fact/fixing', statement: '세라핌 대표 서도겸이 불법 베팅 조직과 손잡고 무진 오픈의 대진표와 판정단을 조작한다. 챔피언 에이든 하트는 4년 내내 짜인 상대만 만났다.', secrecy: 4, subjects: ['npc/seo', 'loc/tower'], protectedTopic: '대회의 뒷거래' },
    { id: 'fact/knee', statement: '에이든 하트는 2년 전 왼쪽 무릎 인대를 다쳤고, 진통제와 테이핑으로 버틴다. 세라핌이 부상을 숨긴다.', secrecy: 4, subjects: ['npc/aiden'], protectedTopic: '챔피언의 몸' },
    { id: 'fact/mentor', statement: '22년 전 황보철은 결승을 일부러 졌다. 딸의 심장 수술비가 필요해 당시 매니저 서도겸의 돈을 받았다. 그 딸이 민하늘이다.', secrecy: 5, subjects: ['npc/hwangbo', 'npc/seo', 'npc/haneul'], protectedTopic: '관장의 과거' },
    { id: 'fact/vantien', statement: '반 티엔은 세라핌에 진 빚 때문에 예선에서 유망주를 다치게 하라는 지시를 받았지만, 일부러 반칙을 하지 않고 정면으로 싸운다.', secrecy: 3, subjects: ['npc/vantien', 'npc/seo'] },
  ],
  claims: [
    { id: 'claim/underground', statement: '지하 격투장 \'바닥\'에서 이기면 무진 오픈 예선 추천장을 받을 수 있다.', truth: 'true' },
    { id: 'claim/bracket-rumor', statement: '세계 대회 대진표가 이미 짜여 있다는 소문이 베팅꾼들 사이에 돈다.', truth: 'partial', relatesTo: 'fact/fixing' },
    { id: 'claim/fixing', statement: '세라핌 대표 서도겸이 베팅 조직과 손잡고 대진표와 결승 판정단을 조작한다.', truth: 'true', relatesTo: 'fact/fixing' },
    { id: 'claim/betting-ledger', statement: '세라핌 트럭이 7번 부두로 실어 나르는 상자에 불법 베팅 장부 사본이 있다.', truth: 'true', relatesTo: 'fact/fixing' },
    { id: 'claim/champion-unbeaten', statement: '에이든 하트는 누구도 쓰러뜨릴 수 없는 완벽한 챔피언이다.', truth: 'false', relatesTo: 'fact/knee' },
    { id: 'claim/champion-knee', statement: '챔피언 에이든 하트는 왼쪽 무릎 부상을 진통제로 숨기고 있다.', truth: 'true', relatesTo: 'fact/knee' },
    { id: 'claim/mentor-coward', statement: '황보철은 22년 전 결승에서 겁을 먹고 도망치듯 졌다.', truth: 'false', relatesTo: 'fact/mentor' },
    { id: 'claim/mentor-photo', statement: '녹슨 종 체육관의 가려진 사진은 22년 전 무진 오픈 준우승자 황보철이다.', truth: 'true' },
    { id: 'claim/mentor-thrown', statement: '황보철은 딸의 수술비 때문에 서도겸의 돈을 받고 22년 전 결승을 일부러 졌다.', truth: 'true', relatesTo: 'fact/mentor' },
    { id: 'claim/vantien-order', statement: '반 티엔은 세라핌으로부터 예선에서 유망주를 다치게 하라는 지시를 받았다.', truth: 'true', relatesTo: 'fact/vantien' },
    { id: 'claim/lia-school', statement: '리아 산토스는 상금으로 부두 아이들의 카포에라 교실 창고 임대료를 낸다.', truth: 'true' },
    { id: 'claim/sera-contract', statement: '윤세라의 세라핌 계약서에는 구단 지시대로 경기를 운영해야 한다는 조항이 있다.', truth: 'true' },
    { id: 'claim/mansuk-debt', statement: '강만석은 문 닫은 레슬링 단체 후배들의 밀린 월급을 지하 시합 상금으로 갚고 있다.', truth: 'true' },
  ],
  beliefs: [
    { holder: 'npc/hwangbo', claim: 'claim/underground', state: 'confirmed' },
    { holder: 'npc/hwangbo', claim: 'claim/mentor-thrown', state: 'secret' },
    { holder: 'npc/hwangbo', claim: 'claim/mentor-photo', state: 'secret' },
    { holder: 'npc/rat', claim: 'claim/underground', state: 'confirmed' },
    { holder: 'npc/rat', claim: 'claim/bracket-rumor', state: 'rumor' },
    { holder: 'npc/rat', claim: 'claim/mentor-coward', state: 'rumor' },
    { holder: 'npc/mansuk', claim: 'claim/underground', state: 'confirmed' },
    { holder: 'npc/mansuk', claim: 'claim/mansuk-debt', state: 'confirmed' },
    { holder: 'npc/sera', claim: 'claim/mentor-coward', state: 'mistaken' },
    { holder: 'npc/sera', claim: 'claim/sera-contract', state: 'secret' },
    { holder: 'npc/lia', claim: 'claim/lia-school', state: 'confirmed' },
    { holder: 'npc/lia', claim: 'claim/betting-ledger', state: 'rumor' },
    { holder: 'npc/vantien', claim: 'claim/vantien-order', state: 'secret' },
    { holder: 'npc/vantien', claim: 'claim/bracket-rumor', state: 'confirmed' },
    { holder: 'npc/ignat', claim: 'claim/champion-knee', state: 'partial' },
    { holder: 'npc/ignat', claim: 'claim/bracket-rumor', state: 'partial' },
    { holder: 'npc/aiden', claim: 'claim/champion-knee', state: 'secret' },
    { holder: 'npc/aiden', claim: 'claim/fixing', state: 'secret' },
    { holder: 'npc/seo', claim: 'claim/fixing', state: 'secret' },
    { holder: 'npc/seo', claim: 'claim/mentor-thrown', state: 'secret' },
    { holder: 'npc/haneul', claim: 'claim/bracket-rumor', state: 'confirmed' },
    { holder: 'npc/haneul', claim: 'claim/fixing', state: 'partial' },
    { holder: 'group:관중', claim: 'claim/champion-unbeaten', state: 'mistaken' },
  ],
  items: [
    { id: 'item/tape', name: '스포츠 테이프', description: '손목과 발목을 감는 흰 테이프. 감고 나면 통증이 한결 가신다.', kind: 'consumable', price: 20, heal: '1d4+1' },
    { id: 'item/rusty-gloves', name: '녹슨 종 글러브', description: '관장이 현역 때 끼던 낡은 가죽 글러브. 손에 감기는 느낌이 묘하게 든든하다.', kind: 'trinket', rarity: 'uncommon', bonus: { attack: 1 }, price: 0 },
  ],
  vars: [
    { id: 'crowd', name: '관중 열기', initial: 10, min: 0, max: 100, visible: true, labels: [[0, '무명'], [25, '입소문'], [50, '화제의 신인'], [80, '돔이 들썩인다']] },
    { id: 'pressure', name: '스폰서의 압력', initial: 20, min: 0, max: 100, visible: true, labels: [[0, '잠잠함'], [30, '눈길'], [60, '노골적인 압박'], [85, '위협']] },
  ],
  factions: [
    { id: 'fac/seraphim', name: '세라핌 스포츠&미디어', description: '무진 오픈 주최사이자 최대 스폰서. 선수 계약·중계·광고를 모두 쥐고 있다.', reputation: 0,
      actions: [{ name: '스폰서의 압박', every: 2, condition: { all: [won('scene/bulldozer'), { not: { flag: 'fixing_exposed' } }] }, effects: [{ var: 'pressure', add: 5 }],
        news: '📰 세라핌 계열 매체가 "근본 없는 지하 출신 신인"이라는 기사를 낸다.' }] },
    { id: 'fac/bottom', name: '지하 서킷 \'바닥\'', description: '항구 냉동창고 지하의 무허가 격투 서킷. 거칠지만 승부만큼은 진짜다.', reputation: 0 },
  ],
  relations: [
    { a: 'npc/hwangbo', b: 'npc/haneul', kind: 'family', note: '민하늘의 친아버지. 그녀는 모른다' },
    { a: 'npc/hwangbo', b: 'npc/seo', kind: 'enemy', note: '22년 전 결승 조작의 빚과 원한' },
    { a: 'npc/seo', b: 'npc/aiden', kind: 'master', note: '부상을 숨겨 주는 대신 각본대로 움직이게 한다' },
    { a: 'npc/seo', b: 'npc/sera', kind: 'master', note: '10년 계약으로 묶어 둔 차기 간판' },
    { a: 'npc/lia', b: 'npc/vantien', kind: 'ally', note: '같은 부두 동네 출신, 서로의 아이들 교실을 돕는다' },
    { a: 'npc/ignat', b: 'npc/aiden', kind: 'rival', note: '4년 전 결승에서 석연찮은 판정패' },
    { a: 'npc/mansuk', b: 'npc/rat', kind: 'ally', note: '\'바닥\'을 함께 꾸려 온 오랜 동업자' },
  ],
  relationBeats: [
    { id: 'beat/sera-challenge', npcId: 'npc/sera', name: '옥상으로 와', condition: won('scene/muaythai'), approach: 'message',
      message: '📱 모르는 번호의 문자: "예선 통과 축하해. 오늘 밤 폐상가 옥상. 혼자 와. — 윤세라"',
      hint: '윤세라가 공식전 전에 비공식 결투를 신청한다. 세라핌 코치들 몰래, 진짜 실력을 확인하고 싶어 한다.' },
    { id: 'beat/mansuk-meal', npcId: 'npc/mansuk', name: '국밥 한 그릇', condition: { sceneEnd: 'scene/bulldozer' }, approach: 'none',
      hint: '강만석이 시합 결과와 상관없이 국밥을 사 주며 후배들 이야기와 \'바닥\'의 규칙을 들려준다.' },
    { id: 'beat/haneul-call', npcId: 'npc/haneul', name: '기자의 제보 요청', condition: won('scene/capoeira'), approach: 'message',
      message: '📱 "안녕, 화제의 신인! 격투 기자 민하늘이야. 세라핌 얘기로 할 말 있어. 새벽시장 국밥집 2층으로 와 줄래?"',
      hint: '민하늘이 승부조작 취재에 협조를 부탁한다. 반 티엔과 베팅 브로커 이야기를 꺼낸다.' },
    { id: 'beat/mentor-confession', npcId: 'npc/hwangbo', name: '녹슨 종의 고백', condition: { any: [{ knows: 'claim/mentor-photo' }, { choice: 'choice/bribe' }] }, approach: 'visit', resolveFlag: 'mentor_confessed',
      hint: '황보철이 22년 전 결승의 진실을 털어놓는다. 서도겸의 돈, 딸의 수술. 같은 제안을 받은 제자에게 자기 같은 길을 가지 말라고 한다.' },
    { id: 'beat/aiden-hallway', npcId: 'npc/aiden', name: '복도의 챔피언', condition: won('scene/semi'), approach: 'none',
      hint: '에이든이 호텔 복도나 대기실에서 혼자 무릎에 얼음을 대고 있다. 카메라가 없는 곳에서 "진짜 시합을 해 본 적이 없다"고 털어놓는다.' },
  ],
  scenes,
  randomEvents: [
    { id: 're/fan', name: '첫 팬', kind: 'meeting', text: '교복 입은 아이가 수줍게 다가와 지하 시합 영상을 보여 주며 사인을 부탁한다.', where: ['loc/market', 'loc/qualifier', 'loc/harbor'], condition: won('scene/bulldozer'), effects: [{ var: 'crowd', add: 2 }], cooldownDays: 2 },
    { id: 're/headline', name: '스포츠 신문 1면', kind: 'news', text: '가판대 스포츠 신문 1면에 "챔피언 에이든, 5연패 확실시 — 배당 1.05배"라는 제목이 박혀 있다.', condition: { day: 2 }, cooldownDays: 3 },
    { id: 're/scout', name: '세라핌 스카우트의 명함', kind: 'opportunity', text: '정장 차림 스카우트가 명함을 내민다. "우리 쪽으로 오면 훨씬 편해질 텐데요."', where: ['loc/hotel', 'loc/qualifier'], condition: won('scene/capoeira'), effects: [{ var: 'pressure', add: 3 }], cooldownDays: 3 },
    { id: 're/busking', name: '시장 버스킹 시범', kind: 'opportunity', text: '시장 상인들이 빈 리어카 위에서 발차기 시범 한 번 보여 달라고 조른다. 모자에 동전이 쌓인다.', where: ['loc/market'], effects: [{ money: 20 }, { var: 'crowd', add: 1 }], cooldownDays: 2 },
    { id: 're/rat-tip', name: '박쥐꼬리의 귓속말', kind: 'meeting', text: '박쥐꼬리가 어깨를 툭 치며 속삭인다. "오늘 밤 7번 부두에 세라핌 트럭 들어온다. 난 말 안 했다?"', where: ['loc/pit', 'loc/market'], condition: won('scene/muaythai'), cooldownDays: 4 },
  ],
  titles: [
    { id: 'title/underdog', name: '언더독', desc: '지하 데뷔전에서 130kg의 불도저를 쓰러뜨렸다.', renown: 5, condition: won('scene/bulldozer') },
    { id: 'title/unbeaten', name: '무패 행진', desc: '예선부터 결승까지 모두 KO로 이겼다.', renown: 20, condition: { all: [won('scene/capoeira'), won('scene/muaythai'), won('scene/semi'), won('scene/final')] } },
    { id: 'title/clean-fist', name: '깨끗한 주먹', desc: '승부를 사겠다는 돈을 거절했다.', renown: 10, condition: { any: [{ choice: 'choice/bribe', is: 'refuse' }, { choice: 'choice/bribe', is: 'record' }] } },
    { id: 'title/rival-friend', name: '숙적이자 벗', desc: '옥상에서 주먹을 섞은 라이벌과 친구가 되었다.', renown: 5, condition: { all: [{ sceneEnd: 'scene/rival' }, { stage: 'npc/sera', in: ['친구', '절친', '연인'] }] } },
  ],
  quests: [
    { id: 'quest/rusty-bell', name: '녹슨 종이 울릴 때', kind: 'main', type: 'duel', giver: 'npc/hwangbo', start: { all: [] },
      motive: '돈도 이름도 없는 신인이 세계 대회에 나가는 길은 하나 — 지하 서킷 \'바닥\'에서 이겨 예선 추천장을 받는 것.',
      approaches: [
        { hint: '관장과 스파링하며 가드·잡기·띄우기·게이지의 기본을 몸에 익힌다. 져도 다시 할 수 있다.', skills: ['athletics', 'insight'] },
        { hint: '박쥐꼬리나 강만석에게 \'바닥\'의 규칙과 상대의 버릇을 물어본다.', skills: ['persuasion'], risk: '박쥐꼬리는 정보값을 받는다' },
      ],
      clues: ['claim/underground'],
      stages: [
        { objective: '녹슨 종 체육관에서 관장과 기초 스파링을 한다.', hint: '스파링은 결과와 상관없이 끝나면 된다. 관장은 가드를 보고 잡기와 타격을 고르는 법을 가르친다.', complete: { sceneEnd: 'scene/spar' } },
        { objective: '지하 격투장 \'바닥\'으로 간다.', hint: '체육관이나 시장에서 바로 내려갈 수 있다.', complete: { at: 'loc/pit' } },
        { objective: '지하 데뷔전에서 불도저 강만석을 쓰러뜨린다.', hint: '져도 다시 도전할 수 있다. 붙으면 던지는 상대 — 백스텝으로 간격을 벌리고 잽과 하단으로 깎는다.', complete: won('scene/bulldozer') },
      ],
      rewards: { xp: 100, money: 100, relationship: [{ npcId: 'npc/hwangbo', respect: 10 }] } },
    { id: 'quest/qualifiers', name: '예선의 벽', kind: 'main', type: 'duel', giver: 'npc/rat', start: won('scene/bulldozer'),
      motive: '추천장을 받았다. 무진 시민체육관 예선을 통과해야 세계 대회 본선 무대에 선다.',
      approaches: [
        { hint: '리아의 징가는 간격을 흔든다 — 붙었을 때 잡기로 붙잡는다.', skills: ['athletics'] },
        { hint: '반 티엔의 리듬은 정직하다 — 간파로 읽고 카운터를 노린다. 잽은 앞차기에 막힌다.', skills: ['insight'] },
      ],
      clues: ['claim/vantien-order', 'claim/bracket-rumor'],
      stages: [
        { objective: '예선 1회전: 카포에라 파이터 리아 산토스를 이긴다.', hint: '리아는 예선 경기장에 있다.', complete: won('scene/capoeira') },
        { objective: '예선 결승: 무에타이 베테랑 반 티엔을 이긴다.', hint: '반 티엔은 경기 내내 정직하게 싸운다. 이기면 무언가를 털어놓는다.', complete: won('scene/muaythai') },
      ],
      rewards: { xp: 150, money: 200, reputation: [{ factionId: 'fac/bottom', delta: 10 }] } },
    { id: 'quest/rooftop', name: '옥상의 라이벌', kind: 'side', type: 'bond', giver: 'npc/sera', target: 'npc/sera', start: won('scene/muaythai'),
      motive: '세라핌이 키운 태권도 신동 윤세라가 공식전 전에 진짜 실력을 확인하자고 한다.',
      approaches: [{ hint: '세라는 긴 다리로 간격을 벌린다. 대시는 읽히니 가드로 버티다가 붙었을 때 잡는다.', skills: ['athletics', 'acrobatics'] }],
      truth: 'claim/sera-contract',
      stages: [
        { objective: '밤에 폐상가 옥상으로 간다.', hint: '세라는 옥상에서 기다린다.', complete: { at: 'loc/rooftop' } },
        { objective: '윤세라와 결투한다 (결과는 상관없다).', hint: '이기든 지든 세라는 마음을 연다.', complete: { sceneEnd: 'scene/rival' } },
      ],
      outcomes: [
        { id: 'won', name: '옥상의 승자', when: won('scene/rival'), text: '세라가 처음으로 당신을 "라이벌"이라 부른다.', rewards: { relationship: [{ npcId: 'npc/sera', respect: 10 }] } },
        { id: 'lost', name: '다음을 기약하다', when: { sceneEnd: 'scene/rival', outcome: 'failure' }, text: '세라가 결승에서 기다리겠다며 주먹을 내민다.', rewards: { relationship: [{ npcId: 'npc/sera', trust: 10 }] } },
        { id: 'draw', name: '새벽의 무승부', when: { sceneEnd: 'scene/rival', outcome: 'neutral' }, text: '둘 다 웃으며 새벽을 맞았다.', rewards: { relationship: [{ npcId: 'npc/sera', affinity: 10 }] } },
      ] },
    { id: 'quest/fixed-bracket', name: '짜인 대진표', kind: 'main', type: 'investigate', giver: 'npc/haneul', start: { any: [won('scene/capoeira'), { knows: 'claim/bracket-rumor' }] },
      motive: '이 대회는 처음부터 결과가 정해져 있다는 소문. 사실이라면, 링 위의 모든 땀이 누군가의 베팅 수익일 뿐이다.',
      approaches: [
        { hint: '\'바닥\'의 베팅 브로커들 대화를 엿듣고, 박쥐꼬리에게 정보를 산다.', skills: ['perception', 'persuasion'] },
        { hint: '7번 부두 창고에 밤마다 드나드는 세라핌 트럭을 뒤진다.', skills: ['stealth', 'investigation'], risk: '경비에게 들키면 대회 출전이 위험해진다' },
        { hint: '세라핌 타워 대표실에서 대진표 초안과 판정단 명단을 맞춰 본다.', skills: ['deception', 'investigation'], risk: '서도겸의 경계가 높아진다' },
        { hint: '서도겸의 제안을 받는 자리에서 몰래 녹음한다.', skills: ['sleight_of_hand', 'deception'] },
      ],
      truth: 'claim/fixing', clues: ['claim/bracket-rumor', 'claim/vantien-order', 'claim/betting-ledger', 'claim/champion-knee'],
      stages: [
        { objective: '대진표 조작 소문의 실체를 확인한다.', hint: '반 티엔·이그나트·민하늘·세라핌 타워 — 조각을 모으면 서도겸의 이름이 나온다.', complete: { knows: 'claim/fixing', min: 'partial' } },
        { objective: '조작의 증거를 손에 넣는다.', hint: '부두 창고의 베팅 장부, 또는 서도겸의 제안을 녹음한 것.', complete: { any: [{ flag: 'bribe_recorded' }, { knows: 'claim/betting-ledger', min: 'confirmed' }] } },
        { objective: '새벽시장의 민하늘에게 증거를 넘긴다.', hint: '민하늘은 국밥집 2층 작업실에 있다. 증거를 넘기면 결승 전에 기사를 터뜨린다.', complete: { flag: 'evidence_delivered' } },
      ],
      outcomes: [
        { id: 'exposed', name: '폭로', when: { flag: 'evidence_delivered' }, text: '민하늘의 기사가 터졌다. 세라핌 판정단이 전원 교체된다.',
          effects: [{ setFlag: 'fixing_exposed' }, { var: 'pressure', set: 0 }, { var: 'crowd', add: 20 }, { reputation: 'fac/seraphim', delta: -40 }, { relationship: 'npc/haneul', delta: { trust: 20, respect: 15 } }] },
      ],
      rewards: { xp: 200 } },
    { id: 'quest/final-bell', name: '파이널 벨', kind: 'main', type: 'duel', start: { sceneEnd: 'scene/rival' },
      motive: '무진 돔. 준결승, 그리고 4년간 아무도 쓰러뜨리지 못한 챔피언.',
      approaches: [
        { hint: '이그나트는 카운터 펀처 — 헛치지 말 것. 잽 싸움 대신 하단과 잡기.', skills: ['acrobatics', 'athletics'] },
        { hint: '챔피언의 무릎이 약점이다. 하지만 2라운드의 그는 진심으로 몰아친다.', skills: ['insight', 'intimidation'] },
      ],
      truth: 'claim/champion-knee',
      stages: [
        { objective: '세계 대회 준결승: 아이언 펜스 이그나트를 이긴다.', hint: '무진 돔에서. 져도 패자부활전으로 다시 오를 수 있다.', complete: won('scene/semi') },
        { objective: '결승 전야, 서도겸의 제안에 답한다.', hint: '호텔 선수 숙소에서 서도겸이 기다린다.', complete: { choice: 'choice/bribe' } },
        { objective: '결승: 무패의 왕 에이든 하트와 싸운다.', hint: '결승은 한 번뿐이다.', complete: { sceneEnd: 'scene/final' } },
      ],
      outcomes: [
        { id: 'champion', name: '새 챔피언', when: won('scene/final'), text: '무진 돔에 새 챔피언의 이름이 울린다.', rewards: { money: 500 } },
        { id: 'runner-up', name: '명예로운 준우승', when: { sceneEnd: 'scene/final' }, text: '벨트는 놓쳤지만 돔 전체가 당신의 이름을 기억한다.' },
      ],
      rewards: { xp: 'major' } },
    { id: 'quest/mentor-shadow', name: '가려진 사진', kind: 'side', type: 'bond', giver: 'npc/hwangbo', target: 'npc/hwangbo', start: { any: [{ knows: 'claim/mentor-photo' }, { knows: 'claim/mentor-coward' }] },
      motive: '관장은 왜 자기 우승 사진의 얼굴을 가렸을까. 그리고 왜 서도겸의 이름만 나오면 주먹을 쥐는가.',
      approaches: [
        { hint: '체육관의 가려진 사진을 살핀다.', skills: ['investigation'] },
        { hint: '관장의 신뢰를 얻으면 스스로 털어놓는다.', skills: ['insight', 'persuasion'] },
      ],
      truth: 'claim/mentor-thrown', clues: ['claim/mentor-photo', 'claim/mentor-coward'],
      stages: [
        { objective: '22년 전 결승의 진실을 알아낸다.', hint: '관장이 털어놓거나, 서도겸이 협박 삼아 흘린다.', complete: { knows: 'claim/mentor-thrown', min: 'partial' } },
        { objective: '관장의 과거를 민하늘에게 알릴지 정한다.', hint: '알고 나면 결정의 순간이 온다.', complete: { choice: 'choice/mentor-truth' } },
      ],
      outcomes: [
        { id: 'told', name: '아버지와 딸', when: { choice: 'choice/mentor-truth', is: 'tell' }, text: '민하늘이 녹슨 종 체육관 문을 연다. 오래 걸렸다.', rewards: { relationship: [{ npcId: 'npc/haneul', trust: 10 }] } },
        { id: 'kept', name: '지켜 준 비밀', when: { choice: 'choice/mentor-truth', is: 'keep' }, text: '관장이 처음으로 "고맙다"고 말한다.', rewards: { relationship: [{ npcId: 'npc/hwangbo', trust: 15 }] } },
      ] },
    { id: 'quest/harbor-kids', name: '부두의 아이들', kind: 'side', type: 'bond', giver: 'npc/lia', target: 'npc/lia', start: won('scene/capoeira'),
      motive: '세라핌이 리아의 아이들 교실이 있는 7번 부두 창고 부지를 사들이려 한다.',
      approaches: [{ hint: '창고에 들러 아이들 교실을 돕고, 밤의 세라핌 트럭을 살핀다.', skills: ['performance', 'investigation'] }],
      clues: ['claim/lia-school', 'claim/betting-ledger'],
      stages: [
        { objective: '7번 부두 창고에 들른다.', hint: '리아는 시합이 끝나면 창고로 돌아간다.', complete: { at: 'loc/harbor' } },
        { objective: '아이들 교실을 하루 돕는다.', hint: '아이들에게 낙법과 스텝을 가르치는 장면이 끝나면 GM이 플래그를 세운다.', complete: { flag: 'kids_class' } },
      ],
      rewards: { xp: 'minor', relationship: [{ npcId: 'npc/lia', affinity: 15, trust: 10 }] } },
  ],
  flags: [
    { id: 'evidence_delivered', when: '플레이어가 승부조작의 증거(녹음 또는 베팅 장부)를 민하늘에게 넘길 때', locationId: 'loc/market', requires: { any: [{ flag: 'bribe_recorded' }, { knows: 'claim/betting-ledger', min: 'confirmed' }] } },
    { id: 'fixing_exposed', when: '(엔진) 승부조작 기사가 터졌을 때 — 임무 결과로 세운다' },
    { id: 'bribe_recorded', when: '(엔진) 서도겸의 제안을 몰래 녹음했을 때 — 결정적 선택으로 세운다' },
    { id: 'bracket_rigged', when: '(엔진) 서도겸이 결승 판정단을 바꿨을 때 — 인물 목표로 세운다' },
    { id: 'mentor_confessed', when: '황보철이 22년 전 결승의 진실을 플레이어에게 털어놓았을 때', locationId: 'loc/gym' },
    { id: 'kids_class', when: '플레이어가 부두 창고에서 리아의 아이들 교실을 하루 도왔을 때', locationId: 'loc/harbor', requires: won('scene/capoeira') },
  ],
  choices: [
    { id: 'choice/bribe', name: '서도겸의 제안', locationId: 'loc/hotel', when: won('scene/semi'),
      prompt: '결승 전야, 호텔 방. 서도겸이 서류 봉투를 탁자에 올린다. "3라운드 전에 눕기만 하세요. 이 금액이면 체육관 빚도, 관장님 무릎 수술도 해결됩니다. 22년 전 그분도 현명한 선택을 하셨죠."',
      options: [
        { id: 'accept', text: '봉투를 받는다. 결승은 각본대로.', effects: [{ money: 3000 }, { var: 'pressure', set: 0 }, { relationship: 'npc/hwangbo', delta: { trust: -20, respect: -20 } }, { reveal: 'claim/mentor-thrown', state: 'partial' }] },
        { id: 'refuse', text: '봉투를 밀어낸다. "링 위에서 봅시다."', effects: [{ var: 'pressure', add: 20 }, { relationship: 'npc/hwangbo', delta: { respect: 15 } }, { relationship: 'npc/seo', delta: { grudge: 20 } }, { reveal: 'claim/mentor-thrown', state: 'partial' }] },
        { id: 'record', text: '주머니 속 휴대폰 녹음 버튼을 누른 채, 더 말하게 둔 뒤 거절한다.', effects: [{ setFlag: 'bribe_recorded' }, { reveal: 'claim/fixing', state: 'confirmed' }, { reveal: 'claim/mentor-thrown', state: 'partial' }, { var: 'pressure', add: 20 }, { relationship: 'npc/seo', delta: { grudge: 30 } }] },
      ] },
    { id: 'choice/mentor-truth', name: '관장의 비밀', when: { knows: 'claim/mentor-thrown', min: 'partial' },
      prompt: '민하늘이 22년 전 결승 조작 건을 기사에 넣으려 한다. 그 선수가 관장이고, 수술비를 받은 딸이 그녀 자신이라는 것을 당신은 안다.',
      options: [
        { id: 'tell', text: '민하늘에게 진실을 말한다. 아버지를 만나게 한다.', effects: [{ relationship: 'npc/haneul', delta: { trust: 10 } }, { relationship: 'npc/hwangbo', delta: { trust: 5 } }, { npcRelation: 'npc/hwangbo', with: 'npc/haneul', kind: 'family', note: '22년 만에 서로를 알게 된 부녀' }] },
        { id: 'keep', text: '관장 스스로 말할 때까지 비밀을 지킨다.', effects: [{ relationship: 'npc/hwangbo', delta: { trust: 15 } }] },
      ] },
  ],
  events: [
    { id: 'event/bracket', name: '세계 대회 대진표 발표', when: { day: 3 }, effects: [{ var: 'pressure', add: 5 }], announce: '📰 무진 오픈 세계 대회 대진표가 발표되었다. 챔피언 쪽 블록에는 이상할 만큼 무명 선수들만 들어 있다.' },
    { id: 'event/presser', name: '챔피언 기자회견', when: { day: 6 }, unless: { flag: 'fixing_exposed' }, effects: [{ var: 'crowd', add: 5 }], announce: '📰 에이든 하트가 기자회견 도중 자리에서 일어나다 잠깐 휘청였다는 목격담이 돈다. 세라핌은 "단순한 피로"라고 해명했다.' },
  ],
  arcs: [
    { id: 'arc/final-bell', name: '파이널 벨', kind: 'main', start: { all: [] },
      chapters: [
        { name: '1장 · 녹슨 종', goal: '플레이어가 관장에게 기초를 배우고 지하 서킷에서 데뷔해 첫 승을 거둔다.', summary: '바닥에서 시작한다.', complete: won('scene/bulldozer'), effects: [{ var: 'crowd', add: 5 }] },
        { name: '2장 · 예선의 벽', goal: '예선 두 경기를 통과하고, 반 티엔을 통해 대회의 그림자를 처음 엿본다.', summary: '무진 오픈 예선.', complete: won('scene/muaythai') },
        { name: '3장 · 옥상의 라이벌', goal: '윤세라와 주먹을 섞고 라이벌이자 친구가 된다. 세라핌 계약의 실체가 드러나기 시작한다.', summary: '네온 아래의 결투.', complete: { sceneEnd: 'scene/rival' } },
        { name: '4장 · 짜인 대진표', goal: '준결승을 통과하고 서도겸의 제안을 받는다. 관장의 과거와 승부조작이 겹쳐 보인다.', summary: '돈이냐, 링이냐.', complete: { choice: 'choice/bribe' } },
        { name: '5장 · 파이널 벨', goal: '무패의 왕과 결승을 치른다. 결과와 선택에 따라 결말이 갈린다.', summary: '마지막 공이 울린다.', complete: { sceneEnd: 'scene/final' } },
      ] },
  ],
  endings: [
    { id: 'ending/exposed', name: '폭로의 벨', condition: { all: [{ flag: 'fixing_exposed' }, { sceneEnd: 'scene/final' }] },
      epilogue: '민하늘의 기사가 결승 다음 날 아침 모든 포털 1면을 덮는다. 서도겸은 검찰 포토라인에 서고, 무진 오픈은 처음으로 "각본 없는 대회"를 약속한다. 결승의 승패는 이제 아무도 의심하지 않는다 — 그것이 당신이 링 밖에서 따낸 진짜 벨트다.' },
    { id: 'ending/walked', name: '봉투를 든 파이터', condition: { all: [{ choice: 'choice/bribe', is: 'accept' }, { sceneEnd: 'scene/final' }] },
      epilogue: '돈은 체육관 빚을 갚고도 남았다. 하지만 관장은 더 이상 종을 울리지 않고, 당신은 링 대신 광고판 속에서 웃는다. 어느 날 밤 녹슨 종 체육관 앞을 지나다, 불 꺼진 창문을 오래 올려다본다.' },
    { id: 'ending/champion', name: '새 챔피언', condition: won('scene/final'),
      epilogue: '무패의 왕을 쓰러뜨린 지하 출신 신인. 벨트를 들고 녹슨 종 체육관으로 돌아오자, 관장이 22년 만에 그 종을 직접 울린다. 다음 날부터 체육관 문 앞에 아이들이 줄을 선다.' },
    { id: 'ending/honest', name: '정직한 패자', condition: { sceneEnd: 'scene/final' },
      epilogue: '벨트는 챔피언의 허리에 남았다. 하지만 진통제 없이 2라운드를 버틴 챔피언은 시상대에서 당신의 손을 들어 올린다. 관중은 패자의 이름을 연호하고, 당신은 다음 시즌을 위해 다시 체육관 바닥에 테이프를 감는다.' },
  ],
  start: { locationId: 'loc/gym', money: 200, items: [{ itemId: 'item/tape', n: 2 }, { itemId: 'std/potion-healing', n: 1 }],
    openingScene: '쿵, 쿵. 샌드백 치는 소리에 눈을 뜬다. 땀 냄새와 파스 냄새, 링 기둥에 매달린 녹슨 종. 손에는 테이프가 반쯤 감겨 있고, 링 건너편에서 땅딸막한 노인이 미트를 두드리며 턱짓한다. "올라와. 몸부터 보자."' },
  starts: [
    { id: 'rookie', name: '신인 도전자', locationId: 'loc/gym', description: '이름도 경력도 없다. 신문 구석의 회원 모집 광고 하나 보고 녹슨 종 체육관 문을 두드렸다.',
      openingScene: '삐걱이는 철문을 밀자 땀 냄새가 훅 끼친다. 링 위의 노인이 미트를 낀 채 당신을 위아래로 훑는다. "광고 보고 왔냐. 장갑 껴. 말은 링에서 해."' },
    { id: 'comeback', name: '돌아온 파이터', locationId: 'loc/pit', description: '몇 년 전 지하 서킷에서 이름을 날리다 부상으로 사라졌다. 몸은 녹슬었지만 링의 소문은 아직 기억한다.', knows: ['claim/underground', 'claim/mentor-coward'],
      openingScene: '깜빡이는 형광등, 철창 너머 함성. 몇 년 만에 내려온 \'바닥\'은 그대로다. 박쥐꼬리가 반지 낀 손을 흔든다. "이게 누구야! 살아 있었네? 몸 풀고 와. 위층 녹슨 종 영감한테 먼저 가 보든가."' },
  ],
  style: '격투 만화 문체. 짧게 끊는 문장, 타격음과 숨소리, 관중의 함성, 기술 이름은 굵고 힘 있게. 한 방 한 방의 무게와 간격 싸움의 긴장을 그린다. 피와 부상은 과장하지 않는다 (멍·숨참·휘청임 정도). 링 밖에서는 땀내 나는 체육관과 네온 도시의 정서, 라이벌과의 우정, 돈과 자존심 사이의 갈등.',
  assets: [
    art('elder-m', 0, { characterId: 'npc/hwangbo' }, '노인·원로'), art('adventurer-f', 1, { characterId: 'npc/sera' }, '모험가'), art('soldier-m', 2, { characterId: 'npc/mansuk' }, '병사'),
    art('rogue-f', 3, { characterId: 'npc/lia' }, '도적'), art('adventurer-m', 4, { characterId: 'npc/vantien' }, '모험가'), art('knight-m', 5, { characterId: 'npc/ignat' }, '기사'),
    art('monarch-m', 6, { characterId: 'npc/aiden' }, '군주'), art('villain-m', 7, { characterId: 'npc/seo' }, '흑막'), art('scholar-f', 8, { characterId: 'npc/haneul' }, '학자'), art('merchant-m', 9, { characterId: 'npc/rat' }, '상인'),
    art('temple', 10, { locationId: 'loc/gym' }, '도장'), art('town', 11, { locationId: 'loc/market' }, '시장'), art('prison', 12, { locationId: 'loc/pit' }, '지하 철창'), art('harbor', 13, { locationId: 'loc/harbor' }, '항구'),
    art('battlefield', 14, { locationId: 'loc/qualifier' }, '경기장'), art('bedchamber', 15, { locationId: 'loc/hotel' }, '숙소'), art('night-city', 16, { locationId: 'loc/rooftop' }, '밤거리'),
    art('study', 17, { locationId: 'loc/tower' }, '대표실'), art('palace-hall', 18, { locationId: 'loc/arena' }, '대회장'),
  ],
};

// 장면 그림 (v0.50): 시작·단계·행동·결과·반작용·끝의 빈 자리에 내장 장면 그림(stock.fx-…)을 채운다
fightingSample.scenes = fightingSample.scenes?.map(autoSceneArt);
