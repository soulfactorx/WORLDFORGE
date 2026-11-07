/**
 * 개인용 세계를 내 다른 기기로 옮기기 (v0.19) — 서버 없이 파일 하나로.
 *
 * 카드로 만든 세계는 만들 때 AI를 여러 번 써서 시간·비용이 든다. 이 파일로 PC에서 만든 세계와 세이브를
 * 스마트폰 등 다른 기기로 옮겨, AI를 다시 쓰지 않고 이어서 플레이한다.
 *
 * 공유 방지: 내용은 원본 카드의 지문으로 암호화된다(AES-GCM). 같은 카드 파일을 가진 사람만 열 수 있고,
 * 받는 기기에서도 원본 카드를 함께 골라야 한다. 카드의 이미지는 파일에 넣지 않고 받는 기기에서 카드에서 다시 읽는다.
 *
 * 파일(.wfmove) = zip { move.json: 머리말(카드 이름·암호화 정보), data.bin: 암호문 }
 * 암호문을 풀면 zip { world.json, saves.json, art.json, art/<id> (내 기본 이미지) }
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { WorldPackage } from '../engine/schema';
import type { StoredEvent } from '../engine/state/events';
import { type CharxBundle, readCharxBundle } from '../importers/bundle';
import { storeAssets } from './assets';
import { sourcesOf } from '../engine/sources';
import { db, loadEvents, type SaveMeta } from './db';

const MAGIC = 'worldforge-move';

/** lock: card = 원본 카드 지문이 열쇠 (타인 작품 기반 세계), pass = 암호가 열쇠 (직접 만든 성인 등급 세계) */
/** cards (v0.53): 이 세계에 쓴 모든 카드 — 받는 기기에서 모든 원본 파일이 있어야 열린다 (열쇠 = 모든 지문) */
export interface MoveHeader { format: typeof MAGIC; version: 1; lock?: 'card' | 'pass'; cardName: string; worldName: string; salt: string; iv: string; createdAt: string; cards?: { name: string; hash: string; fileName?: string }[] }
interface MovePayload { assets?: { id: string; mime: string; file: string }[]; world: WorldPackage; saves: { meta: SaveMeta; events: StoredEvent[] }[]; art: { id: string; kind: 'character' | 'scene'; label: string; tags: string[]; gender?: 'M' | 'F'; mime: string; file: string }[] }

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyForPass(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(strToU8(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 150_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** 열쇠: 카드 지문 (여러 장이면 정렬해 이은 것 — 한 장이면 예전 파일과 같다) */
async function keyFor(cardHash: string | string[], salt: Uint8Array): Promise<CryptoKey> {
  const material = Array.isArray(cardHash) ? [...cardHash].sort().join('+') : cardHash;
  const raw = await crypto.subtle.digest('SHA-256', new Uint8Array([...strToU8(`worldforge-move:${material}:`), ...salt]));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** 옮기기 파일 만들기. 세계에 카드 지문이 없으면(예전 세계) 원본 카드를 함께 줘야 한다 */
export async function exportMove(world: WorldPackage, card?: CharxBundle, passphrase?: string): Promise<Blob> {
  if (!world.manifest.private) {
    // 직접 만든 성인 등급 세계: 암호로 잠근다 (이미지도 파일에 담는다)
    if (world.manifest.contentRating !== 'mature') throw new Error('개인용·성인 등급 세계만 이 방식으로 옮깁니다. 일반 세계는 .wpk로 내보내세요.');
    if (!passphrase || passphrase.length < 4) throw new Error('옮기기 암호를 4자 이상 정해 주세요.');
    return packMove(world, { lock: 'pass', cardName: '', key: (salt) => keyForPass(passphrase, salt), withAssets: true });
  }
  // 출처 카드 모두 (v0.53). 예전 세계는 private.cardHash 하나, 그것도 없으면 원본 카드를 받는다
  let cards = sourcesOf(world).filter((s) => s.hash).map((s) => ({ name: s.name, hash: s.hash, ...(s.fileName ? { fileName: s.fileName } : {}) }));
  if (!cards.length) {
    if (!card) throw new Error('원본 카드 파일이 필요합니다 (이 세계는 카드 지문이 저장되기 전에 만들었습니다).');
    if (!world.manifest.private.source.startsWith(card.card.name)) throw new Error(`이 세계는 "${world.manifest.private.source}"로 만들었습니다. 같은 카드 파일을 골라 주세요.`);
    cards = [{ name: card.card.name, hash: card.fingerprint, fileName: card.fileName }];
  } else if (card && !cards.some((c) => c.hash === card.fingerprint)) throw new Error('이 세계에 쓴 카드가 아닙니다.');
  cards = cards.filter((c, i) => cards.findIndex((x) => x.hash === c.hash) === i);
  const w: WorldPackage = { ...world, manifest: { ...world.manifest, private: { ...world.manifest.private, cardHash: world.manifest.private.cardHash ?? cards[0]!.hash } } };
  const hashes = cards.map((c) => c.hash);
  return packMove(w, { lock: 'card', cardName: cards.map((c) => c.name).join(' · '), cards, key: (salt) => keyFor(hashes.length === 1 ? hashes[0]! : hashes, salt), withAssets: false });
}

async function packMove(w: WorldPackage, o: { lock: 'card' | 'pass'; cardName: string; cards?: MoveHeader['cards']; key: (salt: Uint8Array) => Promise<CryptoKey>; withAssets: boolean }): Promise<Blob> {
  const saves = await Promise.all((await db.saves.toArray()).filter((s) => s.packageId === w.manifest.id).map(async (meta) => ({ meta, events: await loadEvents(meta.id) })));
  const files: Record<string, Uint8Array> = {};
  const art: MovePayload['art'] = [];
  const usedArt = new Set((w.assets ?? []).filter((a) => a.id.startsWith('user.')).map((a) => a.id.slice(5).replace(/--\d+$/, '')));
  for (const id of usedArt) {
    const a = await db.userArt.get(id);
    if (!a) continue;
    const file = `art/${id}`;
    files[file] = new Uint8Array(await a.blob.arrayBuffer());
    art.push({ id, kind: a.kind, label: a.label, tags: a.tags, ...(a.gender ? { gender: a.gender } : {}), mime: a.blob.type || 'image/webp', file });
  }
  // 카드가 없는 세계는 저장된 이미지도 담는다
  const assets: NonNullable<MovePayload['assets']> = [];
  if (o.withAssets) {
    for (const a of w.assets ?? []) {
      if (a.id.startsWith('stock.') || a.id.startsWith('user.')) continue;
      const row = await db.assets.get(`${w.manifest.id}/${a.id}`);
      if (!row) continue;
      const file = `assets/${a.id}`;
      files[file] = new Uint8Array(await row.blob.arrayBuffer());
      assets.push({ id: a.id, mime: row.blob.type || a.mime, file });
    }
  }
  files['world.json'] = strToU8(JSON.stringify(w));
  files['saves.json'] = strToU8(JSON.stringify(saves));
  files['art.json'] = strToU8(JSON.stringify(art));
  files['assets.json'] = strToU8(JSON.stringify(assets));
  const plain = zipSync(files, { level: 6 });

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await o.key(salt), plain));
  const header: MoveHeader = { format: MAGIC, version: 1, lock: o.lock, cardName: o.cardName, worldName: w.manifest.name, salt: b64(salt), iv: b64(iv), createdAt: new Date().toISOString(), ...(o.cards?.length ? { cards: o.cards } : {}) };
  return new Blob([zipSync({ 'move.json': strToU8(JSON.stringify(header, null, 1)), 'data.bin': cipher }, { level: 0 })], { type: 'application/octet-stream' });
}

/** 옮기기 파일의 머리말 (카드 없이도 읽힌다: 어떤 카드가 필요한지 알려주기 위해) */
export async function readMoveHeader(file: Blob): Promise<MoveHeader> {
  let parts: Record<string, Uint8Array>;
  try { parts = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === 'move.json' }); } catch { throw new Error('WORLDFORGE 옮기기 파일(.wfmove)이 아닙니다.'); }
  const h = parts['move.json'] ? JSON.parse(strFromU8(parts['move.json'])) as MoveHeader : null;
  if (h?.format !== MAGIC) throw new Error('WORLDFORGE 옮기기 파일(.wfmove)이 아닙니다.');
  return h;
}

/** 받기: 옮기기 파일 + 같은 원본 카드 → 세계·이미지·세이브·내 기본 이미지를 이 기기에 저장 */
/**
 * 받기. 카드로 잠긴 파일은 같은 원본 카드(cardFile)가, 암호로 잠긴 파일은 암호(passphrase)가 필요하다.
 */
/** 받는 쪽: 고른 카드 파일들 중 이 옮기기 파일에 필요한 카드가 모두 있는가 (v0.53) */
export function missingCards(header: MoveHeader, have: string[]): { name: string; hash: string; fileName?: string }[] {
  return (header.cards ?? []).filter((c) => !have.includes(c.hash));
}

export async function importMove(moveFile: Blob, cardFiles: Blob | null | { blob: Blob; name: string; bundle?: CharxBundle }[], cardFileName: string, onProgress?: (msg: string, done?: number, total?: number) => void, passphrase?: string): Promise<{ world: WorldPackage; saves: number; images: number }> {
  const header = await readMoveHeader(moveFile);
  const parts = unzipSync(new Uint8Array(await moveFile.arrayBuffer()));
  const byPass = header.lock === 'pass';
  const files0 = cardFiles === null ? [] : cardFiles instanceof Blob ? [{ blob: cardFiles, name: cardFileName }] : cardFiles;
  const bundles: CharxBundle[] = [];
  let key: CryptoKey;
  if (byPass) {
    if (!passphrase) throw new Error('이 파일은 암호로 잠겨 있습니다. 옮길 때 정한 암호를 입력해 주세요.');
    key = await keyForPass(passphrase, unb64(header.salt));
  } else {
    if (!files0.length) throw new Error(`원본 카드 파일이 필요합니다: "${header.cardName}"`);
    for (const [i, f] of files0.entries()) { onProgress?.(`원본 카드 읽는 중… (${i + 1}/${files0.length})`); bundles.push('bundle' in f && f.bundle ? f.bundle : await readCharxBundle(f.blob, f.name)); }
    const have = bundles.map((b) => b.fingerprint);
    const missing = missingCards(header, have);
    if (missing.length) throw new Error(`이 세계에 쓴 카드 파일이 모두 있어야 합니다 (고른 파일이 다른 카드일 수 있습니다). 빠진 카드: ${missing.map((c) => `"${c.name}"${c.fileName ? ` (${c.fileName})` : ''}`).join(', ')}`);
    const hashes = header.cards?.length ? header.cards.map((c) => c.hash) : [bundles[0]!.fingerprint];
    key = await keyFor(hashes.length === 1 ? hashes[0]! : hashes, unb64(header.salt));
  }
  const bundle = bundles[0];
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(header.iv) }, key, parts['data.bin']!));
  } catch {
    throw new Error(byPass ? '암호가 맞지 않습니다.' : `이 파일을 만든 카드와 다른 카드입니다. "${header.cardName}" 카드 파일을 골라 주세요.`);
  }
  const files = unzipSync(plain);
  const payload: MovePayload = {
    world: JSON.parse(strFromU8(files['world.json']!)), saves: JSON.parse(strFromU8(files['saves.json']!)), art: JSON.parse(strFromU8(files['art.json']!)),
    ...(files['assets.json'] ? { assets: JSON.parse(strFromU8(files['assets.json'])) } : {}),
  };
  const world = payload.world;
  const pkg = world.manifest.id;

  const items: { id: string; read: () => Promise<Blob> }[] = [];
  let missing = 0;
  if (bundle) {
    // 카드 이미지는 그 이미지를 가져온 카드 파일에서 다시 읽는다 (이름·크기로 맞춤, v0.53: 카드 여러 장)
    const fileOf = (b: CharxBundle) => [...b.assets.map((a) => ({ name: a.name, size: a.size, read: a.read })), ...(b.cover ? [{ name: 'cover', size: b.cover.size, read: async () => b.cover! }] : [])];
    const byHash = new Map(bundles.map((b) => [b.fingerprint, fileOf(b)]));
    const owner = new Map<string, string>();
    for (const s of sourcesOf(world)) for (const id of s.ids?.assets ?? []) owner.set(id, s.hash);
    for (const a of world.assets ?? []) {
      if (a.id.startsWith('stock.') || a.id.startsWith('user.')) continue;
      const pool = owner.has(a.id) ? byHash.get(owner.get(a.id)!) ?? [] : [...byHash.values()].flat();
      const src = pool.find((s) => s.name === a.name && s.size === a.size) ?? pool.find((s) => s.name === a.name);
      if (src) items.push({ id: a.id, read: src.read }); else missing++;
    }
  }
  for (const a of payload.assets ?? []) {
    const bytes = files[a.file];
    if (bytes) items.push({ id: a.id, read: async () => new Blob([new Uint8Array(bytes)], { type: a.mime }) });
  }
  const saved = await storeAssets(pkg, items, (d, t) => onProgress?.('이미지 저장 중…', d, t));

  for (const a of payload.art) {
    const bytes = files[a.file];
    if (!bytes || (await db.userArt.get(a.id))) continue;
    await db.userArt.put({ id: a.id, kind: a.kind, label: a.label, tags: a.tags, ...(a.gender ? { gender: a.gender } : {}), blob: new Blob([new Uint8Array(bytes)], { type: a.mime }), createdAt: Date.now() });
  }

  onProgress?.('세계·세이브 저장 중…');
  await db.packages.put({ key: `${pkg}@${world.manifest.version}`, id: pkg, version: world.manifest.version, name: world.manifest.name, world, source: 'import', updatedAt: Date.now() });
  await db.transaction('rw', db.saves, db.events, async () => {
    for (const s of payload.saves) {
      // 같은 세이브를 다시 옮기면 최신 것으로 바꾼다
      await db.events.where('saveId').equals(s.meta.id).delete();
      await db.saves.put(s.meta);
      await db.events.bulkPut(s.events.map((e) => ({ ...e, saveId: s.meta.id })));
    }
  });
  if (missing) onProgress?.(`카드에서 찾지 못한 이미지 ${missing}장은 빠졌습니다.`);
  return { world, saves: payload.saves.length, images: saved.stored };
}
