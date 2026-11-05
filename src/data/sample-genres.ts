import type { AssetMeta, WorldPackage } from '../engine/schema';

/**
 * 장르 샘플 세계 (설계 v3 15.2): 무협 · 로맨스. 하이 판타지는 sample-world.ts(안개골짜기).
 * 이미지는 앱 내장 그림(stock.*)을 쓴다.
 */
const art = (id: string, n: number, target: { characterId?: string; locationId?: string }, label: string): AssetMeta => ({
  id: `stock.${id}--${n}`, name: `기본 이미지: ${label}`, kind: target.characterId ? 'character' : 'scene', ...target, tags: target.characterId ? ['default'] : [], mime: 'image/svg+xml', size: 0,
});

export const wuxiaSample: WorldPackage = {
  manifest: { id: 'worldforge.sample-cheongun', type: 'world', name: '청운객잔 (무협 샘플)', version: '0.1.0', schemaVersion: '0', author: 'WORLDFORGE', license: 'CC-BY-4.0', contentRating: 'teen', locales: ['ko'] },
  genre: { id: 'wuxia' },
  locations: [
    { id: 'loc/inn', name: '청운객잔', description: '현성 어귀의 이층 객잔. 붉은 등롱이 흔들리고, 술 냄새와 볶은 땅콩 냄새가 섞여 있다. 구석 탁자에 칼을 찬 손님 몇이 낮게 이야기한다.', connections: ['loc/town'], improvisation: 'minor' },
    { id: 'loc/town', name: '현성 저잣거리', description: '나루와 맞닿은 장터. 생선 비린내와 호객 소리, 강 건너로 푸른 산봉우리가 보인다. 관아 앞 방(榜)에 새 공고가 붙어 있다.', connections: ['loc/inn', 'loc/bamboo'],
      discoveries: [{ claim: 'claim/notice', check: 'investigation', hint: '방을 자세히 읽으면 죽림 산길 통행을 막는다는 관아 공고와, 청운검문 제자가 실종됐다는 소식을 찾는다.' }] },
    { id: 'loc/bamboo', name: '죽림 산길', description: '대나무가 하늘을 가린 좁은 산길. 바람에 댓잎이 쓸리는 소리 사이로, 누군가 발소리를 죽이는 기척이 있다.', connections: ['loc/town', 'loc/sect'], improvisation: 'minor' },
    { id: 'loc/sect', name: '청운검문 연무장', description: '산 중턱의 문파. 붉은 전각 앞 연무장에 검을 든 제자들이 서 있지만, 다들 얼굴이 어둡다. 전각 안쪽에서 약 달이는 냄새가 난다.', connections: ['loc/bamboo'], improvisation: 'none',
      discoveries: [{ claim: 'claim/medicine-smell', check: 'medicine', hint: '전각 안의 약 냄새를 맡아 보면(의술 판정) 해독약을 달이고 있다는 것을 안다.' }] },
  ],
  characters: [
    { id: 'npc/wang', name: '왕 주모', appearance: '소매를 걷어붙인 중년 여인. 손이 크고 웃음소리가 시원하다.', personality: '수다스럽고 정이 많다. 손님 사정을 훤히 꿰고 있지만 강호 일에는 끼고 싶어 하지 않는다.', speech: '시원시원한 반말 섞인 하오체. "어서 오시오, 손님!"', locationId: 'loc/inn', improvisation: 'minor', gender: 'F', background: '직함: 청운객잔 주모' },
    { id: 'npc/yeon', faction: 'fac/cheongun', name: '설하연', appearance: '흰 무복에 장검을 멘 젊은 여인. 머리를 비녀 하나로 틀어 올렸다.', personality: '말수가 적고 곧다. 사문에 대한 충성이 깊고, 낯선 이를 쉽게 믿지 않는다.', speech: '짧고 단정한 하오체. "용건만 말씀하시오."', locationId: 'loc/inn', improvisation: 'minor', gender: 'F',
      background: '직함: 청운검문 삼대 제자 · 협녀\n사부의 병을 고칠 약재를 구하러 내려왔다가 죽림의 산적 때문에 발이 묶였다.',
      relationship: { affinity: 0, trust: -5, respect: 0, fear: 0 }, secretTrust: 40,
      companion: { classId: 'fighter', abilities: { str: 14, dex: 15, con: 13, int: 10, wis: 12, cha: 8 }, joinCondition: '산적을 함께 치우고 약재를 문파에 가져가는 일이라면 동행한다. 강호의 의리를 지키지 않는 자와는 가지 않는다.' } },
    { id: 'npc/unhak', faction: 'fac/cheongun', name: '운학 진인', appearance: '흰 수염이 가슴까지 내려온 노도인. 얼굴빛이 잿빛이고 손이 가늘게 떨린다.', personality: '온화하고 깊다. 문파의 체면을 걱정해 자신의 상태를 숨긴다.', speech: '느리고 무게 있는 하게체. "허허, 젊은이."', locationId: 'loc/sect', improvisation: 'none', gender: 'M',
      background: '직함: 청운검문 장문인', relationship: { affinity: 5, trust: 0, respect: 5, fear: 0 }, secretTrust: 45 },
  ],
  facts: [
    { id: 'fact/poison', statement: '운학 진인은 한 달 전 비무에서 흑풍채 채주의 독장(毒掌)에 맞아 중독되었다. 해독약 재료인 죽림의 청사초가 산적에게 막혀 있다.', secrecy: 4, subjects: ['npc/unhak', 'npc/yeon'], protectedTopic: '장문인의 병' },
  ],
  claims: [
    { id: 'claim/bandits', statement: '흑풍채 산적들이 죽림 산길을 막고 통행세를 뜯는다.', truth: 'true' },
    { id: 'claim/notice', statement: '관아가 죽림 산길 통행을 막았고, 청운검문 제자 한 명이 산길에서 사라졌다.', truth: 'true' },
    { id: 'claim/elder-sick', statement: '청운검문 장문인이 병으로 누웠다는 소문이 있다.', truth: 'partial', relatesTo: 'fact/poison' },
    { id: 'claim/poison', statement: '장문인은 병이 아니라 흑풍채 채주의 독장에 중독되었고, 해독에 죽림의 청사초가 필요하다.', truth: 'true', relatesTo: 'fact/poison' },
    { id: 'claim/medicine-smell', statement: '청운검문 전각에서 해독약을 달이고 있다.', truth: 'true' },
  ],
  beliefs: [
    { holder: 'npc/wang', claim: 'claim/bandits', state: 'confirmed' },
    { holder: 'npc/wang', claim: 'claim/elder-sick', state: 'rumor' },
    { holder: 'npc/yeon', claim: 'claim/bandits', state: 'confirmed' },
    { holder: 'npc/yeon', claim: 'claim/poison', state: 'secret' },
    { holder: 'npc/unhak', claim: 'claim/poison', state: 'secret' },
  ],
  encounters: [
    { id: 'enc/bamboo-bandits', name: '죽림의 산적', locationId: 'loc/bamboo', enemies: [{ monsterId: 'wx_bandit', zone: 2 }, { monsterId: 'wx_bandit', zone: 2 }, { monsterId: 'wx_bandit', zone: 3 }], trigger: '플레이어가 죽림 산길을 지나가려 하거나 산적을 찾으면 흑풍채 졸개들이 길을 막는다.' },
  ],
  quests: [
    { id: 'quest/blocked-road', name: '막힌 산길', kind: 'main', start: { all: [] },
      stages: [
        { objective: '객잔과 저잣거리에서 소문을 듣는다.', hint: '주모와 설하연은 산적 이야기를 한다. 방(榜)을 읽어도 된다.', complete: { any: [{ knows: 'claim/bandits' }, { knows: 'claim/notice' }] } },
        { objective: '죽림 산길의 산적을 물리친다.', hint: '설하연은 이 일이라면 함께 간다.', complete: { cleared: 'enc/bamboo-bandits' } },
        { objective: '청운검문에 올라 장문인을 만난다.', hint: '산길을 지나면 문파에 닿는다.', complete: { at: 'loc/sect' } },
        { objective: '장문인의 병의 진실을 알아낸다.', hint: '설하연이나 장문인의 신뢰를 얻으면 독장 이야기를 털어놓는다. 약 냄새도 단서다.', complete: { knows: 'claim/poison', min: 'partial' } },
      ], rewards: { xp: 200, relationship: [{ npcId: 'npc/yeon', trust: 10, respect: 10 }] } },
  ],
  factions: [{ id: 'fac/cheongun', name: '청운문', description: '산 위의 정파 문파. 협의를 중시하지만 요즘 장문인의 병으로 기세가 꺾였다.' }],
  relations: [{ a: 'npc/unhak', b: 'npc/yeon', kind: 'master', note: '설하연을 어려서부터 거둬 키운 사부' }],
  events: [
    { id: 'event/elder-worse', name: '장문인의 병세', when: { day: 3 }, unless: { questDone: 'quest/blocked-road' }, effects: [{ reveal: 'claim/elder-sick', state: 'rumor' }],
      announce: '📜 청운검문 장문인의 병세가 깊어졌다는 소문이 저잣거리에 돈다.' },
    { id: 'event/elder-dies', name: '장문인의 죽음', when: { day: 7 }, unless: { questDone: 'quest/blocked-road' }, effects: [{ killNpc: 'npc/unhak' }, { relationship: 'npc/yeon', delta: { grudge: 5 } }],
      announce: '📜 청운검문 장문인 운학 진인이 끝내 숨을 거두었다는 소식이 강호에 퍼진다.' },
  ],
  flags: [{ id: 'swore_revenge', when: '진실을 안 플레이어가 흑풍채 채주를 응징하겠다고 문파 앞에서 맹세할 때', locationId: 'loc/sect', requires: { knows: 'claim/poison', min: 'partial' } }],
  endings: [{ id: 'ending/oath', name: '협객의 맹세', condition: { all: [{ questDone: 'quest/blocked-road' }, { flag: 'swore_revenge' }] }, epilogue: '청사초로 장문인의 독이 가라앉고, 주인공은 흑풍채를 향한 맹세와 함께 강호에 이름을 남기기 시작한다.' }],
  start: { locationId: 'loc/inn', openingScene: '삐걱이는 의자, 낯선 술 냄새. 정신을 차려 보니 객잔 구석 탁자에 앉아 있다. 소매 끝이 넓은 낯선 옷을 입고 있고, 허리에는 손에 익지 않은 칼이 걸려 있다.' },
  style: '무협 소설 문체. 짧고 힘 있는 문장, 초식 이름과 기세 묘사, 강호의 은원과 의리.',
  assets: [
    art('wx-commoner-f', 0, { characterId: 'npc/wang' }, '점소이·백성'), art('wx-swordsman-f', 1, { characterId: 'npc/yeon' }, '검객'), art('wx-master-m', 2, { characterId: 'npc/unhak' }, '장문인'),
    art('wx-inn', 3, { locationId: 'loc/inn' }, '객잔'), art('wx-town', 4, { locationId: 'loc/town' }, '저잣거리'), art('wx-bamboo', 5, { locationId: 'loc/bamboo' }, '대나무 숲'), art('wx-sect', 6, { locationId: 'loc/sect' }, '문파 연무장'),
  ],
};

export const romanceSample: WorldPackage = {
  manifest: { id: 'worldforge.sample-rose-season', type: 'world', name: '장미 정원의 계절 (로맨스 샘플)', version: '0.1.0', schemaVersion: '0', author: 'WORLDFORGE', license: 'CC-BY-4.0', contentRating: 'teen', locales: ['ko'] },
  genre: { id: 'romance' },
  locations: [
    { id: 'loc/ballroom', name: '공작저 무도회장', description: '샹들리에 불빛과 현악 사중주. 비단 드레스가 스치는 소리와 향수 냄새, 수군거리는 시선들.', connections: ['loc/garden', 'loc/library'], improvisation: 'minor' },
    { id: 'loc/garden', name: '장미 정원', description: '무도회의 소음이 멀어지는 밤의 정원. 붉은 장미 덩굴 아래 흰 대리석 벤치가 하나, 분수 소리가 잔잔하다.', connections: ['loc/ballroom'], improvisation: 'minor' },
    { id: 'loc/library', name: '공작의 서재', description: '책 냄새와 식은 홍차. 책상 위에 봉인된 편지 한 통이 놓여 있고, 벽난로 불이 낮게 타고 있다.', connections: ['loc/ballroom'], improvisation: 'none',
      discoveries: [{ claim: 'claim/letter', check: 'perception', hint: '서재를 살피면 책상 위 편지의 문장(紋章)이 몇 해 전 파혼한 백작가의 것임을 알아챈다.' }] },
  ],
  characters: [
    { id: 'npc/cassian', name: '카시안', appearance: '검은 연미복의 키 큰 청년 공작. 회색 눈, 웃지 않는 입매.', personality: '차갑고 예의 바르다. 사람을 밀어내지만, 진심을 보이는 상대에게는 서툴게 다정해진다.', speech: '격식 있는 존댓말. 짧고 건조하다. "용건이 있으십니까."', locationId: 'loc/ballroom', improvisation: 'none', gender: 'M',
      background: '직함: 젊은 공작 · 무도회의 주인', relationship: { affinity: -5, trust: -10, respect: 0, fear: 0 }, secretTrust: 55, romanceable: true, faction: 'fac/society' },
    { id: 'npc/eleanor', name: '엘레노어', appearance: '금발에 푸른 드레스, 부채로 입가를 가린 영애.', personality: '사교계의 꽃. 웃는 얼굴로 상대를 시험한다. 카시안에게 관심이 있다.', speech: '우아하고 가시 돋친 존댓말. "어머, 처음 뵙는 얼굴이네요."', locationId: 'loc/ballroom', improvisation: 'minor', gender: 'F',
      background: '직함: 후작 영애 · 사교계의 중심', relationship: { affinity: -10, trust: -5, respect: 0, fear: 0 }, faction: 'fac/society' },
    { id: 'npc/rina', name: '리나', appearance: '앞치마를 단정히 맨 젊은 시녀. 주근깨가 있다.', personality: '밝고 눈치가 빠르다. 저택의 소문을 잘 알고, 주인공 편이 되어 준다.', speech: '조심스러운 해요체. "아가씨, 이쪽으로 오세요!"', locationId: 'loc/ballroom', improvisation: 'minor', gender: 'F',
      background: '직함: 공작저 시녀', relationship: { affinity: 15, trust: 10, respect: 0, fear: 0 } },
  ],
  facts: [
    { id: 'fact/broken-engagement', statement: '카시안의 약혼이 깨진 것은 그가 상대 백작가의 횡령을 덮어 주는 대신 스스로 파혼의 오명을 뒤집어썼기 때문이다.', secrecy: 4, subjects: ['npc/cassian'], protectedTopic: '공작의 파혼 사연' },
  ],
  claims: [
    { id: 'claim/cold-duke', statement: '카시안 공작은 몇 해 전 일방적으로 파혼한 냉혈한이라는 소문이 있다.', truth: 'false', relatesTo: 'fact/broken-engagement' },
    { id: 'claim/eleanor-likes', statement: '엘레노어 영애는 카시안 공작에게 마음이 있다.', truth: 'true' },
    { id: 'claim/letter', statement: '공작의 서재에 옛 약혼 상대 백작가의 편지가 와 있다.', truth: 'true' },
    { id: 'claim/truth', statement: '카시안은 상대 가문의 죄를 덮어 주려고 파혼의 오명을 스스로 뒤집어썼다.', truth: 'true', relatesTo: 'fact/broken-engagement' },
  ],
  beliefs: [
    { holder: 'npc/rina', claim: 'claim/cold-duke', state: 'rumor' },
    { holder: 'npc/rina', claim: 'claim/eleanor-likes', state: 'confirmed' },
    { holder: 'npc/eleanor', claim: 'claim/cold-duke', state: 'confirmed' },
    { holder: 'npc/cassian', claim: 'claim/truth', state: 'secret' },
    { holder: 'npc/cassian', claim: 'claim/letter', state: 'confirmed' },
  ],
  encounters: [],
  quests: [
    { id: 'quest/first-dance', name: '첫 번째 춤', kind: 'main', start: { all: [] },
      stages: [
        { objective: '무도회에서 사람들과 이야기를 나눈다.', hint: '리나는 저택의 소문을, 엘레노어는 공작에 대한 견제를 들려준다.', complete: { any: [{ knows: 'claim/cold-duke' }, { knows: 'claim/eleanor-likes' }] } },
        { objective: '공작 카시안과 가까워진다.', hint: '예의 바르게, 그러나 겁먹지 않고 다가가면 공작의 신뢰가 조금씩 오른다. 정원에서 단둘이 이야기할 기회가 온다.', complete: { relationship: 'npc/cassian', axis: 'trust', gte: 20 } },
        { objective: '공작의 파혼 사연을 알아낸다.', hint: '서재의 편지가 단서가 된다. 신뢰가 깊어지면 카시안이 직접 털어놓는다.', complete: { knows: 'claim/truth', min: 'partial' } },
        { objective: '마음을 정한다.', hint: '정원에서 마음을 고백하거나, 그의 비밀을 지켜 주기로 약속하면 결말이 난다.', complete: { any: [{ flag: 'confessed' }, { flag: 'kept_secret' }] } },
      ], rewards: { xp: 150, relationship: [{ npcId: 'npc/cassian', affinity: 10 }] } },
  ],
  flags: [
    { id: 'confessed', when: '장미 정원에서 플레이어가 카시안에게 마음을 분명히 고백할 때', locationId: 'loc/garden', requires: { relationship: 'npc/cassian', axis: 'affinity', gte: 30 } },
    { id: 'kept_secret', when: '진실을 안 플레이어가 카시안의 비밀을 누구에게도 말하지 않겠다고 약속할 때', requires: { knows: 'claim/truth', min: 'partial' } },
    { id: 'garden_walk', when: '카시안과 단둘이 장미 정원을 거닐며 이야기를 나눴을 때', locationId: 'loc/garden' },
  ],
  factions: [{ id: 'fac/society', name: '사교계', description: '수도 귀족들의 사교 모임. 소문이 무엇보다 빠르게 퍼진다.' }],
  relations: [
    { a: 'npc/eleanor', b: 'npc/cassian', kind: 'lover', note: '엘레노어의 오랜 연심 (카시안은 모른 척한다)' },
    { a: 'npc/rina', b: 'npc/cassian', kind: 'ally', note: '어릴 적부터 공작저에서 일한 시녀 — 주인을 걱정한다' },
  ],
  relationBeats: [
    { id: 'beat/cassian-walk', npcId: 'npc/cassian', name: '정원 산책 제안', condition: { any: [{ stage: 'npc/cassian', in: ['친구', '절친', '연인'] }, { relationship: 'npc/cassian', axis: 'intimacy', gte: 20 }] },
      hint: '카시안이 무도회장의 소란을 피해 정원으로 잠시 걷자고 서툴게 청한다. 단둘이 되면 평소보다 말이 조금 길어진다.', resolveFlag: 'garden_walk' },
    { id: 'beat/eleanor-jealous', npcId: 'npc/eleanor', name: '엘레노어의 견제', condition: { relationship: 'npc/eleanor', axis: 'grudge', gte: 6 },
      hint: '엘레노어가 사람들 앞에서 웃으며 플레이어의 출신을 캐묻고 곤란하게 만들려 한다. 질투를 감추지만 부채 끝이 떨린다.' },
  ],
  endings: [
    { id: 'ending/rose', name: '장미 정원의 약속', condition: { all: [{ questDone: 'quest/first-dance' }, { flag: 'confessed' }] }, epilogue: '정원의 장미 아래에서 두 사람의 계절이 시작된다. 소문은 남았지만, 그 진실을 아는 사람이 한 명 늘었다.' },
    { id: 'ending/secret', name: '지켜진 비밀', condition: { all: [{ questDone: 'quest/first-dance' }, { flag: 'kept_secret' }, { not: { flag: 'confessed' } }] }, epilogue: '말하지 않은 마음과 지켜 준 비밀. 공작은 처음으로 누군가를 믿어 보기로 한다.' },
  ],
  start: { locationId: 'loc/ballroom', openingScene: '눈부신 샹들리에 아래에서 눈을 뜬다. 몸에 꼭 맞는 드레스(혹은 예복), 손에 든 초대장. 사람들의 시선이 일제히 이쪽으로 향한다.' },
  style: '감정선 중심의 로맨스 판타지 문체. 시선·숨결·말끝의 변화를 섬세하게.',
  assets: [
    art('noble-m', 0, { characterId: 'npc/cassian' }, '귀족'), art('noble-f', 1, { characterId: 'npc/eleanor' }, '귀족'), art('servant-f', 2, { characterId: 'npc/rina' }, '시녀'),
    art('ballroom', 3, { locationId: 'loc/ballroom' }, '연회장'), art('garden', 4, { locationId: 'loc/garden' }, '정원'), art('study', 5, { locationId: 'loc/library' }, '서재'),
  ],
};
