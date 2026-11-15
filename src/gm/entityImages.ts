/**
 * 인물·장소의 이미지 (v0.127): 한 인물·장소에 여러 장을 붙이고, 태그로 "어떤 상황에 보일지"를 정한다.
 * 플레이 중에는 AI가 서술하며 그 장면에 맞는 태그를 고르고([[그림 인물 태그]] · [[배경 태그]]), 엔진이 그 태그의 그림을 보여 준다.
 * 같은 태그가 여러 장이면 돌아가며, 맞는 태그가 없으면 기본(default 또는 태그 없음) 그림.
 */
import { EXPRESSIONS, pickCharacterImage, pickSceneImage } from '../engine/assets';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { knownTags } from '../importers/assetmatch';

export type ImageTarget = { kind: 'character' | 'location'; id: string; name: string };

/** 자주 쓰는 태그 (누르면 붙는다). 영어 태그를 쓰는 까닭: 카드·AI가 흔히 쓰는 이름이라 같은 뜻으로 묶기 쉽다 */
export const CHARACTER_TAGS: [string, string][] = [
  ['default', '기본 모습'], ['smile', '웃음'], ['angry', '화남'], ['sad', '슬픔'], ['surprised', '놀람'], ['worried', '걱정·당황'],
  ['serious', '진지'], ['blush', '부끄러움'], ['tired', '피곤'], ['hurt', '다침'], ['battle', '싸울 때'], ['night', '밤'],
];
export const PLACE_TAGS: [string, string][] = [
  ['default', '기본'], ['day', '낮'], ['night', '밤'], ['morning', '아침'], ['evening', '저녁'], ['rain', '비'], ['snow', '눈'],
  ['battle', '싸움'], ['crowd', '붐빔'], ['empty', '텅 빔'], ['festival', '축제'], ['danger', '위험'],
];
export const presetsFor = (t: ImageTarget) => (t.kind === 'character' ? CHARACTER_TAGS : PLACE_TAGS);

/** 태그의 우리말 이름 (같은 뜻 무리도 찾는다) */
export function tagLabel(t: ImageTarget, tag: string): string {
  const p = presetsFor(t).find(([k]) => k === tag);
  if (p) return p[1];
  const g = EXPRESSIONS.find((x) => x.words.includes(tag));
  const q = g && CHARACTER_TAGS.find(([k]) => k === g.key);
  return q ? `${tag} (${q[1]})` : tag;
}

const owns = (t: ImageTarget) => (a: AssetMeta) => (t.kind === 'character' ? a.kind === 'character' && a.characterId === t.id : (a.kind === 'scene' || a.kind === 'map') && a.locationId === t.id);
export const imagesOf = (assets: AssetMeta[], t: ImageTarget) => assets.filter(owns(t));

/** 태그별 장수. 태그가 없거나 default면 "기본" */
export function tagSummary(list: AssetMeta[]): [string, number][] {
  const n = new Map<string, number>();
  for (const a of list) for (const tag of a.tags.length ? a.tags : ['default']) n.set(tag, (n.get(tag) ?? 0) + 1);
  return [...n].sort((a, b) => (a[0] === 'default' ? -1 : b[0] === 'default' ? 1 : b[1] - a[1] || a[0].localeCompare(b[0])));
}

const link = (t: ImageTarget) => (t.kind === 'character' ? { kind: 'character' as const, characterId: t.id } : { kind: 'scene' as const, locationId: t.id });

/** 새 이미지 ID (이 세계 안에서 겹치지 않게) */
export function newImageIds(assets: AssetMeta[], n: number, now = Date.now()): string[] {
  const taken = new Set(assets.map((a) => a.id));
  const out: string[] = [];
  let i = 0;
  while (out.length < n) { const id = `img.${now.toString(36)}.${i++}`; if (!taken.has(id)) out.push(id); }
  return out;
}

/** 직접 올린 파일 → 이 대상의 이미지. 파일 이름에 표정·상황 낱말이 있으면 태그로, 이 대상의 첫 그림이면 기본 모습 */
export function uploadedMeta(files: { name: string; mime: string; size: number }[], t: ImageTarget, assets: AssetMeta[], ids: string[]): AssetMeta[] {
  const first = !imagesOf(assets, t).length;
  return files.map((f, i) => {
    const tags = knownTags(f.name);
    return { id: ids[i]!, name: f.name.replace(/\.[a-z0-9]{2,5}$/i, ''), mime: f.mime || 'image/png', size: f.size, ...link(t), tags: tags.length ? tags : first && i === 0 ? ['default'] : [] };
  });
}

/** 이 세계에 이미 있는 이미지를 이 대상에 붙인다 (태그는 그대로) */
export function attachImages(assets: AssetMeta[], ids: string[], t: ImageTarget): AssetMeta[] {
  const set = new Set(ids);
  return assets.map((a) => {
    if (!set.has(a.id)) return a;
    const n: AssetMeta = { ...a, ...link(t) };
    if (t.kind === 'character') delete n.locationId; else delete n.characterId;
    return n;
  });
}

/** 떼기: 내장·내 기본 이미지는 목록에서 빼고, 이 세계의 그림은 "분류 안 됨"으로 남긴다 (다시 붙일 수 있게) */
export function detachImage(assets: AssetMeta[], id: string): AssetMeta[] {
  if (id.startsWith('stock.') || id.startsWith('user.')) return assets.filter((a) => a.id !== id);
  return assets.map((a) => { if (a.id !== id) return a; const { characterId: _c, locationId: _l, ...rest } = a; return { ...rest, kind: 'other' as const }; });
}

export function toggleTag(assets: AssetMeta[], id: string, tag: string): AssetMeta[] {
  const t = tag.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '');
  if (!t) return assets;
  return assets.map((a) => (a.id !== id ? a : { ...a, tags: a.tags.includes(t) ? a.tags.filter((x) => x !== t) : [...a.tags, t] }));
}

/** 시험: 플레이 중 이 태그를 원하면 보일 그림 (같은 뜻 태그 포함 · 없으면 기본) */
export function previewPick(w: WorldPackage, t: ImageTarget, tag: string, salt = 'preview'): AssetMeta | undefined {
  return t.kind === 'character' ? pickCharacterImage(w, t.id, tag, salt) : pickSceneImage(w, t.id, tag, salt);
}
