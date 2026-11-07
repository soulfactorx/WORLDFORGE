import type { SceneDef } from '../engine/schema';

/**
 * 장면 프리셋 (v0.48) — 편집기에서 골라 넣고 이름·수치·상대를 바꿔 쓴다.
 * 모두 "수치가 판정에 들어가고(mods), 상대가 반작용하고(reactions), 대성공이 있는(great)" 구조의 본보기다.
 * 효과(effects)는 세계마다 다르므로 비워 둔다 — 끝에 플래그·관계·세계 수치 효과를 붙여 쓴다.
 */
export interface ScenePreset { key: string; label: string; desc: string; make: () => SceneDef }
import { autoSceneArt } from './sceneArt';

const PRESETS: ScenePreset[] = [
  {
    key: 'negotiation', label: '협상', desc: '인내심을 지키며 합의를 끌어올린다. 상대의 경계가 높을수록 설득이 어렵다.',
    make: (): SceneDef => ({
      id: 'scene/negotiation', name: '협상', description: '상대와 조건을 두고 협상한다. 상대는 정중함을 좋아하고 위협을 싫어한다.',
      gauges: [{ id: 'patience', name: '인내심', start: 5, min: 0, max: 6 }, { id: 'deal', name: '합의', start: 0, min: 0, max: 10 }, { id: 'guard', name: '경계', start: 3, min: 0, max: 6 }],
      states: [{ id: 'leverage', name: '약점을 쥠', edge: 1 }, { id: 'offended', name: '불쾌함', edge: -1 }],
      phases: [{ id: 'probe', name: '탐색' }, { id: 'bargain', name: '담판' }],
      likes: ['정중'], dislikes: ['위협'],
      actions: [
        { id: 'read', name: '속내 떠보기', check: 'skill:insight', dc: 12, phases: ['probe'], mods: [{ gauge: 'guard', per: -1, max: 4 }],
          success: { gauges: { guard: -2 }, phase: 'bargain' }, great: { gauges: { guard: -3 }, addStates: ['leverage'], phase: 'bargain', text: '상대가 정말 원하는 것을 알아챈다' }, failure: { gauges: { patience: -1 } } },
        { id: 'offer', name: '조건 제시', check: 'skill:persuasion', dc: 13, tags: ['정중'], mods: [{ gauge: 'guard', per: -1, max: 4 }],
          success: { gauges: { deal: 3 } }, great: { gauges: { deal: 5 } }, failure: { gauges: { patience: -1, guard: 1 } } },
        { id: 'pressure', name: '압박', check: 'skill:intimidation', dc: 14, tags: ['위협'], phases: ['bargain'],
          success: { gauges: { deal: 4, guard: 1 } }, failure: { gauges: { patience: -2 }, addStates: ['offended'] } },
        { id: 'concede', name: '양보', text: '내 쪽 조건을 하나 내려놓는다', once: true, success: { gauges: { deal: 2, guard: -1 }, removeStates: ['offended'] } },
      ],
      reactions: [{ when: { state: 'offended' }, delta: { gauges: { patience: -1 }, text: '상대가 언짢은 듯 손가락으로 탁자를 두드린다' } }],
      ends: [
        { id: 'deal', name: '합의', when: { gauge: 'deal', gte: 10 }, outcome: 'success', rewards: { xp: 'minor' } },
        { id: 'walkout', name: '결렬', when: { gauge: 'patience', lte: 0 }, outcome: 'failure' },
        { id: 'stalemate', name: '보류', when: { round: 99 }, outcome: 'neutral' },
      ],
      maxRounds: 8, timeoutEnd: 'stalemate',
    }),
  },
  {
    key: 'chase', label: '추격', desc: '거리를 좁히며 상대를 쫓는다. 매 차례 상대가 달아나고, 내 숨이 찬다.',
    make: (): SceneDef => ({
      id: 'scene/chase', name: '추격', description: '도망치는 상대를 골목·지붕·시장통을 지나 쫓는다.',
      gauges: [{ id: 'distance', name: '거리', start: 5, min: 0, max: 10 }, { id: 'stamina', name: '숨', start: 6, min: 0, max: 6 }],
      states: [{ id: 'shortcut', name: '지름길을 앎', edge: 1 }, { id: 'lost', name: '놓침', edge: -1 }],
      actions: [
        { id: 'sprint', name: '전력 질주', check: 'skill:athletics', dc: 12, mods: [{ gauge: 'stamina', per: 0.5, max: 3 }],
          success: { gauges: { distance: -2, stamina: -1 } }, great: { gauges: { distance: -3, stamina: -1 } }, failure: { gauges: { stamina: -2 } } },
        { id: 'vault', name: '장애물 넘기', check: 'skill:acrobatics', dc: 13,
          success: { gauges: { distance: -2 } }, failure: { gauges: { distance: 1, stamina: -1 }, text: '수레에 걸려 휘청인다' } },
        { id: 'track', name: '흔적 찾기', check: 'skill:perception', dc: 12, requires: { state: 'lost' },
          success: { removeStates: ['lost'], gauges: { distance: -1 } }, failure: { gauges: { distance: 1 } } },
        { id: 'shortcut', name: '지름길로', check: 'skill:survival', dc: 14, once: true,
          success: { addStates: ['shortcut'], gauges: { distance: -3 } }, failure: { addStates: ['lost'], gauges: { distance: 2 } } },
        { id: 'breathe', name: '숨 고르기', success: { gauges: { stamina: 2, distance: 1 } } },
      ],
      reactions: [
        { chance: 0.6, delta: { gauges: { distance: 1 }, text: '상대가 모퉁이를 돈다' } },
        { when: { gauge: 'distance', gte: 8 }, chance: 0.5, delta: { addStates: ['lost'], text: '인파 속에 등이 사라진다' } },
      ],
      ends: [
        { id: 'caught', name: '붙잡음', when: { gauge: 'distance', lte: 0 }, outcome: 'success', rewards: { xp: 'minor' } },
        { id: 'escaped', name: '놓침', when: { gauge: 'distance', gte: 10 }, outcome: 'failure' },
        { id: 'exhausted', name: '숨이 턱에 차다', when: { gauge: 'stamina', lte: 0 }, outcome: 'failure' },
      ],
      maxRounds: 10, timeoutEnd: 'escaped',
    }),
  },
  {
    key: 'ritual', label: '의식', desc: '결속을 쌓되 역류를 넘기지 않는다. 역류가 쌓일수록 집중이 흐트러진다.',
    make: (): SceneDef => ({
      id: 'scene/ritual', name: '의식', description: '문양과 주문으로 힘을 엮는 의식. 서두르면 힘이 역류한다.',
      gauges: [{ id: 'bind', name: '결속', start: 0, min: 0, max: 10 }, { id: 'backlash', name: '역류', start: 0, min: 0, max: 6 }],
      states: [{ id: 'focused', name: '몰입', edge: 1 }, { id: 'shaken', name: '동요', edge: -1 }],
      phases: [{ id: 'prepare', name: '준비' }, { id: 'channel', name: '엮기' }],
      actions: [
        { id: 'prepare', name: '문양 그리기', check: 'skill:arcana', dc: 12, phases: ['prepare'],
          success: { gauges: { bind: 2 }, phase: 'channel' }, great: { gauges: { bind: 2 }, addStates: ['focused'], phase: 'channel' }, failure: { gauges: { backlash: 1 } } },
        { id: 'channel', name: '힘 흘려보내기', check: 'ability:con', dc: 12, phases: ['channel'], mods: [{ gauge: 'backlash', per: -1, max: 4 }],
          success: { gauges: { bind: 3, backlash: 1 } }, great: { gauges: { bind: 4 } }, failure: { gauges: { backlash: 2 }, addStates: ['shaken'] } },
        { id: 'pray', name: '기도', check: 'skill:religion', dc: 13, once: true, success: { gauges: { bind: 2 }, removeStates: ['shaken'] }, failure: { gauges: { backlash: 1 } } },
        { id: 'steady', name: '마음 다잡기', check: 'ability:wis', dc: 11, success: { gauges: { backlash: -2 }, removeStates: ['shaken'] }, failure: { gauges: { backlash: 1 } } },
      ],
      reactions: [{ when: { gauge: 'bind', gte: 6 }, chance: 0.4, delta: { gauges: { backlash: 1 }, text: '모인 힘이 출렁인다' } }],
      ends: [
        { id: 'complete', name: '의식 완성', when: { gauge: 'bind', gte: 10 }, outcome: 'success', rewards: { xp: 'minor' } },
        { id: 'backfire', name: '역류 폭주', when: { gauge: 'backlash', gte: 6 }, outcome: 'failure' },
        { id: 'partial', name: '반쯤 된 의식', when: { round: 99 }, outcome: 'neutral' },
      ],
      maxRounds: 9, timeoutEnd: 'partial',
    }),
  },
  {
    key: 'crafting', label: '제작', desc: '품질을 쌓되 재료를 아낀다. 실수가 쌓이면 다음 공정이 어려워진다.',
    make: (): SceneDef => ({
      id: 'scene/crafting', name: '제작', description: '재료를 다듬어 물건을 만든다. 공정마다 품질과 재료가 오간다.',
      gauges: [{ id: 'quality', name: '품질', start: 0, min: 0, max: 12 }, { id: 'material', name: '재료', start: 6, min: 0, max: 6 }, { id: 'flaw', name: '결함', start: 0, min: 0, max: 5 }],
      phases: [{ id: 'shape', name: '형태 잡기' }, { id: 'refine', name: '다듬기' }, { id: 'finish', name: '마무리' }],
      actions: [
        { id: 'shape', name: '형태 잡기', check: 'ability:str', dc: 11, phases: ['shape'],
          success: { gauges: { quality: 3, material: -1 }, phase: 'refine' }, great: { gauges: { quality: 4, material: -1 }, phase: 'refine' }, failure: { gauges: { material: -2, flaw: 1 } } },
        { id: 'refine', name: '세밀하게 다듬기', check: 'skill:sleight_of_hand', dc: 13, phases: ['refine'], mods: [{ gauge: 'flaw', per: -1 }],
          success: { gauges: { quality: 3 } }, great: { gauges: { quality: 4, flaw: -1 } }, failure: { gauges: { flaw: 1, material: -1 } } },
        { id: 'study', name: '설계 다시 보기', check: 'skill:investigation', dc: 12, success: { gauges: { flaw: -2 } }, failure: {} },
        { id: 'finish', name: '마무리', check: 'skill:arcana', dc: 13, phases: ['refine', 'finish'], requires: { gauge: 'quality', gte: 6 },
          success: { gauges: { quality: 4 }, phase: 'finish' }, great: { gauges: { quality: 6 }, phase: 'finish' }, failure: { gauges: { flaw: 2 } } },
      ],
      ends: [
        { id: 'masterwork', name: '걸작', when: { gauge: 'quality', gte: 12 }, outcome: 'success', rewards: { xp: 'minor' } },
        { id: 'ruined', name: '망가짐', when: { any: [{ gauge: 'material', lte: 0 }, { gauge: 'flaw', gte: 5 }] }, outcome: 'failure' },
        { id: 'plain', name: '쓸 만한 물건', when: { round: 99 }, outcome: 'neutral' },
      ],
      maxRounds: 8, timeoutEnd: 'plain',
    }),
  },
  {
    key: 'interrogation', label: '심문', desc: '저항을 무너뜨려 자백을 받는다. 겁을 너무 주면 입을 닫는다.',
    make: (): SceneDef => ({
      id: 'scene/interrogation', name: '심문', description: '붙잡힌 자에게서 진실을 캐낸다. 상대는 자존심이 세고 협박에 굳는다.',
      gauges: [{ id: 'resolve', name: '저항', start: 8, min: 0, max: 10 }, { id: 'fear', name: '두려움', start: 2, min: 0, max: 10 }, { id: 'truth', name: '털어놓은 것', start: 0, min: 0, max: 5 }],
      states: [{ id: 'caught_lie', name: '거짓말 들킴', edge: 1 }, { id: 'clammed', name: '입을 닫음', edge: -1 }],
      likes: ['공감'], dislikes: ['협박'],
      actions: [
        { id: 'empathy', name: '사정 들어 주기', check: 'skill:persuasion', dc: 13, tags: ['공감'], mods: [{ gauge: 'resolve', per: -0.5, max: 4 }],
          success: { gauges: { resolve: -2, truth: 1 } }, great: { gauges: { resolve: -3, truth: 2 } }, failure: { gauges: { resolve: 1 } } },
        { id: 'threat', name: '협박', check: 'skill:intimidation', dc: 12, tags: ['협박'],
          success: { gauges: { fear: 3, resolve: -1 } }, failure: { gauges: { fear: 1, resolve: 1 }, addStates: ['clammed'] } },
        { id: 'catch', name: '모순 짚기', check: 'skill:insight', dc: 14,
          success: { addStates: ['caught_lie'], removeStates: ['clammed'], gauges: { resolve: -2 } }, failure: { gauges: { resolve: 1 } } },
        { id: 'evidence', name: '증거 내밀기', check: 'skill:investigation', dc: 12, once: true, success: { gauges: { resolve: -3, truth: 1 } }, failure: {} },
        { id: 'ask', name: '핵심을 묻다', check: 'skill:intimidation', dc: 14, mods: [{ gauge: 'fear', per: 1, max: 5 }, { gauge: 'resolve', per: -1, max: 5 }],
          success: { gauges: { truth: 2 } }, great: { gauges: { truth: 3 } }, failure: { gauges: { resolve: 1 } } },
      ],
      reactions: [{ when: { gauge: 'fear', gte: 7 }, delta: { addStates: ['clammed'], text: '겁에 질린 상대가 이를 악문다' } }],
      ends: [
        { id: 'confess', name: '자백', when: { gauge: 'truth', gte: 5 }, outcome: 'success', rewards: { xp: 'minor' } },
        { id: 'broken', name: '정신을 놓다', when: { gauge: 'fear', gte: 9 }, outcome: 'failure' },
        { id: 'silent', name: '끝까지 버팀', when: { round: 99 }, outcome: 'neutral' },
      ],
      maxRounds: 9, timeoutEnd: 'silent',
    }),
  },
  {
    key: 'duel', label: '비무', desc: '기세·균형·내력·간격을 겨루는 대결. 상대의 기세가 높을수록 공격이 막힌다.',
    make: (): SceneDef => ({
      id: 'scene/duel', name: '비무', description: '목숨을 걸지 않는 무예 겨루기. 초식 하나하나가 기세와 균형을 흔든다.',
      gauges: [
        { id: 'my_momentum', name: '내 기세', start: 3, min: 0, max: 10 }, { id: 'foe_momentum', name: '상대 기세', start: 3, min: 0, max: 10 },
        { id: 'foe_balance', name: '상대 균형', start: 6, min: 0, max: 6 }, { id: 'my_qi', name: '내력', start: 6, min: 0, max: 6 },
        { id: 'range', name: '간격', start: 2, min: 0, max: 3 },
      ],
      states: [{ id: 'opening', name: '빈틈 발견', edge: 1 }, { id: 'staggered', name: '중심 흔들림', edge: -1 }],
      actions: [
        { id: 'feint', name: '허초', check: 'skill:deception', dc: 12, mods: [{ gauge: 'foe_momentum', per: -0.5, max: 3 }],
          success: { addStates: ['opening'], gauges: { foe_momentum: -1 } }, failure: { gauges: { foe_momentum: 1 } } },
        { id: 'close', name: '파고들기', check: 'skill:acrobatics', dc: 12, success: { gauges: { range: -1, my_momentum: 1 } }, failure: { gauges: { foe_momentum: 1 } } },
        { id: 'strike', name: '정면 초식', check: 'skill:athletics', dc: 13, mods: [{ gauge: 'my_momentum', per: 0.5, max: 3 }, { gauge: 'foe_momentum', per: -0.5, max: 3 }, { gauge: 'range', per: -1 }],
          success: { gauges: { foe_balance: -2, my_momentum: 1 }, removeStates: ['opening'] }, great: { gauges: { foe_balance: -3, my_momentum: 2, foe_momentum: -1 }, removeStates: ['opening'] },
          failure: { gauges: { my_momentum: -1, foe_momentum: 1 } } },
        { id: 'qi', name: '내력 실은 일격', check: 'ability:con', dc: 14, requires: { gauge: 'my_qi', gte: 3 }, mods: [{ gauge: 'my_momentum', per: 0.5, max: 3 }],
          success: { gauges: { foe_balance: -4, my_qi: -3 } }, failure: { gauges: { my_qi: -3 }, addStates: ['staggered'] } },
        { id: 'guard', name: '흘려 막기', check: 'ability:dex', dc: 11, success: { gauges: { foe_momentum: -2 }, removeStates: ['staggered'] }, failure: { gauges: { my_momentum: -1 } } },
        { id: 'breathe', name: '호흡 고르기', success: { gauges: { my_qi: 2, foe_momentum: 1 } } },
      ],
      reactions: [
        { when: { gauge: 'foe_momentum', gte: 5 }, delta: { gauges: { my_momentum: -1 }, text: '상대의 검이 매섭게 몰아친다' } },
        { when: { gauge: 'foe_momentum', gte: 8 }, chance: 0.5, delta: { addStates: ['staggered'], text: '받아 낸 일격에 중심이 흔들린다' } },
        { chance: 0.5, delta: { gauges: { foe_momentum: 1 } } },
      ],
      ends: [
        { id: 'win', name: '한 수 위', when: { gauge: 'foe_balance', lte: 0 }, outcome: 'success', rewards: { xp: 'minor' } },
        { id: 'lose', name: '한 수 아래', when: { all: [{ gauge: 'my_momentum', lte: 0 }, { gauge: 'foe_momentum', gte: 8 }] }, outcome: 'failure' },
        { id: 'draw', name: '무승부', when: { round: 99 }, outcome: 'neutral' },
      ],
      maxRounds: 10, timeoutEnd: 'draw',
    }),
  },
  {
    key: 'date', label: '데이트', desc: '분위기를 끌어올리고 어색함을 관리한다. 상대의 취향이 판정을 바꾼다.',
    make: (): SceneDef => ({
      id: 'scene/date', name: '데이트', description: '함께 시간을 보내며 서로를 알아 간다. 상대는 진솔한 이야기를 좋아하고 허세를 싫어한다.',
      gauges: [{ id: 'mood', name: '분위기', start: 2, min: 0, max: 10 }, { id: 'awkward', name: '어색함', start: 1, min: 0, max: 5 }, { id: 'known', name: '알게 된 것', start: 0, min: 0, max: 4 }],
      states: [{ id: 'laughing', name: '웃음이 터짐', edge: 1 }, { id: 'silence', name: '침묵', edge: -1 }],
      phases: [{ id: 'meet', name: '만남' }, { id: 'walk', name: '산책' }, { id: 'farewell', name: '헤어질 무렵' }],
      likes: ['진솔'], dislikes: ['허세'],
      actions: [
        { id: 'ask', name: '취향 묻기', check: 'skill:insight', dc: 11, tags: ['진솔'], success: { gauges: { known: 1, mood: 1 } }, great: { gauges: { known: 2, mood: 1 } }, failure: { gauges: { awkward: 1 } } },
        { id: 'joke', name: '농담', check: 'skill:performance', dc: 12, mods: [{ gauge: 'awkward', per: -1, max: 3 }],
          success: { gauges: { mood: 2, awkward: -1 }, addStates: ['laughing'], removeStates: ['silence'] }, failure: { gauges: { awkward: 2 }, addStates: ['silence'] } },
        { id: 'brag', name: '자랑', check: 'skill:persuasion', dc: 12, tags: ['허세'], success: { gauges: { mood: 1 } }, failure: { gauges: { awkward: 2 } } },
        { id: 'walk', name: '걷자고 하기', phases: ['meet'], requires: { gauge: 'mood', gte: 4 }, success: { phase: 'walk' } },
        { id: 'story', name: '내 이야기 털어놓기', check: 'skill:persuasion', dc: 13, tags: ['진솔'], phases: ['walk', 'farewell'], mods: [{ gauge: 'known', per: 1, max: 3 }],
          success: { gauges: { mood: 3 } }, great: { gauges: { mood: 4, awkward: -1 } }, failure: { gauges: { awkward: 1 } } },
        { id: 'promise', name: '다음 약속', phases: ['walk'], requires: { gauge: 'mood', gte: 7 }, success: { phase: 'farewell', gauges: { mood: 1 } } },
      ],
      reactions: [{ when: { state: 'silence' }, delta: { gauges: { awkward: 1 }, text: '말이 끊긴 채 발소리만 들린다' } }],
      ends: [
        { id: 'sweet', name: '설레는 하루', when: { gauge: 'mood', gte: 10 }, outcome: 'success' },
        { id: 'flop', name: '어색한 하루', when: { gauge: 'awkward', gte: 5 }, outcome: 'failure' },
        { id: 'fine', name: '무난한 하루', when: { round: 99 }, outcome: 'neutral' },
      ],
      maxRounds: 9, timeoutEnd: 'fine',
    }),
  },
  {
    key: 'auction', label: '경매', desc: '경쟁자의 의지를 꺾으며 자금을 아낀다. 값이 오를수록 버티기 어렵다.',
    make: (): SceneDef => ({
      id: 'scene/auction', name: '경매', description: '탐나는 물건을 두고 경쟁자와 값을 다툰다.',
      gauges: [{ id: 'price', name: '호가', start: 2, min: 0, max: 10 }, { id: 'purse', name: '남은 자금', start: 7, min: 0, max: 8 }, { id: 'rival', name: '경쟁자의 의지', start: 6, min: 0, max: 8 }],
      states: [{ id: 'read_rival', name: '경쟁자 한도 파악', edge: 1 }, { id: 'flustered', name: '흥분', edge: -1 }],
      actions: [
        { id: 'raise', name: '값 올리기', success: { gauges: { price: 1, purse: -1, rival: -1 } } },
        { id: 'jump', name: '크게 지르기', check: 'skill:intimidation', dc: 13, mods: [{ gauge: 'rival', per: -0.5, max: 3 }],
          success: { gauges: { price: 2, purse: -2, rival: -3 } }, great: { gauges: { price: 2, purse: -2, rival: -5 } }, failure: { gauges: { price: 2, purse: -2 }, addStates: ['flustered'] } },
        { id: 'study', name: '경쟁자 살피기', check: 'skill:insight', dc: 12, once: true, success: { addStates: ['read_rival'], gauges: { rival: -1 } }, failure: {} },
        { id: 'bluff', name: '포기하는 척', check: 'skill:deception', dc: 14,
          success: { gauges: { rival: -2 }, text: '경쟁자가 방심한다' }, failure: { gauges: { price: 1 } } },
        { id: 'calm', name: '침착하기', check: 'ability:wis', dc: 11, success: { removeStates: ['flustered'] }, failure: {} },
      ],
      reactions: [
        { when: { gauge: 'rival', gte: 3 }, delta: { gauges: { price: 1 }, text: '경쟁자가 패를 든다' } },
        { when: { state: 'flustered' }, chance: 0.5, delta: { gauges: { purse: -1 }, text: '흥분해서 손이 먼저 올라간다' } },
      ],
      ends: [
        { id: 'won', name: '낙찰', when: { gauge: 'rival', lte: 0 }, outcome: 'success' },
        { id: 'broke', name: '자금 바닥', when: { gauge: 'purse', lte: 0 }, outcome: 'failure' },
        { id: 'outbid', name: '넘어감', when: { gauge: 'price', gte: 10 }, outcome: 'failure' },
      ],
      maxRounds: 10, timeoutEnd: 'outbid',
    }),
  },
  {
    key: 'infiltration', label: '잠입 경보', desc: '들키지 않고 목표에 닿는다. 매 차례 경보가 오르고, 경보가 높을수록 숨기 어렵다.',
    make: (): SceneDef => ({
      id: 'scene/infiltration', name: '잠입', description: '경비가 도는 곳에 몰래 들어가 목표에 닿는다.',
      gauges: [{ id: 'progress', name: '진척', start: 0, min: 0, max: 8 }, { id: 'alert', name: '경보', start: 1, min: 0, max: 10 }],
      states: [{ id: 'disguised', name: '변장', edge: 1 }, { id: 'spotted', name: '수상한 눈길', edge: -1 }],
      phases: [{ id: 'outer', name: '외곽' }, { id: 'inner', name: '내부' }],
      actions: [
        { id: 'sneak', name: '그림자 따라 움직이기', check: 'skill:stealth', dc: 12, mods: [{ gauge: 'alert', per: -0.5, max: 4 }],
          success: { gauges: { progress: 2 } }, great: { gauges: { progress: 3, alert: -1 } }, failure: { gauges: { alert: 2 }, addStates: ['spotted'] } },
        { id: 'lock', name: '자물쇠 따기', check: 'skill:sleight_of_hand', dc: 13, phases: ['outer'], once: true,
          success: { gauges: { progress: 2 }, phase: 'inner' }, failure: { gauges: { alert: 1 } } },
        { id: 'disguise', name: '변장하기', check: 'skill:deception', dc: 13, once: true, success: { addStates: ['disguised'] }, failure: { gauges: { alert: 1 } } },
        { id: 'distract', name: '소리로 따돌리기', check: 'skill:sleight_of_hand', dc: 12, success: { gauges: { alert: -2 }, removeStates: ['spotted'] }, failure: { gauges: { alert: 1 } } },
        { id: 'wait', name: '숨죽여 기다리기', success: { gauges: { alert: -1 } } },
      ],
      reactions: [
        { delta: { gauges: { alert: 1 } } },
        { when: { state: 'spotted' }, delta: { gauges: { alert: 1 }, text: '경비가 이쪽으로 고개를 돌린다' } },
        { when: { gauge: 'alert', gte: 7 }, chance: 0.5, delta: { addStates: ['spotted'], text: '횃불이 늘어난다' } },
      ],
      ends: [
        { id: 'reached', name: '목표 도달', when: { gauge: 'progress', gte: 8 }, outcome: 'success', rewards: { xp: 'minor' } },
        { id: 'caught', name: '발각', when: { gauge: 'alert', gte: 10 }, outcome: 'failure' },
        { id: 'retreat', name: '물러남', when: { round: 99 }, outcome: 'neutral' },
      ],
      maxRounds: 10, timeoutEnd: 'retreat',
    }),
  },
];

/** 프리셋마다 장면 그림을 채워 내보낸다 (v0.50) */
export const SCENE_PRESETS: ScenePreset[] = PRESETS.map((p) => ({ ...p, make: () => autoSceneArt(p.make()) }));
