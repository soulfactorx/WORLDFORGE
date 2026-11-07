/**
 * CHARX 전체 읽기 — card.json + module.risum(rpack 해독) + Lua 데이터 + 모든 이미지 목록.
 * 파일 전체를 메모리에 올리지 않는다(BlobZip). 이미지는 목록만 만들고, 저장할 때 하나씩 읽는다.
 */
import { BlobZip } from './blobzip';
import { type LoreEntry, normalize, type NormalizedCard, parseCardFile } from './charx';
import { extractLuaData, type LuaValue } from './luadata';
import { parseRisum, type RisuModule } from './risum';

export interface BundleAsset {
  name: string;
  ext: string;
  mime: string;
  size: number;
  /** card.json에 있던 에셋 종류 (icon, x-risu-asset, emotion 등) */
  cardType?: string;
  source: 'card' | 'module' | 'zip';
  read: () => Promise<Blob>;
}

export interface CharxBundle {
  fileName: string;
  fileSize: number;
  card: NormalizedCard;
  rawCard: Record<string, unknown>;
  module?: RisuModule;
  /** 모듈 로어북 중 카드에 없는 항목 */
  extraLore: LoreEntry[];
  lua: { code: string; data: Record<string, LuaValue> };
  regexComments: string[];
  toggles: string;
  assets: BundleAsset[];
  cover?: Blob;
  warnings: string[];
  /** 카드 지문 (card.json 또는 카드 파일의 SHA-256) — 같은 카드인지 확인하고, 기기 간 이동 파일의 열쇠로 쓴다 */
  fingerprint: string;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const isImage = (ext: string) => ext.toLowerCase() in MIME;
const extOf = (p: string) => (p.split('.').pop() ?? '').toLowerCase();
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export async function readCharxBundle(file: Blob, fileName = 'card.charx', onProgress?: (msg: string) => void): Promise<CharxBundle> {
  const warnings: string[] = [];
  // RisuAI 모듈(.risum): 로어북 + 이미지 에셋 (v0.61)
  if (/\.risum$/i.test(fileName) || (await file.slice(0, 1).arrayBuffer().then((b) => new Uint8Array(b)[0])) === 111) {
    const risum = await readRisumBundle(file, fileName, onProgress).catch((e: Error) => { if (/\.risum$/i.test(fileName)) throw e; return null; });
    if (risum) return risum;
  }
  const zip = await BlobZip.open(file);
  if (!zip) {
    // zip이 아니면 PNG·JSON 카드 (작은 파일)
    const all = new Uint8Array(await file.arrayBuffer());
    const r = parseCardFile(fileName, all);
    if (!r.card) throw new Error(r.error ?? '카드를 읽을 수 없습니다.');
    const fingerprint = await sha256Hex(all);
    return {
      fingerprint,
      fileName, fileSize: file.size, card: r.card, rawCard: {}, extraLore: [], lua: { code: '', data: {} }, regexComments: [], toggles: '',
      assets: r.card.images.map((i) => ({ name: i.name, ext: i.mime.split('/')[1]!, mime: i.mime, size: i.bytes.byteLength, source: 'card' as const, read: async () => new Blob([new Uint8Array(i.bytes)], { type: i.mime }) })),
      warnings,
    };
  }
  onProgress?.('card.json 읽는 중…');
  const cardEntry = zip.get('card.json');
  if (!cardEntry) throw new Error('CHARX 안에 card.json이 없습니다.');
  const cardBytes = await zip.readBytes(cardEntry, 200 * 1024 * 1024);
  const fingerprint = await sha256Hex(cardBytes);
  const rawCard = JSON.parse(new TextDecoder().decode(cardBytes)) as Record<string, unknown>;
  const card = normalize(rawCard, 'charx');
  const data = (isObj(rawCard.data) ? rawCard.data : rawCard) as Record<string, unknown>;

  // ---- 모듈
  let module: RisuModule | undefined;
  let moduleAssets: Awaited<ReturnType<typeof parseRisum>>['assets'] = [];
  const modEntry = zip.get('module.risum');
  if (modEntry) {
    onProgress?.('module.risum 해독 중…');
    try {
      const r = await parseRisum(await zip.readBlob(modEntry));
      module = r.module;
      moduleAssets = r.assets;
      card.unsupported = card.unsupported.filter((u) => !u.includes('module.risum'));
    } catch (e) {
      warnings.push(`module.risum을 읽지 못했습니다: ${(e as Error).message}`);
    }
  }
  const cardLoreKeys = new Set(card.lore.map((e) => e.content.slice(0, 200)));
  const extraLore: LoreEntry[] = (module?.lorebook ?? [])
    .filter((e) => e.content && e.mode !== 'folder' && !cardLoreKeys.has(e.content.slice(0, 200)))
    .map((e) => ({ name: e.comment ?? '', keys: (e.key ?? '').split(',').map((k) => k.trim()).filter(Boolean), content: e.content!.trim(), enabled: true, ...(e.alwaysActive ? { constant: true } : {}) }));

  // ---- Lua (트리거 코드) — 실행하지 않고 데이터만
  const codes = (module?.trigger ?? []).flatMap((t) => (t.effect ?? []).map((e) => e.code ?? '')).filter(Boolean);
  const risu = isObj(data.extensions) && isObj((data.extensions as Record<string, unknown>).risuai) ? (data.extensions as Record<string, Record<string, unknown>>).risuai! : {};
  const code = codes.join('\n\n');
  const luaData = code ? extractLuaData(code) : {};

  // ---- 이미지: card.json의 에셋 목록 + 모듈 에셋 + zip 안의 나머지 이미지
  const assets: BundleAsset[] = [];
  const used = new Set<string>();
  const cardAssets = Array.isArray(data.assets) ? (data.assets as unknown[]).filter(isObj) : [];
  for (const a of cardAssets) {
    const path = String(a.uri ?? '').replace(/^embed(d)?ed:\/\//, '');
    const en = zip.get(path);
    const ext = String(a.ext ?? extOf(path)).toLowerCase();
    if (!en || !isImage(ext)) continue;
    used.add(path);
    assets.push({ name: String(a.name ?? path), ext, mime: MIME[ext]!, size: en.size, cardType: String(a.type ?? ''), source: 'card', read: () => zip.readBlob(en, MIME[ext]) });
  }
  for (const a of moduleAssets) {
    const ext = a.ext.toLowerCase();
    if (!isImage(ext)) continue;
    assets.push({ name: a.name, ext, mime: MIME[ext]!, size: a.size, source: 'module', read: async () => new Blob([new Uint8Array(await a.read())], { type: MIME[ext] }) });
  }
  for (const en of zip.entries) {
    if (used.has(en.name) || !en.name.startsWith('assets/')) continue;
    const ext = extOf(en.name);
    if (!isImage(ext)) continue;
    assets.push({ name: en.name.split('/').pop()!.replace(/\.[^.]+$/, ''), ext, mime: MIME[ext]!, size: en.size, source: 'zip', read: () => zip.readBlob(en, MIME[ext]) });
  }
  const cover = zip.prefixBytes > 0 ? file.slice(0, zip.prefixBytes, 'image/jpeg') : undefined;

  return {
    fingerprint, fileName, fileSize: file.size, card, rawCard, module, extraLore, lua: { code, data: luaData },
    regexComments: (module?.regex ?? []).map((r) => r.comment ?? '').filter(Boolean),
    toggles: typeof risu.toggles === 'string' ? risu.toggles : '', assets, cover, warnings,
  };
}

/** RisuAI 토글 설정 문자열 → 선택지 목록 (예: kc_scenario=빙의·전이=select=카르엔야에 빙의,다른 인물에 빙의,…) */
export function parseToggles(text: string): { key: string; label: string; kind: string; options: string[]; caption?: string }[] {
  const out: { key: string; label: string; kind: string; options: string[]; caption?: string }[] = [];
  for (const line of text.split('\n')) {
    const parts = line.split('=');
    if (parts.length < 3) continue;
    const [key, label, kind, opts] = parts;
    if (!key) { if (kind === 'caption' && out.length) out[out.length - 1]!.caption = label; continue; }
    out.push({ key: key!, label: label ?? key!, kind: kind ?? '', options: (opts ?? '').split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return out;
}

/** RisuAI 모듈(.risum) 하나를 카드 묶음처럼 읽는다: 모듈 이름·설명 → 카드, 로어북 → 로어, 에셋 → 이미지 (v0.61) */
async function readRisumBundle(file: Blob, fileName: string, onProgress?: (msg: string) => void): Promise<CharxBundle> {
  onProgress?.('RisuAI 모듈 해독 중…');
  const r = await parseRisum(file);
  const m = r.module;
  // 지문: 모듈 본문(로어북·에셋 목록)이 있는 앞부분 — 큰 파일도 통째로 읽지 않는다
  const fingerprint = await sha256Hex(new Uint8Array(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer()));
  const lore: LoreEntry[] = (m.lorebook ?? [])
    .filter((e) => e.content && e.mode !== 'folder')
    .map((e) => ({ name: e.comment ?? '', keys: (e.key ?? '').split(',').map((k) => k.trim()).filter(Boolean), content: e.content!.trim(), enabled: true, ...(e.alwaysActive ? { constant: true } : {}) }));
  const name = (m.name ?? '').trim() || fileName.replace(/\.risum$/i, '');
  const card: NormalizedCard = {
    format: 'risum', name, nickname: '', description: (m.description ?? '').trim(), personality: '', scenario: '', firstMes: '', mesExample: '',
    creator: '', version: '', tags: [], lore, ignoredPrompts: [], unsupported: [], images: [],
  };
  const codes = (m.trigger ?? []).flatMap((t) => (t.effect ?? []).map((e) => e.code ?? '')).filter(Boolean);
  const code = codes.join('\n\n');
  const assets: BundleAsset[] = r.assets.filter((a) => isImage(a.ext)).map((a) => {
    const ext = a.ext.toLowerCase();
    return { name: a.name, ext, mime: MIME[ext]!, size: a.size, source: 'module' as const, read: async () => new Blob([new Uint8Array(await a.read())], { type: MIME[ext] }) };
  });
  const skipped = r.assets.length - assets.length;
  return {
    fingerprint, fileName, fileSize: file.size, card, rawCard: {}, module: m, extraLore: [], lua: { code, data: code ? extractLuaData(code) : {} },
    regexComments: (m.regex ?? []).map((x) => x.comment ?? '').filter(Boolean), toggles: typeof m.customModuleToggle === 'string' ? m.customModuleToggle : '',
    assets, warnings: [`RisuAI 모듈 파일입니다 — 인물 카드 본문 없이 로어북 ${lore.length}개와 이미지 ${assets.length}장을 가져옵니다.${skipped ? ` (이미지가 아닌 에셋 ${skipped}개는 뺐습니다)` : ''}`],
  };
}
