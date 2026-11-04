/**
 * RisuAI 모듈(.risum) 읽기.
 * 형식은 RisuAI(GPL-3.0)의 src/ts/process/modules.ts readModule()을 따른다:
 *   [111 매직][0 버전][u32LE 길이][rpack(JSON {type:'risuModule', module})]
 *   ([1][u32LE 길이][rpack(에셋 바이트)])* [0]
 * 에셋 이름·확장자는 module.assets[i] = [이름, '', 확장자] 에 있다.
 * 큰 모듈도 Blob을 잘라 읽으므로 전체를 메모리에 올리지 않는다. 에셋은 필요할 때 하나씩 해독한다.
 */
import { decodeRPack } from '../vendor/rpack/rpack';

export interface RisuModule {
  name?: string;
  description?: string;
  lorebook?: { key?: string; secondkey?: string; comment?: string; content?: string; mode?: string; alwaysActive?: boolean; folder?: string }[];
  regex?: { comment?: string; in?: string; out?: string; type?: string }[];
  trigger?: { type?: string; comment?: string; effect?: { type?: string; code?: string }[] }[];
  assets?: [string, string, string][];
  lowLevelAccess?: boolean;
  backgroundEmbedding?: string;
  customModuleToggle?: string;
  cjs?: string;
}

export interface RisumAsset {
  name: string;
  ext: string;
  /** 해독된 이미지 (필요할 때 호출) */
  read: () => Promise<Uint8Array>;
  size: number;
}

export interface ParsedRisum {
  module: RisuModule;
  assets: RisumAsset[];
}

const u32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);

export async function parseRisum(blob: Blob): Promise<ParsedRisum> {
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  if (head[0] !== 111) throw new Error('RisuAI 모듈이 아닙니다 (매직 번호 불일치)');
  if (head[1] !== 0) throw new Error(`지원하지 않는 모듈 버전 ${head[1]}`);
  const mainLen = u32(head.subarray(2, 6));
  const main = decodeRPack(new Uint8Array(await blob.slice(6, 6 + mainLen).arrayBuffer()));
  const parsed = JSON.parse(new TextDecoder().decode(main)) as { type?: string; module?: RisuModule };
  if (parsed.type !== 'risuModule' || !parsed.module) throw new Error('RisuAI 모듈 형식이 아닙니다');
  const module = parsed.module;
  const assets: RisumAsset[] = [];
  let pos = 6 + mainLen;
  for (let i = 0; pos < blob.size; i++) {
    const mark = new Uint8Array(await blob.slice(pos, pos + 1).arrayBuffer())[0];
    if (mark === 0 || mark === undefined) break;
    if (mark !== 1) throw new Error('모듈 에셋 구역이 손상되었습니다');
    const len = u32(new Uint8Array(await blob.slice(pos + 1, pos + 5).arrayBuffer()));
    const start = pos + 5;
    const meta = module.assets?.[i];
    assets.push({
      name: meta?.[0] ?? `asset-${i}`, ext: meta?.[2] ?? 'png', size: len,
      read: async () => decodeRPack(new Uint8Array(await blob.slice(start, start + len).arrayBuffer())),
    });
    pos = start + len;
  }
  return { module, assets };
}
