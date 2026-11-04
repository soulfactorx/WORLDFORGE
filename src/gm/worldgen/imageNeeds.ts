/**
 * 부족한 이미지 알림 + 내 기본 이미지 자동 적용 (v0.18).
 *
 * - imageNeeds: 진짜 이미지(카드 이미지·내 이미지)가 없고 앱 내장 그림이나 빈 칸으로 보이는 인물·장소 목록.
 *   만들 그림의 설명·추천 파일 이름을 함께 준다.
 * - applyUserArt: 내 기본 이미지 세트를 세계에 적용한다. 순서:
 *   1) 대상 지정 태그 `for:<세계 ID>/<인물·장소 ID>` (이 세계의 그 대상용으로 올린 그림)
 *   2) 파일 이름 규칙 (예: `윤.png`, `yun_smile.png`, `헤드비히-울음.webp`, `garden_night.png`) — 카드 이미지와 같은 규칙
 *   3) 태그 낱말 (예: 기사·시녀 / 정원·집무실) — 아직 앱 내장 그림이나 빈 칸인 대상에만
 *   적용하면 그 대상의 앱 내장 그림(stock.*)은 뺀다.
 */
import type { StockArt } from '../../data/stockart';
import type { AssetMeta, Character, Location, WorldPackage } from '../../engine/schema';
import { matchAssets } from '../../importers/assetmatch';
import { nextStockIndex, ruleArtForCharacter, ruleArtForLocation } from './stock';

export interface UserArtLite { id: string; kind: 'character' | 'scene'; label: string; tags: string[]; gender?: 'M' | 'F' }

export interface ImageNeed {
  kind: 'character' | 'location';
  id: string;
  name: string;
  /** none: 이미지 없음 / stock: 앱 내장 그림으로 대신하는 중 */
  status: 'none' | 'stock';
  /** 그림을 만들 때 참고할 설명 */
  describe: string;
  /** 이 이름으로 내 기본 이미지에 올리면 자동으로 붙는다 */
  fileName: string;
  gender?: 'M' | 'F';
}

const isFallback = (a: AssetMeta) => a.id.startsWith('stock.');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fileBase = (c: { id: string; name: string }) => {
  const latin = c.id.replace(/^(npc|loc)\//, '').replace(/-\d+$/, '');
  return /^[a-z0-9-]{2,}$/.test(latin) && !/^c\d+$/.test(latin) ? latin.replace(/-/g, '_') : c.name.replace(/\s+/g, '_');
};

export function imageNeeds(world: WorldPackage): ImageNeed[] {
  const assets = world.assets ?? [];
  const out: ImageNeed[] = [];
  for (const c of world.characters) {
    const mine = assets.filter((a) => a.kind === 'character' && a.characterId === c.id);
    if (mine.some((a) => !isFallback(a))) continue;
    const title = /^직함:\s*([^\n]+)/.exec(c.background ?? '')?.[1] ?? '';
    out.push({
      kind: 'character', id: c.id, name: c.name, status: mine.length ? 'stock' : 'none', ...(c.gender ? { gender: c.gender } : {}),
      describe: cut([c.gender ? (c.gender === 'F' ? '여성' : '남성') : '', title, c.appearance].filter(Boolean).join(' · ').replace(/\s+/g, ' '), 240),
      fileName: `${fileBase(c)}.png`,
    });
  }
  for (const l of world.locations) {
    const mine = assets.filter((a) => a.kind === 'scene' && a.locationId === l.id);
    if (mine.some((a) => !isFallback(a))) continue;
    out.push({ kind: 'location', id: l.id, name: l.name, status: mine.length ? 'stock' : 'none', describe: cut(l.description.replace(/\s+/g, ' '), 240), fileName: `${fileBase(l)}.png` });
  }
  return out;
}

/** 만들 그림 목록 (복사해서 그림 만들기·의뢰에 쓴다) */
export function needsText(world: WorldPackage, needs = imageNeeds(world)): string {
  const lines = [`# ${world.manifest.name} — 필요한 그림 (${needs.length}개)`, '파일 이름 그대로 "내 기본 이미지"에 올리면 자동으로 붙습니다. 표정은 이름 뒤에 _smile, _angry 처럼 붙이세요.', ''];
  for (const n of needs) lines.push(`- [${n.kind === 'character' ? '인물' : '장소'}] ${n.name} → ${n.fileName}${n.describe ? `\n  ${n.describe}` : ''}`);
  return lines.join('\n');
}

export const targetTag = (worldId: string, targetId: string) => `for:${worldId}/${targetId}`;

const toStock = (a: UserArtLite): StockArt => ({ id: `u:${a.id}`, kind: a.kind, label: a.label, tags: a.tags.filter((t) => !t.startsWith('for:')), ...(a.gender ? { gender: a.gender } : {}) });

/** 내 기본 이미지를 세계에 적용한다. 바뀐 것이 없으면 applied가 빈 목록 */
export function applyUserArt(world: WorldPackage, arts: UserArtLite[]): { assets: AssetMeta[]; applied: { target: string; art: string }[] } {
  let assets = [...(world.assets ?? [])];
  const applied: { target: string; art: string }[] = [];
  let n = nextStockIndex(assets);
  const has = (artId: string, target: string) => assets.some((a) => a.id.startsWith(`user.${artId}--`) && (a.characterId === target || a.locationId === target));
  const assign = (art: UserArtLite, target: Character | Location, isChar: boolean, tags: string[]) => {
    if (has(art.id, target.id)) return;
    // 앱 내장 그림은 대신하던 것이므로 뺀다
    assets = assets.filter((a) => !(isFallback(a) && (isChar ? a.characterId === target.id : a.locationId === target.id)));
    assets.push({
      id: `user.${art.id}--${n++}`, name: `내 이미지: ${art.label}`, kind: isChar ? 'character' : 'scene',
      ...(isChar ? { characterId: target.id } : { locationId: target.id }), ...(art.gender ? { gender: art.gender } : {}),
      tags: isChar ? (tags.length ? tags : ['default']) : tags, mime: 'image/webp', size: 0,
    });
    applied.push({ target: target.name, art: art.label });
  };

  // 1) 대상 지정
  for (const art of arts) {
    for (const t of art.tags) {
      const m = /^for:(.+)\/((?:npc|loc)\/.+)$/.exec(t);
      if (!m || m[1] !== world.manifest.id) continue;
      const c = world.characters.find((x) => x.id === m[2]);
      const l = world.locations.find((x) => x.id === m[2]);
      if (c && art.kind === 'character') assign(art, c, true, ['default']);
      else if (l && art.kind === 'scene') assign(art, l, false, []);
    }
  }
  // 2) 파일 이름 (카드 이미지와 같은 규칙: 이름 + 표정·상황 낱말)
  const charTargets = world.characters.map((c) => ({ id: c.id, aliases: [c.name, c.id.replace(/^npc\//, '').replace(/-\d+$/, '')] }));
  const locTargets = world.locations.map((l) => ({ id: l.id, aliases: [l.name, l.id.replace(/^loc\//, '').replace(/-\d+$/, '')] }));
  const matched = matchAssets(arts.map((a) => ({ name: a.label, mime: 'image/webp', size: 0 })), charTargets, locTargets);
  arts.forEach((art, i) => {
    const m = matched[i]!;
    if (m.kind === 'character' && art.kind === 'character' && m.characterId) assign(art, world.characters.find((c) => c.id === m.characterId)!, true, m.tags);
    else if (m.kind === 'scene' && art.kind === 'scene' && m.locationId) assign(art, world.locations.find((l) => l.id === m.locationId)!, false, m.tags);
  });
  // 3) 태그 낱말 — 아직 진짜 이미지가 없는 대상에만
  const pool = arts.filter((a) => a.tags.some((t) => !t.startsWith('for:'))).map(toStock);
  if (pool.length) {
    const needs = imageNeeds({ ...world, assets });
    for (const need of needs) {
      if (need.kind === 'character') {
        const c = world.characters.find((x) => x.id === need.id)!;
        const pick = ruleArtForCharacter(c, pool);
        const art = pick.id.startsWith('u:') ? arts.find((a) => `u:${a.id}` === pick.id) : undefined;
        if (art) assign(art, c, true, ['default']);
      } else {
        const l = world.locations.find((x) => x.id === need.id)!;
        const pick = ruleArtForLocation(l, pool.filter((a) => a.kind === 'scene'));
        const art = pick.id.startsWith('u:') ? arts.find((a) => `u:${a.id}` === pick.id) : undefined;
        if (art) assign(art, l, false, []);
      }
    }
  }
  return { assets, applied };
}
