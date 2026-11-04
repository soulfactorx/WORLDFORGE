/**
 * 외부 캐릭터 가져오기 (설계서 PART 6): RisuAI CHARX · Character Card V3 · V2 · V1 · PNG 카드.
 *
 * 원칙
 * - 자체 세계관 구조가 우선. 카드는 "인물 + 지식 후보"로 변환할 뿐 실행 규격으로 쓰지 않는다.
 * - 스크립트(트리거·정규식·Lua 등)는 읽지도 실행하지도 않고 "미지원"으로 표시한다.
 * - system_prompt · post_history_instructions · jailbreak는 AI 프롬프트에 넣지 않는다 (인젝션 방지).
 * - 압축 폭탄·과도한 파일 수를 막는다. card.json과 초상화 이미지만 읽는다.
 */
import { strFromU8, unzipSync } from 'fflate';
import { josa } from '../engine/text/josa';

export type CardFormat = 'charx' | 'ccv3' | 'ccv2' | 'ccv1';

export interface LoreEntry {
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  /** 늘 켜진 항목 (카드의 constant) — 세계의 상식으로 본다 */
  constant?: boolean;
}

export interface NormalizedCard {
  format: CardFormat;
  name: string;
  nickname: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creator: string;
  version: string;
  tags: string[];
  lore: LoreEntry[];
  /** 가져오지 않는 프롬프트 필드 (내용 확인용으로만 보여준다) */
  ignoredPrompts: { field: string; text: string }[];
  /** 지원하지 않아 무시한 기능 */
  unsupported: string[];
  portrait?: { mime: string; bytes: Uint8Array };
  /** 이름 붙은 에셋 이미지 (세계관 카드의 인물별 초상화 등) */
  images: { name: string; mime: string; bytes: Uint8Array }[];
}

export interface ParseResult {
  card: NormalizedCard | null;
  error?: string;
}

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_UNZIPPED = 60 * 1024 * 1024;
const MAX_ENTRIES = 500;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// ---------------------------------------------------------------- PNG

/** PNG tEXt / iTXt 청크에서 키워드별 텍스트를 읽는다 (CRC 검사는 하지 않는다) */
export function readPngText(bytes: Uint8Array): Record<string, string> {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error('PNG 파일이 아닙니다.');
  const out: Record<string, string> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'tEXt') {
      const z = data.indexOf(0);
      if (z > 0) out[strFromU8(data.subarray(0, z), true)] = strFromU8(data.subarray(z + 1), true);
    } else if (type === 'iTXt') {
      const z = data.indexOf(0);
      // keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
      if (z > 0 && data[z + 1] === 0) {
        let q = z + 3;
        q = data.indexOf(0, q) + 1;
        q = data.indexOf(0, q) + 1;
        out[strFromU8(data.subarray(0, z), true)] = strFromU8(data.subarray(q));
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

const b64decode = (s: string) => {
  const bin = atob(s.replace(/\s/g, ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return strFromU8(u);
};

// ---------------------------------------------------------------- 정규화

export function normalize(raw: unknown, format: CardFormat): NormalizedCard {
  if (!isObj(raw)) throw new Error('카드 데이터가 객체가 아닙니다.');
  const isWrapped = isObj(raw.data) && (raw.spec === 'chara_card_v3' || raw.spec === 'chara_card_v2');
  const d = (isWrapped ? raw.data : raw) as Record<string, unknown>;
  const fmt: CardFormat = format === 'charx' ? 'charx' : raw.spec === 'chara_card_v3' ? 'ccv3' : raw.spec === 'chara_card_v2' ? 'ccv2' : 'ccv1';
  const name = str(d.name).trim();
  if (!name) throw new Error('카드에 이름(name)이 없습니다.');

  const book = isObj(d.character_book) ? d.character_book : undefined;
  const lore: LoreEntry[] = Array.isArray(book?.entries)
    ? (book!.entries as unknown[]).filter(isObj).map((e) => ({
      name: str(e.name) || str(e.comment) || (Array.isArray(e.keys) ? String((e.keys as unknown[])[0] ?? '') : ''),
      keys: Array.isArray(e.keys) ? (e.keys as unknown[]).map(String).filter(Boolean) : [],
      content: str(e.content).trim(),
      enabled: e.enabled !== false,
      ...(e.constant === true ? { constant: true } : {}),
    })).filter((e) => e.content) // 내용 없는 폴더·구분선 항목은 버린다
    : [];

  const ignoredPrompts = (['system_prompt', 'post_history_instructions', 'jailbreak'] as const)
    .map((f) => ({ field: f, text: str(d[f]).trim() }))
    .filter((x) => x.text);

  const unsupported: string[] = [];
  const ext = isObj(d.extensions) ? d.extensions : {};
  const risu = isObj(ext.risuai) ? ext.risuai : {};
  const count = (v: unknown) => (Array.isArray(v) ? v.length : v ? 1 : 0);
  const scriptish: [string, unknown][] = [
    ['RisuAI 정규식 스크립트', risu.customScripts], ['RisuAI 트리거 스크립트', risu.triggerscript],
    ['Lua 스크립트', risu.lua ?? risu.luaScript], ['가상 스크립트', risu.virtualscript ?? risu.bias],
    ['로컬 정규식', ext.regex_scripts],
  ];
  for (const [label, v] of scriptish) if (count(v)) unsupported.push(`${label} ${count(v)}개 (실행하지 않음)`);
  if (str(risu.backgroundHTML)) unsupported.push('배경 HTML/CSS (표시하지 않음)');
  if (str(risu.toggles)) unsupported.push('RisuAI 토글 설정');
  if (count(risu.sdData) || count(risu.newGenData)) unsupported.push('이미지 생성 설정');
  if (isObj(ext.depth_prompt) && str(ext.depth_prompt.prompt)) unsupported.push('깊이 프롬프트 (AI에게 넘기지 않음)');
  if (Array.isArray(d.group_only_greetings) && d.group_only_greetings.length) unsupported.push(`그룹 전용 인사말 ${d.group_only_greetings.length}개`);
  if (Array.isArray(d.alternate_greetings) && d.alternate_greetings.length) unsupported.push(`대체 인사말 ${d.alternate_greetings.length}개 (첫 인사말만 사용)`);
  if (Array.isArray(d.assets) && d.assets.length > 1) unsupported.push(`추가 에셋 ${d.assets.length - 1}개 (초상화 1장만 사용)`);
  if (book && lore.some((e) => e.keys.length)) unsupported.push('로어북 키워드 자동 삽입 (키워드는 참고로만 보존)');

  return {
    format: fmt, name, nickname: str(d.nickname), description: str(d.description).trim(), personality: str(d.personality).trim(),
    scenario: str(d.scenario).trim(), firstMes: str(d.first_mes).trim(), mesExample: str(d.mes_example).trim(),
    creator: str(d.creator), version: str(d.character_version), tags: Array.isArray(d.tags) ? (d.tags as unknown[]).map(String) : [],
    lore, ignoredPrompts, unsupported, images: [],
  };
}

/** zip 안의 파일 이름 목록 (내용은 풀지 않는다) */
function unzipNames(buf: Uint8Array): string[] {
  const names: string[] = [];
  try { unzipSync(buf, { filter: (f) => { names.push(f.name); return false; } }); } catch { /* 목록만 실패 */ }
  return names;
}

/** zip이면 첫 로컬 헤더 위치(앞에 다른 데이터가 붙어 있을 수 있음), 아니면 -1 */
export function findZipStart(bytes: Uint8Array): number {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 0;
  // 끝 64KB 안에 중앙 디렉터리 끝(EOCD) 서명이 있어야 zip이다
  const from = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= from; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return -1;
  for (let i = 0; i < eocd; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) return i;
  }
  return -1;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** 파일(바이트)을 읽어 카드를 정규화한다 */
export function parseCardFile(fileName: string, bytes: Uint8Array): ParseResult {
  try {
    if (bytes.byteLength > MAX_BYTES) return { card: null, error: '파일이 너무 큽니다 (최대 30MB).' };
    // PNG 카드: ccv3(우선) 또는 chara 텍스트 청크 (base64 JSON)
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const text = readPngText(bytes);
      const payload = text.ccv3 ?? text.chara;
      if (!payload) return { card: null, error: 'PNG 안에 캐릭터 카드 데이터가 없습니다.' };
      const card = normalize(JSON.parse(b64decode(payload)), 'ccv2');
      card.portrait = { mime: 'image/png', bytes };
      return { card };
    }
    // CHARX: zip { card.json, assets/... }
    // RisuAI는 표지 JPEG 뒤에 zip을 덧붙인 형태(.charx)로도 내보낸다 → 끝부분의 zip 디렉터리로 판별한다
    const zipStart = findZipStart(bytes);
    if (zipStart >= 0) {
      let total = 0, n = 0;
      const filter = (f: { name: string; originalSize: number }) => {
        n++; total += f.originalSize;
        if (n > MAX_ENTRIES || total > MAX_UNZIPPED) throw new Error('압축을 풀면 너무 큽니다.');
        return f.name === 'card.json' || /^assets\/[^/]+\/(image\/)?[^/]+\.(png|jpe?g|webp)$/i.test(f.name);
      };
      // 앞에 데이터가 붙은 경우: 보통 zip 내부 오프셋은 zip 시작 기준이다 → 잘라서 먼저 시도하고, 안 되면 파일 전체 기준으로
      const candidates = zipStart > 0 ? [bytes.subarray(zipStart), bytes] : [bytes];
      let files: Record<string, Uint8Array> | null = null;
      let lastError: unknown = null;
      for (const buf of candidates) {
        n = 0; total = 0;
        try {
          const f = unzipSync(buf, { filter });
          if (f['card.json']) { files = f; break; }
        } catch (e) { lastError = e; }
      }
      if (!files) {
        if (lastError) throw lastError;
        return { card: null, error: 'CHARX 안에 card.json이 없습니다.' };
      }
      if (!files['card.json']) return { card: null, error: 'CHARX 안에 card.json이 없습니다.' };
      const raw = JSON.parse(strFromU8(files['card.json']));
      const card = normalize(raw, 'charx');
      const names = unzipNames(zipStart > 0 ? bytes.subarray(zipStart) : bytes);
      if (names.includes('module.risum')) card.unsupported.push('RisuAI 모듈(module.risum) — 로어북·정규식 묶음, 읽지 않음');
      // 초상화: 카드의 assets 중 icon(또는 첫 이미지)의 embeded:// 경로
      const assets = isObj(raw) && isObj(raw.data) && Array.isArray(raw.data.assets) ? (raw.data.assets as unknown[]).filter(isObj) : [];
      const icon = assets.find((a) => a.type === 'icon') ?? assets[0];
      const uri = icon ? str(icon.uri).replace(/^embed(d)?ed:\/\//, '') : '';
      for (const a of assets) {
        const p = str(a.uri).replace(/^embed(d)?ed:\/\//, '');
        if (files[p] && card.images.length < 60) card.images.push({ name: str(a.name), mime: MIME[(p.split('.').pop() ?? '').toLowerCase()] ?? 'image/png', bytes: files[p] });
      }
      const path = files[uri] ? uri : Object.keys(files).find((k) => /^assets\/icon\//.test(k)) ?? Object.keys(files).find((k) => k !== 'card.json');
      if (path && files[path]) {
        const ext = (path.split('.').pop() ?? '').toLowerCase();
        card.portrait = { mime: MIME[ext] ?? 'image/png', bytes: files[path] };
      } else if (zipStart > 0 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        card.portrait = { mime: 'image/jpeg', bytes: bytes.subarray(0, zipStart) }; // 표지 JPEG
      }
      return { card };
    }
    // JSON 카드
    return { card: normalize(JSON.parse(new TextDecoder().decode(bytes)), 'ccv1') };
  } catch (e) {
    return { card: null, error: `카드를 읽을 수 없습니다: ${(e as Error).message}` };
  }
}

/** {{char}} · {{user}} 매크로를 이름으로 바꾸고, 지원하지 않는 매크로는 지운다 */
export function replaceMacros(text: string, charName: string): string {
  let out = text
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, '\u0001')
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, '\u0002');
  // RisuAI CBS 문법({{#when::…}}, {{getvar::…}} 등)은 안쪽부터 반복해서 지운다 (조건부 내용 자체는 남긴다)
  for (let i = 0; i < 30 && /\{\{[^{}]*\}\}/.test(out); i++) out = out.replace(/\{\{[^{}]*\}\}/g, '');
  out = out
    .replace(/\{\{|\}\}/g, '')
    .replace(/<\/?[A-Za-z][^<>]{0,300}>/g, '') // HTML·의사 태그 (<img …>, <Hedwig> 등)
    .replace(/^\s*::[\w:]+.*$/gm, '') // CBS 잔여 줄 (::is::xxx)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // 매크로 뒤의 조사를 실제 이름의 받침에 맞게 고친다 (세렌는 → 세렌은)
  const PAIRS: Record<string, '이/가' | '은/는' | '을/를' | '과/와'> = { 이: '이/가', 가: '이/가', 은: '은/는', 는: '은/는', 을: '을/를', 를: '을/를', 과: '과/와', 와: '과/와' };
  const fill = (marker: string, word: string) => (t: string) =>
    t.replace(new RegExp(`${marker}(이|가|은|는|을|를|과|와)(?![가-힣])`, 'g'), (_, p: string) => josa(word, PAIRS[p]!)).split(marker).join(word);
  return fill('\u0002', '당신')(fill('\u0001', charName)(out));
}

/** 캐릭터 카드 파일로 보이는가 (패키지 가져오기에 잘못 넣었을 때 안내용) */
export function looksLikeCardFile(bytes: Uint8Array): boolean {
  return parseCardFile('probe', bytes).card !== null;
}
