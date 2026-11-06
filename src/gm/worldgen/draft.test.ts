import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../engine/package/validate';
import { addScenario, type DraftCond, type ScenarioDraft, type WorldDraft, worldFromDraft } from './draft';

const always: DraftCond = { op: 'all', items: [] };
const atom = (type: DraftCond['items'][number]['type'], ref = '', extra: Partial<DraftCond['items'][number]> = {}) => ({ type, ref, min: '' as const, axis: '' as const, value: 0, ...extra });

/** 일부러 지저분한 초안: 중복 키, 끊어진 참조, 일방통행, 고립된 장소 */
const messy: WorldDraft = {
  name: '등불 항구', premise: '안개 낀 항구 도시', opening_scene: '짠 바람에 눈을 뜬다.', start_location: 'Pier',
  locations: [
    { key: 'Pier', name: '부두', description: '삐걱이는 널판', connections: ['market', 'nowhere'], improvisation: 'minor' },
    { key: 'market', name: '시장', description: '생선 냄새', connections: [], improvisation: 'minor' },
    { key: 'market', name: '시장(중복)', description: '중복', connections: [], improvisation: 'minor' },
    { key: 'lighthouse', name: '등대', description: '꺼진 등불', connections: [], improvisation: 'none' },
  ],
  characters: [
    { key: 'keeper', name: '등대지기', appearance: '외눈', personality: '과묵', speech: '짧게', location: 'lighthouse', improvisation: 'none', companion_class: '', join_condition: '', initial_affinity: 0, initial_trust: 0, secret_trust: 50 },
    { key: 'sailor', name: '선원', appearance: '문신', personality: '수다', speech: '거칠게', location: 'docks?', improvisation: 'minor', companion_class: 'fighter', join_condition: '돈을 주면', initial_affinity: 10, initial_trust: 0, secret_trust: 40 },
  ],
  truths: [{ key: 'drowned-light', statement: '등대지기가 등불을 꺼서 배가 침몰했다.', secrecy: 9, subjects: ['keeper', 'ghost'], protected_topic: '침몰의 원인' }],
  claims: [
    { key: 'storm', statement: '폭풍 때문에 배가 가라앉았다.', truth: 'false', relates_to: 'drowned-light' },
    { key: 'oil', statement: '등대 기름통이 비어 있다.', truth: 'true', relates_to: 'drowned-light' },
  ],
  knowledge: [{ holder: 'sailor', claim: 'storm', state: 'mistaken' }, { holder: 'keeper', claim: 'oil', state: 'secret' }, { holder: 'ghost', claim: 'storm', state: 'rumor' }],
  discoveries: [{ location: 'lighthouse', claim: 'oil', check: 'investigation', hint: '등대를 뒤지면' }, { location: 'void', claim: 'oil', check: '', hint: '' }],
};

describe('초안 정리', () => {
  it('지저분한 초안도 오류 없는 패키지가 된다', () => {
    const { world, notes } = worldFromDraft(messy, { id: 'ai.test', contentRating: 'teen' });
    expect(validateWorld(world).filter((i) => i.level === 'error')).toEqual([]);
    expect(world.locations.map((l) => l.id)).toEqual(['loc/pier', 'loc/market', 'loc/lighthouse']);
    expect(world.locations[1]!.connections).toContain('loc/pier'); // 양방향
    expect(world.locations[2]!.connections).toContain('loc/pier'); // 고립 → 시작과 연결
    expect(world.characters[1]!.locationId).toBe('loc/pier'); // 없는 장소 → 시작
    expect(world.characters[1]!.companion?.classId).toBe('fighter');
    expect(world.facts[0]!.secrecy).toBe(5);
    expect(world.facts[0]!.subjects).toEqual(['npc/keeper']);
    expect(world.beliefs).toHaveLength(2);
    expect(world.locations[2]!.discoveries).toEqual([{ claim: 'claim/oil', check: 'investigation', hint: '등대를 뒤지면' }]);
    expect(world.manifest.aiAssisted).toBe(true);
    expect(notes.length).toBeGreaterThanOrEqual(4);
  });
  it('시나리오: 조건 변환, 깨진 참조 제거, 빈 결말 경고', () => {
    const { world } = worldFromDraft(messy, { id: 'ai.test', contentRating: 'teen' });
    const sc: ScenarioDraft = {
      encounters: [{ key: 'gulls', name: '굶주린 늑대', location: 'pier', enemies: [{ monster: 'wolf', zone: 2 }, { monster: 'dragon', zone: 2 }], trigger: '밤에' }],
      flags: [{ key: 'Light The Lamp', when: '등불을 다시 켤 때', location: 'lighthouse', requires: { op: 'all', items: [atom('knows', 'oil')] } }],
      quests: [{
        key: 'truth', name: '침몰의 진실', kind: 'main', start: always, reward_xp: 100,
        stages: [
          { objective: '등대에 간다', hint: '', complete: { op: 'all', items: [atom('at', 'lighthouse')] } },
          { objective: '단서를 찾는다', hint: '', complete: { op: 'any', items: [atom('knows', 'oil', { min: 'partial' }), atom('knows', 'missing-claim')] } },
          { objective: '등불을 켠다', hint: '', complete: { op: 'all', items: [atom('flag', 'Light The Lamp')] } },
        ],
      }],
      endings: [
        { key: 'dawn', name: '새벽', condition: { op: 'all', items: [atom('quest_done', 'truth'), atom('flag', 'Light The Lamp')] }, epilogue: '등불이 켜진다' },
        { key: 'broken', name: '빈 결말', condition: always, epilogue: '...' },
      ],
    };
    const r = addScenario(world, sc);
    expect(validateWorld(r.world).filter((i) => i.level === 'error')).toEqual([]);
    expect(r.world.encounters![0]!.enemies).toEqual([{ monsterId: 'wolf', zone: 2 }]);
    expect(r.world.flags![0]!.id).toBe('light_the_lamp');
    expect(r.world.quests![0]!.stages[1]!.complete).toEqual({ knows: 'claim/oil', min: 'partial' });
    expect(r.world.endings![0]!.condition).toEqual({ all: [{ questDone: 'quest/truth' }, { flag: 'light_the_lamp' }] });
    expect(r.notes.some((n) => n.includes('missing-claim'))).toBe(true);
    expect(r.notes.some((n) => n.includes('빈 결말'))).toBe(true);
  });
});

describe('초안: 세력·인물 관계·관계 사건 (설계 v3 R5)', () => {
  it('세력 소속·연인 가능·인물 관계를 옮기고, 관계 사건의 단계 조건을 펼친다', () => {
    const d: WorldDraft = {
      ...messy,
      characters: messy.characters.map((c, i) => ({ ...c, romanceable: i === 0, faction: i === 0 ? 'Light Keepers' : 'nope' })),
      factions: [{ key: 'Light Keepers', name: '등대회', description: '등대를 지키는 사람들', reputation: 10 }],
      relations: [{ a: 'keeper', b: 'sailor', kind: 'rival', note: '오랜 앙숙' }, { a: 'keeper', b: 'ghost', kind: 'ally', note: '' }],
    };
    const { world, notes } = worldFromDraft(d, { id: 'test.port', contentRating: 'teen' });
    expect(world.factions).toEqual([{ id: 'fac/light-keepers', name: '등대회', description: '등대를 지키는 사람들', reputation: 10 }]);
    expect(world.characters[0]).toMatchObject({ romanceable: true, faction: 'fac/light-keepers' });
    expect(world.characters[1]!.faction).toBeUndefined();
    expect(world.relations).toEqual([{ a: 'npc/keeper', b: 'npc/sailor', kind: 'rival', note: '오랜 앙숙' }]);
    expect(notes.some((n) => n.includes('ghost'))).toBe(true);
    const sc: ScenarioDraft = {
      encounters: [], quests: [], endings: [],
      flags: [{ key: 'keeper_confessed', when: '등대지기가 고백했을 때', location: '', requires: always }],
      relation_beats: [
        { key: 'confession', npc: 'keeper', name: '등대지기의 고백', condition: { op: 'all', items: [atom('stage', 'keeper', { stage: '친구' }), atom('reputation', 'Light Keepers', { value: 20 })] }, hint: '그가 그날 밤의 일을 털어놓는다', resolve_flag: 'keeper_confessed' },
        { key: 'empty', npc: 'keeper', name: '빈 사건', condition: always, hint: '', resolve_flag: '' },
      ],
    };
    const r = addScenario(world, sc);
    expect(r.world.relationBeats).toEqual([{
      id: 'beat/confession', npcId: 'npc/keeper', name: '등대지기의 고백', hint: '그가 그날 밤의 일을 털어놓는다', resolveFlag: 'keeper_confessed',
      condition: { all: [{ stage: 'npc/keeper', in: ['친구', '절친', '연인'] }, { reputation: 'fac/light-keepers', gte: 20 }] },
    }]);
    expect(validateWorld(r.world).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('초안: 상점·보상 돈 (설계 v3 R4a)', () => {
  it('표준 아이템만 파는 상점을 장소에 달고, 없는 장소·아이템은 뺀다', () => {
    const d: WorldDraft = { ...messy, shops: [
      { location: 'market', name: '잡화점', items: ['std/potion-healing', 'std/rope', 'std/nope', 'std/rope'], faction: '' },
      { location: 'void', name: '유령 상점', items: ['std/rope'], faction: '' },
    ] };
    const { world, notes } = worldFromDraft(d, { id: 'test.shop', contentRating: 'teen' });
    expect(world.locations.find((l) => l.id === 'loc/market')!.shop).toEqual({ name: '잡화점', items: ['std/potion-healing', 'std/rope'] });
    expect(notes.some((n) => n.includes('유령 상점'))).toBe(true);
    expect(validateWorld(world).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('초안: 임무 유형·의뢰판 (설계 v3 R4b)', () => {
  it('임무 유형·의뢰인·대상·기한을 옮기고, 의뢰판에 토벌 의뢰를 단다', () => {
    const { world } = worldFromDraft(messy, { id: 'test.board', contentRating: 'teen' });
    const sc: ScenarioDraft = {
      encounters: [], flags: [], endings: [],
      quests: [{ key: 'guard', name: '선원 호위', kind: 'side', type: 'escort', giver: 'keeper', target: 'sailor', time_limit_days: 3, start: always,
        stages: [{ objective: '선원을 등대까지', hint: '', complete: { op: 'all', items: [atom('at', 'lighthouse')] } }], reward_xp: 50, reward_money: 30 }],
      board: { location: 'Pier', name: '부두 게시판', jobs: [
        { key: 'wolves', name: '늑대 퇴치', type: 'hunt', description: '늑대를 쫓아라', location: 'lighthouse', enemies: [{ monster: 'wolf', zone: 2 }, { monster: 'nope', zone: 2 }], reward_money: 0, repeatable: true },
        { key: 'talk', name: '대화', type: 'negotiate', description: '적 없음', location: 'market', enemies: [], reward_money: 10, repeatable: true },
      ] },
    };
    const r = addScenario(world, sc);
    expect(r.world.quests![0]).toMatchObject({ type: 'escort', giver: 'npc/keeper', target: 'npc/sailor', timeLimit: { days: 3 }, rewards: { xp: 'minor', money: 30 } });
    const board = r.world.locations.find((l) => l.id === 'loc/pier')!.board!;
    expect(board.jobs).toEqual([{ id: 'job/wolves', name: '늑대 퇴치', type: 'hunt', description: '늑대를 쫓아라', locationId: 'loc/lighthouse', enemies: [{ monsterId: 'wolf', zone: 2 }] }]);
    expect(validateWorld(r.world).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('AI 응답에서 목록이 빠져도 (v0.46.3)', () => {
  it('세계·이야기 초안의 빠진 목록은 빈 목록으로 다룬다 — "t.quests is undefined" 오류가 나지 않는다', () => {
    const { world } = worldFromDraft({ locations: [{ key: 'a', name: '광장', description: '넓다' }], characters: undefined } as unknown as WorldDraft, { id: 'x', contentRating: 'teen' });
    expect(world.locations.length).toBe(1);
    const r = addScenario(world, { encounters: [{ key: 'e', name: '기습', location: 'a', trigger: '갑자기' }], quests: undefined, choices: [{ key: 'c', name: '?', prompt: '?', when: {}, location: '', options: undefined }] } as unknown as ScenarioDraft);
    expect(r.world.quests ?? []).toEqual([]);
    expect(r.notes.length).toBeGreaterThanOrEqual(0);
    const empty = addScenario(world, {} as ScenarioDraft);
    expect(empty.notes.some((n) => n.includes('비어 있었습니다'))).toBe(true);
  });
});
