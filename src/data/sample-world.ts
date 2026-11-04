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
    },
    {
      id: 'loc/village-gate',
      name: '마을 입구',
      description: '나무 말뚝 울타리와 낡은 문. 문 위에 등불이 흔들린다. 경비 초소가 하나 있다.',
      connections: ['loc/forest-clearing', 'loc/inn'],
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
    },
    {
      id: 'npc/ilse',
      name: '일제',
      appearance: '소매를 걷어 올린 젊은 여관 주인. 왼손에 오래된 화상 자국이 있다.',
      personality: '수다스럽고 호기심이 많다. 소문을 좋아하지만 자기 이야기는 피한다.',
      speech: '친근한 존댓말. 말끝을 흐리는 버릇이 있다.',
      locationId: 'loc/inn',
      improvisation: 'minor',
    },
  ],
  facts: [
    { id: 'fact/altar-summoning', statement: '숲속 제단은 다른 세계의 존재를 불러오는 소환진이며, 마을 장로가 비밀리에 다시 작동시켰다.', secrecy: 5 },
    { id: 'fact/village-name', statement: '이 마을의 이름은 미스트베일이다.', secrecy: 0 },
  ],
  claims: [
    { id: 'claim/village-name', statement: '이 마을의 이름은 미스트베일이다.', truth: 'true', relatesTo: 'fact/village-name' },
    { id: 'claim/altar-cursed', statement: '숲속 제단은 저주받은 곳이라 가까이 가면 안 된다.', truth: 'partial', relatesTo: 'fact/altar-summoning' },
    { id: 'claim/altar-summoning', statement: '숲속 제단은 장로가 다시 작동시킨 소환진이다.', truth: 'true', relatesTo: 'fact/altar-summoning' },
  ],
  beliefs: [
    { holder: 'npc/bran', claim: 'claim/village-name', state: 'confirmed' },
    { holder: 'npc/bran', claim: 'claim/altar-cursed', state: 'rumor' },
    { holder: 'npc/ilse', claim: 'claim/village-name', state: 'confirmed' },
    { holder: 'npc/ilse', claim: 'claim/altar-cursed', state: 'rumor' },
    // claim/altar-summoning 은 아직 아무 NPC도 플레이어도 모른다 (장로 NPC는 이후 추가).
  ],
  start: {
    locationId: 'loc/forest-clearing',
    openingScene: '차가운 돌의 감촉에 눈을 뜬다. 낯선 하늘, 낯선 숲. 어떻게 여기에 왔는지 기억나지 않는다.',
  },
};
