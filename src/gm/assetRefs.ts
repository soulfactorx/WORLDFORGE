/**
 * 이미지를 쓰는 곳 (v0.136): 이미지를 지우기 전에, 장면·카드·조우 등 세계의 다른 곳에서 그 이미지 ID를 가리키는지 센다.
 * (인물·장소 그림은 이미지 목록 자체로 붙으므로 셀 필요가 없다 — 목록에서 빼면 함께 빠진다)
 */
import type { WorldPackage } from '../engine/schema';

export function assetRefs(world: WorldPackage, ids: string[]): Map<string, number> {
  const { assets: _a, ...rest } = world;
  const text = JSON.stringify(rest);
  const out = new Map<string, number>();
  for (const id of ids) {
    const n = text.split(`"${id}"`).length - 1;
    if (n) out.set(id, n);
  }
  return out;
}

/** 지운 뒤 저장할 때 파일까지 지울 이미지 (앱 기본·내 기본 이미지는 이 세계의 파일이 아니다) */
export const ownFiles = (ids: string[]) => ids.filter((id) => !id.startsWith('stock.') && !id.startsWith('user.'));
