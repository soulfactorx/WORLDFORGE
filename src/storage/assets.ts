import { db } from './db';
import { stockDataUrl } from '../data/stockart';
import { userArtId, userArtUrl } from './userart';

/**
 * 세계관 이미지 저장소. 이미지는 패키지 JSON이 아니라 IndexedDB에 한 장씩 Blob으로 저장한다.
 * 수천 장도 메모리에 한꺼번에 올리지 않도록 조금씩 읽어 저장한다.
 */
export const assetKey = (pkg: string, id: string) => `${pkg}/${id}`;

export async function storeAssets(
  pkg: string, items: { id: string; read: () => Promise<Blob> }[],
  onProgress?: (done: number, total: number) => void, signal?: AbortSignal, batch = 24,
): Promise<{ stored: number; failed: string[] }> {
  const failed: string[] = [];
  let stored = 0;
  for (let i = 0; i < items.length; i += batch) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const part = items.slice(i, i + batch);
    const rows = (await Promise.all(part.map(async (it) => {
      try { return { key: assetKey(pkg, it.id), pkg, blob: await it.read() }; } catch { failed.push(it.id); return null; }
    }))).filter((r): r is NonNullable<typeof r> => !!r);
    await db.assets.bulkPut(rows);
    stored += rows.length;
    onProgress?.(Math.min(i + batch, items.length), items.length);
  }
  return { stored, failed };
}

export async function assetBlob(pkg: string, id: string): Promise<Blob | undefined> {
  return (await db.assets.get(assetKey(pkg, id)))?.blob;
}

/** 세계 이미지 지우기 (v0.53: 출처 카드를 뺀 뒤 저장할 때) */
export async function deleteAssets(pkg: string, ids: string[]): Promise<void> {
  if (ids.length) await db.assets.bulkDelete(ids.map((id) => assetKey(pkg, id)));
}

export async function assetCount(pkg: string): Promise<number> {
  return db.assets.where('pkg').equals(pkg).count();
}

/** 화면 표시용 object URL 캐시 (오래된 것부터 해제) */
const urls = new Map<string, string>();
const MAX_URLS = 300;
export async function assetUrl(pkg: string, id: string): Promise<string | undefined> {
  const stock = stockDataUrl(id); // 앱에 내장된 기본 이미지
  if (stock) return stock;
  const mine = userArtId(id); // 내 기본 이미지
  if (mine) return userArtUrl(mine);
  const key = assetKey(pkg, id);
  const hit = urls.get(key);
  if (hit) { urls.delete(key); urls.set(key, hit); return hit; }
  const blob = await assetBlob(pkg, id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  while (urls.size > MAX_URLS) { const [k, u] = urls.entries().next().value!; URL.revokeObjectURL(u); urls.delete(k); }
  return url;
}
