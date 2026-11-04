/**
 * rpack 디코더 — RisuAI의 Rpack.js를 TypeScript로 옮긴 것.
 *
 * 원본: https://github.com/kwaroran/RisuAI/tree/main/src/ts/rpack (커밋 39f1ac1)
 * Copyright (c) 2026 Kwaroran.
 * Rpack.js는 MIT / AGPL-3.0 이중 라이선스이며, RisuAI 밖의 애플리케이션에서 쓸 때는 AGPL-3.0을 따라야 한다.
 * 따라서 이 파일과 rpack 매핑 데이터는 GNU Affero General Public License v3.0 으로 배포된다 (같은 폴더의 LICENSE_AGPL).
 * WORLDFORGE 전체는 GPL-3.0-or-later이며, GPLv3 13조에 따라 이 AGPL 부분과 결합된다.
 *
 * rpack은 512바이트 표(앞 256바이트 = 인코딩, 뒤 256바이트 = 디코딩)로 바이트를 1:1 치환하는 단순한 난독화 형식이다.
 */

// rpack_map.bin (512 bytes, base64)
const MAP_B64 = 'xA0eC70rP1X8RW71ZlNPGuC7MJSGumu/QVBvm+/etxBhFyDfMomonW2ryZAADF2v0sFW5RZkkYJldJfKI9ZS0f+0oOgvilg4WmAZlknb18g7PkNLpWNHqmopkvQVz2I0eNMdPOIFjipXDhvNTC3yQCwleUgPsnq1p2w35px7VH7+h9yaAuQzouuxLgPdmaaw59WIGIN89r7hXJ/DIUYfCE7QdhJf7v2PROqjXosoCTWeacwKx4UHrUrzd+ln1NqEgJO2TXP6JyZ/BMb78XI5UcI2qWis+O3FucvOdaQ9gdlCcByVEbzYjJj5WaET9xR9s+xxwOON8AGuWzEGJCI6uCz3hIvJZfu2n66zAy0BaXQf5KPs7lw0IZNKD2riYgKeIpz9PPxxx8atWWcFcG2KRBL6JIZfr9F6R87+UGPdUQZvGOBSqAmdVnNMuFNsw6AOGc8+DX4HMmhG6kj5mS6rpEkgXlU1OAy807FYFnkoChrh8s3EOduiumBydn2V73/IwN43lL+1FIGSJUWs5/Vmpys2WsET40s66I2DG3wnsJpC64eq3FSOeCbSVynUt/gvj4l18EF3wh7/2BUR5QSXF/Mx0JsA18q0Tyo72bJr2l2hPzBhvZE9Tubfvk2CjB0jEJhk9IUze5BDu6mI8dalHPbMbrlbC5bt1enFywimgEA=';

let decodeMap: Uint8Array | null = null;
let encodeMap: Uint8Array | null = null;

function init() {
  if (decodeMap) return;
  const bin = atob(MAP_B64);
  const map = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) map[i] = bin.charCodeAt(i);
  encodeMap = map.slice(0, 256);
  decodeMap = map.slice(256, 512);
}

export function decodeRPack(data: Uint8Array): Uint8Array {
  init();
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = decodeMap![data[i]!]!;
  return out;
}

/** 테스트용 인코더 */
export function encodeRPack(data: Uint8Array): Uint8Array {
  init();
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = encodeMap![data[i]!]!;
  return out;
}
