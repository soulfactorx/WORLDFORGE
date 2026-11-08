/**
 * 저장소 사용량 (v0.77): IndexedDB에 무엇이 얼마나 있는지 세계관별로 세고, 안전하게 정리한다.
 * 크기: 이미지·카드 원본은 실제 바이트, 그 밖(세계 JSON·세이브 이벤트·기록)은 JSON 글자 수 × 2(UTF-16) 추정.
 */
import { BUILTIN } from './packages';
import { db } from './db';

const jsonBytes = (v: unknown) => { try { return JSON.stringify(v).length * 2; } catch { return 0; } };

export interface WorldStorage {
  id: string;
  name: string;
  builtin: boolean;
  versions: { key: string; version: string; bytes: number; updatedAt: number }[];
  images: { count: number; bytes: number; unusedCount: number; unusedBytes: number; unusedKeys: string[] };
  saves: { id: string; name: string; events: number; bytes: number; debugBytes: number; debugCount: number; updatedAt: number }[];
  total: number;
}
export interface StorageReport {
  estimate?: { usage: number; quota: number };
  persisted?: boolean;
  categories: { key: string; label: string; bytes: number; count: number }[];
  worlds: WorldStorage[];
  orphans: { images: { count: number; bytes: number; keys: string[] }; saves: { count: number; bytes: number; ids: string[] }; debug: { count: number; bytes: number; ids: string[] } };
  imports: { id: string; fileName: string; bytes: number; importedAt: number }[];
}

export async function storageReport(onStage?: (s: string) => void): Promise<StorageReport> {
  const estimate = await navigator.storage?.estimate?.().then((e) => ({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => undefined);
  const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
  onStage?.('세계관 읽는 중…');
  const packages = await db.packages.toArray();
  const saves = await db.saves.toArray();
  const builtinIds = new Set(BUILTIN.map((w) => w.manifest.id));
  const worlds = new Map<string, WorldStorage>();
  const worldOf = (id: string, name: string, builtin: boolean) => {
    let w = worlds.get(id);
    if (!w) { w = { id, name, builtin, versions: [], images: { count: 0, bytes: 0, unusedCount: 0, unusedBytes: 0, unusedKeys: [] }, saves: [], total: 0 }; worlds.set(id, w); }
    return w;
  };
  for (const b of BUILTIN) worldOf(b.manifest.id, b.manifest.name, true);
  // 세계관이 쓰는 이미지 ID (모든 버전)
  const usedIds = new Map<string, Set<string>>();
  for (const p of packages) {
    const w = worldOf(p.id, p.name, false);
    w.versions.push({ key: p.key, version: p.version, bytes: jsonBytes(p.world), updatedAt: p.updatedAt });
    const set = usedIds.get(p.id) ?? new Set<string>();
    (p.world.assets ?? []).forEach((a) => set.add(a.id));
    usedIds.set(p.id, set);
  }
  for (const b of BUILTIN) { const set = usedIds.get(b.manifest.id) ?? new Set<string>(); (b.assets ?? []).forEach((a) => set.add(a.id)); usedIds.set(b.manifest.id, set); }

  onStage?.('이미지 세는 중…');
  const orphanImages = { count: 0, bytes: 0, keys: [] as string[] };
  let imgCount = 0; let imgBytes = 0;
  await db.assets.each((a) => {
    const size = a.blob?.size ?? 0; imgCount++; imgBytes += size;
    const w = worlds.get(a.pkg);
    const known = !!w && (w.versions.length > 0 || builtinIds.has(a.pkg));
    if (!w || !known) { orphanImages.count++; orphanImages.bytes += size; orphanImages.keys.push(a.key); return; }
    w.images.count++; w.images.bytes += size;
    const id = a.key.slice(a.pkg.length + 1);
    if (!usedIds.get(a.pkg)?.has(id)) { w.images.unusedCount++; w.images.unusedBytes += size; w.images.unusedKeys.push(a.key); }
  });

  onStage?.('세이브 세는 중…');
  const saveIds = new Set(saves.map((s) => s.id));
  const evBySave = new Map<string, { n: number; bytes: number }>();
  let evBytes = 0; let evCount = 0;
  await db.events.each((e) => { const b = jsonBytes(e); evBytes += b; evCount++; const x = evBySave.get(e.saveId) ?? { n: 0, bytes: 0 }; x.n++; x.bytes += b; evBySave.set(e.saveId, x); });
  const dbgBySave = new Map<string, { n: number; bytes: number }>();
  let dbgBytes = 0; let dbgCount = 0;
  const orphanDebug = { count: 0, bytes: 0, ids: [] as string[] };
  await db.debug.each((d) => {
    const b = jsonBytes(d); dbgBytes += b; dbgCount++;
    const sid = (d as { saveId?: string }).saveId;
    if (sid && !saveIds.has(sid)) { orphanDebug.count++; orphanDebug.bytes += b; orphanDebug.ids.push(d.id); return; }
    const k = sid ?? '';
    const x = dbgBySave.get(k) ?? { n: 0, bytes: 0 }; x.n++; x.bytes += b; dbgBySave.set(k, x);
  });
  for (const s of saves) {
    const w = worldOf(s.packageId, packages.find((p) => p.id === s.packageId)?.name ?? BUILTIN.find((b) => b.manifest.id === s.packageId)?.manifest.name ?? s.packageId, builtinIds.has(s.packageId));
    const ev = evBySave.get(s.id) ?? { n: 0, bytes: 0 }; const dg = dbgBySave.get(s.id) ?? { n: 0, bytes: 0 };
    w.saves.push({ id: s.id, name: s.name, events: ev.n, bytes: ev.bytes + jsonBytes(s), debugBytes: dg.bytes, debugCount: dg.n, updatedAt: s.updatedAt });
  }
  const orphanSaves = { count: 0, bytes: 0, ids: [] as string[] };
  for (const [sid, x] of evBySave) if (!saveIds.has(sid)) { orphanSaves.count++; orphanSaves.bytes += x.bytes; orphanSaves.ids.push(sid); }

  onStage?.('나머지 세는 중…');
  const imports = (await db.imports.toArray()).map((i) => ({ id: i.id, fileName: i.fileName, bytes: i.bytes?.byteLength ?? 0, importedAt: i.importedAt }));
  let artBytes = 0; let artCount = 0; await db.userArt.each((a) => { artBytes += a.blob?.size ?? 0; artCount++; });
  let cacheBytes = 0; let cacheCount = 0; await db.genCache.each((c) => { cacheBytes += jsonBytes(c.value); cacheCount++; });
  const usageCount = await db.usage.count();
  let lsBytes = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; lsBytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2; } } catch { /* 없음 */ }

  for (const w of worlds.values()) w.total = w.versions.reduce((s, v) => s + v.bytes, 0) + w.images.bytes + w.saves.reduce((s, v) => s + v.bytes + v.debugBytes, 0);
  const pkgBytes = packages.reduce((s, p) => s + jsonBytes(p.world), 0);
  return {
    ...(estimate ? { estimate } : {}), ...(persisted !== undefined ? { persisted } : {}),
    categories: [
      { key: 'assets', label: '세계관 이미지', bytes: imgBytes, count: imgCount },
      { key: 'packages', label: '세계관 데이터 (버전 포함)', bytes: pkgBytes, count: packages.length },
      { key: 'events', label: '세이브 진행 기록', bytes: evBytes, count: evCount },
      { key: 'imports', label: '가져온 카드 원본', bytes: imports.reduce((s, i) => s + i.bytes, 0), count: imports.length },
      { key: 'genCache', label: '세계 만들기 중간 결과 (이어하기용)', bytes: cacheBytes, count: cacheCount },
      { key: 'debug', label: '디버그 기록', bytes: dbgBytes, count: dbgCount },
      { key: 'userArt', label: '내 기본 이미지', bytes: artBytes, count: artCount },
      { key: 'usage', label: 'AI 사용량 기록', bytes: usageCount * 400, count: usageCount },
      { key: 'local', label: '설정 등 (localStorage)', bytes: lsBytes, count: 0 },
    ],
    worlds: [...worlds.values()].filter((w) => !w.builtin || w.total > 0).sort((a, b) => b.total - a.total),
    orphans: { images: orphanImages, saves: orphanSaves, debug: orphanDebug },
    imports,
  };
}

// ---------------------------------------------------------------- 정리
export const deleteImageKeys = (keys: string[]) => db.assets.bulkDelete(keys);
export async function deleteEventsOf(saveIds: string[]) { for (const id of saveIds) await db.events.where('saveId').equals(id).delete(); }
export const deleteDebugIds = (ids: string[]) => db.debug.bulkDelete(ids);
export async function deleteDebugOfSaves(saveIds: string[]) { for (const id of saveIds) await db.debug.where('saveId').equals(id).delete(); }
export const clearGenCache = () => db.genCache.clear();
export const clearDebug = () => db.debug.clear();
export const deleteImport = (id: string) => db.imports.delete(id);
/** 같은 세계의 옛 버전 지우기 (가장 최근에 저장한 버전은 남긴다) */
export async function deleteOldVersions(worldId: string): Promise<number> {
  const vs = await db.packages.where('id').equals(worldId).sortBy('updatedAt');
  const old = vs.slice(0, -1).map((v) => v.key);
  await db.packages.bulkDelete(old);
  return old.length;
}

export const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);
