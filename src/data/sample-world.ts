import type { WorldPackage } from '../engine/schema';

/**
 * 손으로 작성한 샘플 세계 (Phase 0 검증용). 편집기 없이 엔진을 먼저 검증하기 위함.
 * 비밀(secret) 1개가 NPC 프롬프트·플레이어 프롬프트로 새지 않는지 확인하는 용도도 겸한다.
 */
export const sampleWorld: WorldPackage = {
  manifest: {
    id: 'worldforge.sample-mistvale',
    type: 'world',
    name: '안개골짜기 (샘플)',
    version: '0.1.0',
    schemaVersion: '0',
    author: 'WORLDFORGE',
    license: 'CC-BY-4.0',
    contentRating: 'teen',
    locales: ['ko'],
  },
  locations: [
    {
      id: 'loc/forest-clearing',
      name: '숲속 공터',
      description: '이끼 낀 돌 원형 제단이 있는 작은 공터. 짙은 안개가 나무 사이로 흐르고, 멀리 개 짖는 소리가 들린다.',
      connections: ['loc/village-gate'],
      improvisation: 'none',
      discoveries: [
        { claim: 'claim/altar-fresh-ash', check: 'investigation', hint: '제단을 자세히 조사하면 최근에 피운 불의 재와, 돌에 새로 그려진 낯선 문양을 찾을 수 있다.' },
      ],
    },
    {
      id: 'loc/village-gate',
      name: '마을 입구',
      description: '나무 말뚝 울타리와 낡은 문. 문 위에 등불이 흔들린다. 경비 초소가 하나 있다.',
      connections: ['loc/forest-clearing', 'loc/inn', 'loc/old-road', 'loc/elder-house'],
    },
    {
      id: 'loc/elder-house',
      name: '장로의 집',
      description: '마을 가장 안쪽의 이층 목조 집. 창틀에 말린 약초가 걸려 있고, 문 앞에 진흙 묻은 장화가 놓여 있다.',
      connections: ['loc/village-gate'],
      discoveries: [
        { claim: 'claim/elder-book', check: 'perception', hint: '장로와 이야기하는 동안 주위를 살피면, 서가에 펼쳐진 낡은 책에 제단의 문양과 같은 그림이 보인다.' },
      ],
    },
    {
      id: 'loc/old-road',
      name: '낡은 숲길',
      description: '마을 동쪽으로 뻗은 수레바퀴 자국투성이 길. 쓰러진 나무와 덤불이 시야를 가린다. 부러진 화살 하나가 땅에 꽂혀 있다.',
      connections: ['loc/village-gate'],
    },
    {
      id: 'loc/inn',
      name: '젖은 장화 여관',
      description: '난롯불 냄새와 묽은 수프 냄새가 섞인 좁은 여관. 손님은 몇 되지 않는다.',
      connections: ['loc/village-gate'],
    },
  ],
  characters: [
    {
      id: 'npc/bran',
      name: '브란',
      appearance: '턱수염이 희끗한 중년 경비병. 녹슨 창을 들고 있다.',
      personality: '의심이 많지만 정이 있다. 외지인을 경계한다.',
      speech: '짧고 퉁명스러운 반말. "흠", "어디서 왔나" 같은 말을 자주 쓴다.',
      locationId: 'loc/village-gate',
      improvisation: 'minor',
      companion: {
        classId: 'fighter',
        abilities: { str: 15, dex: 12, con: 14, int: 8, wis: 13, cha: 10 },
        joinCondition: '마을 문을 지키는 게 일이라 쉽게 자리를 비우지 않는다. 다만 낡은 숲길의 고블린을 처치하러 가거나 장로의 수상한 행동을 함께 조사하자는 제안이라면, 투덜대면서도 따라나선다. 무례한 외지인은 거절한다.',
        minAffinity: -5,
      },
      relationship: { affinity: -10, trust: -10, respect: 0, fear: 0 },
    },
    {
      id: 'npc/ilse',
      name: '일제',
      appearance: '소매를 걷어 올린 젊은 여관 주인. 왼손에 오래된 화상 자국이 있다.',
      personality: '수다스럽고 호기심이 많다. 소문을 좋아하지만 자기 이야기는 피한다.',
      speech: '친근한 존댓말. 말끝을 흐리는 버릇이 있다.',
      locationId: 'loc/inn',
      improvisation: 'minor',
      companion: {
        classId: 'cleric',
        abilities: { str: 12, dex: 10, con: 13, int: 10, wis: 15, cha: 14 },
        joinCondition: '여관을 비우기 싫어한다. 상대가 진심으로 제단이나 마을의 비밀을 밝히려 한다고 느끼면 망설이다 동행한다. 처음 만난 자리에서 바로 따라나서지는 않는다.',
        minTrust: 25,
      },
      relationship: { affinity: 10, trust: 0, respect: 0, fear: 0 },
      secretTrust: 50,
    },
    {
      id: 'npc/orvin',
      name: '오르빈',
      appearance: '등이 굽은 백발의 노인. 손가락 끝에 검댕이 배어 있고, 눈 밑이 검게 꺼져 있다.',
      personality: '온화하고 말이 느리지만 무언가에 쫓기듯 초조하다. 마을을 지키는 일에 지나치게 집착한다.',
      speech: '느린 존댓말. 곤란한 질문에는 "허허" 하고 말을 돌린다.',
      locationId: 'loc/elder-house',
      improvisation: 'minor',
      relationship: { affinity: 5, trust: 0, respect: 0, fear: 0 },
      secretTrust: 40,
      secretFear: 30,
    },
  ],
  facts: [
    {
      id: 'fact/altar-summoning', statement: '숲속 제단은 다른 세계의 존재를 불러오는 소환진이며, 마을 장로가 비밀리에 다시 작동시켰다.', secrecy: 5,
      subjects: ['loc/forest-clearing'], protectedTopic: '숲속 제단의 정체와 누가 작동시켰는지',
    },
    {
      id: 'fact/ilse-burn', statement: '일제의 왼손 화상은 10년 전 제단 의식을 엿보다가 생긴 것이다.', secrecy: 4,
      subjects: ['npc/ilse', 'loc/forest-clearing'], protectedTopic: '일제의 화상 자국이 생긴 경위',
    },
    { id: 'fact/village-name', statement: '이 마을의 이름은 미스트베일이다.', secrecy: 0 },
  ],
  claims: [
    { id: 'claim/village-name', statement: '이 마을의 이름은 미스트베일이다.', truth: 'true', relatesTo: 'fact/village-name' },
    { id: 'claim/altar-cursed', statement: '숲속 제단은 저주받은 곳이라 가까이 가면 안 된다.', truth: 'partial', relatesTo: 'fact/altar-summoning' },
    { id: 'claim/altar-summoning', statement: '숲속 제단은 장로가 다시 작동시킨 소환진이다.', truth: 'true', relatesTo: 'fact/altar-summoning' },
    { id: 'claim/ilse-burn', statement: '일제의 왼손 화상은 10년 전 제단 의식을 엿보다가 생긴 것이다.', truth: 'true', relatesTo: 'fact/ilse-burn' },
    { id: 'claim/elder-strange', statement: '요즘 장로가 밤마다 숲으로 나간다.', truth: 'true' },
    { id: 'claim/goblins-road', statement: '낡은 숲길에 고블린이 나타나 지나가는 사람을 습격한다.', truth: 'true' },
    { id: 'claim/altar-fresh-ash', statement: '숲속 제단에 최근 불을 피운 재와 새로 그린 낯선 문양이 있다.', truth: 'true', relatesTo: 'fact/altar-summoning' },
    { id: 'claim/elder-book', statement: '장로의 서가에 제단 문양과 같은 그림이 그려진 낡은 책이 있다.', truth: 'true', relatesTo: 'fact/altar-summoning' },
    { id: 'claim/elder-reason', statement: '장로는 마을을 지킬 수호자를 얻으려고 소환진을 작동시켰고, 당신이 그 결과다.', truth: 'true', relatesTo: 'fact/altar-summoning' },
    { id: 'claim/way-home', statement: '소환진을 거꾸로 그리면 불려온 자를 원래 세계로 돌려보낼 수 있다.', truth: 'true', relatesTo: 'fact/altar-summoning' },
  ],
  beliefs: [
    { holder: 'npc/bran', claim: 'claim/village-name', state: 'confirmed' },
    { holder: 'npc/bran', claim: 'claim/altar-cursed', state: 'rumor' },
    { holder: 'npc/ilse', claim: 'claim/village-name', state: 'confirmed' },
    { holder: 'npc/ilse', claim: 'claim/altar-cursed', state: 'rumor' },
    { holder: 'npc/ilse', claim: 'claim/ilse-burn', state: 'secret' },
    { holder: 'npc/bran', claim: 'claim/elder-strange', state: 'confirmed' },
    { holder: 'npc/bran', claim: 'claim/goblins-road', state: 'confirmed' },
    { holder: 'npc/ilse', claim: 'claim/goblins-road', state: 'rumor' },
    { holder: 'npc/orvin', claim: 'claim/village-name', state: 'confirmed' },
    { holder: 'npc/orvin', claim: 'claim/altar-summoning', state: 'secret' },
    { holder: 'npc/orvin', claim: 'claim/elder-reason', state: 'secret' },
    { holder: 'npc/orvin', claim: 'claim/way-home', state: 'secret' },
  ],
  encounters: [
    {
      id: 'enc/clearing-wolves', name: '굶주린 늑대들', locationId: 'loc/forest-clearing',
      enemies: [{ monsterId: 'wolf', zone: 2 }, { monsterId: 'wolf', zone: 3 }],
      trigger: '굶주린 늑대 두 마리가 숲 가장자리를 맴돈다. 플레이어가 공터에서 두 턴 이상 머물거나, 큰 소리를 내거나, 숲 깊숙이 들어가려 하면 덤빈다.',
    },
    {
      id: 'enc/road-goblins', name: '고블린 매복', locationId: 'loc/old-road',
      enemies: [{ monsterId: 'goblin_warrior', zone: 2 }, { monsterId: 'goblin_warrior', zone: 3 }],
      trigger: '고블린 둘이 덤불 뒤에 숨어 있다. 플레이어가 길을 따라 더 들어가거나 부러진 화살을 조사하면 습격한다. 플레이어가 은신에 성공하면 먼저 발견할 수도 있다.',
    },
  ],
  quests: [
    {
      id: 'quest/why-am-i-here', name: '낯선 하늘 아래', kind: 'main',
      start: { all: [] },
      stages: [
        { objective: '사람이 사는 곳을 찾는다.', hint: '숲 공터에서 개 짖는 소리 쪽으로 가면 마을 입구가 있다.', complete: { at: 'loc/village-gate' } },
        { objective: '이 마을과 숲속 제단에 대해 알아본다.', hint: '마을 사람들은 제단이 저주받았다는 소문과 장로의 밤 외출을 알고 있다.', complete: { any: [{ knows: 'claim/altar-cursed' }, { knows: 'claim/elder-strange' }] } },
        { objective: '제단과 장로 사이의 연결고리를 찾는다.', hint: '제단을 조사하거나(조사 판정), 장로의 집에서 서가를 살피면(지각 판정) 단서를 얻는다.', complete: { any: [{ knows: 'claim/altar-fresh-ash' }, { knows: 'claim/elder-book' }] } },
        { objective: '장로 오르빈에게 진실을 묻는다.', hint: '장로는 신뢰가 40 이상이거나 충분히 겁을 먹으면 털어놓는다. 단서를 들이밀면 흔들린다.', complete: { knows: 'claim/altar-summoning', min: 'partial' } },
        { objective: '돌아갈지, 이곳에 남을지 정한다.', hint: '장로는 소환진을 거꾸로 그리면 돌려보낼 수 있다는 것을 안다. 플레이어가 결정을 내리면 해당 플래그를 세운다.', complete: { any: [{ flag: 'chose_return' }, { flag: 'chose_stay' }] } },
      ],
      rewards: { xp: 150 },
    },
    {
      id: 'quest/road-goblins', name: '낡은 숲길의 고블린', kind: 'side',
      start: { any: [{ knows: 'claim/goblins-road' }, { at: 'loc/old-road' }] },
      stages: [
        { objective: '낡은 숲길의 고블린을 처치한다.', hint: '고블린 둘이 낡은 숲길 덤불에 숨어 있다. 브란은 이 일이라면 함께 간다.', complete: { cleared: 'enc/road-goblins' } },
      ],
      rewards: { xp: 100, relationship: [{ npcId: 'npc/bran', trust: 8, respect: 5 }] },
    },
    {
      id: 'quest/ilse-scar', name: '일제의 화상', kind: 'side',
      start: { relationship: 'npc/ilse', axis: 'trust', gte: 20 },
      stages: [
        { objective: '일제가 감추는 상처의 사연을 듣는다.', hint: '일제는 신뢰가 50 이상이 되면 화상의 사연을 털어놓는다. 그 사연은 제단과 이어져 있다.', complete: { knows: 'claim/ilse-burn', min: 'partial' } },
      ],
      rewards: { xp: 75, relationship: [{ npcId: 'npc/ilse', affinity: 10 }] },
    },
  ],
  flags: [
    { id: 'chose_return', when: '진실을 안 플레이어가 소환진으로 원래 세계에 돌아가겠다고 결심하고 제단에서 의식을 치를 때', locationId: 'loc/forest-clearing', requires: { knows: 'claim/way-home', min: 'partial' } },
    { id: 'chose_stay', when: '진실을 안 플레이어가 이 세계에 남아 마을을 지키겠다고 장로나 마을 사람에게 분명히 선언할 때', requires: { knows: 'claim/altar-summoning', min: 'partial' } },
  ],
  endings: [
    {
      id: 'ending/return', name: '돌아가는 길',
      condition: { all: [{ flag: 'chose_return' }, { questDone: 'quest/why-am-i-here' }] },
      epilogue: '제단의 문양이 거꾸로 빛나고, 안개 속에서 당신의 몸이 가벼워진다. 함께한 사람들과의 작별, 그리고 원래 세계에서 눈을 뜨는 순간까지. 남은 사람들이 어떻게 지낼지는 여운으로 남긴다.',
    },
    {
      id: 'ending/stay', name: '안개골짜기의 수호자',
      condition: { all: [{ flag: 'chose_stay' }, { questDone: 'quest/why-am-i-here' }] },
      epilogue: '당신은 이 마을에 남기로 한다. 장로의 죄와 마을의 두려움을 함께 짊어지고, 안개 너머에서 다가오는 것들을 지키는 사람이 된다. 동료들과의 관계를 반영해 따뜻하게 마무리한다.',
    },
  ],
  start: {
    locationId: 'loc/forest-clearing',
    openingScene: '차가운 돌의 감촉에 눈을 뜬다. 낯선 하늘, 낯선 숲. 어떻게 여기에 왔는지 기억나지 않는다.',
  },
};
