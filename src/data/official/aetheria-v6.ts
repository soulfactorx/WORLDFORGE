/**
 * 에테리아 v6판 (설계 v6 M6): 기류 축 · 국면 · 갈래 카드.
 * 기존 세계(임무·장면·조우·결말)는 그대로 두고 그 위에 얹는다 — 카드의 갈림길이 임무의 조건(지식·장소·플래그)을 채우며 이야기를 민다.
 * 체험판(AI 없이)에서 쓰이는 첫 장의 카드에는 text·successText·failText가 있다.
 */
import type { Phase, Storylet, WorldPackage, WorldVar } from '../../engine/schema';

const D = 'drama';

/** 기류 축 — 세계의 방향 */
export const AETHERIA_AXES: WorldVar[] = [
  { id: 'path', name: '봉인의 길', initial: 0, min: -5, max: 5, visible: true, poles: ['봉인을 지킨다', '고신의 힘을 쥔다'],
    labels: [[-5, '수호자'], [-2, '봉인 쪽'], [-1, '갈림길'], [2, '힘 쪽'], [4, '그릇']] },
  { id: 'balance', name: '대륙의 저울', initial: 0, min: -5, max: 5, visible: true, poles: ['루미나 왕국', '바르가스 제국'],
    labels: [[-5, '왕국의 검'], [-2, '왕국 쪽'], [-1, '중립'], [2, '제국 쪽'], [4, '제국의 칼']] },
];

/** 국면 — 위에서부터 본다 */
export const AETHERIA_PHASES: Phase[] = [
  { id: 'phase/eclipse', name: '검은 달', tint: 'dark', music: 'dark', gmStyle: 'horror',
    from: ['phase/unrest', 'phase/rift', 'phase/war'],
    enter: { any: [{ var: 'path', gte: 3 }, { all: [{ var: 'seal', lte: 25 }, { var: D, gte: 6 }] }] },
    tone: '검은 달 — 고신의 숨결이 세상에 스민다. 그림자가 한 박자 늦게 따라오고, 사람들은 당신과 눈을 마주치지 않는다. 문장은 차갑고 낮게, 속삭임과 맥박 소리. 힘은 유혹적으로, 대가는 끔찍하게.',
    announce: '달이 검게 물들었다. 당신의 그림자가 당신보다 먼저 움직인다.',
    attitudes: { 'npc/lyra': '당신의 그림자를 보고 활을 반쯤 든다 — 아직 쏘지는 않는다', 'npc/elaine': '당신을 위해 기도하지만, 문은 열어 주지 않는다', 'npc/seres': '처음으로 당신을 동료처럼 대한다', 'npc/theo': '두려워하면서도 떠나지 않는다' },
    closed: ['loc/elf-grove'], effects: [{ reputation: 'fac/church', delta: -5 }] },
  { id: 'phase/war', name: '국경의 불길', tint: 'warm', music: 'combat',
    from: ['phase/unrest', 'phase/rift', 'phase/respite'],
    enter: { any: [{ var: 'tension', gte: 75 }, { all: [{ var: D, gte: 6 }, { any: [{ var: 'balance', gte: 3 }, { var: 'balance', lte: -3 }] }] }] },
    tone: '국경의 불길 — 회색 관문 너머로 북이 울린다. 길에는 피난민과 징발된 수레, 술집에는 전쟁 이야기뿐. 문장은 빠르고 거칠게, 쇳내와 연기. 모두가 누구 편이냐고 묻는다.',
    announce: '회색 관문에 봉화가 올랐다. 이제 길 위의 모두가 당신에게 묻는다 — 누구 편이냐고.',
    attitudes: { 'npc/isolde': '갑옷을 입고 장군들 사이에 선다 — 당신의 칼이 필요하다', 'npc/valter': '마지막 명령을 기다리며 관문을 지킨다', 'npc/brom': '신참들을 전장에 보내지 않으려 길드 문을 걸어 잠근다' } },
  { id: 'phase/rift', name: '균열', tint: 'dark', music: 'dark',
    from: ['phase/unrest', 'phase/accord', 'phase/respite'],
    enter: { any: [{ clock: 'clock/seal-crack', gte: 6 }, { var: 'seal', lte: 35 }, { var: D, gte: 7 }] },
    tone: '균열 — 봉인이 신음한다. 밤마다 북쪽 하늘이 보랏빛으로 찢어지고, 짐승과 죽은 것이 길을 잃고 내려온다. 문장은 짧고 다급하게. 낡은 맹세와 오래된 거짓말이 한꺼번에 드러난다.',
    announce: '땅이 숨을 쉬듯 흔들렸다. 북쪽 하늘에 보랏빛 금이 갔다 — 봉인이 신음하고 있다.',
    attitudes: { 'npc/morg': '천 년 만에 처음으로 대성전 문을 열어 둔다', 'npc/aldric': '침대에서 일어나려 애쓴다 — 남은 힘을 봉인에 쓰고 싶어 한다', 'npc/kael': '팔의 비늘이 쑤신다며 말수가 줄었다' } },
  { id: 'phase/accord', name: '맺어진 손', tint: 'bright', music: 'calm',
    from: ['phase/unrest', 'phase/rift', 'phase/respite'],
    enter: { all: [{ var: 'path', lte: -2 }, { var: D, lte: 4 }, { questDone: 'quest/lost-children' }] },
    tone: '맺어진 손 — 서로 등을 돌리던 이들이 하나둘 같은 쪽을 본다. 아침 햇살, 함께 먹는 빵, 오래된 원한이 풀리는 순간. 문장은 따뜻하고 넓게. 그러나 손을 잡은 만큼 잃을 것도 늘었다.',
    announce: '처음으로 사람들이 같은 쪽을 본다. 당신이 이어 붙인 손들이다.',
    attitudes: { 'npc/theo': '당신을 형제처럼 대한다', 'npc/lyra': '숲의 길을 당신에게 열어 준다', 'npc/isolde': '교단과 길드 사이에 다리를 놓자고 먼저 말을 꺼낸다' } },
  { id: 'phase/unrest', name: '술렁이는 대륙', tint: 'tense', music: 'tense',
    from: ['phase/dawn', 'phase/respite', 'phase/accord'],
    enter: { any: [{ var: D, gte: 4 }, { questDone: 'quest/lost-children' }, { questFailed: 'quest/lost-children' }] },
    tone: '술렁이는 대륙 — 소문이 사람보다 빨리 달린다. 시장의 값이 오르고, 경비는 이방인을 오래 쳐다본다. 문장은 조금 빨라지고, 사람들은 편을 고르기 시작한다.',
    announce: '소문이 당신보다 먼저 도착하기 시작했다. 사람들이 술렁인다.' },
  { id: 'phase/respite', name: '숨 고르기', tint: 'calm', music: 'calm',
    from: ['phase/unrest', 'phase/rift', 'phase/war'],
    enter: { all: [{ var: D, lte: 2 }, { questDone: 'quest/lost-children' }] },
    tone: '숨 고르기 — 큰일이 지나간 뒤의 고요. 모닥불, 다친 손을 감는 붕대, 하지 못한 말들. 문장은 느리고 가깝게. 다음 폭풍의 씨앗이 어딘가에서 자란다.',
    announce: '폭풍이 지나갔다. 오늘 밤만큼은 모닥불 곁에 앉아도 된다.' },
  { id: 'phase/dawn', name: '낯선 새벽', tint: 'calm', music: 'calm',
    enter: { all: [{ var: D, lte: 3 }, { not: { questDone: 'quest/lost-children' } }] },
    tone: '낯선 새벽 — 처음 보는 세계의 경이. 두 개의 달, 마나가 흐르는 공기의 보랏빛 잔광, 낯선 말과 낯선 음식. 문장은 호기심 어리게, 모든 것이 처음이다. 그러나 그 아래 무언가가 당신을 지켜본다.' },
];

const flag = (id: string) => ({ setFlag: id });

/** 갈래 카드 */
export const AETHERIA_STORYLETS: Storylet[] = [
  // ───────────── 1장: 낯선 새벽 (체험판 카드 — 글이 있다)
  { id: 'card/ae-two-moons', title: '두 개의 달', locationId: 'loc/star-hill', tags: ['main'],
    when: { not: { flag: 'hill_left' } },
    situation: '별무덤 언덕, 선돌 일곱 개 한가운데. 손에는 기억에 없는 은빛 펜던트, 하늘에는 달이 둘. 언덕 아래 멀리 성벽의 등불이 깜빡인다.',
    text: '차가운 밤바람이 살갗을 찌른다. 등 아래 돌바닥이 아직 따뜻하고, 선돌 일곱 개 위로 처음 보는 별자리가 흐른다. 달이 둘이다. 손에 쥔 은빛 펜던트가 맥박처럼 미약하게 떨린다. 언덕 아래, 성벽의 등불이 깜빡인다.',
    options: [
      { id: 'pendant', label: '펜던트를 달빛에 비춰 본다', stake: 'theme:path:+', check: { skill: 'arcana', dc: 'easy' },
        success: [flag('pendant_awake'), { reveal: 'claim/summoned-outsider', state: 'confirmed' }],
        successText: '달빛이 닿자 펜던트 안에서 보랏빛 실이 풀려 나와 당신의 손목을 감는다. 머릿속에 목소리 없는 앎이 스민다 — 당신은 이 세계 사람이 아니다. 누군가 당신을 불렀다. 그리고 그 실의 다른 끝은 북쪽, 아주 깊은 곳 어딘가로 이어져 있다.',
        failText: '펜던트는 차갑게 식어 아무것도 보여 주지 않는다. 대신 선돌 하나가 낮게 웅웅거리고, 그 소리에 언덕 아래 풀숲이 움직인다.' },
      { id: 'down', label: '언덕 아래 불빛을 향해 내려간다', stake: 'defuse',
        success: [flag('hill_left'), { moveTo: 'loc/vellos-gate' }],
        successText: '이슬 젖은 풀을 헤치고 한참을 내려가자 성벽이 가까워진다. 해 뜰 무렵, 자유도시 벨로스의 성문이 열리며 수레와 사람들이 쏟아져 나온다. 아무도 당신이 어디서 왔는지 묻지 않는다 — 아직은.' },
      { id: 'stones', label: '선돌에 새겨진 문양을 손끝으로 따라간다', stake: 'escalate', check: { skill: 'investigation', dc: 'medium' },
        success: [{ reveal: 'claim/summoner-mages', state: 'partial' }],
        fail: [{ startEncounter: 'enc/hill-wolves' }],
        successText: '이끼 아래 문양은 사람의 손으로 새로 그은 것이다. 같은 모양의 고리가 일곱 번, 그리고 한가운데 탑 모양의 표식. 누군가 이 소환진을 일부러 그렸다 — 마법사의 솜씨다.',
        failText: '문양에 손이 닿는 순간 선돌이 번쩍 빛난다. 그 빛에 이끌린 무언가가 어둠 속에서 낮게 으르렁거린다 — 늑대들이다.' },
    ] },
  { id: 'card/ae-gate', title: '성문 광장의 이방인', locationId: 'loc/vellos-gate', tags: ['main'],
    when: { not: { flag: 'guild_registered' } },
    situation: '벨로스 성문 광장. 짐수레와 상인과 모험가가 뒤엉킨 아침. 경비병 하나가 당신의 낯선 옷차림을 오래 쳐다보다 다가온다.',
    text: '성문 광장은 아침부터 시끄럽다. 짐수레 바퀴가 돌길을 긁고, 상인들이 서로 다른 말로 값을 부른다. 창을 든 경비병 하나가 당신의 낯선 옷차림을 위아래로 훑더니 다가온다. "어디서 왔지? 통행패는?"',
    options: [
      { id: 'truth', label: '별무덤 언덕에서 깨어났다고 솔직히 말한다', stake: 'side:fac/guild',
        success: [{ reveal: 'claim/vellos-free', state: 'confirmed' }, { var: 'vellos_order', add: 3 }],
        successText: '경비병의 표정이 굳었다가, 이내 한숨으로 풀린다. "또 그 언덕이군. 이방인이면 길드로 가. 거기서 이름을 올리면 이 도시는 누구든 받아 줘." 그가 광장 끝, 부러진 투구가 그려진 깃발을 가리킨다.' },
      { id: 'blend', label: '시장 쪽 인파에 섞여 슬쩍 빠져나간다', stake: 'escalate', check: { skill: 'stealth', dc: 'easy' },
        success: [{ moveTo: 'loc/vellos-market' }, { var: 'vellos_order', add: -2 }],
        fail: [{ var: 'vellos_order', add: -3 }],
        successText: '수레 하나가 지나가는 틈에 당신은 사람들 사이로 스며든다. 등 뒤에서 경비병이 무어라 외치지만, 시장의 소음이 그 목소리를 삼킨다.',
        failText: '세 걸음도 못 가 어깨가 붙잡힌다. "도망치는 놈은 수상하지." 경비병의 손이 당신의 짐을 뒤진다. 광장 사람들이 수군거리며 당신을 본다.' },
      { id: 'pendant', label: '펜던트를 보여 주며 무엇인지 아느냐고 묻는다', stake: 'theme:path:+',
        success: [{ var: D, add: 1 }],
        successText: '경비병이 펜던트를 보는 순간 얼굴에서 핏기가 가신다. "그걸 아무 데서나 꺼내지 마. 그 빛… 흑월단 놈들이 찾는 거랑 닮았어." 그가 서둘러 물러서며 길드 쪽을 가리킨다. 광장 건너편 그늘에서 누군가 당신을 지켜보고 있다.' },
    ] },
  { id: 'card/ae-helm', title: '부러진 투구', locationId: 'loc/vellos-guild', tags: ['main'],
    when: { not: { flag: 'guild_registered' } },
    situation: '모험가 길드 「부러진 투구」. 접수대 뒤의 늙은 드워프 지부장 브롬이 장부를 덮고, 벽에 기댄 붉은 머리 용병 카엘이 당신을 재 본다.',
    text: '길드 안은 맥주와 쇠기름 냄새로 가득하다. 접수대 뒤의 늙은 드워프가 장부를 덮으며 수염을 쓸어내린다. "이름." 벽에 기대 있던 붉은 머리 용병이 피식 웃는다. "이방인이네. 언덕 쪽 냄새가 나."',
    options: [
      { id: 'register', label: '이름을 대고 길드원으로 등록한다', stake: 'bond:npc/brom',
        success: [flag('guild_registered'), { reputation: 'fac/guild', delta: 3 }],
        successText: '브롬이 장부에 당신의 이름을 눌러 쓴다. "구리 등급. 혼자 숲에 가지 마. 그게 첫째 규칙이고, 둘째도 셋째도 같다." 그의 목소리에 이상할 만큼 단단한 걱정이 묻어 있다.' },
      { id: 'kael', label: '카엘에게 실력을 보여 주겠다며 팔씨름을 청한다', stake: 'bond:npc/kael', check: { skill: 'athletics', dc: 'medium' },
        success: [flag('guild_registered'), { relationship: 'npc/kael', delta: { respect: 6, affinity: 3 } }],
        fail: [{ relationship: 'npc/kael', delta: { affinity: 2 } }],
        successText: '탁자가 삐걱인다. 카엘의 팔이 생각보다 뜨겁다 — 사람의 체온이 아니다. 마지막 순간 그가 웃으며 힘을 뺀다. "합격. 영감, 이 녀석 등록해 줘." 소매 끝으로 붉은 비늘 하나가 언뜻 보였다가 사라진다.',
        failText: '카엘의 팔은 쇠기둥 같다. 당신의 손등이 탁자에 닿자 그가 껄껄 웃는다. "나쁘지 않아. 사람치고는." 브롬이 혀를 차며 그래도 장부를 펼친다.' },
      { id: 'big', label: '구리 등급 일은 싫다며 큰 보수의 일을 달라고 버틴다', stake: 'escalate',
        success: [flag('guild_registered'), { reputation: 'fac/guild', delta: -2 }, { var: D, add: 1 }],
        successText: '브롬의 눈썹이 꿈틀한다. "큰 일? 좋아." 그가 서랍에서 구겨진 의뢰서를 꺼낸다 — 에델 마을, 사라진 아이 셋. "아무도 안 받는 일이다. 촌장이 뭔가 숨기고 있거든."' },
    ] },
  { id: 'card/ae-market', title: '대시장의 정보상', locationId: 'loc/vellos-market', tags: ['side'],
    situation: '벨로스 대시장. 향신료 좌판 그늘에서 여우 귀의 정보상 미나가 손가락으로 동전을 굴린다. "이방인. 알고 싶은 게 있으면 값을 내."',
    text: '향신료 냄새와 호객 소리. 좌판 그늘에서 여우 귀를 가진 소녀가 손가락으로 동전을 굴리며 당신을 부른다. "이방인. 이 도시에서 제일 비싼 게 뭔지 알아? 정보야. 알고 싶은 게 있으면 값을 내."',
    options: [
      { id: 'pay', label: '동전을 내고 요즘 도는 소문을 산다', stake: 'bond:npc/mina',
        success: [{ money: -10 }, { reveal: 'claim/children-monster', state: 'rumor' }, { reveal: 'claim/empire-invades', state: 'rumor' }],
        successText: '미나가 동전을 이로 깨물어 보고는 목소리를 낮춘다. "에델 마을에서 아이 셋이 사라졌어. 마수가 물어 갔다나. 그리고 북쪽 관문엔 제국 깃발이 늘었고." 그녀의 꼬리가 한 번 크게 흔들린다. "다음에도 와. 단골은 싸게 해 줄게."' },
      { id: 'haggle', label: '값을 깎자며 말로 구슬린다', stake: 'defuse', check: { skill: 'persuasion', dc: 'medium' },
        success: [{ reveal: 'claim/children-monster', state: 'rumor' }],
        successText: '미나가 깔깔 웃는다. "말솜씨 좋네. 이번 한 번만." 그녀가 에델 마을의 실종 이야기를 반값에 넘긴다.',
        failText: '"공짜는 없어." 미나가 고개를 돌린다. 하지만 당신이 돌아서려는 순간, 그녀가 작게 덧붙인다. "…뒷골목 「까마귀」는 조심해."' },
      { id: 'raven', label: '그녀가 자꾸 뒷골목 쪽을 보는 이유를 묻는다', stake: 'escalate', check: { skill: 'insight', dc: 'hard' },
        success: [{ relationship: 'npc/mina', delta: { trust: 4 } }, { reveal: 'claim/raven-cult', state: 'rumor' }],
        successText: '미나의 귀가 납작해진다. 한참 만에 그녀가 속삭인다. "까마귀. 뒷골목의 라벤. 우리 오빠가 그놈 일을 캐다 사라졌어." 처음으로 그녀의 목소리에 값이 붙어 있지 않다.',
        failText: '"남의 장사 참견하지 마." 미나의 웃음이 싹 가신다. 좌판 그늘이 갑자기 차갑다.' },
    ] },
  { id: 'card/ae-road', title: '은빛 교역로의 갈림길', tags: ['side'], repeat: { after: 4 },
    when: { any: [{ at: 'loc/vellos-gate' }, { at: 'loc/trade-road' }] },
    situation: '은빛 교역로. 남쪽은 루미나 왕도, 서쪽은 아르켄 마도도시, 북쪽은 회색 관문, 동쪽은 에델 마을. 이정표 아래 여행자들이 저마다의 소식을 나눈다.',
    text: '은빛 교역로의 이정표 아래, 마차꾼과 순례자와 용병이 섞여 쉰다. 누군가는 에델 마을의 실종을, 누군가는 북쪽 관문의 제국 깃발을, 누군가는 아르켄 탑의 늙은 의장이 쓰러졌다는 소문을 이야기한다. 길은 넷이다.',
    options: [
      { id: 'edel', label: '동쪽, 아이들이 사라졌다는 에델 마을로', stake: 'theme:path:-',
        success: [{ moveTo: 'loc/edel-village' }],
        successText: '반나절을 걸어 에델 마을에 닿는다. 지난겨울 불탄 집들이 아직 검게 남아 있고, 마을 사람들은 당신을 반기면서도 눈을 피한다.' },
      { id: 'arken', label: '서쪽, 마법사들의 도시 아르켄으로', stake: 'side:fac/mages',
        success: [{ moveTo: 'loc/arken' }, { reveal: 'claim/aldric-ill', state: 'rumor' }],
        successText: '하루를 걸어 아르켄에 닿는다. 하늘을 찌르는 상아탑 아래, 마법사들이 의장의 병을 두고 수군거린다.' },
      { id: 'border', label: '북쪽, 제국 깃발이 늘었다는 회색 관문으로', stake: 'escalate',
        success: [{ moveTo: 'loc/border-fort' }, { var: 'tension', add: 5 }],
        successText: '이틀 길 끝에 회색 관문이 보인다. 성벽 위에는 루미나의 은빛 깃발, 그 너머 들판에는 바르가스의 검은 깃발이 빽빽하다. 공기에서 쇳내가 난다.' },
      { id: 'capital', label: '남쪽, 루미나 왕도의 성광 대성당으로', stake: 'side:fac/church',
        success: [{ moveTo: 'loc/lumina-cathedral' }],
        successText: '사흘 길을 걸어 왕도의 하얀 성벽 안으로 들어선다. 성광 대성당의 종소리가 도시 전체를 덮는다.' },
    ] },
  // ───────────── 에델 마을과 사라진 아이들
  { id: 'card/ae-edel', title: '불탄 마을의 촌장', locationId: 'loc/edel-village', tags: ['main'],
    when: { not: { knows: 'claim/no-blood' } },
    situation: '에델 마을. 불탄 집들 사이에서 촌장 고드릭이 당신을 붙잡는다. 아이 셋이 마수에게 끌려갔다고, 제발 찾아 달라고. 곁의 견습 사제 테오가 무언가 말하려다 입을 다문다.',
    text: '불탄 지붕들 사이로 촌장 고드릭이 비틀거리며 다가와 당신의 손을 붙잡는다. "아이 셋이… 마수가 물어 갔소. 제발." 그의 손이 지나치게 떨린다. 곁에 선 젊은 사제 테오가 무언가 말하려다, 촌장의 눈길에 입을 다문다.',
    options: [
      { id: 'room', label: '테오와 함께 아이들이 사라진 방을 살핀다', stake: 'bond:npc/theo', check: { skill: 'investigation', dc: 'easy' },
        success: [{ reveal: 'claim/no-blood', state: 'confirmed' }, { relationship: 'npc/theo', delta: { trust: 5 } }],
        successText: '테오가 문을 열며 속삭인다. "이상하지 않아요?" 방에는 핏자국도, 마수의 발톱 자국도 없다. 빗장은 안에서 열려 있다. 아이들은 끌려간 게 아니라 — 스스로 걸어 나갔다.',
        failText: '방은 어수선하고, 무엇이 이상한지 알 수 없다. 테오가 무언가 짚으려는 순간 촌장이 문간에 나타난다. "충분히 보셨으면 숲으로 가 주시오."' },
      { id: 'forest', label: '촌장의 말을 믿고 곧장 숲으로 간다', stake: 'side:fac/lumina',
        success: [{ moveTo: 'loc/beast-forest' }, { relationship: 'npc/godric', delta: { trust: 4 } }],
        successText: '촌장이 몇 번이고 고개를 숙인다. 마을 끝에서 마수의 숲이 시작된다. 나무들이 이상할 만큼 조용하다.' },
      { id: 'press', label: '촌장의 떨리는 손을 붙잡고 무엇을 숨기느냐고 묻는다', stake: 'betray:npc/godric', check: { skill: 'intimidation', dc: 'hard' },
        success: [{ reveal: 'claim/chief-pact', state: 'rumor' }, { var: D, add: 1 }],
        successText: '고드릭의 얼굴이 무너진다. "마을을… 마을을 지키려고…" 그는 끝내 말을 맺지 못하지만, 검은 달이 그려진 사제와 "약조"라는 말이 새어 나온다. 테오가 창백해진다.',
        failText: '"무례하군!" 고드릭이 손을 뿌리친다. 마을 사람들이 몰려들어 당신을 노려본다. 이 마을에서 당신은 이제 반갑지 않은 손님이다.' },
    ] },
  { id: 'card/ae-tracks', title: '숲속의 작은 발자국', locationId: 'loc/beast-forest', tags: ['main'],
    when: { all: [{ not: { knows: 'claim/small-footprints' } }, { not: { questDone: 'quest/lost-children' } }] },
    situation: '마수의 숲 어귀. 짐승의 울음이 멎은 이상한 고요 속에, 이끼 위로 어른 하나와 아이 셋의 발자국이 숲 깊은 쪽으로 이어진다.',
    text: '마수의 숲은 이상하게 조용하다. 새도, 벌레도 울지 않는다. 이끼 위에 발자국이 있다 — 어른 하나, 그리고 작은 것 셋. 발자국은 숲 깊은 곳, 오래된 돌무더기 쪽으로 곧게 이어진다.',
    options: [
      { id: 'follow', label: '발자국을 따라 숲 깊이 들어간다', stake: 'escalate', check: { skill: 'survival', dc: 'medium' },
        success: [{ reveal: 'claim/small-footprints', state: 'confirmed' }, { moveTo: 'loc/forest-sanctum' }],
        fail: [{ reveal: 'claim/small-footprints', state: 'partial' }, { startEncounter: 'enc/forest-spider' }],
        successText: '발자국은 길을 잃지 않는다 — 누군가 아이들을 이끌었다. 한 시간 뒤, 덩굴에 덮인 석실의 입구가 나타난다. 안에서 낮은 노랫소리가 들린다.',
        failText: '발자국을 쫓다 길을 잃는다. 나뭇가지 사이로 은빛 실이 번들거린다 — 거미줄이다. 무언가 큰 것이 위에서 내려온다.' },
      { id: 'lyra', label: '숲의 주인인 엘프들에게 도움을 청하러 간다', stake: 'bond:npc/lyra',
        success: [{ moveTo: 'loc/elf-grove' }, { reveal: 'claim/elves-saw-light', state: 'confirmed' }],
        successText: '은엽 숲 거처의 순찰대 궁수 리라가 활을 내리며 당신을 본다. "언덕에서 보랏빛 기둥이 솟던 밤… 너였구나." 그녀가 숲의 길을 알려 주겠다고 한다.' },
      { id: 'back', label: '촌장에게 돌아가 발자국 이야기를 들이민다', stake: 'betray:npc/godric',
        success: [{ reveal: 'claim/small-footprints', state: 'partial' }, { moveTo: 'loc/edel-village' }, { relationship: 'npc/godric', delta: { fear: 6 } }],
        successText: '발자국 이야기에 고드릭의 얼굴이 잿빛이 된다. "그, 그건…" 그가 대답하기 전에 테오가 당신 곁에 선다. "촌장님. 이제 말씀하셔야 해요."' },
    ] },
  { id: 'card/ae-sanctum', title: '노래하는 석실', locationId: 'loc/forest-sanctum', tags: ['main'],
    when: { not: { cleared: 'enc/sanctum-cultists' } },
    situation: '숲속 봉인 석실. 촛불 아래 검은 달 문양의 로브를 입은 이들이 둥글게 서 있고, 한가운데 아이 셋이 눈을 감은 채 봉인의 문양에 귀를 대고 있다.',
    text: '석실 안쪽에서 촛불이 흔들린다. 검은 달 문양의 로브를 입은 이들이 둥글게 서서 낮게 노래하고, 한가운데 아이 셋이 눈을 감은 채 바닥의 문양에 귀를 대고 있다. 아이들은 살아 있다. 그리고 무언가를 듣고 있다.',
    options: [
      { id: 'charge', label: '정면으로 뛰어들어 아이들을 구한다', stake: 'escalate',
        success: [{ startEncounter: 'enc/sanctum-cultists' }],
        successText: '당신이 뛰어들자 노래가 끊긴다. 로브들이 일제히 돌아선다 — 싸움이다.' },
      { id: 'listen', label: '숨어서 그들의 노래와 문양을 살핀다', stake: 'theme:path:-', check: { skill: 'stealth', dc: 'medium' },
        success: [{ reveal: 'claim/children-alive', state: 'confirmed' }, { reveal: 'claim/blackmoon-letter', state: 'confirmed' }, { var: 'path', add: -1 }],
        fail: [{ startEncounter: 'enc/sanctum-cultists' }],
        successText: '노래는 봉인의 맥박을 세는 소리다. 아이들은 "귀"로 쓰이고 있다 — 봉인이 약해지는 소리를 듣는 귀. 제단 위 편지에 적힌 구절이 눈에 들어온다. "이방인의 혼으로 문을 연다." 당신의 펜던트가 뜨거워진다.',
        failText: '발밑의 돌이 구른다. 노래가 뚝 끊기고, 촛불이 일제히 당신 쪽으로 기운다. "이방인이다!"' },
      { id: 'pendant', label: '펜던트를 높이 들어 그들의 노래에 섞인다', stake: 'theme:path:+',
        success: [{ var: 'path', add: 1 }, { reputation: 'fac/blackmoon', delta: 5 }, { var: D, add: 1 }],
        successText: '펜던트가 보랏빛으로 타오르자 로브들이 노래를 멈추고 무릎을 꿇는다. "그분의 그릇…" 누구도 당신을 막지 않는다. 아이들이 눈을 뜨고 당신을 본다 — 겁에 질린 눈으로.' },
    ] },
  // ───────────── 벨로스 뒷골목
  { id: 'card/ae-alley-shadow', title: '등불 없는 골목의 손님', tags: ['side'],
    when: { all: [{ any: [{ at: 'loc/vellos-alley' }, { at: 'loc/vellos-market' }] }, { any: [{ knows: 'claim/raven-cult' }, { flag: 'pendant_awake' }] }] },
    situation: '등불 없는 골목. 까마귀 깃털을 꽂은 사내가 벽에 기대 당신을 기다리고 있었던 것처럼 웃는다. "이방인. 네 펜던트에 관심 있는 분이 계셔."',
    options: [
      { id: 'deal', label: '그분이 누구인지 듣겠다며 따라간다', stake: 'theme:path:+', success: [{ reputation: 'fac/blackmoon', delta: 5 }, { var: 'path', add: 1 }] },
      { id: 'mina', label: '미나를 위해 그의 이름을 캐낸다', stake: 'bond:npc/mina', check: { skill: 'deception', dc: 'medium' }, success: [{ reveal: 'claim/raven-cult', state: 'confirmed' }, { relationship: 'npc/mina', delta: { trust: 6 } }] },
      { id: 'guard', label: '경비대를 불러 골목을 덮친다', stake: 'side:fac/guild', success: [{ var: 'vellos_order', add: 8 }, { startEncounter: 'enc/alley-raven' }] },
    ] },
  { id: 'card/ae-mina-brother', title: '미나의 오빠', tags: ['side'],
    when: { all: [{ relationship: 'npc/mina', axis: 'trust', gte: 10 }, { not: { cleared: 'enc/alley-raven' } }] },
    situation: '미나가 낡은 단검 한 자루를 내민다. 오빠의 것이다. "라벤을 치러 갈 거면 나도 데려가. 아니면… 이걸로 그놈 목에 내가 직접."',
    options: [
      { id: 'together', label: '함께 가자고 한다 — 복수는 둘이 지는 것이다', stake: 'bond:npc/mina', success: [{ relationship: 'npc/mina', delta: { intimacy: 6, trust: 4 } }] },
      { id: 'stop', label: '복수에 삼켜지지 말라고 단검을 거둬 들인다', stake: 'defuse', check: { skill: 'persuasion', dc: 'medium' }, success: [{ relationship: 'npc/mina', delta: { respect: 6 } }], fail: [{ relationship: 'npc/mina', delta: { trust: -4 } }] },
      { id: 'use', label: '그녀의 복수심을 미끼로 라벤을 끌어낸다', stake: 'betray:npc/mina', success: [{ var: D, add: 2 }] },
    ] },
  // ───────────── 아르켄
  { id: 'card/ae-ivory', title: '상아탑의 두 얼굴', tags: ['main'],
    when: { any: [{ at: 'loc/arken' }, { at: 'loc/arken-tower' }] },
    situation: '아르켄 상아탑. 병상의 의장 알드릭은 눈만 살아 있고, 부의장 세레스 바일이 다정한 미소로 당신을 맞는다. "별무덤 언덕의 손님이군요. 기다렸습니다."',
    options: [
      { id: 'seres', label: '세레스의 환대를 받아들이고 그녀의 연구실로 간다', stake: 'side:fac/mages', success: [{ relationship: 'npc/seres', delta: { trust: 6 } }, { var: 'path', add: 1 }] },
      { id: 'aldric', label: '세레스 몰래 알드릭의 병상을 찾는다', stake: 'bond:npc/aldric', check: { skill: 'stealth', dc: 'medium' }, success: [{ reveal: 'claim/aldric-curse', state: 'partial' }], fail: [{ relationship: 'npc/seres', delta: { trust: -6 } }, { var: D, add: 1 }] },
      { id: 'sigil', label: '소환진의 문양을 그려 보이며 누구의 것이냐고 묻는다', stake: 'escalate', check: { skill: 'arcana', dc: 'medium' }, success: [{ reveal: 'claim/summoner-mages', state: 'confirmed' }, { var: D, add: 1 }] },
    ] },
  { id: 'card/ae-charm', title: '베갯속의 부적', tags: ['side'],
    when: { all: [{ knows: 'claim/aldric-curse', min: 'partial' }, { not: { flag: 'curse_broken' } }] },
    situation: '알드릭의 병실. 베갯속에서 검은 달이 새겨진 부적이 미약하게 맥박친다. 문밖에 세레스의 발소리가 가까워진다.',
    options: [
      { id: 'break', label: '부적을 깨뜨린다 — 지금 당장', stake: 'side:fac/mages', check: { skill: 'arcana', dc: 'hard' }, success: [flag('curse_broken'), { var: 'seal', add: 5 }, { relationship: 'npc/aldric', delta: { trust: 10 } }], fail: [{ var: D, add: 2 }] },
      { id: 'keep', label: '부적을 몰래 챙긴다 — 증거이자, 힘이다', stake: 'theme:path:+', success: [{ giveItem: 'item/blackmoon-charm' }, { var: 'path', add: 1 }] },
      { id: 'expose', label: '세레스가 들어오는 순간 부적을 들이민다', stake: 'escalate', success: [{ relationship: 'npc/seres', delta: { grudge: 10, trust: -10 } }, { var: D, add: 2 }] },
    ] },
  // ───────────── 국경
  { id: 'card/ae-border', title: '두 깃발 사이', tags: ['main'], locationId: 'loc/border-fort',
    situation: '회색 관문. 성벽 위에는 왕녀 이졸데의 은빛 기사들, 들판에는 발터 그림의 검은 대열. 양쪽 모두 당신을 사자로 쓰고 싶어 한다.',
    options: [
      { id: 'isolde', label: '이졸데 곁에 서서 왕국의 사자가 된다', stake: 'theme:balance:-', success: [{ reputation: 'fac/lumina', delta: 5 }, { var: 'tension', add: 5 }] },
      { id: 'valter', label: '발터의 막사로 건너가 그의 말을 듣는다', stake: 'theme:balance:+', check: { skill: 'persuasion', dc: 'medium' }, success: [{ reveal: 'claim/empire-wants-temple', state: 'partial' }, { reputation: 'fac/vargas', delta: 5 }], fail: [{ var: 'tension', add: 8 }] },
      { id: 'parley', label: '두 사람을 한 천막 아래 앉힌다', stake: 'defuse', check: { skill: 'persuasion', dc: 'hard' }, success: [{ var: 'tension', add: -10 }, { var: D, add: -1 }], fail: [{ var: 'tension', add: 5 }] },
    ] },
  { id: 'card/ae-envoy', title: '아르켄에서 온 사절', tags: ['side', 'twist'],
    when: { all: [{ at: 'loc/border-fort' }, { knows: 'claim/empire-wants-temple', min: 'partial' }] },
    situation: '밤의 관문. 아르켄 협회의 문장을 단 사절이 몰래 제국 막사로 들어간다. 망토 아래로 보이는 손가락에 검은 달의 반지.',
    options: [
      { id: 'follow', label: '사절을 미행한다', stake: 'escalate', check: { skill: 'stealth', dc: 'hard' }, success: [{ reveal: 'claim/seres-empire-deal', state: 'partial' }, { var: D, add: 2 }], fail: [{ startEncounter: 'enc/border-skirmish' }] },
      { id: 'tell', label: '이졸데에게 알린다', stake: 'side:fac/lumina', success: [{ var: 'tension', add: 10 }, { var: 'balance', add: -1 }] },
      { id: 'sell', label: '이 사실을 발터에게 팔아 넘긴다', stake: 'side:fac/vargas', success: [{ relationship: 'npc/valter', delta: { trust: 8 } }, { var: 'balance', add: 1 }] },
    ] },
  // ───────────── 대성전 · 카엘
  { id: 'card/ae-mural', title: '용의 벽화', locationId: 'loc/grand-temple', tags: ['main'],
    situation: '잊힌 신들의 대성전. 무너진 천장 아래 거대한 벽화 — 일곱 신이 스스로를 쐐기로 박아 넣는 장면, 그리고 그 곁에 무릎 꿇은 붉은 용. 수문장 모르그가 해골 같은 얼굴로 당신을 본다.',
    options: [
      { id: 'morg', label: '모르그에게 천 년 전의 진실을 묻는다', stake: 'theme:path:-', check: { skill: 'religion', dc: 'medium' }, success: [{ reveal: 'claim/hidden-history', state: 'partial' }] },
      { id: 'kael', label: '카엘의 팔을 붙잡고 벽화의 용을 가리킨다', stake: 'bond:npc/kael', success: [{ relationship: 'npc/kael', delta: { trust: 10, intimacy: 4 } }] },
      { id: 'altar', label: '제단에 펜던트를 올려 본다', stake: 'theme:path:+', success: [{ var: 'path', add: 2 }, { var: 'seal', add: -10 }, { var: D, add: 2 }] },
    ] },
  // ───────────── 국면 카드: 균열
  { id: 'card/ae-rift-dead', title: '돌아온 죽은 자들', phases: ['phase/rift'], tags: ['random'], repeat: { after: 6 },
    situation: '보랏빛 하늘 아래, 오래전에 묻힌 이들이 길 위를 걷는다. 그중 하나가 당신의 얼굴을 보고 멈춘다 — 마치 아는 사람인 것처럼.',
    options: [
      { id: 'fight', label: '검을 뽑는다', stake: 'escalate', check: { skill: 'athletics', dc: 'medium' }, success: [{ var: D, add: 1 }] },
      { id: 'lay', label: '성광의 기도로 잠재운다', stake: 'side:fac/church', check: { skill: 'religion', dc: 'medium' }, success: [{ var: 'seal', add: 3 }, { var: D, add: -1 }] },
      { id: 'ask', label: '그에게 무엇을 아느냐고 묻는다', stake: 'theme:path:+', success: [{ reveal: 'claim/seal-weakening', state: 'confirmed' }, { var: 'path', add: 1 }] },
    ] },
  { id: 'card/ae-rift-refugees', title: '피난민의 행렬', phases: ['phase/rift', 'phase/war'], tags: ['side'], repeat: { after: 8 },
    situation: '교역로를 가득 메운 피난민. 아이를 업은 여인이 당신의 소매를 붙잡는다. 뒤에서 무언가가 행렬을 쫓아오고 있다.',
    options: [
      { id: 'guard', label: '행렬의 맨 뒤에 서서 쫓아오는 것을 막는다', stake: 'escalate', success: [{ startEncounter: 'enc/road-goblins' }, { reputation: 'fac/lumina', delta: 4 }] },
      { id: 'lead', label: '행렬을 벨로스로 이끈다', stake: 'side:fac/guild', success: [{ var: 'vellos_order', add: -4 }, { reputation: 'fac/guild', delta: 4 }] },
      { id: 'pass', label: '갈 길이 바쁘다 — 지나친다', stake: 'defuse', success: [{ trait: 'good', add: -4 }] },
    ] },
  // ───────────── 국면 카드: 검은 달
  { id: 'card/ae-eclipse-whisper', title: '그릇에게 속삭이는 것', phases: ['phase/eclipse'], tags: ['main'],
    situation: '꿈과 생시의 경계에서 목소리가 들린다. 천 년 동안 갇힌 것의 목소리. "네가 문이다. 열기만 하면 된다. 아무도 다시는 너를 부르지 못하게."',
    options: [
      { id: 'yield', label: '목소리에 귀를 연다', stake: 'theme:path:+', success: [{ var: 'path', add: 2 }, { var: 'seal', add: -10 }] },
      { id: 'refuse', label: '펜던트를 움켜쥐고 거부한다', stake: 'theme:path:-', check: { skill: 'insight', dc: 'hard' }, success: [{ var: 'path', add: -2 }], fail: [{ var: 'path', add: 1 }, { var: D, add: 1 }] },
      { id: 'tell', label: '곁의 동료에게 이 목소리를 털어놓는다', stake: 'defuse', success: [{ var: D, add: -2 }] },
    ] },
  { id: 'card/ae-eclipse-hunt', title: '교단의 사냥', phases: ['phase/eclipse'], tags: ['twist'],
    situation: '성광 교단의 기사들이 당신의 이름을 부르며 거리를 뒤진다. 엘레인의 봉인된 칙령 — "그릇을 제단으로."',
    options: [
      { id: 'flee', label: '흑월단의 은신처로 몸을 숨긴다', stake: 'side:fac/blackmoon', success: [{ reputation: 'fac/blackmoon', delta: 8 }, { var: 'path', add: 1 }] },
      { id: 'surrender', label: '기사들 앞에 스스로 걸어 나간다', stake: 'side:fac/church', success: [{ var: 'path', add: -2 }, { var: D, add: 1 }] },
      { id: 'stand', label: '길 한가운데 서서 칼을 뽑는다', stake: 'escalate', success: [{ startEncounter: 'enc/border-skirmish' }, { reputation: 'fac/church', delta: -10 }] },
    ] },
  // ───────────── 국면 카드: 맺어진 손
  { id: 'card/ae-accord-feast', title: '함께 먹는 빵', phases: ['phase/accord'], tags: ['side'],
    situation: '에델 마을의 광장, 돌아온 아이들을 위한 잔치. 테오와 리라와 브롬이 한 탁자에 앉았다. 누군가 당신에게 잔을 건넨다.',
    options: [
      { id: 'toast', label: '모두를 위해 잔을 든다', stake: 'defuse', success: [{ var: D, add: -1 }, { relationship: 'npc/theo', delta: { affinity: 5 } }] },
      { id: 'oath', label: '봉인을 함께 지키자고 맹세를 청한다', stake: 'theme:path:-', check: { skill: 'persuasion', dc: 'medium' }, success: [{ var: 'path', add: -1 }, { var: 'seal', add: 5 }] },
      { id: 'kael', label: '구석에 앉은 카엘 곁으로 간다', stake: 'bond:npc/kael', success: [{ relationship: 'npc/kael', delta: { trust: 6, intimacy: 4 } }] },
    ] },
  { id: 'card/ae-accord-bridge', title: '왕녀와 대사제', phases: ['phase/accord'], tags: ['main'],
    situation: '루미나 왕도. 이졸데가 엘레인에게 금서고를 열라고 요구한다. 엘레인은 당신을 본다 — 당신이 무엇을 원하는지 묻는 눈으로.',
    options: [
      { id: 'open', label: '진실을 드러내자고 이졸데 편에 선다', stake: 'side:fac/lumina', check: { skill: 'persuasion', dc: 'medium' }, success: [{ reveal: 'claim/hidden-history', state: 'confirmed' }, { reputation: 'fac/church', delta: -5 }] },
      { id: 'protect', label: '교단의 비밀을 지켜 주겠다고 엘레인에게 약속한다', stake: 'side:fac/church', success: [{ reputation: 'fac/church', delta: 8 }, { relationship: 'npc/elaine', delta: { trust: 8 } }] },
    ] },
  // ───────────── 국면 카드: 국경의 불길
  { id: 'card/ae-war-levy', title: '징발', phases: ['phase/war'], tags: ['random'], repeat: { after: 6 },
    situation: '왕국의 징발관이 마을의 마지막 말과 곡식을 끌고 가려 한다. 늙은 농부가 당신을 본다.',
    options: [
      { id: 'stop', label: '징발관을 막아선다', stake: 'escalate', check: { skill: 'intimidation', dc: 'medium' }, success: [{ reputation: 'fac/lumina', delta: -5 }, { trait: 'good', add: 4 }] },
      { id: 'help', label: '징발을 돕는다 — 전쟁은 이겨야 한다', stake: 'theme:balance:-', success: [{ reputation: 'fac/lumina', delta: 5 }, { trait: 'law', add: 4 }] },
      { id: 'pay', label: '내 돈으로 말 값을 치러 준다', stake: 'defuse', success: [{ money: -20 }, { trait: 'good', add: 5 }] },
    ] },
  { id: 'card/ae-war-deserter', title: '제국의 탈영병', phases: ['phase/war'], tags: ['side'],
    situation: '숲가에서 제국 병사 하나가 무기를 버리고 손을 든다. "발터 사령관은 이 전쟁을 원하지 않았어. 아르켄의 여자가…"',
    options: [
      { id: 'listen', label: '그의 이야기를 끝까지 듣는다', stake: 'theme:balance:+', success: [{ reveal: 'claim/seres-empire-deal', state: 'rumor' }] },
      { id: 'hand', label: '왕국군에 넘긴다', stake: 'side:fac/lumina', success: [{ reputation: 'fac/lumina', delta: 5 }, { trait: 'law', add: 3 }] },
      { id: 'free', label: '몰래 국경 너머로 보내 준다', stake: 'defuse', check: { skill: 'stealth', dc: 'medium' }, success: [{ reputation: 'fac/vargas', delta: 5 }, { trait: 'good', add: 3 }] },
    ] },
  // ───────────── 국면 카드: 숨 고르기
  { id: 'card/ae-respite-fire', title: '모닥불 곁에서', phases: ['phase/respite'], tags: ['side'], repeat: { after: 5 },
    situation: '큰일이 지나간 밤. 동료들이 모닥불 곁에 앉아 각자의 상처를 감는다. 누군가 당신이 원래 살던 세계에 대해 묻는다.',
    options: [
      { id: 'home', label: '원래 세계 이야기를 들려준다 — 돌아가고 싶은지도', stake: 'defuse', success: [{ var: D, add: -1 }] },
      { id: 'here', label: '이제는 여기가 내 자리라고 말한다', stake: 'theme:path:-', success: [{ var: 'path', add: -1 }] },
      { id: 'secret', label: '펜던트가 속삭이는 것을 털어놓는다', stake: 'escalate', success: [{ var: D, add: 1 }, { var: 'path', add: 1 }] },
    ] },
  // ───────────── 돌발 (어느 국면이든)
  { id: 'card/ae-stranger', title: '같은 언덕에서 온 사람', tags: ['twist'],
    when: { all: [{ questDone: 'quest/lost-children' }, { not: { at: 'loc/star-hill' } }] },
    situation: '여관 구석, 당신과 똑같은 펜던트를 목에 건 노인이 당신을 본다. "나도 그 언덕에서 깨어났지. 사십 년 전에."',
    options: [
      { id: 'ask', label: '어떻게 살아남았는지 묻는다', stake: 'theme:path:-', success: [{ reveal: 'claim/way-home', state: 'rumor' }] },
      { id: 'warn', label: '그가 누구 편인지 먼저 떠본다', stake: 'escalate', check: { skill: 'insight', dc: 'medium' }, success: [{ var: D, add: 1 }] },
      { id: 'take', label: '그의 펜던트를 빼앗아 두 개를 맞춰 본다', stake: 'theme:path:+', success: [{ var: 'path', add: 2 }, { var: 'seal', add: -5 }] },
    ] },
  // ───────────── 중반: 이상 현상 · 감춰진 역사 · 운명
  { id: 'card/ae-omen-sky', title: '보랏빛 하늘', tags: ['main'], when: { questStage: 'quest/omens', is: 0 },
    situation: '밤마다 북쪽 하늘이 보랏빛으로 물든다. 벨로스 사람들이 창을 닫고, 아르켄의 탑 꼭대기에서는 관측 마법사들이 밤을 지샌다.',
    options: [
      { id: 'tower', label: '아르켄 관측탑에 올라 하늘을 직접 본다', stake: 'side:fac/mages', check: { skill: 'arcana', dc: 'medium' }, success: [{ reveal: 'claim/seal-weakening', state: 'confirmed' }] },
      { id: 'church', label: '대성당의 사제들에게 무엇을 숨기느냐고 묻는다', stake: 'side:fac/church', check: { skill: 'persuasion', dc: 'medium' }, success: [{ reveal: 'claim/seal-weakening', state: 'partial' }, { reputation: 'fac/church', delta: -2 }] },
      { id: 'pendant', label: '펜던트를 하늘에 겨눠 실이 가리키는 곳을 본다', stake: 'theme:path:+', success: [{ reveal: 'claim/seal-weakening', state: 'partial' }, { var: 'path', add: 1 }] },
    ] },
  { id: 'card/ae-summoner', title: '나를 부른 손', tags: ['main', 'twist'], when: { questStage: 'quest/omens', is: 1 },
    situation: '소환진의 문양, 아르켄의 봉랍, 흑월단의 편지. 모든 실이 한 사람에게 모인다. 상아탑의 다정한 부의장.',
    options: [
      { id: 'confront', label: '세레스에게 정면으로 묻는다', stake: 'escalate', check: { skill: 'insight', dc: 'hard' }, success: [{ reveal: 'claim/summoner-seres', state: 'confirmed' }, { relationship: 'npc/seres', delta: { grudge: 6 } }], fail: [{ reveal: 'claim/summoner-seres', state: 'rumor' }, { var: 'drama', add: 2 }] },
      { id: 'aldric', label: '알드릭의 마지막 기억을 빌린다', stake: 'bond:npc/aldric', check: { skill: 'arcana', dc: 'medium' }, success: [{ reveal: 'claim/summoner-seres', state: 'confirmed' }] },
      { id: 'listen', label: '세레스가 하려는 일을 먼저 듣는다', stake: 'theme:path:+', success: [{ reveal: 'claim/summoner-seres', state: 'partial' }, { var: 'path', add: 1 }, { relationship: 'npc/seres', delta: { trust: 6 } }] },
    ] },
  { id: 'card/ae-archive', title: '금서고의 문', tags: ['main'], when: { questStage: 'quest/hidden-history', is: 1 },
    situation: '대성전 지하, 엘레인만 열 수 있는 금서고. 문 앞의 엘레인이 열쇠를 쥔 손을 떨고 있다. "읽으면 다시는 기도할 수 없게 될지도 몰라요."',
    options: [
      { id: 'read', label: '그래도 읽겠다고 한다', stake: 'expose:claim/hidden-history', check: { skill: 'history', dc: 'medium' }, success: [{ reveal: 'claim/hidden-history', state: 'confirmed' }, { reputation: 'fac/church', delta: -5 }] },
      { id: 'together', label: '엘레인과 함께 읽자고 손을 내민다', stake: 'bond:npc/elaine', success: [{ reveal: 'claim/hidden-history', state: 'partial' }, { relationship: 'npc/elaine', delta: { trust: 8, intimacy: 3 } }] },
      { id: 'morg', label: '문을 두고 모르그에게 직접 듣는다', stake: 'theme:path:-', check: { skill: 'religion', dc: 'medium' }, success: [{ reveal: 'claim/hidden-history', state: 'partial' }, { reveal: 'claim/seal-reweave', state: 'rumor' }] },
    ] },
  { id: 'card/ae-reweave', title: '누구도 죽지 않는 길', tags: ['main'], when: { questStage: 'quest/hidden-history', is: 2 },
    situation: '모르그의 해골 같은 손가락이 벽화의 한 구석을 가리킨다. 용과 이방인이 손을 맞잡은 그림. "피와 혼이 함께 맹세하면 — 누구도 바치지 않고."',
    options: [
      { id: 'believe', label: '그 길을 믿는다', stake: 'theme:path:-', success: [{ reveal: 'claim/seal-reweave', state: 'confirmed' }, { var: 'path', add: -1 }] },
      { id: 'doubt', label: '교단의 교리(희생)가 더 확실하다고 본다', stake: 'side:fac/church', success: [{ reveal: 'claim/seal-needs-sacrifice', state: 'confirmed' }, { reveal: 'claim/seal-reweave', state: 'rumor' }] },
      { id: 'kael', label: '카엘에게 이 그림을 보여 준다', stake: 'bond:npc/kael', success: [{ reveal: 'claim/seal-reweave', state: 'partial' }, { relationship: 'npc/kael', delta: { trust: 8 } }] },
    ] },
  { id: 'card/ae-rift-descent', title: '심연으로 내려가는 계단', tags: ['main'], when: { questStage: 'quest/fate', is: 0 },
    situation: '심연의 균열 가장자리. 끝없는 계단 아래에서 세레스의 노래가 올라온다. 동료들이 당신을 본다 — 누구를 데려갈 것인가.',
    options: [
      { id: 'all', label: '모두 함께 내려간다', stake: 'defuse', success: [{ var: 'drama', add: -1 }] },
      { id: 'alone', label: '혼자 내려간다 — 그들을 잃고 싶지 않다', stake: 'escalate', success: [{ var: 'drama', add: 2 }, { trait: 'good', add: 4 }] },
      { id: 'pact', label: '펜던트의 목소리와 거래한다 — 길을 열어 달라고', stake: 'theme:path:+', success: [{ var: 'path', add: 2 }, { var: 'seal', add: -10 }] },
    ] },
  // ───────────── 곁가지: 카엘 · 리라 · 미나 · 테오 · 이졸데
  { id: 'card/ae-kael-scales', title: '소매 아래의 비늘', tags: ['side'], when: { all: [{ inParty: 'npc/kael' }, { not: { knows: 'claim/kael-heir' } }] },
    situation: '모닥불 곁, 카엘이 소매를 걷다 멈춘다. 팔뚝에 붉은 비늘이 번져 있다. 그가 당신이 보았다는 것을 안다.',
    options: [
      { id: 'wait', label: '아무것도 묻지 않고 곁에 앉아 있는다', stake: 'bond:npc/kael', success: [{ relationship: 'npc/kael', delta: { trust: 10 } }] },
      { id: 'ask', label: '그 비늘이 무엇이냐고 묻는다', stake: 'escalate', check: { skill: 'insight', dc: 'medium' }, success: [{ reveal: 'claim/kael-heir', state: 'partial' }], fail: [{ relationship: 'npc/kael', delta: { trust: -4 } }] },
      { id: 'report', label: '교단에 알리면 보상이 크다는 것을 떠올린다', stake: 'betray:npc/kael', success: [{ reputation: 'fac/church', delta: 6 }, { reveal: 'claim/kael-heir', state: 'rumor' }] },
    ] },
  { id: 'card/ae-lyra-hunt', title: '은엽의 사냥', tags: ['side'], locationId: 'loc/elf-grove', when: { not: { cleared: 'enc/corrupted-bear' } },
    situation: '리라가 활시위를 당긴 채 숲을 노려본다. 마나에 미친 불곰이 순찰대 둘을 다치게 했다. "죽이지 않고 잠재울 수 있다면…"',
    options: [
      { id: 'hunt', label: '정면으로 사냥한다', stake: 'escalate', success: [{ startEncounter: 'enc/corrupted-bear' }] },
      { id: 'soothe', label: '곰의 마나를 가라앉힐 방법을 함께 찾는다', stake: 'bond:npc/lyra', check: { skill: 'nature', dc: 'hard' }, success: [{ relationship: 'npc/lyra', delta: { trust: 10, respect: 6 } }, { var: 'seal', add: 3 }], fail: [{ startEncounter: 'enc/corrupted-bear' }] },
      { id: 'leave', label: '엘프의 일은 엘프에게 — 숲을 떠난다', stake: 'defuse', success: [{ relationship: 'npc/lyra', delta: { affinity: -3 } }] },
    ] },
  { id: 'card/ae-theo-doubt', title: '견습 사제의 의심', tags: ['side'], when: { all: [{ knows: 'claim/no-blood' }, { npcAlive: 'npc/theo' }] },
    situation: '테오가 기도서를 덮으며 당신에게 묻는다. "교단이 무언가 숨기고 있다면, 저는 누구를 위해 기도해야 하죠?"',
    options: [
      { id: 'faith', label: '믿음은 교단보다 크다고 말해 준다', stake: 'bond:npc/theo', success: [{ relationship: 'npc/theo', delta: { trust: 8 } }] },
      { id: 'leave', label: '교단을 떠나 함께 가자고 한다', stake: 'escalate', success: [{ relationship: 'npc/theo', delta: { intimacy: 6 } }, { reputation: 'fac/church', delta: -4 }] },
      { id: 'stay', label: '교단 안에서 진실을 찾으라고 등을 민다', stake: 'side:fac/church', success: [{ reputation: 'fac/church', delta: 3 }] },
    ] },
  { id: 'card/ae-isolde-offer', title: '왕녀의 제안', tags: ['side'], when: { any: [{ at: 'loc/lumina-cathedral' }, { at: 'loc/border-fort' }] },
    situation: '이졸데가 당신에게 왕국 기사의 문장을 내민다. "이방인이라도 좋습니다. 저는 믿을 수 있는 칼이 필요해요."',
    options: [
      { id: 'accept', label: '문장을 받아 든다', stake: 'theme:balance:-', success: [{ reputation: 'fac/lumina', delta: 8 }, { var: 'balance', add: -1 }] },
      { id: 'decline', label: '어느 깃발도 지지 않겠다고 정중히 거절한다', stake: 'defuse', success: [{ relationship: 'npc/isolde', delta: { respect: 5 } }] },
      { id: 'price', label: '값을 부른다 — 칼은 공짜가 아니다', stake: 'escalate', check: { skill: 'persuasion', dc: 'medium' }, success: [{ money: 50 }, { relationship: 'npc/isolde', delta: { trust: -3 } }] },
    ] },
  { id: 'card/ae-guild-oath', title: '브롬의 규칙', tags: ['side'], when: { all: [{ flag: 'guild_registered' }, { questStage: 'quest/guild-roads', is: 1 }] },
    situation: '브롬이 숲 어귀의 거미줄 의뢰서를 내밀다 멈춘다. "혼자 가겠다면 안 줘. 삼십 년 전 내가 그랬다가 다 잃었으니까."',
    options: [
      { id: 'promise', label: '혼자 가지 않겠다고 약속한다', stake: 'bond:npc/brom', success: [{ relationship: 'npc/brom', delta: { trust: 8 } }] },
      { id: 'story', label: '삼십 년 전 이야기를 들려 달라고 한다', stake: 'defuse', success: [{ relationship: 'npc/brom', delta: { intimacy: 6 } }, { reveal: 'claim/beast-forest-dangerous', state: 'confirmed' }] },
      { id: 'defy', label: '의뢰서를 낚아채 혼자 숲으로 간다', stake: 'betray:npc/brom', success: [{ moveTo: 'loc/beast-forest' }, { startEncounter: 'enc/forest-spider' }] },
    ] },
  // ───────────── 국면 카드 보강
  { id: 'card/ae-unrest-rumor', title: '당신에 대한 소문', phases: ['phase/unrest'], tags: ['random'], repeat: { after: 6 },
    situation: '시장의 아이들이 노래를 부른다 — 별에서 떨어진 이방인의 노래. 가사의 절반은 사실이고, 절반은 무섭다.',
    options: [
      { id: 'own', label: '노래에 끼어들어 마지막 절을 바꿔 부른다', stake: 'defuse', check: { skill: 'performance', dc: 'easy' }, success: [{ var: 'vellos_order', add: 3 }, { var: 'drama', add: -1 }] },
      { id: 'source', label: '노래를 퍼뜨린 자를 찾는다', stake: 'escalate', check: { skill: 'investigation', dc: 'medium' }, success: [{ reveal: 'claim/raven-cult', state: 'rumor' }] },
      { id: 'ignore', label: '모자를 깊이 눌러쓰고 지나친다', stake: 'theme:path:+', success: [{ var: 'path', add: 1 }] },
    ] },
  { id: 'card/ae-dawn-kindness', title: '처음 받은 친절', phases: ['phase/dawn'], tags: ['side'], when: { any: [{ at: 'loc/vellos-gate' }, { at: 'loc/vellos-market' }] },
    situation: '빵집 아주머니가 굶주린 당신에게 갓 구운 빵을 내민다. "언덕에서 온 사람이지? 우리 남편도 그랬어. 이십 년 전에."',
    text: '갓 구운 빵 냄새. 빵집 앞에서 아주머니가 당신을 불러 세운다. "언덕에서 온 사람이지? 얼굴에 써 있어." 그녀가 빵 하나를 쥐여 준다. "우리 남편도 그랬어. 이십 년 전에."',
    options: [
      { id: 'thanks', label: '고맙게 받고 남편 이야기를 묻는다', stake: 'defuse', success: [{ reveal: 'claim/summoned-outsider', state: 'confirmed' }, { var: 'vellos_order', add: 2 }],
        successText: '아주머니의 남편은 별무덤 언덕에서 깨어나 이 도시에 정착했다고 한다. "돌아갈 길을 찾다가, 결국 여기서 늙었지. 후회는 안 한대." 그녀가 웃는다. 당신만 그런 게 아니었다.' },
      { id: 'pay', label: '공짜는 싫다며 동전을 놓고 간다', stake: 'side:fac/guild', success: [{ money: -2 }, { reputation: 'fac/guild', delta: 1 }],
        successText: '아주머니가 어깨를 으쓱하며 동전을 받는다. "이 도시 사람다워졌네, 벌써."' },
    ] },
];

/** 체험판에서 쓰는 카드 순서 (AI 없이 진행 — M7) */
export const AETHERIA_DEMO_START = 'start/summoned';

export const AETHERIA_FLAGS = [
  { id: 'hill_left', when: '별무덤 언덕을 떠나 벨로스로 내려갔을 때 (카드 전용)' },
  { id: 'pendant_awake', when: '펜던트가 깨어나 보랏빛 실을 드러냈을 때 (카드 전용)' },
];

/** 에테리아에 v6 층을 얹는다 */
export function applyAetheriaV6(w: WorldPackage) {
  w.manifest.version = '1.1.0';
  w.vars = [...(w.vars ?? []), ...AETHERIA_AXES];
  w.phases = AETHERIA_PHASES;
  w.storylets = AETHERIA_STORYLETS;
  w.flags = [...(w.flags ?? []), ...AETHERIA_FLAGS];
}
