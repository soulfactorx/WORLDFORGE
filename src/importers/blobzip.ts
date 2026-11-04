/**
 * Blob 기반 zip 리더 — 파일 전체를 메모리에 올리지 않고 필요한 항목만 잘라 읽는다.
 * 100MB를 넘는 CHARX(이미지 수천 장)도 처리할 수 있도록:
 *  - 끝부분만 읽어 중앙 디렉터리를 찾고(ZIP64 포함),
 *  - 표지 이미지처럼 앞에 데이터가 붙은 zip은 오프셋 차이를 보정하고,
 *  - 압축하지 않은(STORE) 항목은 Blob.slice로 복사 없이 넘긴다.
 */
import { inflateSync } from 'fflate';

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  size: number;
  localOffset: number; // 보정된 절대 오프셋
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));
const dec = new TextDecoder();

async function bytesOf(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export class BlobZip {
  private constructor(readonly blob: Blob, readonly entries: ZipEntry[], readonly prefixBytes: number) {}

  private byName = new Map<string, ZipEntry>();

  static async open(blob: Blob, limits = { maxEntries: 200_000 }): Promise<BlobZip | null> {
    const size = blob.size;
    if (size < 22) return null;
    const tailStart = Math.max(0, size - (65_535 + 22 + 20));
    const tail = await bytesOf(blob, tailStart, size);
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (u32(tv, i) === 0x06054b50) { e = i; break; }
    if (e < 0) return null;
    let count = u16(tv, e + 10);
    let cdSize = u32(tv, e + 12);
    let cdOffset = u32(tv, e + 16);
    let recordStart = tailStart + e; // 중앙 디렉터리 바로 뒤에 오는 레코드의 실제 위치
    // ZIP64
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = e - 20;
      if (loc >= 0 && u32(tv, loc) === 0x07064b50) {
        const z64Rel = u64(tv, loc + 8);
        // 위치 지시자 바로 앞에 ZIP64 EOCD가 온다 (56바이트)
        const z64Actual = tailStart + loc - 56;
        const head = await bytesOf(blob, z64Actual, z64Actual + 56);
        const hv = new DataView(head.buffer);
        if (u32(hv, 0) === 0x06064b50) {
          count = u64(hv, 32);
          cdSize = u64(hv, 40);
          cdOffset = u64(hv, 48);
          recordStart = z64Actual;
          void z64Rel;
        }
      }
    }
    if (count > limits.maxEntries) throw new Error(`zip 항목이 너무 많습니다 (${count}개)`);
    const cdStart = recordStart - cdSize;
    const delta = cdStart - cdOffset; // 앞에 붙은 데이터 길이 (보통 0)
    if (cdStart < 0 || delta < 0) return null;
    const cd = await bytesOf(blob, cdStart, cdStart + cdSize);
    const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (u32(v, p) !== 0x02014b50) break;
      const method = u16(v, p + 10);
      let compressedSize = u32(v, p + 20);
      let sizeU = u32(v, p + 24);
      const nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), commentLen = u16(v, p + 32);
      let localOffset = u32(v, p + 42);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      // ZIP64 확장 필드
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = u16(v, x), len = u16(v, x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (sizeU === 0xffffffff) { sizeU = u64(v, q); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = u64(v, q); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = u64(v, q); q += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name, method, compressedSize, size: sizeU, localOffset: localOffset + delta });
      p += 46 + nameLen + extraLen + commentLen;
    }
    const z = new BlobZip(blob, entries, delta);
    for (const en of entries) z.byName.set(en.name, en);
    return z;
  }

  get(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  /** 항목 데이터의 시작 위치 (로컬 헤더 뒤) */
  private async dataStart(e: ZipEntry): Promise<number> {
    const h = await bytesOf(this.blob, e.localOffset, e.localOffset + 30);
    const hv = new DataView(h.buffer);
    if (u32(hv, 0) !== 0x04034b50) throw new Error(`손상된 zip 항목: ${e.name}`);
    return e.localOffset + 30 + u16(hv, 26) + u16(hv, 28);
  }

  /** 항목을 Blob으로 (STORE면 복사 없이 잘라낸다) */
  async readBlob(e: ZipEntry, type = ''): Promise<Blob> {
    const start = await this.dataStart(e);
    if (e.method === 0) return this.blob.slice(start, start + e.compressedSize, type);
    return new Blob([new Uint8Array(await this.readBytesFrom(e, start))], { type });
  }

  async readBytes(e: ZipEntry, maxBytes = 512 * 1024 * 1024): Promise<Uint8Array> {
    if (e.size > maxBytes) throw new Error(`${e.name}이(가) 너무 큽니다 (${Math.round(e.size / 1048576)}MB)`);
    return this.readBytesFrom(e, await this.dataStart(e));
  }

  private async readBytesFrom(e: ZipEntry, start: number): Promise<Uint8Array> {
    const raw = await bytesOf(this.blob, start, start + e.compressedSize);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateSync(raw, { out: new Uint8Array(e.size) });
    throw new Error(`지원하지 않는 압축 방식 (${e.method}): ${e.name}`);
  }
}
