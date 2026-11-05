/**
 * 연출 (설계 v3 R10): 효과음 · 배경 음악 · 음성.
 * 소리 파일 없이 Web Audio로 합성한다 (오프라인 단일 파일에서도 동작, 저작권 걱정 없음).
 * 음성은 브라우저 음성 합성(Web Speech)을 쓴다. 모두 기본 꺼짐 — 사용자가 켠다.
 */

export interface AvSettings { sfx: boolean; music: boolean; voice: boolean; volume: number }
const KEY = 'worldforge.av.v1';
const DEFAULTS: AvSettings = { sfx: false, music: false, voice: false, volume: 0.6 };

export function loadAv(): AvSettings {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AvSettings>) }; } catch { return { ...DEFAULTS }; }
}
export function saveAv(s: AvSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 무시 */ } }

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
function audio(): { ctx: AudioContext; out: GainNode } | null {
  const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.value = loadAv().volume;
  return { ctx, out: master! };
}

/** 음 하나: 주파수·길이·파형·음량 엔벨로프 */
function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.25, slideTo?: number, dest?: AudioNode) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + start;
  const o = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest ?? a.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** 짧은 잡음 (타격감) */
function noise(start: number, dur: number, vol = 0.3, lowpass = 1800) {
  const a = audio();
  if (!a) return;
  const len = Math.max(1, Math.floor(a.ctx.sampleRate * dur));
  const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const f = a.ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = lowpass;
  const g = a.ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.out);
  src.start(a.ctx.currentTime + start);
}

export type Sfx = 'hit' | 'crit' | 'miss' | 'heal' | 'spell' | 'down' | 'levelup' | 'coin' | 'quest' | 'omen' | 'dice' | 'decision' | 'fail';

export function playSfx(kind: Sfx) {
  if (!loadAv().sfx) return;
  switch (kind) {
    case 'hit': noise(0, 0.12, 0.35, 1400); tone(140, 0, 0.12, 'square', 0.12, 70); break;
    case 'crit': noise(0, 0.2, 0.45, 2400); tone(220, 0, 0.18, 'sawtooth', 0.15, 80); tone(660, 0.05, 0.15, 'triangle', 0.12); break;
    case 'miss': tone(900, 0, 0.18, 'sine', 0.08, 300); break;
    case 'heal': [523, 659, 784].forEach((f, i) => tone(f, i * 0.07, 0.35, 'sine', 0.12)); break;
    case 'spell': tone(300, 0, 0.4, 'triangle', 0.15, 1200); tone(450, 0.05, 0.4, 'sine', 0.08, 1800); break;
    case 'down': tone(220, 0, 0.6, 'sawtooth', 0.12, 55); break;
    case 'levelup': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.4, 'triangle', 0.14)); break;
    case 'coin': tone(1319, 0, 0.08, 'square', 0.06); tone(1760, 0.07, 0.2, 'square', 0.06); break;
    case 'quest': [392, 523, 659].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle', 0.12)); break;
    case 'omen': tone(110, 0, 1.4, 'sine', 0.18, 98); tone(116.5, 0, 1.4, 'sine', 0.12); break;
    case 'dice': for (let i = 0; i < 5; i++) noise(i * 0.05, 0.03, 0.2, 4000); break;
    case 'decision': tone(196, 0, 1.0, 'triangle', 0.15); tone(294, 0.15, 0.9, 'triangle', 0.12); tone(392, 0.3, 0.9, 'sine', 0.1); break;
    case 'fail': tone(330, 0, 0.25, 'square', 0.08, 220); tone(262, 0.2, 0.35, 'square', 0.08, 180); break;
  }
}

/** 기록 한 줄 → 효과음 (없으면 null) */
export function sfxForLog(kind: string, text: string): Sfx | null {
  if (kind === 'combat') {
    if (text.includes('치명타')) return 'crit';
    if (text.includes('쓰러짐') || text.includes('숨이 멎었다') || text.includes('숨을 거두었다')) return 'down';
    if (text.includes('회복')) return 'heal';
    if (text.includes('명중') || text.includes('피해')) return 'hit';
    if (text.includes('빗나감') || text.includes('대실패')) return 'miss';
    return null;
  }
  if (kind === 'progress') {
    if (text.startsWith('★')) return 'levelup';
    if (text.startsWith('얻음') || /\+\d+ \(/.test(text)) return 'coin';
    return null;
  }
  if (kind === 'quest') return text.startsWith('◆ 결정') ? 'decision' : text.includes('실패') ? 'fail' : 'quest';
  if (kind === 'omen') return 'omen';
  if (kind === 'check') return 'dice';
  return null;
}

// ---------------------------------------------------------------- 배경 음악 (절차적, 아주 조용히)

export type Mood = 'fantasy' | 'wuxia' | 'romance' | 'combat';
const SCALES: Record<Mood, number[]> = {
  fantasy: [0, 2, 4, 7, 9, 12, 14],     // 장조 펜타토닉에 가깝게 — 넓고 밝게
  wuxia: [0, 2, 5, 7, 9, 12, 14],        // 궁상각치우 느낌의 5음계
  romance: [0, 4, 7, 11, 14, 16, 19],    // 장7화음 — 부드럽게
  combat: [0, 3, 5, 7, 10, 12, 15],      // 단조 펜타토닉 — 긴장
};
const ROOT: Record<Mood, number> = { fantasy: 196, wuxia: 220, romance: 174.6, combat: 146.8 };

let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicMood: Mood | null = null;
let musicBus: GainNode | null = null;
let step = 0;

export function setMusic(mood: Mood | null) {
  const on = loadAv().music && mood !== null;
  if (!on) { stopMusic(); return; }
  if (musicMood === mood && musicTimer) return;
  stopMusic();
  const a = audio();
  if (!a) return;
  musicMood = mood;
  musicBus = a.ctx.createGain();
  musicBus.gain.value = 0.35;
  musicBus.connect(a.out);
  const beat = mood === 'combat' ? 0.45 : 0.9;
  const tick = () => {
    if (!musicMood || !musicBus) return;
    const sc = SCALES[musicMood], root = ROOT[musicMood];
    const deg = sc[(step * 3 + (step >> 2)) % sc.length]!;
    const f = root * 2 ** (deg / 12);
    tone(f, 0, beat * 1.8, musicMood === 'combat' ? 'triangle' : 'sine', 0.06, undefined, musicBus);
    if (step % 4 === 0) tone(root / 2, 0, beat * 4, 'sine', 0.05, undefined, musicBus);
    if (musicMood === 'combat' && step % 2 === 0) noise(0, 0.05, 0.05, 300);
    step++;
  };
  tick();
  musicTimer = setInterval(tick, beat * 1000);
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  musicMood = null;
  musicBus?.disconnect();
  musicBus = null;
}

export function moodOf(genreId: string | undefined, inCombat: boolean): Mood {
  if (inCombat) return 'combat';
  return genreId === 'wuxia' ? 'wuxia' : genreId === 'romance' ? 'romance' : 'fantasy';
}

// ---------------------------------------------------------------- 음성 (Web Speech)

/** 서술을 읽는다: 바깥 글은 서술 목소리, 큰따옴표 안 대사는 높낮이를 바꿔서 */
export function speak(text: string) {
  const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  if (!loadAv().voice || !synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  synth.cancel();
  const voice = synth.getVoices().find((v) => v.lang.startsWith('ko'));
  const parts = text.replace(/\*\*/g, '').split(/(["“][^"”]+["”])/).map((p) => p.trim()).filter(Boolean);
  let n = 0;
  for (const p of parts) {
    const quoted = /^["“]/.test(p);
    const u = new SpeechSynthesisUtterance(p.replace(/["“”]/g, ''));
    u.lang = 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.pitch = quoted ? (n++ % 2 ? 0.8 : 1.25) : 1;
    u.volume = loadAv().volume;
    synth.speak(u);
  }
}

export function stopSpeaking() {
  (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel();
}
