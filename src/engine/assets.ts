/**
 * 플레이 중에 보여줄 이미지 고르기 (순수 함수, 결정적).
 * AI는 표정·장면 "태그"만 고르고, 실제 이미지는 엔진이 패키지의 에셋 목록에서 고른다.
 * 같은 태그의 이미지가 여러 장이면 salt(턴 번호 등)로 돌려 가며 보여준다.
 */
import type { AssetMeta, Character, EntityId, WorldPackage } from './schema';

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pickOne = <T>(list: T[], salt: string): T | undefined => (list.length ? list[hash(salt) % list.length] : undefined);

function characterAssets(world: WorldPackage, c: Pick<Character, 'id' | 'gender'>): AssetMeta[] {
  const all = (world.assets ?? []).filter((a) => a.kind === 'character' && a.characterId === c.id);
  if (!c.gender) return all;
  const same = all.filter((a) => !a.gender || a.gender === c.gender);
  return same.length ? same : all;
}

const TAG_LIMIT = 60;
const count = (list: AssetMeta[]) => {
  const m = new Map<string, number>();
  for (const a of list) for (const t of a.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TAG_LIMIT).map(([t]) => t);
};

/** 이 인물의 이미지에 붙은 표정·상황 태그 (많이 쓰인 순) */
export function expressionTags(world: WorldPackage, npcId: EntityId): string[] {
  const c = world.characters.find((x) => x.id === npcId);
  return c ? count(characterAssets(world, c)).filter((t) => t !== 'default') : [];
}

/** 인물 이미지 하나: 태그가 맞는 것 → 기본 모습 → 아무거나 */
export function pickCharacterImage(world: WorldPackage, npcId: EntityId, tag: string, salt: string): AssetMeta | undefined {
  const c = world.characters.find((x) => x.id === npcId);
  if (!c) return undefined;
  const list = characterAssets(world, c);
  const t = tag.trim().toLowerCase();
  const tagged = t ? list.filter((a) => a.tags.includes(t)) : [];
  if (tagged.length) return pickOne(tagged, `${npcId}|${t}|${salt}`);
  const def = list.filter((a) => a.tags.includes('default') || a.tags.length === 0);
  return pickOne(def.length ? def : list, `${npcId}|${salt}`);
}

function sceneAssets(world: WorldPackage, locationId: EntityId): AssetMeta[] {
  return (world.assets ?? []).filter((a) => a.kind === 'scene' && (!a.locationId || a.locationId === locationId));
}

/** 이 장소에서 쓸 수 있는 장면 태그 */
export function sceneTags(world: WorldPackage, locationId: EntityId): string[] {
  return count(sceneAssets(world, locationId));
}

/** 장면 이미지: 태그가 맞는 것(이 장소 우선) → 이 장소 전용 이미지 */
export function pickSceneImage(world: WorldPackage, locationId: EntityId, tag: string, salt: string): AssetMeta | undefined {
  const list = sceneAssets(world, locationId);
  const t = tag.trim().toLowerCase();
  if (t) {
    const tagged = list.filter((a) => a.tags.includes(t));
    const here = tagged.filter((a) => a.locationId === locationId);
    if (tagged.length) return pickOne(here.length ? here : tagged, `${locationId}|${t}|${salt}`);
  }
  return pickOne(list.filter((a) => a.locationId === locationId), `${locationId}|${salt}`);
}

/** 글에 이름(한글 이름 또는 영문 ID)이 나오는 인물 — 처음 나온 순서대로 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 한 글자 이름(윤, 핀)은 앞뒤가 다른 한글 낱말의 일부가 아닐 때만 (조사는 허용) */
const JOSA = '이은는을를의에과와도아야랑께가로만처보한';
const findName = (text: string, name: string): number => {
  if (!name) return -1;
  if (name.length >= 2) return text.toLowerCase().indexOf(name.toLowerCase());
  const m = new RegExp(`(?<![가-힣])${esc(name)}(?=[${JOSA}]|[^가-힣]|$)`).exec(text);
  return m ? m.index : -1;
};

/** 직함 (배경 첫 줄 "직함: 시녀장 · …") — 다른 인물과 겹치지 않을 때만 이름처럼 쓴다 */
function titleOf(c: Pick<Character, 'background'>): string {
  const m = /^직함:\s*([^\n·,]+)/.exec(c.background ?? '');
  const t = m?.[1]?.trim() ?? '';
  return t.length >= 2 && t.length <= 14 ? t : '';
}

/** 글에 이름(한글 이름·영문 ID·고유한 직함)이 나오는 인물 — 처음 나온 순서대로 */
export function mentionedCharacters(chars: Pick<Character, 'id' | 'name' | 'background'>[], text: string): string[] {
  const titles = chars.map(titleOf);
  return chars.map((c, i) => {
    const latin = c.id.replace(/^npc\//, '').replace(/-\d+$/, '');
    let at = findName(text, c.name);
    if (at < 0 && latin.length >= 3) { const m = new RegExp(`\\b${latin.replace(/[^a-z0-9-]/gi, '').replace(/-/g, '[ -]')}\\b`, 'i').exec(text); if (m) at = m.index; }
    const title = titles[i]!;
    if (at < 0 && title && titles.filter((t) => t === title).length === 1) at = text.indexOf(title);
    return { id: c.id, at };
  }).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.id);
}

/** 글에 나온 인물들의 이미지 (이미지가 있는 인물만, 최대 n장) */
export function mentionedImages(world: WorldPackage, text: string, salt: string, n = 4, skip: string[] = []): { id: string; caption: string }[] {
  const out: { id: string; caption: string }[] = [];
  for (const id of mentionedCharacters(world.characters, text)) {
    if (out.length >= n) break;
    const img = pickCharacterImage(world, id, '', salt);
    if (img && !skip.includes(img.id) && !out.some((o) => o.id === img.id)) out.push({ id: img.id, caption: world.characters.find((c) => c.id === id)!.name });
  }
  return out;
}

/** 인물의 대표 이미지 (목록·편집기용) */
export function portraitAsset(world: WorldPackage, npcId: EntityId): AssetMeta | undefined {
  return pickCharacterImage(world, npcId, 'default', 'portrait');
}
