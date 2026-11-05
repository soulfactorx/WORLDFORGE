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
import { db, loadEvents, type SaveMeta } from './db';

const MAGIC = 'worldforge-move';

/** lock: card = 원본 카드 지문이 열쇠 (타인 작품 기반 세계), pass = 암호가 열쇠 (직접 만든 성인 등급 세계) */
interface MoveHeader { format: typeof MAGIC; version: 1; lock?: 'card' | 'pass'; cardName: string; worldName: string; salt: string; iv: string; createdAt: string }
interface MovePayload { assets?: { id: string; mime: string; file: string }[]; world: WorldPackage; saves: { meta: SaveMeta; events: StoredEvent[] }[]; art: { id: string; kind: 'character' | 'scene'; label: string; tags: string[]; gender?: 'M' | 'F'; mime: string; file: string }[] }

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyForPass(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(strToU8(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 150_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function keyFor(cardHash: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new Uint8Array([...strToU8(`worldforge-move:${cardHash}:`), ...salt]));
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
  let cardHash = world.manifest.private.cardHash;
  if (card) {
    if (cardHash && cardHash !== card.fingerprint) throw new Error('이 세계를 만든 카드와 다른 카드 파일입니다.');
    if (!cardHash && !world.manifest.private.source.startsWith(card.card.name)) throw new Error(`이 세계는 "${world.manifest.private.source}"로 만들었습니다. 같은 카드 파일을 골라 주세요.`);
    cardHash = card.fingerprint;
  }
  if (!cardHash) throw new Error('원본 카드 파일이 필요합니다 (이 세계는 카드 지문이 저장되기 전에 만들었습니다).');
  const w: WorldPackage = { ...world, manifest: { ...world.manifest, private: { ...world.manifest.private, cardHash } } };
  const hash = cardHash;
  return packMove(w, { lock: 'card', cardName: w.manifest.private!.source, key: (salt) => keyFor(hash, salt), withAssets: false });
}

async function packMove(w: WorldPackage, o: { lock: 'card' | 'pass'; cardName: string; key: (salt: Uint8Array) => Promise<CryptoKey>; withAssets: boolean }): Promise<Blob> {
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
  const header: MoveHeader = { format: MAGIC, version: 1, lock: o.lock, cardName: o.cardName, worldName: w.manifest.name, salt: b64(salt), iv: b64(iv), createdAt: new Date().toISOString() };
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
export async function importMove(moveFile: Blob, cardFile: Blob | null, cardFileName: string, onProgress?: (msg: string, done?: number, total?: number) => void, passphrase?: string): Promise<{ world: WorldPackage; saves: number; images: number }> {
  const header = await readMoveHeader(moveFile);
  const parts = unzipSync(new Uint8Array(await moveFile.arrayBuffer()));
  const byPass = header.lock === 'pass';
  let bundle: CharxBundle | undefined;
  let key: CryptoKey;
  if (byPass) {
    if (!passphrase) throw new Error('이 파일은 암호로 잠겨 있습니다. 옮길 때 정한 암호를 입력해 주세요.');
    key = await keyForPass(passphrase, unb64(header.salt));
  } else {
    if (!cardFile) throw new Error(`원본 카드 파일이 필요합니다: "${header.cardName}"`);
    onProgress?.('원본 카드 읽는 중…');
    bundle = await readCharxBundle(cardFile, cardFileName);
    key = await keyFor(bundle.fingerprint, unb64(header.salt));
  }
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
    // 카드 이미지는 카드에서 다시 읽는다 (이름·크기로 맞춤)
    const b = bundle;
    const sources = [...b.assets.map((a) => ({ name: a.name, size: a.size, read: a.read })), ...(b.cover ? [{ name: 'cover', size: b.cover.size, read: async () => b.cover! }] : [])];
    for (const a of world.assets ?? []) {
      if (a.id.startsWith('stock.') || a.id.startsWith('user.')) continue;
      const src = sources.find((s) => s.name === a.name && s.size === a.size) ?? sources.find((s) => s.name === a.name);
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
