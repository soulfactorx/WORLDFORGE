/**
 * 콘텐츠 패키지 파일 (설계 v3 10장 · R7): .chp(인물) · .rule(규칙) = zip { pack.json, images/<id> }.
 * 읽을 때 압축 폭탄·과도한 파일 수·큰 그림을 막는다. 스크립트는 없고 실행하지 않는다.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { checkPack, type ContentPack } from '../engine/package/packs';
import { shareBlocked, MATURE_NOTE } from '../engine/rating';
import type { WorldPackage } from '../engine/schema';
import { assetBlob, storeAssets } from './assets';
import { isPrivate, PRIVATE_NOTE } from './packages';

const MAX_FILE = 30 * 1024 * 1024;
const MAX_ENTRIES = 300;
const MAX_UNZIPPED = 60 * 1024 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const IMG = /^images\/([^/]{1,120})$/;

export const PACK_EXT = { character: 'chp', rules: 'rule' } as const;

/** 패키지 파일 만들기. 개인용·성인 등급 세계에서 나온 것은 공유할 수 없다 */
export async function exportPack(world: WorldPackage, pack: ContentPack): Promise<Blob> {
  if (isPrivate(world)) throw new Error(PRIVATE_NOTE);
  if (shareBlocked(world) || pack.manifest.contentRating === 'mature') throw new Error(MATURE_NOTE);
  const files: Record<string, Uint8Array> = { 'pack.json': strToU8(JSON.stringify(pack, null, 1)) };
  if ('assets' in pack) {
    for (const a of pack.assets) {
      if (a.id.startsWith('stock.')) continue; // 앱 내장 그림은 어디에나 있다
      const b = await assetBlob(world.manifest.id, a.id);
      if (b) files[`images/${a.id}`] = new Uint8Array(await b.arrayBuffer());
    }
  }
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export interface ParsedPack {
  pack: ContentPack | null;
  errors: string[];
  images: Record<string, Uint8Array>;
}

export function parsePack(name: string, bytes: Uint8Array): ParsedPack {
  const fail = (e: string): ParsedPack => ({ pack: null, errors: [e], images: {} });
  if (bytes.byteLength > MAX_FILE) return fail('파일이 너무 큽니다 (최대 30MB).');
  let files: Record<string, Uint8Array>;
  try {
    let count = 0, total = 0;
    files = unzipSync(bytes, {
      filter: (f) => {
        count++; total += f.originalSize;
        if (count > MAX_ENTRIES || total > MAX_UNZIPPED) throw new Error('압축을 풀면 너무 큽니다 (파일 수 또는 용량 초과).');
        return f.name === 'pack.json' || (IMG.test(f.name) && f.originalSize <= MAX_IMAGE);
      },
    });
  } catch (e) { return fail(`${name}: 압축 파일을 읽을 수 없습니다 — ${(e as Error).message}`); }
  if (!files['pack.json']) return fail(`${name}: pack.json이 없습니다. 인물(.chp)·규칙(.rule) 패키지가 아닌 것 같습니다.`);
  let data: unknown;
  try { data = JSON.parse(strFromU8(files['pack.json'])); } catch { return fail('pack.json을 읽을 수 없습니다.'); }
  const errors = checkPack(data);
  if (errors.length) return { pack: null, errors, images: {} };
  const images: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) { const m = IMG.exec(k); if (m) images[m[1]!] = v; }
  return { pack: data as ContentPack, errors: [], images };
}

/** 넣은 패키지의 그림을 세계 이미지 저장소에 (이름 바꾼 ID로) */
export async function storePackImages(worldId: string, images: Record<string, Uint8Array>, assetIds: Record<string, string>, mimeOf: (id: string) => string): Promise<number> {
  const items = Object.entries(assetIds).filter(([from]) => images[from]).map(([from, to]) => ({ id: to, read: async () => new Blob([new Uint8Array(images[from]!)], { type: mimeOf(from) }) }));
  const r = await storeAssets(worldId, items);
  return r.stored;
}
