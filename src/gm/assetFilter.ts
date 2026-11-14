/**
 * 이미지 필터 (v0.122): 편집기 이미지 목록을 종류·인물·장소·태그·상태·검색어로 함께 좁힌다.
 * 모든 조건은 "그리고"로 묶인다. 태그도 고른 것을 모두 가진 그림만 (하나라도 없으면 뺀다).
 */
import type { AssetMeta, WorldPackage } from '../engine/schema';

export type AssetState = '' | 'selected' | 'unselected' | 'untagged' | 'unlinked' | 'stock' | 'user' | 'original';
export type AssetSort = '' | 'name' | 'tags';

export interface AssetFilter {
  kind: '' | AssetMeta['kind'];
  /** '' 전체 · '-' 인물 없음 · 인물 ID */
  character: string;
  /** '' 전체 · '-' 장소 없음 · 장소 ID */
  location: string;
  /** 고른 태그 — 모두 가져야 한다 */
  tags: string[];
  state: AssetState;
  /** 검색어: 띄어쓰기로 여러 낱말(모두 포함), 앞에 -를 붙이면 그 낱말이 있는 것을 뺀다 */
  q: string;
  sort: AssetSort;
}

export const EMPTY_FILTER: AssetFilter = { kind: '', character: '', location: '', tags: [], state: '', q: '', sort: '' };

export const KIND_WORD: Record<AssetMeta['kind'], string> = { character: '인물', scene: '장소 배경 장면', map: '지도', cover: '표지', other: '기타 분류 안 됨' };

/** 바뀐 조건의 수 (정렬 제외) */
export function activeCount(f: AssetFilter): number {
  return [f.kind, f.character, f.location, f.state, f.q.trim()].filter(Boolean).length + f.tags.length;
}

function hay(world: WorldPackage, a: AssetMeta): string {
  const c = a.characterId ? world.characters.find((x) => x.id === a.characterId) : undefined;
  const l = a.locationId ? world.locations.find((x) => x.id === a.locationId) : undefined;
  const g = a.gender ?? c?.gender;
  return [a.name, a.id, a.kind, KIND_WORD[a.kind] ?? '', g === 'F' ? '여성 여자' : g === 'M' ? '남성 남자' : '', ...a.tags, c?.name ?? '', l?.name ?? ''].join(' ').toLowerCase();
}

export function filterAssets(world: WorldPackage, assets: AssetMeta[], f: AssetFilter, selected: Set<string> = new Set()): AssetMeta[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const want = words.filter((w) => !w.startsWith('-') || w.length === 1);
  const not = words.filter((w) => w.startsWith('-') && w.length > 1).map((w) => w.slice(1));
  const out = assets.filter((a) => {
    if (f.kind && a.kind !== f.kind) return false;
    if (f.character === '-' ? a.characterId : f.character && a.characterId !== f.character) return false;
    if (f.location === '-' ? a.locationId : f.location && a.locationId !== f.location) return false;
    if (f.tags.length && !f.tags.every((t) => a.tags.includes(t))) return false;
    switch (f.state) {
      case 'selected': if (!selected.has(a.id)) return false; break;
      case 'unselected': if (selected.has(a.id)) return false; break;
      case 'untagged': if (a.tags.some((t) => t !== 'default')) return false; break;
      case 'unlinked': if (a.kind === 'character' ? a.characterId : a.kind === 'other' ? false : a.locationId) return false; break;
      case 'stock': if (!a.id.startsWith('stock.')) return false; break;
      case 'user': if (!a.id.startsWith('user.')) return false; break;
      case 'original': if (a.id.startsWith('stock.') || a.id.startsWith('user.')) return false; break;
    }
    if (words.length) {
      const h = hay(world, a);
      if (!want.every((w) => h.includes(w)) || not.some((w) => h.includes(w))) return false;
    }
    return true;
  });
  if (f.sort === 'name') return [...out].sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  if (f.sort === 'tags') return [...out].sort((a, b) => a.tags.length - b.tags.length || a.name.localeCompare(b.name, 'ko', { numeric: true }));
  return out;
}

/**
 * 고를 수 있는 태그와 그 수: 다른 조건(태그 제외)으로 좁힌 목록 안에서 센다 — 고르면 0장이 되는 태그는 보이지 않는다.
 * 이미 고른 태그는 늘 남긴다 (끌 수 있게).
 */
export function tagCounts(world: WorldPackage, assets: AssetMeta[], f: AssetFilter, selected?: Set<string>): [string, number][] {
  const base = filterAssets(world, assets, { ...f, sort: '' }, selected);
  const n = new Map<string, number>();
  for (const a of base) for (const t of new Set(a.tags)) n.set(t, (n.get(t) ?? 0) + 1);
  for (const t of f.tags) if (!n.has(t)) n.set(t, 0);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
}
