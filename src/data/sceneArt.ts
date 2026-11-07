/**
 * 장면 그림 (v0.50) — 장면의 순간(타격·가드·필살기·대화·설렘·경보·의식…)을 그린 내장 SVG.
 * 에셋 ID는 `stock.fx-<이름>` — 다른 기본 이미지처럼 어느 세계에서나 쓸 수 있다 (파일 없이 앱이 그린다).
 */
import type { SceneDef, SceneDelta } from '../engine/schema';

export interface SceneFx { id: string; label: string; tags: string[] }

type Draw = () => string;
interface FxSpec extends SceneFx { bg: [string, string]; draw: Draw }

// ---------------------------------------------------------------- 그리기 도구

const star = (cx: number, cy: number, ro: number, ri: number, n: number, fill: string, rot = 0, extra = '') => {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) { const a = rot + (Math.PI * i) / n; const r = i % 2 ? ri : ro; pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`); }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" ${extra}/>`;
};
const rays = (cx: number, cy: number, n: number, r0: number, r1: number, color: string, w = 4, op = 0.7) =>
  Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 * i) / n + 0.13 * (i % 3); return `<line x1="${(cx + Math.cos(a) * r0).toFixed(1)}" y1="${(cy + Math.sin(a) * r0).toFixed(1)}" x2="${(cx + Math.cos(a) * r1).toFixed(1)}" y2="${(cy + Math.sin(a) * r1).toFixed(1)}" stroke="${color}" stroke-width="${w}" opacity="${op}" stroke-linecap="round"/>`; }).join('');
const speed = (y0: number, y1: number, n: number, color: string, dir = 1) =>
  Array.from({ length: n }, (_, i) => { const y = y0 + ((y1 - y0) * i) / n; const x = (i * 97) % 300; return `<line x1="${dir > 0 ? x : 640 - x}" y1="${y}" x2="${dir > 0 ? x + 160 + (i % 4) * 40 : 480 - x - (i % 4) * 40}" y2="${y}" stroke="${color}" stroke-width="${2 + (i % 3)}" opacity=".55" stroke-linecap="round"/>`; }).join('');
const fist = (x: number, y: number, s: number, c: string, o = '#2a1a10') =>
  `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-40" y="-30" width="80" height="62" rx="18" fill="${c}" stroke="${o}" stroke-width="5"/>${[-26, -9, 8, 25].map((dx) => `<rect x="${dx - 8}" y="-38" width="17" height="26" rx="8" fill="${c}" stroke="${o}" stroke-width="4"/>`).join('')}<path d="M-40 6 q-18 -4 -14 -22 q14 -2 22 10" fill="${c}" stroke="${o}" stroke-width="4"/></g>`;
const figure = (x: number, y: number, s: number, c: string, pose: 'stand' | 'kick' | 'guard' | 'fall' | 'jump' | 'run' = 'stand') => {
  const head = `<circle cx="0" cy="-110" r="18" fill="${c}"/>`;
  const L = (d: string) => `<path d="${d}" stroke="${c}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  const body = {
    stand: L('M0 -90 L0 -30') + L('M0 -78 L-30 -50 M0 -78 L34 -60') + L('M0 -30 L-22 20 M0 -30 L22 20'),
    kick: L('M0 -90 L-6 -30') + L('M0 -78 L-34 -64 M0 -78 L-20 -40') + L('M-6 -30 L-30 20 M-6 -30 L60 -60'),
    guard: L('M0 -90 L0 -30') + L('M0 -80 L18 -96 L10 -118 M0 -80 L-12 -98 L-24 -116') + L('M0 -30 L-24 20 M0 -30 L24 20'),
    fall: L('M0 -90 L20 -36') + L('M2 -80 L-34 -96 M2 -80 L40 -98') + L('M20 -36 L-10 4 M20 -36 L58 -8'),
    jump: L('M0 -90 L0 -40') + L('M0 -80 L-30 -110 M0 -80 L30 -112') + L('M0 -40 L-26 -10 M0 -40 L26 -16'),
    run: L('M0 -90 L10 -36') + L('M2 -78 L34 -92 M2 -78 L-28 -58') + L('M10 -36 L44 -6 M10 -36 L-28 10'),
  }[pose];
  return `<g transform="translate(${x} ${y}) scale(${s})">${head}${body}</g>`;
};
const heart = (x: number, y: number, s: number, c: string, op = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 30 C-40 0 -40 -30 -20 -36 C-8 -40 0 -30 0 -22 C0 -30 8 -40 20 -36 C40 -30 40 0 0 30 Z" fill="${c}" opacity="${op}"/>`;
const bubble = (x: number, y: number, w: number, h: number, c: string, tail: 1 | -1 = 1) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2.4}" fill="${c}"/><path d="M${x + w / 2 + tail * 20} ${y + h - 4} l${tail * 28} 34 l${-tail * 6} -36 Z" fill="${c}"/>${[0.3, 0.5, 0.7].map((f) => `<circle cx="${x + w * f}" cy="${y + h / 2}" r="7" fill="#00000033"/>`).join('')}</g>`;
const circleMagic = (cx: number, cy: number, r: number, c: string) => `<g fill="none" stroke="${c}" stroke-width="4"><circle cx="${cx}" cy="${cy}" r="${r}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.78}"/>${star(cx, cy, r * 0.76, r * 0.3, 6, 'none', -Math.PI / 2, `stroke="${c}" stroke-width="3"`)}${Array.from({ length: 12 }, (_, i) => { const a = (Math.PI * i) / 6; return `<rect x="${(cx + Math.cos(a) * r * 0.89 - 6).toFixed(1)}" y="${(cy + Math.sin(a) * r * 0.89 - 6).toFixed(1)}" width="12" height="12" transform="rotate(${i * 30} ${(cx + Math.cos(a) * r * 0.89).toFixed(1)} ${(cy + Math.sin(a) * r * 0.89).toFixed(1)})"/>`; }).join('')}</g>`;
const coin = (x: number, y: number, r: number) => `<g><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.9}" fill="#e8b830" stroke="#8a6410" stroke-width="4"/><ellipse cx="${x}" cy="${y}" rx="${r * 0.62}" ry="${r * 0.55}" fill="none" stroke="#fff2a8" stroke-width="3"/></g>`;
const word = (x: number, y: number, t: string, size: number, fill: string, stroke = '#1a1010') => `<text x="${x}" y="${y}" font-family="Impact, 'Arial Black', sans-serif" font-size="${size}" font-weight="900" text-anchor="middle" fill="${fill}" stroke="${stroke}" stroke-width="${size / 14}" paint-order="stroke">${t}</text>`;
const spot = (cx: number, color: string) => `<path d="M${cx - 30} 0 L${cx + 30} 0 L${cx + 160} 400 L${cx - 160} 400 Z" fill="${color}" opacity=".18"/>`;

// ---------------------------------------------------------------- 순간들

const FX: FxSpec[] = [
  // 격투·대결
  { id: 'fx-ring', label: '링·대결 시작', tags: ['대결', '시작', '링', '경기', '격투', '비무', 'fight', 'ring', 'versus'], bg: ['#2a1e3a', '#0a0610'],
    draw: () => `${spot(160, '#fff')}${spot(480, '#fff')}<rect x="0" y="310" width="640" height="90" fill="#1a1222"/><path d="M0 250 H640 M0 280 H640" stroke="#c8303a" stroke-width="6"/>${figure(190, 300, 1.1, '#e85a3a', 'guard')}${figure(450, 300, 1.1, '#3a8ae8', 'guard')}${word(320, 150, 'VS', 110, '#ffd23a')}` },
  { id: 'fx-strike', label: '타격', tags: ['타격', '강타', '주먹', '공격', '때리', '때린', '친다', '꽂', '훅', '치기', '잽', '정면', '초식', '일격', 'strike', 'hit', 'punch'], bg: ['#ffcf4a', '#e2541e'],
    draw: () => `${rays(330, 200, 28, 60, 320, '#fff6c8', 6)}${star(330, 200, 150, 70, 12, '#fff', 0.2)}${star(330, 200, 100, 50, 10, '#ff4a2a', 0.5)}${fist(300, 205, 1.3, '#f2c39a')}` },
  { id: 'fx-kick', label: '발차기·하단', tags: ['발차기', '킥', '하단', '쓸기', '돌려차기', '무릎', 'kick', 'sweep', 'low'], bg: ['#4ac8ff', '#1a4ab8'],
    draw: () => `${speed(240, 330, 9, '#fff', 1)}${star(470, 290, 90, 42, 10, '#fff', 0.1)}${figure(260, 330, 1.4, '#1a1a2a', 'kick')}` },
  { id: 'fx-guard', label: '가드·막기', tags: ['가드', '막기', '막아', '막혀', '막는', '방어', '흘려', '버티', 'guard', 'block', 'defend'], bg: ['#5a7a9a', '#1a2a3a'],
    draw: () => `<path d="M320 60 L460 110 Q460 270 320 350 Q180 270 180 110 Z" fill="#c8d8e8" stroke="#fff" stroke-width="8" opacity=".9"/><path d="M320 100 L420 135 Q420 250 320 310 Q220 250 220 135 Z" fill="#3a6a9a"/>${star(150, 140, 50, 20, 8, '#ffe68a', 0)}${star(500, 250, 40, 16, 8, '#ffe68a', 0)}` },
  { id: 'fx-throw', label: '잡기·메치기', tags: ['잡기', '메치', '던지', '조르', '레슬링', '유도', 'throw', 'grab', 'grapple'], bg: ['#9a4ae8', '#2a0a4a'],
    draw: () => `<path d="M120 320 Q320 -40 520 300" fill="none" stroke="#fff" stroke-width="10" stroke-dasharray="4 18" stroke-linecap="round"/><path d="M500 260 l40 50 l-62 6 Z" fill="#fff"/>${figure(200, 330, 1.2, '#1a0a2a', 'stand')}${figure(420, 210, 1.1, '#ffd23a', 'fall')}` },
  { id: 'fx-launch', label: '띄우기·공중 콤보', tags: ['띄우', '어퍼', '공중', '콤보', '연타', 'launch', 'juggle', 'combo', 'air'], bg: ['#ff8a3a', '#7a1a4a'],
    draw: () => `${Array.from({ length: 7 }, (_, i) => `<line x1="${200 + i * 40}" y1="380" x2="${260 + i * 22}" y2="${120 - (i % 3) * 20}" stroke="#fff" stroke-width="4" opacity=".5"/>`).join('')}${figure(330, 200, 1.1, '#2a0a1a', 'fall')}${[[300, 120], [380, 90], [350, 170]].map(([x, y]) => star(x!, y!, 46, 18, 8, '#fff6a8', 0.3)).join('')}${word(500, 120, 'COMBO', 54, '#ffe23a')}` },
  { id: 'fx-counter', label: '카운터·간파', tags: ['카운터', '간파', '반격', '역습', '읽', 'counter', 'read', 'riposte'], bg: ['#1a1a3a', '#000'],
    draw: () => `<path d="M330 20 L270 190 L330 190 L250 380 L420 150 L350 150 L410 20 Z" fill="#7ae8ff" stroke="#fff" stroke-width="5"/>${rays(330, 200, 18, 120, 300, '#7ae8ff', 3, 0.5)}${word(330, 120, 'COUNTER', 70, '#fff', '#2a8aff')}` },
  { id: 'fx-super', label: '필살기·내력 폭발', tags: ['필살', '필살기', '폭발', '비기', '절초', '궁극', 'super', 'ultimate'], bg: ['#fff4a8', '#ff3a1a'],
    draw: () => `${rays(320, 210, 40, 30, 380, '#fff', 8, 0.8)}<circle cx="320" cy="210" r="120" fill="#fff" opacity=".9"/><circle cx="320" cy="210" r="80" fill="#ffd23a"/>${star(320, 210, 70, 30, 6, '#ff5a1a', -Math.PI / 2)}${word(320, 370, 'SUPER', 64, '#fff', '#c81a1a')}` },
  { id: 'fx-dodge', label: '회피·이동', tags: ['회피', '피하', '백스텝', '대시', '물러', '파고', '간격', '스텝', 'dodge', 'dash', 'step', 'evade'], bg: ['#3ae8a8', '#0a4a4a'],
    draw: () => `${[0.15, 0.3, 0.55].map((o, i) => `<g opacity="${o}">${figure(200 + i * 90, 330, 1.2, '#04241e', 'run')}</g>`).join('')}${figure(470, 330, 1.2, '#04241e', 'run')}${speed(150, 330, 8, '#fff', -1)}` },
  { id: 'fx-stagger', label: '경직·휘청', tags: ['경직', '휘청', '흔들', '실수', '헛', '빗나', '균형', 'stagger', 'stun', 'whiff'], bg: ['#c8a8e8', '#4a2a6a'],
    draw: () => `<path d="M320 200 m-100 0 a100 100 0 1 1 100 100 a70 70 0 1 1 -70 -70 a40 40 0 1 1 40 40" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>${[[200, 90], [450, 110], [480, 300], [170, 300]].map(([x, y]) => star(x!, y!, 26, 10, 5, '#ffe23a', -Math.PI / 2)).join('')}` },
  { id: 'fx-ko', label: 'KO·승리 일격', tags: ['ko', '케이오', '쓰러', '마무리', '결정타', '승리', 'knockout', 'finish'], bg: ['#ff2a2a', '#3a0000'],
    draw: () => `${rays(320, 200, 32, 40, 400, '#ffb03a', 10, 0.7)}${star(320, 200, 190, 120, 16, '#ffd23a', 0.1)}${word(320, 250, 'K.O.', 150, '#fff', '#7a0000')}` },
  { id: 'fx-victory', label: '승리·성공', tags: ['승리', '성공', '이겼', '합의', '도달', '완성', '낙찰', '자백', '한 수 위', 'victory', 'win', 'success'], bg: ['#ffe68a', '#e8a01a'],
    draw: () => `${rays(320, 160, 24, 60, 300, '#fff', 6, 0.8)}${figure(320, 360, 1.5, '#3a2006', 'jump')}<path d="M190 120 q130 -110 260 0" fill="none" stroke="#3a8a2a" stroke-width="14" stroke-dasharray="20 10"/>${[[200, 80], [440, 70], [520, 180], [120, 190]].map(([x, y]) => star(x!, y!, 20, 8, 4, '#fff', 0)).join('')}` },
  { id: 'fx-defeat', label: '패배·실패', tags: ['패배', '실패', '결렬', '발각', '놓침', '망가', '폭주', '한 수 아래', '어색', 'defeat', 'lose', 'fail'], bg: ['#5a5a6a', '#141418'],
    draw: () => `<rect x="0" y="300" width="640" height="100" fill="#0e0e12"/>${figure(320, 330, 1.3, '#9a9aaa', 'fall')}<path d="M120 80 L520 320 M520 80 L120 320" stroke="#c83a3a" stroke-width="18" opacity=".45" stroke-linecap="round"/>` },
  { id: 'fx-draw', label: '무승부·보류', tags: ['무승부', '보류', '판정', '반쯤', '무난', '버팀', '물러남', 'draw', 'neutral', 'timeout'], bg: ['#8a9ab0', '#2a3240'],
    draw: () => `${figure(230, 320, 1.1, '#e8eef4', 'stand')}${figure(410, 320, 1.1, '#e8eef4', 'stand')}<path d="M260 140 h120" stroke="#fff" stroke-width="12" stroke-linecap="round"/>${word(320, 110, '...', 80, '#fff', '#2a3240')}` },
  // 말·관계
  { id: 'fx-talk', label: '대화·흥정', tags: ['대화', '말', '설득', '협상', '흥정', '제안', '조건', '담판', '협의', '설전', '묻', 'talk', 'negotiate', 'persuade'], bg: ['#8ac8e8', '#2a6a9a'],
    draw: () => `${bubble(80, 70, 280, 110, '#fff', 1)}${bubble(290, 200, 270, 100, '#ffe8a8', -1)}` },
  { id: 'fx-insight', label: '눈치·속내 읽기', tags: ['속내', '떠보', '눈치', '통찰', '살피', '모순', '읽기', '파악', 'insight', 'read', 'notice'], bg: ['#2a3a5a', '#0a1020'],
    draw: () => `<path d="M100 200 Q320 40 540 200 Q320 360 100 200 Z" fill="#e8f0ff"/><circle cx="320" cy="200" r="80" fill="#3a7ae8"/><circle cx="320" cy="200" r="38" fill="#0a1020"/><circle cx="300" cy="180" r="14" fill="#fff"/>${rays(320, 200, 16, 200, 300, '#7ab8ff', 3, 0.5)}` },
  { id: 'fx-threat', label: '위협·압박', tags: ['위협', '협박', '압박', '으름장', '도발', '겁', 'threat', 'intimidate', 'taunt'], bg: ['#6a0a0a', '#0a0000'],
    draw: () => `<path d="M140 120 L260 170 M500 120 L380 170" stroke="#ff3a2a" stroke-width="18" stroke-linecap="round"/><ellipse cx="230" cy="210" rx="44" ry="22" fill="#ff3a2a"/><ellipse cx="410" cy="210" rx="44" ry="22" fill="#ff3a2a"/>${[[90, 90], [550, 90], [320, 330]].map(([x, y]) => `<path d="M${x! - 30} ${y} l18 -20 l12 14 l18 -24" stroke="#ff8a6a" stroke-width="6" fill="none"/>`).join('')}` },
  { id: 'fx-heart', label: '설렘·호감', tags: ['설렘', '호감', '분위기', '마음', '데이트', '왈츠', '춤', '고백', '진심', '웃음', 'heart', 'romance', 'date', 'dance'], bg: ['#ffc8d8', '#e85a8a'],
    draw: () => `${heart(320, 200, 4.2, '#fff', 0.95)}${heart(320, 196, 3.4, '#ff4a7a')}${[[110, 90, 1.1], [520, 110, 1.4], [150, 320, 0.9], [500, 320, 1]].map(([x, y, s]) => heart(x!, y!, s!, '#fff', 0.8)).join('')}` },
  { id: 'fx-awkward', label: '어색함·침묵', tags: ['어색', '침묵', '당황', '굳은', '실례', '아첨', '허세', 'awkward', 'silence', 'embarrass'], bg: ['#c8d8e8', '#7a8aa0'],
    draw: () => `<circle cx="320" cy="210" r="120" fill="#ffe0b8"/><circle cx="280" cy="190" r="12" fill="#3a2a2a"/><circle cx="360" cy="190" r="12" fill="#3a2a2a"/><path d="M280 260 h80" stroke="#3a2a2a" stroke-width="8" stroke-linecap="round"/><path d="M440 110 q22 40 0 64 q-22 -24 0 -64 Z" fill="#7ac8ff" stroke="#fff" stroke-width="4"/>${word(320, 380, '. . .', 60, '#fff', '#4a5a70')}` },
  // 쫓고 숨고
  { id: 'fx-chase', label: '추격·질주', tags: ['추격', '질주', '쫓', '달리', '도망', '지름길', '장애물', '흔적', 'chase', 'run', 'pursuit'], bg: ['#ffb05a', '#7a3a1a'],
    draw: () => `${speed(120, 340, 12, '#fff', 1)}${figure(470, 330, 1.2, '#2a1006', 'run')}${figure(250, 330, 1.2, '#2a1006', 'run')}<path d="M330 170 l60 0 l-14 -14 M390 170 l-14 14" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round"/>` },
  { id: 'fx-sneak', label: '잠입·숨기', tags: ['잠입', '숨어', '숨죽', '숨기', '그림자', '몰래', '은신', '변장', '자물쇠', '기다리', 'sneak', 'stealth', 'hide', 'infiltrate'], bg: ['#1a2a3a', '#02060a'],
    draw: () => `<path d="M0 400 L0 120 L200 60 L200 400 Z" fill="#000" opacity=".6"/>${figure(120, 330, 1.2, '#0a0e14', 'stand')}<ellipse cx="104" cy="214" rx="8" ry="4" fill="#ffe23a"/><ellipse cx="134" cy="214" rx="8" ry="4" fill="#ffe23a"/><path d="M640 60 L380 400 L640 400 Z" fill="#ffe68a" opacity=".12"/>` },
  { id: 'fx-alarm', label: '경보·발각 위기', tags: ['경보', '발각', '들킴', '수상', '경비', '횃불', '사이렌', 'alarm', 'alert', 'spotted'], bg: ['#ff3a3a', '#3a0000'],
    draw: () => `${rays(320, 180, 20, 90, 340, '#ffb0a0', 8, 0.5)}<path d="M240 260 Q240 100 320 100 Q400 100 400 260 Z" fill="#ff2a2a" stroke="#fff" stroke-width="8"/><rect x="220" y="260" width="200" height="40" rx="8" fill="#3a0a0a" stroke="#fff" stroke-width="6"/>${word(320, 230, '!', 120, '#fff', '#7a0000')}` },
  // 손과 힘
  { id: 'fx-ritual', label: '의식·마법진', tags: ['의식', '마법진', '룬', '봉인', '문양', '주문', '결속', '기도', '정렬', '엮', 'ritual', 'rune', 'seal', 'spell'], bg: ['#3a2a6a', '#0a0420'],
    draw: () => `${circleMagic(320, 220, 150, '#a8a0ff')}<circle cx="320" cy="220" r="40" fill="#e8e0ff" opacity=".9"/>${rays(320, 220, 12, 160, 220, '#c8c0ff', 3, 0.5)}` },
  { id: 'fx-backlash', label: '역류·폭주', tags: ['역류', '폭주', '반동', '깨짐', '출렁', '동요', '갈라', 'backlash', 'surge', 'crack'], bg: ['#8a2aff', '#1a0030'],
    draw: () => `${circleMagic(320, 220, 140, '#ff6aff')}<path d="M320 60 L300 180 L360 200 L310 380" stroke="#fff" stroke-width="10" fill="none"/>${star(320, 210, 110, 50, 9, '#ff3aff', 0.3, 'opacity=".6"')}` },
  { id: 'fx-qi', label: '내력·호흡', tags: ['내력', '운기', '호흡', '기공', '숨 고르', '마음 다잡', '침착', '집중', 'qi', 'breathe', 'focus', 'calm'], bg: ['#a8e8d8', '#2a6a6a'],
    draw: () => `${figure(320, 340, 1.3, '#0a2a2a', 'stand')}${[0, 1, 2].map((i) => `<ellipse cx="320" cy="230" rx="${90 + i * 50}" ry="${40 + i * 22}" fill="none" stroke="#fff" stroke-width="5" opacity="${0.8 - i * 0.22}" transform="rotate(${-15 + i * 15} 320 230)"/>`).join('')}` },
  { id: 'fx-forge', label: '제작·대장간', tags: ['제작', '대장간', '모루', '망치', '다듬', '형태', '마무리', '룬 새기', '설계', 'craft', 'forge', 'anvil'], bg: ['#ff8a2a', '#3a1006'],
    draw: () => `<path d="M180 300 h280 l-40 -60 h-200 Z" fill="#2a2a32"/><rect x="250" y="300" width="140" height="70" fill="#1a1a20"/><rect x="340" y="80" width="30" height="150" fill="#6a4a2a" transform="rotate(30 355 155)"/><rect x="300" y="60" width="110" height="50" rx="6" fill="#4a4a54" transform="rotate(30 355 85)"/>${rays(300, 236, 18, 20, 130, '#ffe23a', 4, 0.9)}` },
  // 돈과 물건
  { id: 'fx-coin', label: '경매·돈', tags: ['경매', '값', '호가', '지르', '자금', '은자', '돈', '흥정', '거래', '입찰', 'auction', 'coin', 'money', 'bid'], bg: ['#ffe8a8', '#b8801a'],
    draw: () => `${[[230, 260, 60], [330, 230, 70], [420, 280, 54], [280, 320, 50], [380, 330, 46]].map(([x, y, r]) => coin(x!, y!, r!)).join('')}<rect x="420" y="70" width="140" height="44" rx="8" fill="#6a3a1a" transform="rotate(-25 490 92)"/><rect x="480" y="100" width="20" height="120" fill="#8a5a2a" transform="rotate(-25 490 160)"/>` },
  { id: 'fx-clue', label: '단서·증거', tags: ['단서', '증거', '쪽지', '장부', '문서', '편지', '서류', '봉랍', '털어놓', '자백', 'clue', 'evidence', 'document', 'confess'], bg: ['#e8d8b8', '#7a5a3a'],
    draw: () => `<rect x="170" y="70" width="240" height="290" rx="6" fill="#fff8e8" transform="rotate(-6 290 215)"/>${Array.from({ length: 8 }, (_, i) => `<line x1="200" y1="${120 + i * 28}" x2="${360 - (i % 3) * 30}" y2="${110 + i * 28}" stroke="#8a7a6a" stroke-width="5"/>`).join('')}<circle cx="420" cy="230" r="70" fill="none" stroke="#3a2a1a" stroke-width="16"/><circle cx="420" cy="230" r="58" fill="#c8e8ff" opacity=".35"/><rect x="460" y="280" width="26" height="100" rx="10" fill="#3a2a1a" transform="rotate(-40 473 330)"/>` },
  { id: 'fx-interrogate', label: '심문·추궁', tags: ['심문', '추궁', '저항', '두려움', '사정', '핵심', 'interrogate', 'question'], bg: ['#3a3a40', '#0a0a0c'],
    draw: () => `<path d="M280 0 L360 0 L520 340 L120 340 Z" fill="#ffe8a8" opacity=".25"/><path d="M290 40 h60 l20 50 h-100 Z" fill="#c8c8d0"/><rect x="200" y="300" width="240" height="20" fill="#5a4a3a"/>${figure(320, 300, 1, '#0a0a0c', 'stand')}${word(320, 390, '?', 70, '#ffe8a8', '#000')}` },
  { id: 'fx-gift', label: '선물·보상', tags: ['선물', '보상', '술 한', '술잔', '술병', '동이', '양보', '칭찬', '꽃', '물건', 'gift', 'reward', 'present'], bg: ['#ffd8e8', '#c86a9a'],
    draw: () => `<rect x="220" y="170" width="200" height="160" rx="10" fill="#e83a6a"/><rect x="200" y="140" width="240" height="50" rx="8" fill="#ff5a8a"/><rect x="305" y="140" width="30" height="190" fill="#ffe23a"/><path d="M320 140 q-70 -80 -80 -20 q10 30 80 20 q70 10 80 -20 q-10 -60 -80 20" fill="#ffe23a"/>${[[150, 110], [500, 120], [520, 300]].map(([x, y]) => star(x!, y!, 22, 9, 4, '#fff', 0)).join('')}` },
];

export const SCENE_FX: SceneFx[] = FX.map(({ id, label, tags }) => ({ id, label, tags }));

export function fxSvg(id: string): string | undefined {
  const f = FX.find((x) => x.id === id);
  if (!f) return undefined;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><defs><radialGradient id="bg" cx=".5" cy=".5" r=".8"><stop offset="0" stop-color="${f.bg[0]}"/><stop offset="1" stop-color="${f.bg[1]}"/></radialGradient></defs><rect width="640" height="400" fill="url(#bg)"/>${f.draw()}</svg>`;
}

// ---------------------------------------------------------------- 자동 배정

/** 낱말로 장면 그림 고르기 (먼저 맞는 것) */
/** 구체적인 순간이 먼저 (예: "카운터 히트"는 타격보다 카운터, "막아 냈다"는 가드) */
const PRIORITY = ['fx-ko', 'fx-super', 'fx-counter', 'fx-launch', 'fx-throw', 'fx-guard', 'fx-kick', 'fx-dodge', 'fx-stagger', 'fx-strike'];
const ORDERED = [...PRIORITY.map((id) => FX.find((f) => f.id === id)!), ...FX.filter((f) => !PRIORITY.includes(f.id))];
export function pickFx(text: string, fallback?: string): string | undefined {
  const t = text.toLowerCase();
  const hit = ORDERED.find((f) => f.tags.some((k) => t.includes(k.toLowerCase())));
  return hit ? `stock.${hit.id}` : fallback ? `stock.${fallback}` : undefined;
}

const KIND_START: [RegExp, string][] = [
  [/비무|격투|대결|스파링|경기|준결승|결승|예선|데뷔전|라이벌|duel|fight/i, 'fx-ring'], [/추격|chase/i, 'fx-chase'], [/잠입|침투|infiltrat/i, 'fx-sneak'],
  [/의식|봉인|운기|ritual/i, 'fx-ritual'], [/제작|대장간|룬|craft/i, 'fx-forge'], [/심문|interrog/i, 'fx-interrogate'], [/경매|암시장|auction/i, 'fx-coin'],
  [/데이트|왈츠|오후|date|dance/i, 'fx-heart'], [/협상|흥정|담판|설전|negotiat/i, 'fx-talk'],
];

/**
 * 비어 있는 장면 이미지 자리를 낱말로 채운다 (이미 정한 것은 그대로).
 * 시작·단계·행동 카드·성공/대성공/실패·반작용·끝 모두.
 */
export function autoSceneArt(def: SceneDef): SceneDef {
  const kindHit = KIND_START.find(([re]) => re.test(`${def.name} ${def.description}`));
  const fight = kindHit?.[1] === 'fx-ring';
  // 이름 → 결과 글 → 설명·꼬리표 순으로 낱말을 찾는다 (설명 속 낱말이 이름을 이기지 않게)
  const first = (texts: string[], fb?: string) => { for (const t of texts) { const hit = t && pickFx(t); if (hit) return hit; } return fb ? `stock.${fb}` : undefined; };
  const fill = (d: SceneDelta | undefined, texts: string[], fb?: string): SceneDelta | undefined => (d && !d.image ? { ...d, ...(first([d.text ?? '', ...texts], fb) ? { image: first([d.text ?? '', ...texts], fb)! } : {}) } : d);
  return {
    ...def,
    image: def.image ?? (kindHit ? `stock.${kindHit[1]}` : pickFx(`${def.name} ${def.description}`, 'fx-talk')),
    ...(def.phases ? { phases: def.phases.map((p) => (p.image ? p : { ...p, image: first([p.name, p.text ?? ''], kindHit?.[1] ?? 'fx-talk')! })) } : {}),
    actions: def.actions.map((a) => {
      const texts = [a.name, (a.tags ?? []).join(' '), a.text ?? ''];
      const icon = a.image ?? first(texts, kindHit?.[1] ?? 'fx-talk');
      return {
        ...a, ...(icon ? { image: icon } : {}),
        ...(a.success ? { success: a.success.image ? a.success : { ...a.success, ...(icon ? { image: icon } : {}) } } : {}),
        // 대성공: 격투면 필살·띄우기는 그 그림, 나머지는 카운터 / 아니면 성공
        ...(a.great ? { great: a.great.image ? a.great : { ...a.great, image: fight ? (icon && /fx-(super|launch|throw|ko)/.test(icon) ? icon : 'stock.fx-counter') : first([a.great.text ?? ''], 'fx-victory')! } } : {}),
        // 실패: 격투면 막혔으면 가드, 아니면 경직 / 아니면 결과 글의 낱말, 없으면 어색함
        ...(a.failure ? { failure: a.failure.image ? a.failure : { ...a.failure, image: fight ? (/막|가드/.test(a.failure.text ?? '') ? 'stock.fx-guard' : 'stock.fx-stagger') : first([a.failure.text ?? ''], 'fx-awkward')! } } : {}),
      };
    }),
    ...(def.reactions ? { reactions: def.reactions.map((r) => (r.delta.image || !r.delta.text ? r : { ...r, delta: { ...r.delta, image: pickFx(r.delta.text, fight ? 'fx-strike' : 'fx-alarm')! } })) } : {}),
    ends: def.ends.map((e) => (e.image ? e : { ...e, image: `stock.${e.outcome === 'success' ? (fight ? 'fx-ko' : 'fx-victory') : e.outcome === 'failure' ? 'fx-defeat' : 'fx-draw'}` })),
  };
}
