/**
 * 플레이 중에 보여줄 이미지 고르기 (순수 함수, 결정적).
 * AI는 표정·장면 "태그"만 고르고, 실제 이미지는 엔진이 패키지의 에셋 목록에서 고른다.
 * 같은 태그의 이미지가 여러 장이면 salt(턴 번호 등)로 돌려 가며 보여준다.
 */
import type { AssetMeta, Character, EntityId, WorldPackage } from './schema';

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pickOne = <T>(list: T[], salt: string): T | undefined => (list.length ? list[hash(salt) % list.length] : undefined);

// ---------------------------------------------------------------- 고른 근거 기록 (디버그, v0.57.4)

/** 이미지 하나를 고른 과정 */
export interface ImagePick {
  step: '인물 이미지' | '장소 이미지' | '표정 짐작' | '서술 언급';
  target: string;
  /** 원한 태그 (AI가 고른 표정·장면 태그, 또는 문맥으로 짐작한 것) */
  wanted?: string;
  /** 이 인물·장소의 이미지 태그 중 실제로 맞춘 것 */
  resolved?: string;
  rule: string;
  candidates?: number;
  chosen?: string;
}
let tracing: ImagePick[] | null = null;
const note = (p: ImagePick) => { tracing?.push(p); };
/** fn 안에서 이미지 고르기 과정을 모은다 */
export function traceImages<T>(fn: () => T): { result: T; picks: ImagePick[] } {
  const prev = tracing;
  const picks: ImagePick[] = [];
  tracing = picks;
  try { return { result: fn(), picks }; } finally { tracing = prev; if (prev) prev.push(...picks); }
}

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

// ---------------------------------------------------------------- 표정 (같은 뜻의 다른 이름 · 문맥 단서)

/**
 * 표정·상황 무리. 카드마다 태그 이름이 다르다 (smile / smiling / happy / 웃음 …).
 * words: 같은 뜻의 태그 이름, cues: 서술 속에서 그 표정을 짐작하게 하는 말
 */
export const EXPRESSIONS: { key: string; words: string[]; cues: RegExp }[] = [
  { key: 'smile', words: ['smile', 'smiling', 'smiles', 'happy', 'joy', 'laugh', 'laughing', 'grin', 'cheerful', '웃음', '미소', '기쁨', '행복', '웃는'], cues: /웃|미소|기뻐|기쁜|즐거|히죽|싱긋|빙긋|활짝|반갑/ },
  { key: 'angry', words: ['angry', 'anger', 'mad', 'rage', 'annoyed', 'furious', 'irritated', '분노', '화남', '화', '짜증'], cues: /화를|화가|화난|분노|노려|짜증|언성|버럭|이를 악|성난|격분|으르렁|쏘아/ },
  { key: 'sad', words: ['sad', 'cry', 'crying', 'tears', 'tearful', 'depressed', 'gloomy', 'sorrow', '슬픔', '울음', '우는', '눈물'], cues: /울었|울먹|울음|눈물|슬퍼|슬픈|흐느|침울|훌쩍|애처|서글|낙담/ },
  { key: 'surprised', words: ['surprised', 'surprise', 'shock', 'shocked', 'astonished', '놀람', '놀란'], cues: /놀라|깜짝|휘둥그레|흠칫|움찔|소스라/ },
  { key: 'worried', words: ['worried', 'worry', 'anxious', 'nervous', 'scared', 'afraid', 'fear', 'embarrassed', 'flustered', 'confused', '걱정', '불안', '당황', '두려움'], cues: /걱정|불안|머뭇|망설|초조|당황|두려|겁에|떨리|어쩔 줄/ },
  { key: 'serious', words: ['serious', 'determined', 'focus', 'focused', 'stern', 'cold', 'thinking', '진지', '결의', '냉정'], cues: /진지|굳은|단호|결연|날카롭|차갑게|싸늘|엄숙|정색|심각/ },
  { key: 'blush', words: ['blush', 'blushing', 'shy', 'love', 'flirt', '부끄', '수줍', '홍조'], cues: /붉어|부끄|수줍|얼굴이 달아|홍조|설레/ },
  { key: 'tired', words: ['tired', 'sleepy', 'exhausted', 'bored', '피곤', '졸림', '지침'], cues: /하품|졸린|졸음|지친|피곤|나른/ },
  { key: 'hurt', words: ['hurt', 'injured', 'wounded', 'pain', '부상', '고통'], cues: /다친|피를 흘|상처|신음|고통|비틀/ },
];

/** 원하는 태그를 그 인물이 가진 태그 중 같은 뜻의 것으로 바꾼다 (없으면 '') */
export function resolveTag(available: string[], wanted: string): string {
  const t = wanted.trim().toLowerCase();
  if (!t) return '';
  if (available.includes(t)) return t;
  const group = EXPRESSIONS.find((g) => g.key === t || g.words.includes(t));
  return group ? available.find((a) => a === group.key || group.words.includes(a)) ?? '' : '';
}

/** 서술에서 그 인물이 나온 문장(과 다음 문장)을 보고 표정을 짐작한다 */
export function contextExpression(text: string, names: string[], available: string[]): string {
  if (!text) return '';
  if (!available.length) { note({ step: '표정 짐작', target: names.filter(Boolean).join('/'), rule: '이 인물의 이미지에 표정 태그가 없어 표정을 고르지 않음 (이미지 파일 이름이나 이미지 탭에서 smile·angry 같은 태그를 붙이면 표정별로 고른다)' }); return ''; }
  const near: string[] = [];
  // 그 인물이 나온 문장 + 같은 문단에서 바로 이어지는 대사("…")나 그/그녀 문장
  for (const para of text.split(/\n\s*\n/)) {
    const sentences = para.split(/(?<=[.!?。…"”])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    sentences.forEach((s, i) => {
      if (!names.some((n) => n && s.includes(n))) return;
      near.push(s);
      const next = sentences[i + 1] ?? '';
      if (/^["“「『]|^(그는|그녀는|그가|그녀가)/.test(next)) near.push(next);
    });
  }
  const scope = near.join(' ');
  if (!scope) return '';
  for (const g of EXPRESSIONS) {
    const m = scope.match(g.cues);
    if (!m) continue;
    const tag = resolveTag(available, g.key);
    if (tag) { note({ step: '표정 짐작', target: names.filter(Boolean).join('/'), resolved: tag, rule: `서술의 "${m[0]}" → ${g.key} 표정 (그 인물이 나온 문장: "${scope.slice(0, 80)}${scope.length > 80 ? '…' : ''}")` }); return tag; }
  }
  note({ step: '표정 짐작', target: names.filter(Boolean).join('/'), rule: '그 인물이 나온 문장에서 표정 단서를 찾지 못함' });
  return '';
}

/** 인물 이미지 하나: 태그가 맞는 것(같은 뜻 포함) → 기본 모습 → 아무거나 */
export function pickCharacterImage(world: WorldPackage, npcId: EntityId, tag: string, salt: string): AssetMeta | undefined {
  const c = world.characters.find((x) => x.id === npcId);
  if (!c) return undefined;
  const list = characterAssets(world, c);
  const t = resolveTag([...new Set(list.flatMap((a) => a.tags))], tag);
  const tagged = t ? list.filter((a) => a.tags.includes(t)) : [];
  if (tagged.length) {
    const r = pickOne(tagged, `${npcId}|${t}|${salt}`);
    note({ step: '인물 이미지', target: `${c.name} (${npcId})`, ...(tag ? { wanted: tag } : {}), resolved: t, rule: `태그 "${t}"가 붙은 이미지 ${tagged.length}장 중 턴마다 돌려 가며 하나`, candidates: tagged.length, ...(r ? { chosen: r.id } : {}) });
    return r;
  }
  const def = list.filter((a) => a.tags.includes('default') || a.tags.length === 0);
  const r = pickOne(def.length ? def : list, `${npcId}|${salt}`);
  note({ step: '인물 이미지', target: `${c.name} (${npcId})`, ...(tag ? { wanted: tag } : {}),
    rule: `${tag ? `원한 태그 "${tag}"와 맞는 이미지가 없어 ` : '원한 표정 없음 — '}${def.length ? `기본 이미지(default 또는 태그 없음) ${def.length}장 중` : list.length ? `이 인물의 이미지 전체 ${list.length}장 중` : '이 인물의 이미지가 없음'}`,
    candidates: def.length || list.length, ...(r ? { chosen: r.id } : {}) });
  return r;
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
  const target = world.locations.find((l) => l.id === locationId)?.name ?? locationId;
  if (t) {
    const tagged = list.filter((a) => a.tags.includes(t));
    const here = tagged.filter((a) => a.locationId === locationId);
    if (tagged.length) {
      const r = pickOne(here.length ? here : tagged, `${locationId}|${t}|${salt}`);
      note({ step: '장소 이미지', target, wanted: t, resolved: t, rule: here.length ? `이 장소의 "${t}" 태그 이미지 ${here.length}장 중` : `이 장소엔 "${t}" 태그가 없어 다른 장면 이미지 ${tagged.length}장 중`, candidates: here.length || tagged.length, ...(r ? { chosen: r.id } : {}) });
      return r;
    }
  }
  const own = list.filter((a) => a.locationId === locationId);
  const r = pickOne(own, `${locationId}|${salt}`);
  note({ step: '장소 이미지', target, ...(t ? { wanted: t } : {}), rule: `${t ? `"${t}" 태그 이미지가 없어 ` : ''}${own.length ? `이 장소의 이미지 ${own.length}장 중` : '이 장소의 이미지가 없음'}`, candidates: own.length, ...(r ? { chosen: r.id } : {}) });
  return r;
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
    const c = world.characters.find((x) => x.id === id)!;
    note({ step: '서술 언급', target: `${c.name} (${id})`, rule: `글에 이름 "${c.name}"${titleOf(c) ? ` 또는 직함 "${titleOf(c)}"` : ''}이(가) 나옴` });
    // 그 인물이 나온 문장의 분위기로 표정을 고른다 (서술에 "윤이 웃었다" → 윤의 웃는 얼굴)
    const img = pickCharacterImage(world, id, contextExpression(text, [c.name, titleOf(c)], expressionTags(world, id)), salt);
    if (img && !skip.includes(img.id) && !out.some((o) => o.id === img.id)) out.push({ id: img.id, caption: c.name });
  }
  return out;
}

/** 인물의 대표 이미지 (목록·편집기용) */
export function portraitAsset(world: WorldPackage, npcId: EntityId): AssetMeta | undefined {
  return pickCharacterImage(world, npcId, 'default', 'portrait');
}
