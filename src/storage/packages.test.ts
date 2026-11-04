import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { sampleWorld } from '../data/sample-world';
import { blankWorld, exportWpk, parsePackageFile } from './packages';
import { validateWorld } from '../engine/package/validate';

describe('패키지 파일', () => {
  it('.wpk 내보내기 → 가져오기 왕복', async () => {
    const blob = exportWpk(sampleWorld);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const r = parsePackageFile('x.wpk', bytes);
    expect(r.world?.manifest.id).toBe(sampleWorld.manifest.id);
    expect(r.issues).toEqual([]);
  });
  it('.json도 읽는다, 깨진 JSON은 거부', () => {
    expect(parsePackageFile('w.json', strToU8(JSON.stringify(sampleWorld))).world).not.toBeNull();
    expect(parsePackageFile('w.json', strToU8('{oops')).issues[0]!.message).toContain('JSON');
  });
  it('world.json이 없는 zip, 압축 폭탄은 거부', () => {
    expect(parsePackageFile('a.wpk', zipSync({ 'readme.txt': strToU8('hi') })).issues[0]!.message).toContain('world.json');
    const big = new Uint8Array(60 * 1024 * 1024); // 0으로 채운 60MB → 압축하면 작다
    const bomb = zipSync({ 'world.json': big }, { level: 9 });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(parsePackageFile('bomb.wpk', bomb).issues[0]!.message).toContain('너무 큽니다');
  });
  it('빈 템플릿은 오류 없이 시작할 수 있다', () => {
    expect(validateWorld(blankWorld()).filter((i) => i.level === 'error')).toEqual([]);
  });
});
