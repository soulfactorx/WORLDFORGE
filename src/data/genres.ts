/**
 * 장르 프로필 (설계 v3 2장, D1·D2). 규칙(d20 코어)은 하나, 장르는 이름·말투·분위기만 바꾼다.
 * terms: 화면·AI에 보이는 용어 바꾸기 (엔진 데이터와 세이브는 그대로)
 */
export interface GenreProfile {
  id: string;
  label: string;
  description: string;
  /** 서술·NPC·안내 AI에게 주는 장르 지침 */
  tone: string;
  /** 화면·AI 글의 용어 바꾸기 (긴 것부터 적용) */
  terms: Record<string, string>;
  currency: string;
  /** 기본 최대 레벨 (세계에서 바꿀 수 있다) */
  levelCap: number;
  /** 조우(전투)를 얼마나 자주 쓰는가: 세계 생성·Director 참고 */
  combat: 'often' | 'sometimes' | 'rare';
  /** 기본 이미지 고르기 선호 태그 */
  artTags: string[];
  /** 바탕 장르 (v0.81): 성향 축·주인공 양식·기본 적처럼 이 장르에 따로 없는 것은 바탕 장르의 것을 쓴다 */
  base?: 'high_fantasy' | 'wuxia' | 'romance' | 'fighting';
}

/** 모던 직업 용어 (현대·SF 계열) */
const MODERN_TERMS: Record<string, string> = { 골드: '크레딧', 마법: '기술', 주문: '프로그램', 슬롯: '배터리' };

export const GENRES: GenreProfile[] = [
  {
    id: 'high_fantasy', label: '하이 판타지', description: '검과 마법, 왕국과 던전. D&D 기본 그대로.',
    tone: '장르: 하이 판타지. 검과 마법, 왕국·기사·마법사·괴물이 있는 서사적 모험. 경이로움과 위험을 함께 묘사한다.',
    terms: {}, currency: '골드', levelCap: 10, combat: 'often', artTags: ['fantasy'],
  },
  {
    id: 'wuxia', label: '무협', description: '강호와 문파, 무공과 내공, 은원과 협의.',
    tone: '장르: 무협. 강호·문파·무림맹·마교, 무공 초식과 내공, 협(俠)과 의리·은원·복수의 세계. 서술은 무협 소설 문체로, 인물은 하오체·하게체·합쇼체 등 고풍스러운 말투를 쓴다. 무공 동작은 초식 이름과 기세로 묘사한다. 서양식 용어(마법·기사 등)는 쓰지 않는다.',
    terms: {
      파이터: '검객', 로그: '자객', 클레릭: '도사', 위저드: '술사', 바드: '악사', 레인저: '포두', 팔라딘: '협사', 워락: '사술사',
      '음유 영감': '고무', '신랄한 조롱': '독설', '불협화음의 속삭임': '섭혼음', 파쇄: '사자후', '최면 문양': '미혼진', '사냥꾼의 표식': '추혼표', '화살 세례': '만전제발',
      안수: '추궁과혈', '신성 강타': '파사검', '섬뜩한 화살': '음풍장', 저주: '고독술', '하다르의 굶주림': '흑풍마공', '얼음 폭풍': '빙백신장', '냉기 원뿔': '한빙장', '화염 일격': '천뢰강',
      '4레벨 슬롯': '내공 4성', '5레벨 슬롯': '내공 5성', '계약 슬롯': '사술 내공',
      롱소드: '장검', 숏소드: '단검', 대거: '비수', 숏보우: '단궁', '재블린 투척': '표창 던지기', 메이스: '철편', 시미터: '환도',
      '재기의 바람': '운기조식', '행동 연쇄': '연환초', '교활한 행동': '신법', '정밀 조준': '관조',
      '신성 불꽃': '도력', '성스러운 불꽃': '뇌정부', '상처 치료': '금창술', '치유의 말': '회춘결', '인도의 화살': '청광탄',
      '화염 화살': '열양장', '마법 화살': '비도술', '타오르는 손길': '화룡장', '작열 광선': '삼양신권',
      '1레벨 슬롯': '내공 1성', '2레벨 슬롯': '내공 2성', '3레벨 슬롯': '내공 3성',
      화염구: '열화탄', '수호 영령': '호신강기', '인간 속박': '부동결', '병마의 광선': '역병지', '추가 공격': '연환격', '초감각 회피': '이형환위', '주문 슬롯': '내공', 슬롯: '내공', 주문: '술법', 소마법: '기공',
      '고블린 전사': '산적 졸개', 고블린: '산적',
      '상급 치유 물약': '대환단', '치유 물약': '금창약', 해독제: '해독단', '휴대 식량': '건량', '도둑 도구': '개문 도구', 재블린: '표창',
      '가죽 갑옷': '피갑', '사슬 셔츠': '쇄자의', '비늘 갑옷': '어린갑', '체인 메일': '철갑', 방패: '등패', 보석: '옥패',
    },
    currency: '냥', levelCap: 10, combat: 'often', artTags: ['wuxia'],
  },
  {
    id: 'romance', label: '로맨스', description: '인물과의 관계가 이야기의 중심. 전투보다 대화·사교·선택.',
    tone: '장르: 로맨스. 인물들과의 감정과 관계 변화가 이야기의 중심이다. 시선·말끝·거리감·망설임 같은 작은 변화를 섬세하게 묘사하고, 설렘·긴장·질투·화해의 순간을 놓치지 않는다. 전투는 드물게, 사교·대화·선택에 무게를 둔다.',
    terms: {}, currency: '골드', levelCap: 3, combat: 'rare', artTags: ['romance'],
  },
  {
    id: 'fighting', label: '현대 격투', description: '격투 대회와 라이벌. 대결은 장면 엔진의 턴제 격투로 진행한다.',
    tone: '장르: 현대 격투. 지하 격투장과 세계 대회, 라이벌·사제·숙적, 기술 하나하나의 무게. 대결은 턴제 격투 장면으로 진행되고, 서술은 격투 만화처럼 짧고 힘 있게 — 타격음, 숨소리, 관중의 함성, 링 위의 긴장. 무기와 마법은 없다. 승부욕·자존심·우정·복수가 이야기의 동력이다.',
    terms: { 파이터: '스트라이커', 로그: '테크니션', 클레릭: '트레이너', 위저드: '전략가', 바드: '쇼맨', 레인저: '스카우트', 팔라딘: '수호자', 워락: '계약 파이터' },
    currency: '원', levelCap: 5, combat: 'sometimes', artTags: [],
  },
  // ---------------------------------------------------------------- v0.81 장르 프리셋
  {
    id: 'dark_fantasy', label: '다크 판타지', description: '몰락한 왕국, 저주와 역병, 대가를 요구하는 힘.', base: 'high_fantasy',
    tone: '장르: 다크 판타지. 신들이 침묵하고 왕국은 썩어 가며, 힘에는 언제나 대가가 따른다. 희망은 드물고 귀하다. 피·진흙·쇠 냄새, 지친 사람들, 도덕적으로 회색인 선택을 묘사한다. 승리도 상처를 남긴다.',
    terms: {}, currency: '은화', levelCap: 10, combat: 'often', artTags: ['fantasy'],
  },
  {
    id: 'sf', label: 'SF · 우주', description: '항성 간 항해, 정거장과 행성, 외계 문명과 기업.', base: 'high_fantasy',
    tone: '장르: SF·우주 활극. 항성선과 정거장, 개척 행성, 외계 종족과 거대 기업. 기술은 그럴듯하게 — 함선의 소음, 생명 유지 장치, 통신 지연, 낯선 중력. 마법이나 중세풍 용어는 쓰지 않는다. 경이와 고독, 미지의 위험.',
    terms: { 파이터: '해병', 로그: '침투요원', 클레릭: '의무관', 위저드: '과학자', 바드: '외교관', 레인저: '정찰병', 팔라딘: '보안관', 워락: '사이오닉', ...MODERN_TERMS }, currency: '크레딧', levelCap: 10, combat: 'sometimes', artTags: [],
  },
  {
    id: 'cyberpunk', label: '사이버펑크', description: '네온과 빗속의 메가시티, 사이버웨어와 기업 권력.', base: 'high_fantasy',
    tone: '장르: 사이버펑크. 네온이 번지는 빗속의 메가시티, 기업이 국가 위에 있고 몸은 사이버웨어로 개조된다. 해킹·거래·배신, 하이테크 로우라이프. 문장은 짧고 차갑게, 거리의 은어를 섞는다. 마법·중세 용어는 쓰지 않는다.',
    terms: { 파이터: '솔로', 로그: '넷러너', 클레릭: '리퍼닥', 위저드: '테키', 바드: '픽서', 레인저: '노마드', 팔라딘: '코프 경호원', 워락: '해킹 계약자', ...MODERN_TERMS }, currency: '에디', levelCap: 10, combat: 'sometimes', artTags: [],
  },
  {
    id: 'urban_fantasy', label: '현대 어반 판타지', description: '평범한 도시 뒤편의 요괴·마법사·비밀 조직.', base: 'high_fantasy',
    tone: '장르: 현대 어반 판타지. 지하철과 편의점이 있는 평범한 도시 뒤편에 요괴·흡혈귀·마법사·비밀 조직이 숨어 산다. 일상의 디테일(스마트폰, 야근, 배달 오토바이)과 초자연의 충돌을 묘사한다. 비밀은 일반인에게 들키지 않아야 한다.',
    terms: { 골드: '원' }, currency: '원', levelCap: 10, combat: 'sometimes', artTags: [],
  },
  {
    id: 'horror', label: '공포 · 괴담', description: '설명할 수 없는 것과 마주하는 생존. 전투보다 도망과 조사.', base: 'high_fantasy',
    tone: '장르: 공포·괴담. 정체를 알 수 없는 것이 천천히 다가온다. 작은 어긋남(틀린 그림, 들리지 말아야 할 소리, 반복되는 숫자)으로 불안을 쌓고, 정체는 쉽게 드러내지 않는다. 주인공은 강하지 않다 — 숨고, 도망치고, 조사하고, 버틴다.',
    terms: { 골드: '원' }, currency: '원', levelCap: 5, combat: 'rare', artTags: [],
  },
  {
    id: 'mystery', label: '추리 · 미스터리', description: '사건과 단서, 거짓말하는 증인, 밝혀지는 진실.', base: 'romance',
    tone: '장르: 추리·미스터리. 사건 현장과 단서, 알리바이와 거짓말하는 증인. 플레이어가 스스로 추리할 수 있도록 단서는 공정하게 — 발견한 것은 정확히, 아직 모르는 것은 드러내지 않는다. 인물마다 숨기는 것이 있다. 전투는 드물고 대화·관찰·조사가 중심이다.',
    terms: { 골드: '원' }, currency: '원', levelCap: 5, combat: 'rare', artTags: [],
  },
  {
    id: 'post_apoc', label: '포스트 아포칼립스', description: '무너진 문명 뒤의 생존. 물자·거점·약탈자.', base: 'high_fantasy',
    tone: '장르: 포스트 아포칼립스. 문명이 무너진 뒤의 황무지와 폐허 도시. 물·식량·연료·탄약이 생명이고, 거점과 무리가 정치다. 녹슨 금속, 모래바람, 오래된 광고판 같은 옛 세계의 잔해를 묘사한다. 사람이 가장 위험할 때가 많다.',
    terms: { 골드: '병뚜껑' }, currency: '병뚜껑', levelCap: 10, combat: 'often', artTags: [],
  },
  {
    id: 'joseon', label: '조선 사극', description: '궁궐과 저잣거리, 양반과 상민, 음모와 의리.', base: 'wuxia',
    tone: '장르: 조선 사극. 궁궐과 관아, 저잣거리와 주막, 양반·중인·상민·천민의 신분 질서와 그 사이의 음모·의리·한(恨). 인물은 하오체·하게체·합쇼체·해라체를 신분에 맞게 쓴다. 서양식 용어는 쓰지 않는다.',
    terms: { 골드: '냥' }, currency: '냥', levelCap: 10, combat: 'sometimes', artTags: ['wuxia'],
  },
  {
    id: 'school', label: '학원물', description: '교실과 동아리, 축제와 시험, 우정과 첫사랑.', base: 'romance',
    tone: '장르: 학원물. 교실·복도·옥상·동아리방, 축제와 시험과 수학여행. 우정·경쟁·첫사랑·소문이 사건이 된다. 말투는 학생답게 생생하고, 작은 일도 큰일처럼 느껴지는 나이의 감정을 놓치지 않는다. 전투는 거의 없다.',
    terms: { 골드: '원' }, currency: '원', levelCap: 3, combat: 'rare', artTags: ['romance'],
  },
];

/** 사용자 정의 장르 (v0.81): 이름·설명·분위기 지침·전투 빈도·바탕 장르 */
export interface CustomGenre { label: string; description?: string; tone: string; combat?: GenreProfile['combat']; base?: GenreProfile['base']; currency?: string; levelCap?: number }
export const CUSTOM_GENRE_ID = 'custom';

export function genreOf(id?: string, custom?: CustomGenre): GenreProfile {
  if (id === CUSTOM_GENRE_ID && custom?.tone?.trim()) {
    const base = GENRES.find((g) => g.id === (custom.base ?? 'high_fantasy')) ?? GENRES[0]!;
    return { ...base, id: CUSTOM_GENRE_ID, label: custom.label?.trim() || '사용자 정의 장르', description: custom.description ?? '', tone: `장르: ${custom.label?.trim() || '사용자 정의'}. ${custom.tone.trim()}`,
      terms: {}, combat: custom.combat ?? base.combat, currency: custom.currency ?? base.currency, levelCap: custom.levelCap ?? base.levelCap, base: base.base ?? (base.id as GenreProfile['base']) };
  }
  return GENRES.find((g) => g.id === id) ?? GENRES[0]!;
}
/** 성향·주인공 양식·기본 적 같은 장르별 데이터를 찾을 때의 열쇠 (자기 것이 없으면 바탕 장르) */
export const genreDataKey = (id?: string, custom?: CustomGenre): string => { const g = genreOf(id, custom); return g.base ?? g.id; };
