import Dexie, { type EntityTable } from 'dexie';
import type { StoredEvent } from '../engine/state/events';
import type { StoredPackage } from './packages';

export interface SaveMeta {
  id: string;
  name: string;
  packageId: string;
  packageVersion: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 브라우저 IndexedDB 저장소. GitHub Pages(https)와 file:// 모두에서 동작하지만,
 * 브라우저가 지울 수 있으므로 반드시 exportSave()로 파일 백업을 제공한다.
 */
class WorldforgeDB extends Dexie {
  saves!: EntityTable<SaveMeta, 'id'>;
  events!: Dexie.Table<StoredEvent, [string, number]>;
  packages!: EntityTable<StoredPackage, 'key'>;
  /** 가져온 외부 파일 원본 보존 (설계서 6.4: 원본 CHARX 파일 보존) */
  imports!: EntityTable<{ id: string; fileName: string; format: string; bytes: Uint8Array; importedAt: number }, 'id'>;
  /** 세계관 이미지 (v0.13). key = `${패키지 ID}/${에셋 ID}` */
  assets!: EntityTable<{ key: string; pkg: string; blob: Blob }, 'key'>;
  constructor() {
    super('worldforge');
    this.version(1).stores({
      saves: 'id, updatedAt',
      events: '[saveId+seq], saveId',
    });
    // v0.9: 세계관 패키지 라이브러리
    this.version(2).stores({
      saves: 'id, updatedAt',
      events: '[saveId+seq], saveId',
      packages: 'key, id, updatedAt',
    });
    // v0.12: 가져온 캐릭터 카드 원본
    this.version(3).stores({
      saves: 'id, updatedAt',
      events: '[saveId+seq], saveId',
      packages: 'key, id, updatedAt',
      imports: 'id, importedAt',
    });
    // v0.13: 세계관 이미지 에셋
    this.version(4).stores({
      saves: 'id, updatedAt',
      events: '[saveId+seq], saveId',
      packages: 'key, id, updatedAt',
      imports: 'id, importedAt',
      assets: 'key, pkg',
    });
  }
}

export const db = new WorldforgeDB();

export async function loadEvents(saveId: string): Promise<StoredEvent[]> {
  return db.events.where('saveId').equals(saveId).sortBy('seq');
}

export async function appendEvents(saveId: string, events: StoredEvent[]): Promise<void> {
  await db.transaction('rw', db.events, db.saves, async () => {
    await db.events.bulkAdd(events);
    await db.saves.update(saveId, { updatedAt: Date.now() });
  });
}

/** 마지막 턴의 이벤트를 모두 지운다 (턴 되돌리기). */
export async function undoLastTurn(saveId: string): Promise<void> {
  const events = await loadEvents(saveId);
  const last = events.at(-1);
  if (!last || last.turn === 0) return;
  await db.events.where('saveId').equals(saveId).filter((e) => e.turn === last.turn).delete();
}

export async function deleteSave(saveId: string): Promise<void> {
  await db.transaction('rw', db.events, db.saves, async () => {
    await db.events.where('saveId').equals(saveId).delete();
    await db.saves.delete(saveId);
  });
}

// ---- 파일 내보내기 / 가져오기 ----

interface SaveFile {
  format: 'worldforge-save';
  formatVersion: 1;
  meta: SaveMeta;
  events: StoredEvent[];
}

export async function exportSave(saveId: string): Promise<Blob> {
  const meta = await db.saves.get(saveId);
  if (!meta) throw new Error('save not found');
  const pkg = await db.packages.where('id').equals(meta.packageId).first();
  if (pkg?.world.manifest.private) throw new Error('개인용 세계의 세이브는 내보낼 수 없습니다.');
  const file: SaveFile = { format: 'worldforge-save', formatVersion: 1, meta, events: await loadEvents(saveId) };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function importSave(text: string): Promise<SaveMeta> {
  const file = JSON.parse(text) as Partial<SaveFile>;
  if (file.format !== 'worldforge-save' || file.formatVersion !== 1 || !file.meta || !Array.isArray(file.events)) {
    throw new Error('WORLDFORGE 세이브 파일이 아닙니다.');
  }
  const id = crypto.randomUUID();
  const meta: SaveMeta = { ...file.meta, id, name: `${file.meta.name} (가져옴)`, updatedAt: Date.now() };
  await db.transaction('rw', db.events, db.saves, async () => {
    await db.saves.add(meta);
    await db.events.bulkAdd(file.events!.map((e) => ({ ...e, saveId: id })));
  });
  return meta;
}
