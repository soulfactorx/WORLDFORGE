import { fxSvg } from './sceneArt';
/**
 * 기본 이미지 에셋 (v0.16) — 앱에 내장된 절차적 SVG 그림.
 * 카드에 이미지가 없거나 부족할 때, AI가 고르거나 제작자가 직접 인물·장소에 붙인다.
 * 파일을 내려받지 않고 코드로 그리므로 용량이 거의 없고, 오프라인에서도 보인다.
 * 에셋 ID 규칙: `stock.<그림 ID>` 또는 같은 그림을 여러 번 쓸 때 `stock.<그림 ID>--<번호>`.
 */

export interface StockArt {
  id: string;
  kind: 'character' | 'scene';
  /** 한국어 이름 */
  label: string;
  /** 고르기용 낱말 (한국어·영어) */
  tags: string[];
  gender?: 'M' | 'F';
  /** 어울리는 장르 (없으면 판타지·로맨스용 서양풍) */
  genres?: string[];
}

// ---------------------------------------------------------------- 인물

type Outfit = 'royal' | 'dress' | 'suit' | 'armor' | 'robe' | 'priest' | 'maid' | 'butler' | 'tunic' | 'leather' | 'dark' | 'uniform' | 'vest' | 'hanfu' | 'monkrobe';
type Hair = 'short' | 'long' | 'bun' | 'ponytail' | 'braid' | 'messy' | 'bald' | 'topknot';
type Acc = 'crown' | 'tiara' | 'helmet' | 'hood' | 'hat' | 'witchhat' | 'glasses' | 'veil' | 'horns' | 'headband' | 'hairpin' | 'guan' | 'mask' | 'none';

interface CharSpec { outfit: Outfit; hair: Hair; acc: Acc; hairColor: string; cloth: string; trim: string; bg: [string, string]; skin?: string; old?: boolean }

const SKIN = ['#f3d6c1', '#e8c0a0', '#d9a983', '#b9805a'];

const ARCHETYPES: { id: string; label: string; tags: string[]; m: CharSpec; f: CharSpec }[] = [
  { id: 'monarch', label: '군주 (황제·왕)', tags: ['황제', '황후', '여제', '왕', '왕비', '여왕', '군주', 'emperor', 'empress', 'king', 'queen', 'monarch', 'royal'],
    m: { outfit: 'royal', hair: 'short', acc: 'crown', hairColor: '#2b2420', cloth: '#5b1f2e', trim: '#d4a640', bg: ['#3a1d2a', '#1a0f16'] },
    f: { outfit: 'royal', hair: 'long', acc: 'crown', hairColor: '#1d1a24', cloth: '#3b1f5b', trim: '#d4a640', bg: ['#2a1d3a', '#120f1a'] } },
  { id: 'prince', label: '왕족 (황자·황녀)', tags: ['황자', '황녀', '왕자', '공주', '대공', '왕족', 'prince', 'princess', 'duke'],
    m: { outfit: 'uniform', hair: 'messy', acc: 'none', hairColor: '#d9c27a', cloth: '#f2efe6', trim: '#c9a23f', bg: ['#30455e', '#151f2b'] },
    f: { outfit: 'dress', hair: 'long', acc: 'tiara', hairColor: '#e7d39b', cloth: '#8fb2d9', trim: '#f1e2b0', bg: ['#34506e', '#16202c'] } },
  { id: 'noble', label: '귀족', tags: ['귀족', '영애', '영식', '공작', '백작', '후작', '부인', '귀부인', 'noble', 'lady', 'lord', 'count', 'aristocrat'],
    m: { outfit: 'suit', hair: 'short', acc: 'none', hairColor: '#4a3426', cloth: '#26324a', trim: '#b7bfd0', bg: ['#3b3a4e', '#17171f'] },
    f: { outfit: 'dress', hair: 'bun', acc: 'none', hairColor: '#7a3b2a', cloth: '#9b3a4f', trim: '#f0d0d8', bg: ['#4a2f3a', '#1d1217'] } },
  { id: 'knight', label: '기사', tags: ['기사', '기사단', '기사단장', '호위', '호위기사', '성기사', 'knight', 'paladin', 'guard', 'captain'],
    m: { outfit: 'armor', hair: 'short', acc: 'none', hairColor: '#3a2c22', cloth: '#9aa4b1', trim: '#3b5f8f', bg: ['#2f3c4c', '#121820'] },
    f: { outfit: 'armor', hair: 'ponytail', acc: 'none', hairColor: '#b8b8c4', cloth: '#a7b0bd', trim: '#8f3b3b', bg: ['#3c2f33', '#181214'] } },
  { id: 'soldier', label: '병사·경비병', tags: ['병사', '경비병', '근위병', '군인', '용병', 'soldier', 'guard', 'mercenary', 'sentry'],
    m: { outfit: 'armor', hair: 'short', acc: 'helmet', hairColor: '#2c241c', cloth: '#7d858f', trim: '#6b4a2a', bg: ['#3a3a33', '#161612'] },
    f: { outfit: 'armor', hair: 'ponytail', acc: 'helmet', hairColor: '#3b2a1e', cloth: '#80888f', trim: '#6b4a2a', bg: ['#3a3a33', '#161612'] } },
  { id: 'mage', label: '마법사', tags: ['마법사', '마도사', '마탑', '마녀', '술사', '정령술사', 'mage', 'wizard', 'witch', 'sorcerer', 'magic'],
    m: { outfit: 'robe', hair: 'long', acc: 'none', hairColor: '#cfd6e4', cloth: '#26306b', trim: '#8fd0ff', bg: ['#1c2350', '#0b0e22'] },
    f: { outfit: 'robe', hair: 'long', acc: 'witchhat', hairColor: '#5a2b7a', cloth: '#3a2260', trim: '#c49bff', bg: ['#2a1a48', '#0f0a1c'] } },
  { id: 'priest', label: '성직자 (사제·성녀)', tags: ['사제', '신관', '성녀', '성자', '교황', '수녀', '신전', '교단', 'priest', 'saint', 'cleric', 'nun', 'church'],
    m: { outfit: 'priest', hair: 'short', acc: 'none', hairColor: '#e6dcc4', cloth: '#f3efe4', trim: '#d4a640', bg: ['#4b4a3a', '#1e1d16'] },
    f: { outfit: 'priest', hair: 'long', acc: 'veil', hairColor: '#f0e3b8', cloth: '#f4f1ea', trim: '#d4a640', bg: ['#4a4a3c', '#1d1d17'] } },
  { id: 'servant', label: '시종 (집사·시녀)', tags: ['시녀', '시녀장', '하녀', '메이드', '집사', '시종', '하인', '시종장', 'maid', 'butler', 'servant', 'attendant'],
    m: { outfit: 'butler', hair: 'short', acc: 'none', hairColor: '#2a2a2e', cloth: '#1d1d22', trim: '#f2f2f2', bg: ['#3a3430', '#171412'] },
    f: { outfit: 'maid', hair: 'bun', acc: 'headband', hairColor: '#3b2a22', cloth: '#1f1f26', trim: '#f5f5f5', bg: ['#3d3530', '#181412'] } },
  { id: 'scholar', label: '학자·관료', tags: ['학자', '관료', '재상', '비서', '보좌관', '서기', '의사', '연구원', 'scholar', 'minister', 'secretary', 'advisor', 'doctor'],
    m: { outfit: 'robe', hair: 'short', acc: 'glasses', hairColor: '#4b4038', cloth: '#2f4a3a', trim: '#cfc39a', bg: ['#2f3d33', '#121813'] },
    f: { outfit: 'suit', hair: 'bun', acc: 'glasses', hairColor: '#2c2420', cloth: '#3b4a3f', trim: '#d8d0b4', bg: ['#2f3d33', '#121813'] } },
  { id: 'merchant', label: '상인', tags: ['상인', '상단', '장사꾼', '여관주인', '주인', '상회', 'merchant', 'trader', 'innkeeper', 'shopkeeper'],
    m: { outfit: 'vest', hair: 'short', acc: 'hat', hairColor: '#5b3b22', cloth: '#7a4f2a', trim: '#e4c48a', bg: ['#4a3a26', '#1c150d'] },
    f: { outfit: 'vest', hair: 'braid', acc: 'none', hairColor: '#8a4f2a', cloth: '#6b3f2a', trim: '#f0d9a0', bg: ['#4a3a26', '#1c150d'] } },
  { id: 'rogue', label: '도적·암살자', tags: ['도적', '암살자', '첩자', '정보원', '그림자', '밀정', 'rogue', 'thief', 'assassin', 'spy'],
    m: { outfit: 'dark', hair: 'messy', acc: 'hood', hairColor: '#1b1b1f', cloth: '#26262c', trim: '#5a5a66', bg: ['#1f2228', '#0a0b0d'] },
    f: { outfit: 'dark', hair: 'long', acc: 'hood', hairColor: '#2a1a1a', cloth: '#2a2228', trim: '#7a3b4a', bg: ['#221d22', '#0b090b'] } },
  { id: 'adventurer', label: '모험가', tags: ['모험가', '여행자', '사냥꾼', '궁수', '이방인', '용사', 'adventurer', 'traveler', 'hunter', 'ranger', 'hero'],
    m: { outfit: 'leather', hair: 'messy', acc: 'none', hairColor: '#6b4a2a', cloth: '#5a4430', trim: '#3f6b45', bg: ['#2f4433', '#121a14'] },
    f: { outfit: 'leather', hair: 'ponytail', acc: 'none', hairColor: '#a3542a', cloth: '#5a4430', trim: '#3f6b45', bg: ['#2f4433', '#121a14'] } },
  { id: 'villager', label: '평민·마을 사람', tags: ['평민', '마을', '주민', '농부', '아이', '소년', '소녀', '하층민', 'villager', 'commoner', 'farmer', 'peasant', 'child'],
    m: { outfit: 'tunic', hair: 'messy', acc: 'none', hairColor: '#4a3020', cloth: '#7a6a4a', trim: '#b8a27a', bg: ['#4a4430', '#1c1a12'] },
    f: { outfit: 'tunic', hair: 'braid', acc: 'headband', hairColor: '#6a3a1e', cloth: '#8a5a4a', trim: '#e0c9a0', bg: ['#4a4430', '#1c1a12'] } },
  { id: 'elder', label: '노인·원로', tags: ['노인', '원로', '할아버지', '할머니', '대신관', '현자', '장로', 'elder', 'old', 'sage'],
    m: { outfit: 'robe', hair: 'bald', acc: 'none', hairColor: '#e8e8e8', cloth: '#4a3a5a', trim: '#cfc39a', bg: ['#3a3440', '#151318'], old: true },
    f: { outfit: 'robe', hair: 'bun', acc: 'none', hairColor: '#ececec', cloth: '#4a4a3a', trim: '#cfc39a', bg: ['#3a3a34', '#151513'], old: true } },
  { id: 'villain', label: '흑막·악당', tags: ['흑막', '악당', '마왕', '흑마법사', '반역자', '악역', 'villain', 'dark lord', 'traitor', 'demon'],
    m: { outfit: 'dark', hair: 'long', acc: 'horns', hairColor: '#e8e4f0', cloth: '#1a0f14', trim: '#b02a3a', bg: ['#3a0f18', '#0d0306'] },
    f: { outfit: 'dress', hair: 'long', acc: 'none', hairColor: '#120c12', cloth: '#1c0c14', trim: '#b02a3a', bg: ['#3a0f18', '#0d0306'] } },
  // ---- 무협 (genres: wuxia)
  { id: 'wx-swordsman', label: '무협 · 검객·협객', tags: ['검객', '협객', '무인', '대협', '소협', '검수', '협녀', '여협', '표사', 'swordsman', 'wuxia'],
    m: { outfit: 'hanfu', hair: 'topknot', acc: 'none', hairColor: '#1b1714', cloth: '#dfe6ee', trim: '#3b5f8f', bg: ['#2c3e4c', '#10181f'] },
    f: { outfit: 'hanfu', hair: 'long', acc: 'hairpin', hairColor: '#15110f', cloth: '#f1e9ee', trim: '#b04a6a', bg: ['#3a2c3a', '#140f16'] } },
  { id: 'wx-monk', label: '무협 · 무승·비구니', tags: ['무승', '승려', '소림', '비구니', '스님', '아미', '대사', '방장', 'monk'],
    m: { outfit: 'monkrobe', hair: 'bald', acc: 'none', hairColor: '#3a2a20', cloth: '#d98a2b', trim: '#8a3a1e', bg: ['#4a3420', '#1a120b'] },
    f: { outfit: 'monkrobe', hair: 'bald', acc: 'hood', hairColor: '#3a2a20', cloth: '#8a8a7a', trim: '#4a4a3a', bg: ['#3a3a30', '#141410'] } },
  { id: 'wx-master', label: '무협 · 장문인·장로', tags: ['장문인', '문주', '장로', '맹주', '사부', '스승', '태상장로', '가주', '세가', 'master', 'elder'],
    m: { outfit: 'hanfu', hair: 'topknot', acc: 'guan', hairColor: '#d8d8d8', cloth: '#4a2a5a', trim: '#d4a640', bg: ['#2a1d3a', '#0f0a16'], old: true },
    f: { outfit: 'hanfu', hair: 'bun', acc: 'hairpin', hairColor: '#cfcfcf', cloth: '#2a4a5a', trim: '#d4a640', bg: ['#1d2a3a', '#0a0f16'], old: true } },
  { id: 'wx-assassin', label: '무협 · 자객·살수', tags: ['자객', '살수', '암기', '하오문', '흑의', '복면', 'assassin'],
    m: { outfit: 'hanfu', hair: 'topknot', acc: 'mask', hairColor: '#111', cloth: '#22242a', trim: '#5a5a66', bg: ['#1a1c22', '#08090b'] },
    f: { outfit: 'hanfu', hair: 'ponytail', acc: 'mask', hairColor: '#111', cloth: '#2a2228', trim: '#7a3b4a', bg: ['#1f1a1f', '#0a080a'] } },
  { id: 'wx-demon', label: '무협 · 마두·마교', tags: ['마교', '마두', '교주', '사파', '흑도', '마인', '혈교', 'demonic cult'],
    m: { outfit: 'hanfu', hair: 'long', acc: 'guan', hairColor: '#0d0b0d', cloth: '#1a0c10', trim: '#b02a3a', bg: ['#3a0c14', '#0d0306'] },
    f: { outfit: 'hanfu', hair: 'long', acc: 'hairpin', hairColor: '#0d0b0d', cloth: '#2a0a14', trim: '#d03a4a', bg: ['#3a0c14', '#0d0306'] } },
  { id: 'wx-physician', label: '무협 · 의원·신의', tags: ['의원', '신의', '약선', '의녀', '약방', '당가', 'physician', 'healer'],
    m: { outfit: 'hanfu', hair: 'topknot', acc: 'none', hairColor: '#2a2420', cloth: '#3f6b55', trim: '#e0d6b0', bg: ['#2a3d33', '#0f1712'] },
    f: { outfit: 'hanfu', hair: 'bun', acc: 'hairpin', hairColor: '#2a1e1a', cloth: '#6a8a6a', trim: '#f0e6c8', bg: ['#2a3d33', '#0f1712'] } },
  { id: 'wx-commoner', label: '무협 · 점소이·백성', tags: ['점소이', '주모', '객잔', '백성', '농민', '장사꾼', '상인', '아이', 'commoner'],
    m: { outfit: 'tunic', hair: 'topknot', acc: 'headband', hairColor: '#2a201a', cloth: '#7a6a4a', trim: '#c8b088', bg: ['#4a4030', '#1a1610'] },
    f: { outfit: 'tunic', hair: 'braid', acc: 'headband', hairColor: '#2a1a14', cloth: '#9a5a4a', trim: '#e8d0a8', bg: ['#4a4030', '#1a1610'] } },
];

function characterSvg(s: CharSpec, gender: 'M' | 'F', variant: number): string {
  const skin = s.skin ?? SKIN[variant % SKIN.length]!;
  const F = gender === 'F';
  const sh = F ? 118 : 132; // 어깨 반폭
  const g: string[] = [];
  g.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.bg[0]}"/><stop offset="1" stop-color="${s.bg[1]}"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".42" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="cl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.cloth}"/><stop offset="1" stop-color="${shade(s.cloth, -0.35)}"/></linearGradient></defs>`);
  g.push(`<rect width="400" height="520" fill="url(#bg)"/><circle cx="200" cy="230" r="210" fill="url(#glow)"/>`);
  // 뒷머리
  if (s.hair === 'long' || (s.hair === 'braid' && F)) g.push(`<path d="M128 220 Q118 360 140 430 L260 430 Q282 360 272 220 Z" fill="${s.hairColor}"/>`);
  if (s.hair === 'ponytail') g.push(`<path d="M250 200 Q312 250 290 360 Q284 300 252 262 Z" fill="${s.hairColor}"/>`);
  // 몸
  const body = `M${200 - sh - 20} 520 C${200 - sh - 10} 430 ${200 - sh + 20} 395 200 392 C${200 + sh - 20} 395 ${200 + sh + 10} 430 ${200 + sh + 20} 520 Z`;
  g.push(`<rect x="178" y="300" width="44" height="80" rx="16" fill="${shade(skin, -0.12)}"/>`);
  g.push(`<path d="${body}" fill="url(#cl)"/>`);
  g.push(outfitDetail(s, sh, skin));
  // 머리
  g.push(`<ellipse cx="200" cy="245" rx="${F ? 58 : 62}" ry="${F ? 72 : 76}" fill="${skin}"/>`);
  g.push(`<ellipse cx="${F ? 143 : 139}" cy="252" rx="9" ry="15" fill="${shade(skin, -0.08)}"/><ellipse cx="${F ? 257 : 261}" cy="252" rx="9" ry="15" fill="${shade(skin, -0.08)}"/>`);
  // 얼굴 (간결하게)
  const eye = '#2a2228';
  g.push(`<ellipse cx="178" cy="252" rx="${F ? 6.5 : 6}" ry="${F ? 8 : 6.5}" fill="${eye}"/><ellipse cx="222" cy="252" rx="${F ? 6.5 : 6}" ry="${F ? 8 : 6.5}" fill="${eye}"/>`);
  g.push(`<circle cx="180" cy="249" r="2" fill="#fff" opacity=".8"/><circle cx="224" cy="249" r="2" fill="#fff" opacity=".8"/>`);
  g.push(`<path d="M164 ${F ? 234 : 232} q14 -6 28 0 M208 ${F ? 234 : 232} q14 -6 28 0" stroke="${shade(s.hairColor, -0.2)}" stroke-width="${F ? 2.5 : 4}" fill="none" stroke-linecap="round"/>`);
  g.push(`<path d="M190 292 q10 ${F ? 6 : 4} 20 0" stroke="#9a5a52" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  if (F) g.push(`<ellipse cx="166" cy="276" rx="10" ry="5" fill="#e88a8a" opacity=".25"/><ellipse cx="234" cy="276" rx="10" ry="5" fill="#e88a8a" opacity=".25"/>`);
  if (s.old) g.push(`<path d="M160 270 q8 6 16 0 M224 270 q8 6 16 0 M186 312 q14 6 28 0" stroke="${shade(skin, -0.25)}" stroke-width="2" fill="none"/>`);
  // 앞머리
  g.push(hairFront(s, F));
  g.push(accessory(s, F));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520">${g.join('')}</svg>`;
}

function hairFront(s: CharSpec, F: boolean): string {
  const c = s.hairColor;
  if (s.acc === 'helmet' || s.acc === 'hood') return '';
  switch (s.hair) {
    case 'topknot': return `<path d="M136 246 Q130 170 200 162 Q272 168 264 246 Q256 206 232 196 Q200 210 168 196 Q146 206 136 246 Z" fill="${c}"/><ellipse cx="200" cy="150" rx="22" ry="18" fill="${c}"/><rect x="186" y="160" width="28" height="7" rx="3" fill="${shade(s.trim, -0.1)}"/>`;
    case 'bald': if (s.outfit === 'monkrobe') return `<circle cx="183" cy="196" r="3" fill="${shade(c, 0.3)}" opacity=".5"/><circle cx="200" cy="190" r="3" fill="${shade(c, 0.3)}" opacity=".5"/><circle cx="217" cy="196" r="3" fill="${shade(c, 0.3)}" opacity=".5"/>`;
      return `<path d="M142 236 Q140 200 156 186 L150 240 Z M258 236 Q260 200 244 186 L250 240 Z" fill="${c}"/>`;
    case 'short': return `<path d="M136 246 Q130 168 200 160 Q272 166 264 246 Q258 206 236 196 Q214 214 170 204 Q150 214 136 246 Z" fill="${c}"/>`;
    case 'messy': return `<path d="M134 250 Q126 170 196 156 Q276 160 268 250 L256 214 L246 232 L238 200 L218 222 L206 196 L188 220 L176 198 L162 226 L150 210 Z" fill="${c}"/>`;
    case 'bun': return `<circle cx="200" cy="158" r="30" fill="${c}"/><path d="M140 250 Q132 174 200 166 Q268 174 260 250 Q252 200 200 196 Q150 200 140 250 Z" fill="${c}"/>`;
    case 'braid': return `<path d="M140 250 Q132 172 200 164 Q268 172 260 250 Q250 204 200 200 Q150 204 140 250 Z" fill="${c}"/>${F ? `<path d="M252 250 q30 40 10 90 q-6 30 4 60" stroke="${c}" stroke-width="20" fill="none" stroke-linecap="round"/>` : ''}`;
    case 'ponytail': return `<path d="M138 250 Q130 170 200 162 Q270 170 262 250 Q256 208 200 200 Q146 206 138 250 Z" fill="${c}"/>`;
    case 'long':
    default: return `<path d="M132 300 Q118 170 200 160 Q282 170 268 300 Q262 230 246 206 Q226 224 196 214 Q166 230 150 214 Q138 240 132 300 Z" fill="${c}"/>`;
  }
}

function accessory(s: CharSpec, F: boolean): string {
  const t = s.trim;
  switch (s.acc) {
    case 'crown': return `<path d="M150 178 L160 138 L180 164 L200 128 L220 164 L240 138 L250 178 Z" fill="#d4a640" stroke="#8a6a1e" stroke-width="3"/><circle cx="200" cy="150" r="6" fill="#c0303a"/>`;
    case 'tiara': return `<path d="M156 186 Q200 150 244 186 Q200 172 156 186 Z" fill="#e8e8f0"/><circle cx="200" cy="168" r="6" fill="#7fb6ff"/>`;
    case 'helmet': return `<path d="M132 252 Q128 156 200 150 Q272 156 268 252 L250 252 Q250 214 200 210 Q150 214 150 252 Z" fill="#8a929c" stroke="#5a626c" stroke-width="3"/><rect x="194" y="150" width="12" height="70" fill="#6a727c"/>`;
    case 'hood': return `<path d="M120 330 Q112 150 200 138 Q288 150 280 330 L258 330 Q262 214 200 206 Q138 214 142 330 Z" fill="${shade(s.cloth, -0.15)}"/>`;
    case 'hat': return `<ellipse cx="200" cy="178" rx="96" ry="18" fill="#4a3020"/><path d="M150 178 Q152 126 200 124 Q248 126 250 178 Z" fill="#5a3a26"/><rect x="152" y="160" width="96" height="10" fill="${t}"/>`;
    case 'witchhat': return `<ellipse cx="200" cy="184" rx="104" ry="20" fill="${shade(s.cloth, -0.2)}"/><path d="M146 184 Q170 120 210 60 Q230 40 250 54 Q222 70 230 120 L254 184 Z" fill="${shade(s.cloth, -0.1)}"/><rect x="150" y="166" width="100" height="10" fill="${t}"/>`;
    case 'glasses': return `<circle cx="178" cy="252" r="15" fill="none" stroke="#3a3a3a" stroke-width="3"/><circle cx="222" cy="252" r="15" fill="none" stroke="#3a3a3a" stroke-width="3"/><path d="M193 252 h14" stroke="#3a3a3a" stroke-width="3"/>`;
    case 'veil': return `<path d="M128 340 Q116 160 200 150 Q284 160 272 340 L256 340 Q262 220 200 200 Q138 220 144 340 Z" fill="#f6f4ee" opacity=".92"/><rect x="150" y="190" width="100" height="8" fill="${t}"/>`;
    case 'horns': return `<path d="M154 190 Q120 150 132 110 Q140 150 170 176 Z M246 190 Q280 150 268 110 Q260 150 230 176 Z" fill="#2a2228" stroke="${t}" stroke-width="2"/>`;
    case 'hairpin': return `<ellipse cx="200" cy="158" rx="26" ry="20" fill="${s.hairColor}"/><path d="M160 150 L246 140" stroke="${t}" stroke-width="5" stroke-linecap="round"/><circle cx="160" cy="150" r="6" fill="${t}"/><path d="M160 156 l-6 22 M166 156 l-2 18" stroke="${t}" stroke-width="2"/>`;
    case 'guan': return `<path d="M178 166 L180 136 L220 136 L222 166 Z" fill="#1e1a18" stroke="${t}" stroke-width="3"/><path d="M168 150 L232 150" stroke="${t}" stroke-width="4"/>`;
    case 'mask': return `<path d="M144 262 Q200 250 256 262 L250 318 Q200 340 150 318 Z" fill="${shade(s.cloth, -0.1)}"/>`;
    case 'headband': return F ? `<path d="M148 196 Q200 172 252 196" stroke="${t}" stroke-width="10" fill="none"/>` : '';
    default: return '';
  }
}

function outfitDetail(s: CharSpec, sh: number, skin: string): string {
  const t = s.trim, c = s.cloth;
  switch (s.outfit) {
    case 'royal': return `<path d="M${200 - sh - 18} 520 Q${200 - sh} 420 ${200 - sh + 30} 404 L200 440 L${200 + sh - 30} 404 Q${200 + sh} 420 ${200 + sh + 18} 520 Z" fill="${shade(c, 0.1)}"/><path d="M${200 - sh + 10} 410 Q200 470 ${200 + sh - 10} 410" stroke="#f2efe6" stroke-width="22" fill="none"/><path d="M200 400 L200 520" stroke="${t}" stroke-width="6"/><circle cx="200" cy="452" r="10" fill="${t}"/>`;
    case 'dress': return `<path d="M150 400 Q200 446 250 400 L250 392 Q200 420 150 392 Z" fill="${skin}"/><path d="M146 402 Q200 452 254 402" stroke="${t}" stroke-width="6" fill="none"/><circle cx="200" cy="430" r="7" fill="${t}"/>`;
    case 'suit': return `<path d="M176 392 L200 470 L224 392 Z" fill="#f2f2f2"/><path d="M164 396 L200 470 L190 520 L150 520 Z M236 396 L200 470 L210 520 L250 520 Z" fill="${shade(c, -0.15)}"/><path d="M192 404 L200 420 L208 404 Z" fill="${t}"/>`;
    case 'butler': return `<path d="M176 392 L200 470 L224 392 Z" fill="${t}"/><path d="M186 400 L200 412 L214 400 L200 406 Z" fill="#111"/><path d="M164 396 L200 470 L196 520 L150 520 Z M236 396 L200 470 L204 520 L250 520 Z" fill="${shade(c, 0.1)}"/>`;
    case 'maid': return `<path d="M168 394 Q200 420 232 394 L240 410 Q200 440 160 410 Z" fill="${t}"/><path d="M160 440 L240 440 L250 520 L150 520 Z" fill="${t}"/><circle cx="200" cy="412" r="6" fill="#b03a4a"/>`;
    case 'armor': return `<ellipse cx="${200 - sh + 10}" cy="420" rx="40" ry="28" fill="${shade(c, 0.15)}" stroke="${shade(c, -0.3)}" stroke-width="3"/><ellipse cx="${200 + sh - 10}" cy="420" rx="40" ry="28" fill="${shade(c, 0.15)}" stroke="${shade(c, -0.3)}" stroke-width="3"/><path d="M160 410 Q200 400 240 410 L232 520 L168 520 Z" fill="${shade(c, 0.05)}" stroke="${shade(c, -0.3)}" stroke-width="3"/><path d="M200 414 L200 520" stroke="${shade(c, -0.3)}" stroke-width="3"/><path d="M168 460 L232 460" stroke="${t}" stroke-width="8"/>`;
    case 'robe': return `<path d="M172 392 L200 450 L228 392" stroke="${t}" stroke-width="8" fill="none"/><path d="M200 450 L200 520" stroke="${t}" stroke-width="6"/>`;
    case 'priest': return `<path d="M168 396 L186 520 M232 396 L214 520" stroke="${t}" stroke-width="14"/><path d="M176 392 Q200 410 224 392" stroke="${t}" stroke-width="6" fill="none"/><path d="M200 440 v34 M186 452 h28" stroke="${t}" stroke-width="5"/>`;
    case 'tunic': return `<path d="M180 394 L200 424 L220 394" stroke="${t}" stroke-width="5" fill="none"/><path d="M150 480 L250 480" stroke="${shade(c, -0.3)}" stroke-width="10"/>`;
    case 'leather': return `<path d="M${200 - sh} 470 Q200 404 ${200 + sh} 470" stroke="${t}" stroke-width="26" fill="none" opacity=".9"/><path d="M150 400 L250 500" stroke="#3a2a1a" stroke-width="10"/>`;
    case 'dark': return `<path d="M${200 - sh - 20} 520 Q200 380 ${200 + sh + 20} 520" fill="${shade(c, -0.1)}"/><path d="M170 398 Q200 420 230 398" stroke="${t}" stroke-width="4" fill="none"/>`;
    case 'uniform': return `<path d="M${200 - sh + 4} 404 h34 M${200 + sh - 38} 404 h34" stroke="${t}" stroke-width="10"/><path d="M200 400 L200 520" stroke="${shade(c, -0.2)}" stroke-width="3"/><circle cx="212" cy="430" r="4" fill="${t}"/><circle cx="212" cy="456" r="4" fill="${t}"/><circle cx="212" cy="482" r="4" fill="${t}"/><path d="M150 420 Q170 470 160 510" stroke="${t}" stroke-width="4" fill="none"/>`;
    case 'hanfu': return `<path d="M${200 - sh + 8} 404 Q200 396 ${200 + sh - 8} 404 L${200 + sh + 10} 520 L${200 - sh - 10} 520 Z" fill="${shade(c, 0.06)}"/><path d="M166 394 L222 470" stroke="${t}" stroke-width="12" stroke-linecap="round"/><path d="M234 394 L200 446" stroke="${shade(t, -0.2)}" stroke-width="10" stroke-linecap="round"/><rect x="${200 - sh + 20}" y="474" width="${2 * sh - 40}" height="18" fill="${t}"/><path d="M200 492 l-8 28 M206 492 l8 28" stroke="${shade(t, -0.25)}" stroke-width="5"/>`;
    case 'monkrobe': return `<path d="M${200 - sh} 430 L${200 + sh - 10} 520" stroke="${t}" stroke-width="34" opacity=".85"/>${Array.from({ length: 11 }, (_, i) => `<circle cx="${160 + i * 8}" cy="${410 + Math.sin(i / 10 * Math.PI) * 26}" r="5" fill="#5a2a14"/>`).join('')}`;
    case 'vest': return `<path d="M176 392 L200 440 L224 392 Z" fill="#efe6d2"/><path d="M164 396 L196 520 L150 520 Z M236 396 L204 520 L250 520 Z" fill="${shade(c, 0.12)}"/><circle cx="212" cy="470" r="4" fill="${t}"/>`;
  }
}

// ---------------------------------------------------------------- 장소

interface SceneSpec { id: string; label: string; tags: string[]; sky: [string, string]; draw: (r: () => number) => string }

const rngOf = (seed: string) => { let h = 2166136261; for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };

const hills = (y: number, amp: number, color: string, r: () => number, n = 6) => {
  let d = `M0 400 L0 ${y}`;
  for (let i = 0; i <= n; i++) { const x = (640 / n) * i; d += ` Q${x - 320 / n} ${y - amp * (0.4 + r())} ${x} ${y + (r() - 0.5) * amp * 0.4}`; }
  return `<path d="${d} L640 400 Z" fill="${color}"/>`;
};
const trees = (y: number, color: string, r: () => number, n = 14, h = 70) => Array.from({ length: n }, (_, i) => {
  const x = (i + r() * 0.8) * (640 / n), hh = h * (0.6 + r() * 0.6);
  return `<path d="M${x} ${y - hh} L${x - hh * 0.32} ${y} L${x + hh * 0.32} ${y} Z" fill="${color}"/>`;
}).join('');
const stars = (r: () => number, n = 40) => Array.from({ length: n }, () => `<circle cx="${(r() * 640).toFixed(0)}" cy="${(r() * 180).toFixed(0)}" r="${(r() * 1.4 + 0.3).toFixed(1)}" fill="#fff" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`).join('');
const columns = (color: string, n = 6, top = 60) => Array.from({ length: n }, (_, i) => { const x = 40 + i * (560 / (n - 1)); return `<rect x="${x - 16}" y="${top}" width="32" height="${360 - top}" fill="${color}"/><rect x="${x - 24}" y="${top - 10}" width="48" height="14" fill="${shade(color, 0.15)}"/>`; }).join('');
const windows = (y: number, color: string, n = 5, w = 46, h = 110) => Array.from({ length: n }, (_, i) => { const x = 70 + i * (500 / (n - 1)); return `<path d="M${x - w / 2} ${y + h} L${x - w / 2} ${y + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w / 2} ${y + w / 2} L${x + w / 2} ${y + h} Z" fill="${color}"/>`; }).join('');
const castle = (x: number, base: number, s: number, color: string) => `<g fill="${color}"><rect x="${x - 60 * s}" y="${base - 90 * s}" width="${120 * s}" height="${90 * s}"/><rect x="${x - 90 * s}" y="${base - 140 * s}" width="${30 * s}" height="${140 * s}"/><rect x="${x + 60 * s}" y="${base - 140 * s}" width="${30 * s}" height="${140 * s}"/><path d="M${x - 95 * s} ${base - 140 * s} L${x - 75 * s} ${base - 180 * s} L${x - 55 * s} ${base - 140 * s} Z M${x + 55 * s} ${base - 140 * s} L${x + 75 * s} ${base - 180 * s} L${x + 95 * s} ${base - 140 * s} Z"/><rect x="${x - 18 * s}" y="${base - 170 * s}" width="${36 * s}" height="${80 * s}"/><path d="M${x - 24 * s} ${base - 170 * s} L${x} ${base - 220 * s} L${x + 24 * s} ${base - 170 * s} Z"/></g>`;
const houses = (y: number, color: string, light: string, r: () => number, n = 7) => Array.from({ length: n }, (_, i) => {
  const w = 60 + r() * 30, h = 50 + r() * 50, x = i * (640 / n) + r() * 20;
  return `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="${color}"/><path d="M${x - 6} ${y - h} L${x + w / 2} ${y - h - 30} L${x + w + 6} ${y - h} Z" fill="${shade(color, -0.2)}"/><rect x="${x + w * 0.3}" y="${y - h * 0.7}" width="12" height="14" fill="${light}"/>`;
}).join('');

const SCENES: SceneSpec[] = [
  { id: 'throne', label: '알현실·왕좌', tags: ['알현실', '왕좌', '옥좌', '대전', '접견실', 'throne', 'audience hall', 'court'], sky: ['#3a1d24', '#120a0c'],
    draw: () => `${columns('#4a2a30', 6, 50)}<rect x="0" y="330" width="640" height="70" fill="#2a1418"/><path d="M290 400 L300 260 L340 260 L350 400 Z" fill="#7a1e2a"/><path d="M280 270 Q320 160 360 270 Z" fill="#d4a640"/><rect x="292" y="268" width="56" height="62" fill="#5a1620" stroke="#d4a640" stroke-width="4"/><path d="M200 400 L300 330 L340 330 L440 400 Z" fill="#8a1e2c" opacity=".8"/>` },
  { id: 'palace-hall', label: '궁전 복도·대회랑', tags: ['궁전', '황궁', '왕궁', '복도', '회랑', '홀', '궁', 'palace', 'hall', 'corridor'], sky: ['#3b3426', '#16130d'],
    draw: () => `${windows(70, '#f2d890', 5, 60, 160)}${columns('#5a4a36', 5, 40)}<rect x="0" y="330" width="640" height="70" fill="#2e261a"/><path d="M220 400 L300 330 L340 330 L420 400 Z" fill="#7a2a2a" opacity=".7"/>` },
  { id: 'bedchamber', label: '침실', tags: ['침실', '침전', '방', '숙소', '객실', 'bedroom', 'bedchamber', 'room'], sky: ['#2c2433', '#120e16'],
    draw: () => `<rect x="420" y="70" width="140" height="180" fill="#3a4a6a"/><path d="M420 70 h140 v180 h-140 Z" fill="none" stroke="#c9a86a" stroke-width="8"/><circle cx="500" cy="120" r="22" fill="#f4f0d8" opacity=".9"/><path d="M60 250 Q160 160 260 250 L260 330 L60 330 Z" fill="#6a2a3a"/><rect x="60" y="270" width="230" height="80" rx="10" fill="#e8e0d4"/><rect x="60" y="300" width="230" height="60" fill="#7a3a4a"/><rect x="0" y="350" width="640" height="50" fill="#2a1e1a"/>` },
  { id: 'study', label: '집무실·서재', tags: ['집무실', '서재', '사무실', '집무', '서류', '서고', 'study', 'office', 'library'], sky: ['#2e281e', '#12100b'],
    draw: (r) => `${Array.from({ length: 4 }, (_, row) => Array.from({ length: 16 }, (_, i) => `<rect x="${20 + i * 18}" y="${60 + row * 60}" width="${12 + r() * 4}" height="${44 + r() * 8}" fill="${['#6a2a2a', '#2a4a6a', '#4a5a2a', '#7a5a2a'][(i + row) % 4]}"/>`).join('')).join('')}<rect x="10" y="50" width="310" height="250" fill="none" stroke="#4a3420" stroke-width="10"/><rect x="380" y="90" width="200" height="130" fill="#d8c48a" opacity=".25"/><rect x="340" y="260" width="280" height="24" fill="#5a3a22"/><rect x="360" y="284" width="20" height="80" fill="#4a2e1a"/><rect x="580" y="284" width="20" height="80" fill="#4a2e1a"/><rect x="420" y="240" width="60" height="20" fill="#f0e8d0"/><rect x="0" y="360" width="640" height="40" fill="#1e150e"/>` },
  { id: 'garden', label: '정원', tags: ['정원', '장미', '화원', '온실', '뜰', 'garden', 'rose', 'greenhouse'], sky: ['#8fb8d8', '#e8d8b0'],
    draw: (r) => `${hills(260, 40, '#6a9a5a', r)}${trees(270, '#3a6a3a', r, 10, 90)}<rect x="0" y="300" width="640" height="100" fill="#5a8a4a"/><path d="M260 400 Q320 300 380 400 Z" fill="#d8c8a0"/>${Array.from({ length: 30 }, () => `<circle cx="${(r() * 640).toFixed(0)}" cy="${(300 + r() * 90).toFixed(0)}" r="${(4 + r() * 5).toFixed(1)}" fill="${['#d83a4a', '#f08aa0', '#f4e0e8'][Math.floor(r() * 3)]}"/>`).join('')}<path d="M300 300 L300 230 Q320 200 340 230 L340 300" stroke="#f0ece0" stroke-width="8" fill="none"/>` },
  { id: 'ballroom', label: '연회장·무도회장', tags: ['연회', '연회장', '무도회', '파티', '만찬', '축제', '사교', 'ballroom', 'banquet', 'party', 'feast'], sky: ['#4a3a20', '#1a1208'],
    draw: (r) => `${windows(60, '#ffe6a0', 5, 70, 170)}<rect x="0" y="320" width="640" height="80" fill="#3a2a14"/>${Array.from({ length: 3 }, (_, i) => `<g transform="translate(${160 + i * 160} 40)"><path d="M-40 0 h80 l-10 40 h-60 Z" fill="#d4a640"/>${Array.from({ length: 9 }, (_, k) => `<circle cx="${-36 + k * 9}" cy="44" r="3" fill="#fff6c8"/>`).join('')}</g>`).join('')}${Array.from({ length: 10 }, () => { const x = r() * 600 + 20; return `<path d="M${x} 400 L${x + 10} 330 L${x + 20} 400 Z" fill="${['#7a2a4a', '#2a3a6a', '#d8c8a0'][Math.floor(r() * 3)]}"/><circle cx="${x + 10}" cy="322" r="8" fill="#2a1e14"/>`; }).join('')}` },
  { id: 'temple', label: '신전·교회', tags: ['신전', '교회', '성당', '예배당', '제단', '교단', '사원', 'temple', 'church', 'cathedral', 'shrine', 'altar'], sky: ['#e8e0c8', '#a89a78'],
    draw: () => `${columns('#d8d0b8', 6, 80)}<path d="M120 80 L320 10 L520 80 Z" fill="#c8c0a8"/><circle cx="320" cy="130" r="50" fill="#f6e8a0" opacity=".8"/><path d="M320 90 v80 M290 120 h60" stroke="#d4a640" stroke-width="8"/><rect x="0" y="330" width="640" height="70" fill="#b8b098"/><rect x="270" y="280" width="100" height="50" fill="#e8e0c8"/>` },
  { id: 'castle', label: '성·궁 외관', tags: ['성', '성채', '요새', '궁 외관', '성문', '외관', 'castle', 'fortress', 'gate'], sky: ['#f0a070', '#5a3a6a'],
    draw: (r) => `${hills(280, 50, '#4a3a5a', r)}${castle(320, 300, 1.3, '#2a2236')}<rect x="0" y="300" width="640" height="100" fill="#2a2a3a"/><path d="M290 400 L310 300 L330 300 L350 400 Z" fill="#6a5a4a"/>` },
  { id: 'town', label: '도시 거리·시장', tags: ['거리', '도시', '수도', '시장', '광장', '시내', '번화가', 'town', 'city', 'market', 'street', 'plaza', 'capital'], sky: ['#9ac0e0', '#f0e0c0'],
    draw: (r) => `${castle(520, 220, 0.7, '#8a96a8')}${houses(320, '#b88a6a', '#f8e0a0', r, 8)}<rect x="0" y="320" width="640" height="80" fill="#a89878"/>${Array.from({ length: 5 }, (_, i) => `<path d="M${40 + i * 120} 320 l20 -40 h60 l20 40 Z" fill="${['#c83a3a', '#3a6ac8', '#e8b83a', '#3a9a5a', '#8a3ac8'][i]}"/>`).join('')}` },
  { id: 'tavern', label: '선술집·여관', tags: ['선술집', '여관', '주점', '술집', '식당', 'tavern', 'inn', 'pub'], sky: ['#3a2410', '#140a04'],
    draw: () => `<rect x="0" y="0" width="640" height="40" fill="#2a1808"/>${[100, 300, 500].map((x) => `<rect x="${x - 8}" y="0" width="16" height="400" fill="#2a1808"/>`).join('')}<circle cx="560" cy="200" r="70" fill="#f0902a" opacity=".35"/><rect x="510" y="200" width="100" height="120" fill="#2a1808"/><path d="M530 320 Q560 230 590 320 Z" fill="#f0a030"/><rect x="60" y="270" width="380" height="20" fill="#6a3a1a"/><rect x="80" y="290" width="16" height="70" fill="#4a2810"/><rect x="400" y="290" width="16" height="70" fill="#4a2810"/>${[120, 200, 300].map((x) => `<rect x="${x}" y="246" width="22" height="26" rx="4" fill="#d8a040"/>`).join('')}<rect x="0" y="360" width="640" height="40" fill="#1e1006"/>` },
  { id: 'village', label: '마을·시골', tags: ['마을', '시골', '농촌', '촌락', '영지', 'village', 'countryside', 'farm', 'hamlet'], sky: ['#a8d0e8', '#f8e8c8'],
    draw: (r) => `${hills(250, 60, '#8ab070', r)}${trees(260, '#4a7a4a', r, 8, 60)}${houses(330, '#c89a6a', '#3a2a1a', r, 5)}<rect x="0" y="330" width="640" height="70" fill="#9ab070"/><path d="M0 380 Q320 340 640 390" stroke="#c8b088" stroke-width="20" fill="none"/>` },
  { id: 'forest', label: '숲', tags: ['숲', '삼림', '수풀', '산림', '나무', 'forest', 'woods', 'grove'], sky: ['#6a9a7a', '#1a2a1e'],
    draw: (r) => `${trees(240, '#2a4a34', r, 18, 160)}${trees(300, '#1e3a28', r, 14, 200)}${trees(380, '#12261a', r, 10, 240)}<rect x="0" y="370" width="640" height="30" fill="#0e1a12"/>${Array.from({ length: 6 }, () => `<path d="M${r() * 640} 0 l${-30 + r() * 20} 400" stroke="#f0f8d0" stroke-width="${10 + r() * 20}" opacity=".06"/>`).join('')}` },
  { id: 'mountain', label: '산·고원', tags: ['산', '산맥', '고원', '절벽', '봉우리', '설산', 'mountain', 'peak', 'cliff', 'highland'], sky: ['#b8d0e8', '#e8eef4'],
    draw: (r) => `<path d="M0 300 L120 120 L200 220 L320 60 L440 220 L520 140 L640 280 L640 400 L0 400 Z" fill="#7a8a9a"/><path d="M280 116 L320 60 L360 116 L340 108 L320 124 L300 106 Z M100 150 L120 120 L140 150 Z" fill="#f4f8fc"/>${hills(320, 40, '#5a7a5a', r)}${trees(340, '#3a5a3a', r, 12, 50)}` },
  { id: 'harbor', label: '항구·바다', tags: ['항구', '바다', '해안', '부두', '해변', '호수', '강', 'harbor', 'port', 'sea', 'coast', 'lake', 'river'], sky: ['#f0b070', '#6a7ab0'],
    draw: (r) => `<circle cx="480" cy="230" r="40" fill="#f8d890" opacity=".9"/><rect x="0" y="240" width="640" height="160" fill="#3a5a8a"/>${Array.from({ length: 12 }, () => `<path d="M${r() * 640} ${250 + r() * 140} q20 -6 40 0" stroke="#a8c0e0" stroke-width="2" fill="none"/>`).join('')}<path d="M120 300 L220 300 L200 320 L140 320 Z" fill="#4a2a1a"/><path d="M170 300 L170 210 L230 290 Z" fill="#f0ece0"/><rect x="0" y="320" width="260" height="20" fill="#5a3a22"/>${houses(260, '#8a6a5a', '#f8e0a0', r, 3)}` },
  { id: 'cave', label: '동굴·지하 던전', tags: ['동굴', '던전', '지하', '지하실', '굴', '광산', '하수도', 'cave', 'dungeon', 'underground', 'cellar', 'mine'], sky: ['#1a1614', '#060504'],
    draw: (r) => `<path d="M0 0 L640 0 L640 400 L0 400 Z M120 400 Q100 160 320 120 Q540 160 520 400 Z" fill="#2a2420" fill-rule="evenodd"/>${Array.from({ length: 10 }, () => { const x = r() * 640; return `<path d="M${x} 0 L${x + 10} ${40 + r() * 60} L${x + 20} 0 Z" fill="#3a322c"/>`; }).join('')}<circle cx="320" cy="300" r="60" fill="#f08a2a" opacity=".25"/><path d="M310 330 L320 290 L330 330 Z" fill="#f0a030"/><rect x="0" y="360" width="640" height="40" fill="#1a1412"/>` },
  { id: 'ruins', label: '폐허·유적', tags: ['폐허', '유적', '잔해', '무너진', '고대', 'ruins', 'ancient', 'remains'], sky: ['#c8a888', '#5a4a4a'],
    draw: (r) => `${hills(300, 30, '#7a6a5a', r)}<rect x="100" y="140" width="40" height="200" fill="#9a8a7a"/><rect x="220" y="200" width="40" height="140" fill="#9a8a7a"/><rect x="420" y="120" width="40" height="220" fill="#9a8a7a"/><rect x="90" y="130" width="200" height="20" fill="#aa9a8a" transform="rotate(6 190 140)"/><path d="M500 340 L540 300 L600 320 L620 340 Z" fill="#8a7a6a"/><rect x="0" y="340" width="640" height="60" fill="#6a5a4a"/>` },
  { id: 'battlefield', label: '전장·벌판', tags: ['전장', '전쟁', '벌판', '평원', '들판', '초원', '훈련장', 'battlefield', 'war', 'plain', 'field', 'training ground'], sky: ['#c86a3a', '#3a2a2a'],
    draw: (r) => `${hills(300, 30, '#4a3a2a', r, 8)}<rect x="0" y="320" width="640" height="80" fill="#3a2a1e"/>${Array.from({ length: 8 }, () => { const x = r() * 620; return `<path d="M${x} 330 L${x} ${240 - r() * 40}" stroke="#2a1e14" stroke-width="3"/><path d="M${x} ${240 - r() * 20} l30 8 l-30 8 Z" fill="${['#8a1e1e', '#1e3a8a'][Math.floor(r() * 2)]}"/>`; }).join('')}<circle cx="120" cy="120" r="40" fill="#f8b070" opacity=".6"/>` },
  { id: 'night-city', label: '밤거리·뒷골목', tags: ['밤', '뒷골목', '골목', '빈민가', '밤거리', '야경', 'night', 'alley', 'slum', 'back street'], sky: ['#1a1e3a', '#06070e'],
    draw: (r) => `${stars(r)}<circle cx="520" cy="80" r="28" fill="#f4f0d8"/>${houses(330, '#1e2236', '#f8c860', r, 8)}<rect x="0" y="330" width="640" height="70" fill="#14162a"/><rect x="300" y="250" width="8" height="80" fill="#2a2a3a"/><circle cx="304" cy="246" r="14" fill="#f8d880" opacity=".8"/>` },
  { id: 'prison', label: '감옥·지하 감옥', tags: ['감옥', '감금', '지하감옥', '독방', '옥', 'prison', 'jail', 'cell'], sky: ['#2a2a2e', '#0e0e10'],
    draw: () => `${Array.from({ length: 9 }, (_, row) => Array.from({ length: 10 }, (_, i) => `<rect x="${i * 66 + (row % 2) * 33 - 20}" y="${row * 40}" width="62" height="36" fill="#34343a"/>`).join('')).join('')}<rect x="400" y="80" width="90" height="70" fill="#5a6a8a" opacity=".6"/>${[0, 1, 2, 3].map((k) => `<rect x="${410 + k * 22}" y="80" width="6" height="70" fill="#1a1a1e"/>`).join('')}${Array.from({ length: 10 }, (_, i) => `<rect x="${40 + i * 30}" y="60" width="8" height="300" fill="#4a4a52"/>`).join('')}<rect x="0" y="360" width="640" height="40" fill="#1a1a1e"/>` },
  { id: 'desert', label: '사막', tags: ['사막', '모래', '황야', '오아시스', 'desert', 'sand', 'wasteland', 'oasis'], sky: ['#f0c070', '#f8e8c0'],
    draw: (r) => `<circle cx="480" cy="110" r="44" fill="#fff4c8"/>${hills(260, 50, '#d8a860', r, 5)}${hills(320, 40, '#c89048', r, 4)}<rect x="0" y="360" width="640" height="40" fill="#b88040"/>` },
  { id: 'snow', label: '설원·겨울', tags: ['설원', '눈', '겨울', '얼음', '북부', '빙하', 'snow', 'winter', 'ice', 'north', 'tundra'], sky: ['#c8d8e8', '#f4f8fc'],
    draw: (r) => `${hills(250, 50, '#e8eef4', r)}${trees(300, '#4a6a7a', r, 12, 80)}<rect x="0" y="310" width="640" height="90" fill="#f4f8fc"/>${Array.from({ length: 60 }, () => `<circle cx="${(r() * 640).toFixed(0)}" cy="${(r() * 400).toFixed(0)}" r="${(1 + r() * 2).toFixed(1)}" fill="#fff" opacity=".8"/>`).join('')}` },
  // ---- 무협 장소
  { id: 'wx-inn', label: '무협 · 객잔', tags: ['객잔', '주루', '주점', '반점', '여각', 'inn'], sky: ['#3a2010', '#120804'],
    draw: () => `<rect x="0" y="0" width="640" height="60" fill="#2a1408"/>${[60, 200, 340, 480, 600].map((x) => `<rect x="${x - 7}" y="0" width="14" height="400" fill="#3a1e0c"/>`).join('')}${[130, 270, 410, 540].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="70" stroke="#2a1408" stroke-width="2"/><ellipse cx="${x}" cy="92" rx="18" ry="24" fill="#c8302a"/><ellipse cx="${x}" cy="92" rx="10" ry="18" fill="#f0a040" opacity=".6"/>`).join('')}<rect x="80" y="280" width="200" height="16" fill="#6a3a18"/><rect x="100" y="296" width="12" height="70" fill="#4a2810"/><rect x="250" y="296" width="12" height="70" fill="#4a2810"/><rect x="380" y="290" width="200" height="16" fill="#6a3a18"/>${[130, 170, 210].map((x) => `<ellipse cx="${x}" cy="270" rx="12" ry="14" fill="#8a6a40"/><rect x="${x - 5}" y="252" width="10" height="6" fill="#3a2a1a"/>`).join('')}<rect x="0" y="360" width="640" height="40" fill="#1e0e04"/>` },
  { id: 'wx-bamboo', label: '무협 · 대나무 숲', tags: ['죽림', '대나무', '숲', '산길', 'bamboo', 'forest'], sky: ['#cfe0c0', '#5a7a4a'],
    draw: (r) => `${Array.from({ length: 26 }, () => { const x = r() * 640, w = 6 + r() * 10, c = ['#4a7a3a', '#3a6a2e', '#5a8a44', '#2e5a26'][Math.floor(r() * 4)]; return `<rect x="${x}" y="0" width="${w}" height="400" fill="${c}"/>${Array.from({ length: 6 }, (_, k) => `<rect x="${x - 1}" y="${40 + k * 60 + r() * 20}" width="${w + 2}" height="3" fill="#2a4a1e"/>`).join('')}<path d="M${x + w} ${80 + r() * 200} q30 -10 46 6 q-26 2 -46 -6 Z" fill="#6a9a4a"/>`; }).join('')}<rect x="0" y="0" width="640" height="400" fill="#e8f0e0" opacity=".18"/><path d="M220 400 Q320 300 420 400 Z" fill="#8a7a5a" opacity=".6"/>` },
  { id: 'wx-sect', label: '무협 · 문파 연무장', tags: ['문파', '연무장', '전각', '본산', '무관', '도관', '사원', '세가', 'sect', 'martial hall'], sky: ['#e8d0a0', '#a07040'],
    draw: () => `<path d="M60 150 Q320 110 580 150 L540 160 L100 160 Z" fill="#2a2a2e"/><path d="M40 150 Q50 140 70 138 M600 150 Q590 140 570 138" stroke="#2a2a2e" stroke-width="8"/><rect x="120" y="160" width="400" height="120" fill="#8a2a1e"/>${[150, 230, 310, 390, 470].map((x) => `<rect x="${x}" y="170" width="40" height="110" fill="#5a1a12"/><rect x="${x + 6}" y="180" width="28" height="70" fill="#d8b070" opacity=".5"/>`).join('')}<rect x="280" y="128" width="80" height="22" fill="#1a1410" stroke="#d4a640" stroke-width="2"/><rect x="0" y="280" width="640" height="120" fill="#b8a888"/>${Array.from({ length: 8 }, (_, i) => `<line x1="${i * 90}" y1="280" x2="${i * 90 - 60}" y2="400" stroke="#9a8a6a" stroke-width="2"/>`).join('')}<rect x="40" y="250" width="8" height="70" fill="#4a2a14"/><path d="M30 250 h28 M34 262 h20" stroke="#aaa" stroke-width="3"/>` },
  { id: 'wx-pavilion', label: '무협 · 산중 정자·절벽', tags: ['정자', '절벽', '산', '봉우리', '은거', '폭포', '화산', '무당', '아미', 'mountain', 'pavilion'], sky: ['#f0e8e0', '#a8b8c8'],
    draw: (r) => `<path d="M0 260 L80 120 L140 200 L220 60 L300 200 L380 110 L460 220 L540 90 L640 210 L640 400 L0 400 Z" fill="#7a8a98" opacity=".7"/><path d="M0 300 L120 200 L200 260 L320 170 L420 270 L520 210 L640 280 L640 400 L0 400 Z" fill="#5a6a72"/>${Array.from({ length: 5 }, () => `<ellipse cx="${r() * 640}" cy="${220 + r() * 120}" rx="${80 + r() * 80}" ry="14" fill="#fff" opacity=".45"/>`).join('')}<path d="M420 400 L440 250 L520 250 L560 400 Z" fill="#3a4248"/><rect x="450" y="200" width="6" height="50" fill="#5a1a12"/><rect x="504" y="200" width="6" height="50" fill="#5a1a12"/><path d="M430 202 Q480 170 530 202 L520 208 L440 208 Z" fill="#2a2a2e"/><path d="M426 204 l-8 -10 M534 204 l8 -10" stroke="#2a2a2e" stroke-width="5"/>${Array.from({ length: 4 }, (_, i) => `<path d="M${40 + i * 30} 400 q-10 -60 6 -110" stroke="#2a3a24" stroke-width="5" fill="none"/>`).join('')}` },
  { id: 'wx-town', label: '무협 · 저잣거리·나루', tags: ['저잣거리', '시장', '마을', '나루', '강', '포구', '현성', '성시', 'town', 'river'], sky: ['#f0d8b0', '#a0b8c8'],
    draw: (r) => `<rect x="0" y="250" width="640" height="150" fill="#6a8aa0"/>${Array.from({ length: 10 }, () => `<path d="M${r() * 640} ${270 + r() * 120} q20 -5 40 0" stroke="#a8c0d0" stroke-width="2" fill="none"/>`).join('')}<path d="M380 330 Q440 350 500 330 L490 345 Q440 360 390 345 Z" fill="#4a2a14"/><path d="M440 330 L440 270" stroke="#4a2a14" stroke-width="3"/><path d="M440 272 L470 300 L440 300 Z" fill="#d8c8a0"/>${Array.from({ length: 6 }, (_, i) => { const x = i * 110 - 10, h = 60 + r() * 40; return `<rect x="${x}" y="${250 - h}" width="96" height="${h}" fill="#c8a878"/><path d="M${x - 12} ${250 - h} Q${x + 48} ${232 - h} ${x + 108} ${250 - h} L${x + 98} ${258 - h} L${x - 2} ${258 - h} Z" fill="#2a2a2e"/><rect x="${x + 36}" y="${250 - h * 0.6}" width="24" height="${h * 0.6}" fill="#5a3a1e"/><rect x="${x + 10}" y="${250 - h * 0.8}" width="16" height="22" fill="#c8302a"/>`; }).join('')}` },
];

function sceneSvg(s: SceneSpec): string {
  const r = rngOf(s.id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/></linearGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient></defs>
<rect width="640" height="400" fill="url(#sky)"/>${s.draw(r)}<rect width="640" height="400" fill="url(#vig)"/></svg>`;
}

// ---------------------------------------------------------------- 공용

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

/** 기본 이미지 목록 (인물 = 원형 × 성별, 장소) */
export const STOCK_ART: StockArt[] = [
  ...ARCHETYPES.flatMap((a) => (['M', 'F'] as const).map((g) => ({ id: `${a.id}-${g.toLowerCase()}`, kind: 'character' as const, label: `${a.label} · ${g === 'M' ? '남' : '여'}`, tags: a.tags, gender: g, ...(a.id.startsWith('wx-') ? { genres: ['wuxia'] } : {}) }))),
  ...SCENES.map((s) => ({ id: s.id, kind: 'scene' as const, label: s.label, tags: s.tags, ...(s.id.startsWith('wx-') ? { genres: ['wuxia'] } : {}) })),
];

const svgCache = new Map<string, string>();

/** 그림 ID → SVG 글. 모르는 ID면 undefined */
export function stockSvg(artId: string): string | undefined {
  const hit = svgCache.get(artId);
  if (hit) return hit;
  let svg: string | undefined;
  const m = /^(.+)-(m|f)$/.exec(artId);
  const arch = m && ARCHETYPES.find((a) => a.id === m[1]);
  if (arch) svg = characterSvg(m![2] === 'm' ? arch.m : arch.f, m![2] === 'm' ? 'M' : 'F', arch.id.length);
  else if (artId.startsWith('fx-')) svg = fxSvg(artId); // 장면 그림 (v0.50)
  else { const sc = SCENES.find((s) => s.id === artId); if (sc) svg = sceneSvg(sc); }
  if (svg) svgCache.set(artId, svg);
  return svg;
}

/** 에셋 ID(`stock.<그림>` 또는 `stock.<그림>--<번호>`) → 그림 ID */
export const stockArtId = (assetId: string): string | undefined => (assetId.startsWith('stock.') ? assetId.slice(6).replace(/--\d+$/, '') : undefined);

export function stockDataUrl(assetId: string): string | undefined {
  const art = stockArtId(assetId);
  const svg = art ? stockSvg(art) : undefined;
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined;
}
