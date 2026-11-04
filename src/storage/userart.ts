/**
 * 내 기본 이미지 세트 (v0.17): 사용자가 직접 만든 그림을 앱 내장 기본 이미지처럼 쓴다.
 * - 이 브라우저에 저장되고, 모든 세계에서 쓸 수 있다
 * - 세계의 에셋 ID는 `user.<그림 ID>--<번호>` (기본 이미지와 같은 규칙)
 * - 묶음 파일(.wfart = zip: art.json + 이미지)로 백업·옮기기
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { StockArt } from '../data/stockart';
import { db, type UserArt } from './db';

export const userArtId = (assetId: string): string | undefined => (assetId.startsWith('user.') ? assetId.slice(5).replace(/--\d+$/, '') : undefined);

export async function listUserArt(): Promise<UserArt[]> {
  try { return await db.userArt.orderBy('createdAt').toArray(); } catch { return []; }
}

/** 배정·고르기용 목록 (그림 ID 앞에 `u:`를 붙여 내장 그림과 구분) */
export async function userStockArt(): Promise<StockArt[]> {
  return (await listUserArt()).map((a) => ({ id: `u:${a.id}`, kind: a.kind, label: `내 이미지: ${a.label}`, tags: a.tags, ...(a.gender ? { gender: a.gender } : {}) }));
}

/** 그림을 줄여 저장 (긴 변 최대 1024px, webp) */
async function shrink(file: Blob, max = 1024): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 600_000) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.88));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

export async function addUserArt(files: File[], meta: { kind: UserArt['kind']; gender?: UserArt['gender']; tags: string[] }, onProgress?: (d: number, t: number) => void): Promise<number> {
  let n = 0;
  for (const f of files) {
    if (!/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(f.type)) continue;
    const blob = f.type === 'image/svg+xml' ? f : await shrink(f);
    await db.userArt.put({ id: crypto.randomUUID().slice(0, 12), kind: meta.kind, label: baseName(f.name) || '그림', tags: meta.tags, ...(meta.gender ? { gender: meta.gender } : {}), blob, createdAt: Date.now() + n });
    onProgress?.(++n, files.length);
  }
  return n;
}

export async function updateUserArt(id: string, patch: Partial<Pick<UserArt, 'label' | 'tags' | 'gender' | 'kind'>>): Promise<void> {
  await db.userArt.update(id, patch);
}

export async function deleteUserArt(id: string): Promise<void> {
  await db.userArt.delete(id);
}

const urls = new Map<string, string>();
export async function userArtUrl(artId: string): Promise<string | undefined> {
  const hit = urls.get(artId);
  if (hit) return hit;
  try {
    const a = await db.userArt.get(artId);
    if (!a) return undefined;
    const u = URL.createObjectURL(a.blob);
    urls.set(artId, u);
    return u;
  } catch { return undefined; }
}

// ---------------------------------------------------------------- 묶음 파일 (.wfart)

const extOf = (t: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' } as Record<string, string>)[t] ?? 'bin';
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' };

export async function exportUserArt(): Promise<Blob> {
  const list = await listUserArt();
  const files: Record<string, Uint8Array> = {};
  const meta = list.map((a) => { const file = `images/${a.id}.${extOf(a.blob.type)}`; return { id: a.id, kind: a.kind, label: a.label, tags: a.tags, gender: a.gender, file }; });
  for (let i = 0; i < list.length; i++) files[meta[i]!.file] = new Uint8Array(await list[i]!.blob.arrayBuffer());
  files['art.json'] = strToU8(JSON.stringify({ format: 'worldforge-art', version: 1, items: meta }, null, 1));
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}

export async function importUserArt(file: Blob): Promise<number> {
  if (file.size > 300 * 1024 * 1024) throw new Error('파일이 너무 큽니다 (최대 300MB).');
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === 'art.json' || f.name.startsWith('images/') });
  const manifest = files['art.json'] ? JSON.parse(strFromU8(files['art.json'])) as { format?: string; items?: { id: string; kind: string; label: string; tags: string[]; gender?: string; file: string }[] } : null;
  if (manifest?.format !== 'worldforge-art' || !Array.isArray(manifest.items)) throw new Error('WORLDFORGE 기본 이미지 묶음(.wfart)이 아닙니다.');
  let n = 0;
  for (const it of manifest.items.slice(0, 5000)) {
    const bytes = files[it.file];
    const mime = MIME[(it.file.split('.').pop() ?? '').toLowerCase()];
    if (!bytes || !mime || !/^[\w-]{1,40}$/.test(it.id)) continue;
    await db.userArt.put({
      id: it.id, kind: it.kind === 'scene' ? 'scene' : 'character', label: String(it.label ?? '').slice(0, 60) || '그림',
      tags: Array.isArray(it.tags) ? it.tags.map(String).slice(0, 20) : [], ...(it.gender === 'M' || it.gender === 'F' ? { gender: it.gender } : {}),
      blob: new Blob([new Uint8Array(bytes)], { type: mime }), createdAt: Date.now() + n,
    });
    n++;
  }
  return n;
}
