import { strToU8 } from 'fflate';
import { encodeRPack } from '../vendor/rpack/rpack';

/** RisuAI exportModuleLegacy와 같은 방식으로 risum을 만든다 */
export function makeRisum(module: object, assets: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const len = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const main = encodeRPack(strToU8(JSON.stringify({ module, type: 'risuModule' }, null, 2)));
  parts.push(new Uint8Array([111, 0]), len(main.length), main);
  for (const a of assets) { const e = encodeRPack(a); parts.push(new Uint8Array([1]), len(e.length), e); }
  parts.push(new Uint8Array([0]));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

