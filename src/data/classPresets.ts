/**
 * 직업 프리셋 (v0.56) — 규칙(d20 엔진 직업 8종)은 그대로, 장르에 맞는 이름·소개·추천 기술로 보여 준다.
 * 세계가 classes를 정하지 않으면 장르의 기본 프리셋을 쓴다.
 */
import { CLASSES } from '../engine/character/rules';
import type { WorldClass } from '../engine/schema';

export interface ClassPreset { id: string; label: string; description: string; classes: WorldClass[] }

const c = (id: string, name: string, base: string, blurb: string, strengths: string, skills: string[], skillOptions?: string[]): WorldClass =>
  ({ id, name, base, blurb, strengths, skills, ...(skillOptions ? { skillOptions } : {}) });

/** 하위 직업 이름 (v0.67): 기본 직업마다 엔진 하위 직업 순서대로 [첫째, 둘째] */
const SUB_ORDER: Record<string, [string, string]> = { fighter: ['champion', 'guardian'], rogue: ['thief', 'duelist'], cleric: ['life', 'war'], wizard: ['evoker', 'diviner'], bard: ['lore', 'valor'], ranger: ['hunter', 'tracker'], paladin: ['devotion', 'vengeance'], warlock: ['fiend', 'archfey'] };
const withSubs = (list: WorldClass[], names: Record<string, [string, string, string?, string?]>): WorldClass[] => list.map((x) => {
  const n = names[x.id];
  if (!n) return x;
  const [a, b] = SUB_ORDER[x.base]!;
  return { ...x, subclasses: [{ base: a, name: n[0], ...(n[2] ? { blurb: n[2] } : {}) }, { base: b, name: n[1], ...(n[3] ? { blurb: n[3] } : {}) }] };
});

const FANTASY: WorldClass[] = Object.values(CLASSES).map((x) => ({ id: x.id, name: x.name, base: x.id, blurb: x.blurb }));

export const CLASS_PRESETS: ClassPreset[] = [
  { id: 'fantasy', label: '하이 판타지 (기본 8직업)', description: '파이터·로그·클레릭·위저드·바드·레인저·팔라딘·워락', classes: FANTASY },
  {
    id: 'wuxia', label: '무협', description: '검객·자객·도사·술사·악사·포두·협사·사술사',
    classes: withSubs([
      c('swordsman', '검객', 'fighter', '한 자루 검으로 강호를 떠도는 무인. 정면 승부와 버티기에 강하다.', '검법 · 정면 승부 · 체력', ['athletics', 'intimidation']),
      c('assassin', '자객', 'rogue', '그림자 속의 살수. 신법으로 파고들어 급소를 노린다.', '암습 · 신법 · 잠입', ['stealth', 'acrobatics', 'perception', 'deception']),
      c('taoist', '도사', 'cleric', '도관에서 수행한 도인. 부적과 도력으로 사람을 살리고 사악을 물리친다.', '치유 · 도력 · 의술', ['medicine', 'religion']),
      c('sorcerer', '술사', 'wizard', '기문둔갑과 진법을 익힌 기인. 머리로 싸운다.', '진법 · 학식 · 술법', ['arcana', 'history']),
      c('musician', '악사', 'bard', '금(琴)과 피리로 마음을 흔드는 풍류객. 강호의 소문을 누구보다 빨리 듣는다.', '음공 · 풍류 · 소문', ['performance', 'persuasion', 'insight']),
      c('constable', '포두', 'ranger', '관아의 추격자. 흔적을 쫓아 끝내 범인을 잡는다.', '추적 · 활 · 관찰', ['perception', 'investigation', 'survival']),
      c('knight_errant', '협사', 'paladin', '협(俠)을 맹세한 의인. 약자를 지키는 일에 목숨을 건다.', '수호 · 의협 · 위엄', ['persuasion', 'insight']),
      c('heretic', '사술사', 'warlock', '마도의 비전과 계약을 맺은 자. 강하지만 대가가 따른다.', '사술 · 비밀 · 공포', ['intimidation', 'arcana']),
    ], { swordsman: ['검성의 길', '호위 검객'], assassin: ['비영문 자객', '일검 결투가'], taoist: ['회춘 도사', '무당 전투 도사'], sorcerer: ['뇌정 술사', '천기 점술사'], musician: ['섭혼 악사', '검무 악사'], constable: ['추격 포두', '수색 포두'], knight_errant: ['정의의 협사', '복수의 협사'], heretic: ['혈마 계약', '환술 계약'] }),
  },
  {
    id: 'romance_court', label: '궁정 로맨스', description: '기사·사교계 인사·밀정·궁정 학자·치유사·여행자·근위 기사·계약자',
    classes: withSubs([
      c('knight', '기사', 'fighter', '검과 맹세로 사는 사람. 호위·결투·명예가 걸린 순간에 빛난다.', '결투 · 호위 · 체력', ['athletics', 'insight'], ['athletics', 'acrobatics', 'animal_handling', 'insight', 'intimidation', 'persuasion', 'perception', 'history']),
      c('socialite', '사교계 인사', 'bard', '무도회와 살롱의 주인공. 말 한마디로 분위기를 바꾸고 닫힌 마음을 연다.', '화술 · 매력 · 소문', ['persuasion', 'performance', 'insight'], ['persuasion', 'performance', 'insight', 'deception', 'history', 'perception', 'acrobatics', 'investigation']),
      c('spy', '밀정', 'rogue', '편지와 소문, 닫힌 문 뒤의 비밀을 다루는 사람. 들키지 않고 알아낸다.', '정보 · 은밀 · 기지', ['stealth', 'investigation', 'deception', 'insight']),
      c('scholar', '궁정 학자', 'wizard', '서고와 연구실의 사람. 가문의 역사와 숨은 사정을 꿰뚫고, 약간의 마법도 다룬다.', '지식 · 추리 · 마법', ['history', 'investigation']),
      c('healer', '신전 치유사', 'cleric', '신전에서 자라 사람의 상처와 마음을 돌본다. 고해를 들어 주면 사람들은 비밀을 털어놓는다.', '치유 · 위로 · 신뢰', ['medicine', 'insight']),
      c('traveler', '이국의 여행자', 'ranger', '먼 나라에서 온 방랑자. 사교계의 규칙은 낯설지만 사람과 짐승의 속내는 잘 읽는다.', '관찰 · 생존 · 이방인의 시선', ['perception', 'insight', 'animal_handling']),
      c('royal_guard', '근위 기사', 'paladin', '왕가에 맹세한 수호자. 충성과 마음 사이에서 흔들린다.', '수호 · 신념 · 위엄', ['persuasion', 'insight']),
      c('contractor', '비밀 계약자', 'warlock', '누구에게도 말할 수 없는 계약을 맺었다. 신비로운 매력과 위험한 비밀을 함께 지닌다.', '신비 · 비밀 · 매혹', ['deception', 'arcana']),
    ], { knight: ['결투의 명수', '맹세한 호위'], socialite: ['화술가', '무도의 꽃'], spy: ['그림자 정보원', '가면의 검객'], scholar: ['마도학자', '점성술사'], healer: ['치유의 손', '종군 사제'], traveler: ['사냥꾼', '길잡이'], royal_guard: ['헌신의 서약', '복수의 서약'], contractor: ['악마의 계약', '요정의 계약'] }),
  },
  {
    id: 'romance_academy', label: '학원 로맨스', description: '운동부 에이스·학생회장·밴드부 보컬·우등생·전학생·보건부원·탐정 동아리·오컬트 동아리',
    classes: withSubs([
      c('ace', '운동부 에이스', 'fighter', '체육관과 운동장의 주인공. 몸으로 부딪치고, 지는 걸 싫어한다.', '체력 · 승부욕 · 듬직함', ['athletics', 'acrobatics'], ['athletics', 'acrobatics', 'insight', 'intimidation', 'persuasion', 'perception']),
      c('president', '학생회장', 'paladin', '모두가 의지하는 원칙주의자. 규칙과 마음 사이에서 고민한다.', '리더십 · 신뢰 · 원칙', ['persuasion', 'insight'], ['persuasion', 'insight', 'intimidation', 'history', 'investigation', 'athletics']),
      c('vocalist', '밴드부 보컬', 'bard', '무대 위에서 빛나는 인기인. 노래 한 곡으로 분위기를 바꾼다.', '공연 · 매력 · 인맥', ['performance', 'persuasion', 'insight'], ['performance', 'persuasion', 'insight', 'deception', 'perception', 'acrobatics', 'history']),
      c('honor', '수석 우등생', 'wizard', '시험마다 1등. 차가워 보이지만 모르는 게 없다.', '지식 · 추리 · 계획', ['investigation', 'history'], ['investigation', 'history', 'insight', 'medicine', 'nature']),
      c('transfer', '비밀 많은 전학생', 'rogue', '어디서 왔는지 아무도 모른다. 눈치가 빠르고 숨기는 게 많다.', '눈치 · 은밀 · 비밀', ['stealth', 'insight', 'deception', 'perception']),
      c('nurse', '보건부원', 'cleric', '다친 사람을 그냥 지나치지 못한다. 보건실은 모두의 고민 상담소.', '돌봄 · 위로 · 공감', ['medicine', 'insight'], ['medicine', 'insight', 'persuasion', 'history']),
      c('detective', '탐정 동아리', 'ranger', '학교의 작은 미스터리를 쫓는다. 사소한 흔적도 놓치지 않는다.', '관찰 · 추적 · 끈기', ['perception', 'investigation', 'insight'], ['perception', 'investigation', 'insight', 'stealth', 'athletics', 'survival']),
      c('occult', '오컬트 동아리', 'warlock', '학교 괴담과 이상한 계약에 얽혀 있다. 신비롭고 조금 위험하다.', '신비 · 괴담 · 비밀', ['arcana', 'investigation']),
    ], { ace: ['에이스 스트라이커', '수비의 핵'], president: ['모범 회장', '개혁파 회장'], vocalist: ['작사가', '무대의 지배자'], honor: ['수석 응용파', '예측의 천재'], transfer: ['정보통', '밤의 결투자'], nurse: ['보건실의 천사', '응급처치 담당'], detective: ['현장파', '추리파'], occult: ['금서의 계약', '요정의 속삭임'] }),
  },
  {
    id: 'romance_modern', label: '현대 로맨스', description: '경호원·배우·기자·의사·변호사·연구원·사진작가·재벌 후계자',
    classes: withSubs([
      c('bodyguard', '경호원', 'fighter', '말수는 적고 몸이 먼저 나간다. 지키는 사람에게 마음이 흔들리면 곤란하다.', '경호 · 체력 · 침착', ['athletics', 'perception'], ['athletics', 'acrobatics', 'insight', 'intimidation', 'perception', 'persuasion']),
      c('actor', '배우·가수', 'bard', '카메라 앞의 얼굴과 카메라 밖의 얼굴이 다르다. 사람을 끄는 힘이 있다.', '연기 · 매력 · 인맥', ['performance', 'persuasion', 'deception'], ['performance', 'persuasion', 'deception', 'insight', 'perception', 'acrobatics']),
      c('reporter', '기자', 'rogue', '특종을 위해서라면 어디든 들어간다. 진실과 사람 사이에서 갈등한다.', '취재 · 정보 · 기지', ['investigation', 'insight', 'deception', 'perception'], ['investigation', 'insight', 'deception', 'perception', 'persuasion', 'stealth', 'sleight_of_hand']),
      c('doctor', '의사', 'cleric', '응급실의 밤을 버티는 사람. 생명을 다루는 손이 사람의 마음도 다룬다.', '의술 · 위로 · 책임감', ['medicine', 'insight'], ['medicine', 'insight', 'persuasion', 'history']),
      c('lawyer', '변호사', 'paladin', '정의와 의뢰인 사이에서 싸운다. 말로 상대를 무너뜨린다.', '논리 · 설득 · 원칙', ['persuasion', 'insight'], ['persuasion', 'insight', 'intimidation', 'history', 'investigation']),
      c('researcher', '연구원', 'wizard', '연구실에 사는 천재. 사람 마음은 실험보다 어렵다.', '지식 · 분석 · 집중', ['investigation', 'history'], ['investigation', 'history', 'insight', 'medicine', 'nature']),
      c('photographer', '사진작가', 'ranger', '세계를 떠돌며 순간을 찍는다. 남들이 못 보는 것을 본다.', '관찰 · 여행 · 자유', ['perception', 'insight', 'survival'], ['perception', 'insight', 'survival', 'nature', 'stealth', 'athletics']),
      c('heir', '재벌 후계자', 'warlock', '가문과 맺은 계약에 묶인 사람. 모든 걸 가졌지만 마음대로 할 수 있는 건 없다.', '권력 · 비밀 · 압박', ['intimidation', 'deception'], ['intimidation', 'deception', 'persuasion', 'insight', 'history', 'investigation']),
    ], { bodyguard: ['전투 전문', '근접 경호'], actor: ['연기파', '액션 배우'], reporter: ['탐사 기자', '현장 기자'], doctor: ['외과의', '응급의학과'], lawyer: ['인권 변호사', '검사 출신'], researcher: ['실험파', '분석파'], photographer: ['다큐 작가', '파파라치'], heir: ['그룹 후계자', '숨겨진 후계자'] }),
  },
  {
    id: 'fighting', label: '현대 격투', description: '스트라이커·테크니션·트레이너·전략가·쇼맨·스카우트·수호자·계약 파이터',
    classes: withSubs([
      c('striker', '스트라이커', 'fighter', '정면에서 때리고 버티는 타격가. 한 방의 무게로 승부한다.', '타격 · 맷집 · 압박', ['athletics', 'intimidation']),
      c('technician', '테크니션', 'rogue', '관절기와 카운터의 장인. 빈틈을 기다렸다가 정확히 찌른다.', '카운터 · 관절기 · 속도', ['acrobatics', 'insight', 'perception', 'sleight_of_hand']),
      c('trainer', '트레이너', 'cleric', '코너의 사람. 상처를 돌보고 동료를 다시 일으켜 세운다.', '회복 · 지원 · 근성', ['medicine', 'insight']),
      c('strategist', '전략가', 'wizard', '상대의 영상을 백 번 돌려 본 분석가. 머리로 이긴다.', '분석 · 예측 · 계획', ['investigation', 'insight'], ['investigation', 'insight', 'history', 'medicine', 'perception']),
      c('showman', '쇼맨', 'bard', '관중을 내 편으로 만드는 엔터테이너. 도발과 퍼포먼스가 무기.', '도발 · 관중 · 기세', ['performance', 'persuasion', 'intimidation']),
      c('street', '스트리트 파이터', 'ranger', '골목에서 자란 실전파. 어디서든 싸우고 어디서든 살아남는다.', '실전 · 관찰 · 생존', ['perception', 'athletics', 'survival']),
      c('guardian', '정통 무도가', 'paladin', '도장의 가르침을 지키는 무도가. 예의와 신념이 힘이 된다.', '수련 · 정신력 · 품격', ['athletics', 'insight']),
      c('contract', '계약 파이터', 'warlock', '지하 격투장과 위험한 계약을 맺었다. 이기는 대가로 무언가를 잃는다.', '위협 · 비밀 · 집념', ['intimidation', 'deception']),
    ], { striker: ['일격필살', '철벽 가드'], technician: ['서브미션', '카운터 결투가'], trainer: ['회복 트레이너', '세컨드 파이터'], strategist: ['파괴 분석가', '예측 분석가'], showman: ['도발 쇼맨', '퍼포먼스 파이터'], street: ['골목 사냥꾼', '추적자'], guardian: ['정도의 무도가', '설욕의 무도가'], contract: ['지옥의 계약', '환영의 계약'] }),
  },
  {
    id: 'modern', label: '현대·근미래', description: '경호원·해커·의사·엔지니어·기자·형사·특수요원·오컬트 연구가',
    classes: withSubs([
      c('guard', '경호원', 'fighter', '몸으로 막고 몸으로 뚫는다. 근접전과 버티기의 전문가.', '격투 · 체력 · 위압', ['athletics', 'intimidation']),
      c('hacker', '해커', 'rogue', '잠긴 문도 잠긴 서버도 연다. 들키지 않고 들어가 필요한 것만 가져온다.', '침입 · 은신 · 손재주', ['sleight_of_hand', 'stealth', 'investigation', 'deception']),
      c('medic', '의사', 'cleric', '사람을 살리는 손. 위기에서 가장 먼저 찾게 되는 사람.', '치료 · 통찰 · 침착함', ['medicine', 'insight']),
      c('engineer', '엔지니어', 'wizard', '원리를 알면 무엇이든 고치고 만든다. 지식이 곧 무기.', '분석 · 지식 · 장비', ['investigation', 'arcana']),
      c('reporter', '기자', 'bard', '말로 문을 열고 사람을 움직인다. 진실을 쫓는 입담가.', '말솜씨 · 정보 · 인맥', ['persuasion', 'deception', 'insight']),
      c('detective', '형사', 'ranger', '현장을 읽고 끝까지 쫓는다. 단서와 사람을 놓치지 않는다.', '추적 · 관찰 · 수사', ['perception', 'investigation', 'survival']),
      c('agent', '특수요원', 'paladin', '임무와 신념으로 움직이는 요원. 동료를 지키는 방패.', '임무 · 정신력 · 리더십', ['athletics', 'persuasion']),
      c('occultist', '오컬트 연구가', 'warlock', '설명할 수 없는 것과 거래한 사람. 그 대가는 아직 모른다.', '금지된 지식 · 위협 · 비밀', ['arcana', 'intimidation']),
    ], { guard: ['철벽 경호', '방어 전문'], hacker: ['침입 전문', '근접 전문'], medic: ['응급 의학', '전장 의무병'], engineer: ['폭발물 전문', '예측 분석'], reporter: ['탐사 보도', '현장 기자'], detective: ['강력계', '추적 전문'], agent: ['신념의 요원', '복수의 요원'], occultist: ['악마의 계약', '요정의 계약'] }),
  },
];

/** 장르별 기본 프리셋 */
export const GENRE_CLASS_PRESET: Record<string, string> = { high_fantasy: 'fantasy', wuxia: 'wuxia', romance: 'romance_court', fighting: 'fighting',
  dark_fantasy: 'fantasy', sf: 'modern', cyberpunk: 'modern', urban_fantasy: 'modern', horror: 'modern', mystery: 'modern', post_apoc: 'modern', joseon: 'wuxia', school: 'romance_academy' };

export const presetById = (id: string) => CLASS_PRESETS.find((p) => p.id === id);
