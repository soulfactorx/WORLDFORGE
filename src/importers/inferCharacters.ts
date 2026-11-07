/**
 * AI 없이 카드 데이터만으로 인물 후보를 찾는다 (v0.52) — 인물 편집의 "캐릭터 카드 가져오기".
 * 근거: ① 로어북 규칙(이름(영문)·프로필 형식) ② 프로필 낱말(나이·외모·성격·말투…) ③ 카드 본인 ④ 이미지 파일 이름 묶음.
 * 이미지는 이름 규칙(matchAssets)으로 인물에 붙이고, 사람이 고칠 수 있다.
 */
import type { AssetMeta, Belief, Character, Claim, Fact, WorldPackage } from '../engine/schema';
import { matchAssets, tokenize } from './assetmatch';
import type { CharxBundle } from './bundle';
import { type AnalyzedEntry, analyzeEntries, type EntryChoice, isWorldCard, worldCardToEntities } from './worldcard';
import { cardToEntities, defaultLoreChoices } from './toWorld';
import type { LoreEntry, NormalizedCard } from './charx';

export type CandidateSource = 'lore' | 'profile' | 'card' | 'images';
export interface Candidate {
  key: string;
  name: string;
  source: CandidateSource;
  /** 로어북 항목 (lore·profile) */
  entry?: number;
  latin?: string;
  gender?: 'M' | 'F';
  title?: string;
  /** 처음에 고를지 */
  pick: boolean;
  /** 왜 인물로 보았는가 */
  why: string;
}

export const SOURCE_LABEL: Record<CandidateSource, string> = { lore: '로어북 인물 항목', profile: '로어북 (프로필 낱말)', card: '카드 본인', images: '이미지 이름' };

/** 프로필에 자주 나오는 낱말 — 몇 종류가 나오면 인물로 본다 */
const PROFILE_WORDS = /(나이|연령|성별|외모|외형|생김새|성격|말투|어투|말버릇|신장|키\s*[:：]|몸무게|체형|머리카락|머리색|눈동자|눈색|직업|소속|신분|좋아하는\s*것|싫어하는\s*것|취미|특기|생일|종족|age|gender|sex|appearance|looks|personality|speech|height|weight|hair|eyes|occupation|likes|dislikes|hobby|species)\s*[:：]/gi;
const GENERIC_IMG = new Set(['bg', 'background', 'back', '배경', 'icon', 'main', 'cover', 'thumb', 'thumbnail', 'map', '지도', 'ui', 'btn', 'button', 'frame', 'logo', 'title', 'scene', 'cg', 'event', 'item', 'items', 'effect', 'fx', 'sticker', 'emoji', 'common', 'default', 'normal', 'image', 'img', 'asset', 'assets']);

function profileScore(e: LoreEntry): number {
  return new Set([...e.content.slice(0, 4000).matchAll(PROFILE_WORDS)].map((m) => m[1]!.toLowerCase().replace(/\s+/g, ''))).size;
}
const shortName = (s: string) => s.replace(/[#*[\]【】「」『』<>]/g, '').trim();

export interface Inference { card: NormalizedCard; analyzed: AnalyzedEntry[]; candidates: Candidate[]; worldCard: boolean }

export function inferCandidates(b: CharxBundle): Inference {
  const card: NormalizedCard = { ...b.card, lore: [...b.card.lore, ...b.extraLore] };
  const analyzed = analyzeEntries(card);
  const worldCard = isWorldCard(card, analyzed);
  const cands: Candidate[] = [];
  const names = new Set<string>();
  const add = (c: Candidate) => { const k = (c.latin || c.name).toLowerCase(); if (!c.name || names.has(k) || names.has(c.name.toLowerCase())) return; names.add(k); names.add(c.name.toLowerCase()); cands.push(c); };
  // ① 로어북 규칙
  analyzed.forEach((a) => {
    if (a.kind !== 'character') return;
    add({ key: `lore:${a.index}`, name: a.displayName || a.latin, source: 'lore', entry: a.index, ...(a.latin ? { latin: a.latin } : {}), ...(a.gender ? { gender: a.gender } : {}), ...(a.title ? { title: a.title } : {}), pick: a.choice === 'character', why: a.note || '이름(영문)·프로필 형식' });
  });
  // ② 프로필 낱말이 3종류 이상인 항목 (이름이 짧고, AI 지시문이 아닌 것)
  analyzed.forEach((a) => {
    if (a.kind !== 'world') return;
    const e = card.lore[a.index]!;
    const nm = shortName(e.name);
    const score = profileScore(e);
    if (score < 3 || !nm || nm.length > 24 || /설정|세계|지역|역사|목록|명단|규칙|시스템|list|world|setting/i.test(nm)) return;
    add({ key: `profile:${a.index}`, name: nm.replace(/\s*\(.*\)\s*$/, '') || nm, source: 'profile', entry: a.index, ...(a.latin ? { latin: a.latin } : {}), pick: e.enabled, why: `프로필 낱말 ${score}종 (나이·외모·성격 등)` });
  });
  // ③ 카드 본인 (세계관 카드가 아니면 — 카드가 곧 한 인물)
  if (!worldCard || cands.length === 0) {
    const nm = shortName(card.nickname || card.name);
    if (nm && !/world|simulator|시뮬|세계/i.test(card.name)) add({ key: 'card', name: nm, source: 'card', pick: true, why: '카드의 성격·말투·첫 메시지' });
  }
  // ④ 이미지 이름 묶음: 같은 이름으로 시작하는 이미지가 2장 이상이고, 아직 없는 이름
  const groups = new Map<string, number>();
  for (const a of b.assets) {
    const { tokens } = tokenize(a.name);
    const head = tokens.find((t) => !GENERIC_IMG.has(t) && !/^\d+$/.test(t) && t.length >= 2);
    if (head) groups.set(head, (groups.get(head) ?? 0) + 1);
  }
  // 한 인물 카드: 가장 큰 이미지 묶음은 카드 본인의 다른 이름(영문 파일 이름)으로 본다 (세라 ↔ sera_smile.png)
  const self = cands.find((c) => c.source === 'card');
  if (self && !worldCard && !self.latin) {
    const top = [...groups.entries()].sort((x, y) => y[1] - x[1])[0];
    if (top && top[1] >= 2 && !cands.some((c) => c !== self && tokenize(c.latin || c.name).compact === top[0])) self.latin = top[0];
  }
  const known = cands.flatMap((c) => [c.name, c.latin ?? ''].filter(Boolean).map((x) => tokenize(x).compact));
  for (const [head, n] of [...groups.entries()].sort((x, y) => y[1] - x[1])) {
    if (n < 2 || known.some((k) => k && (k === head || k.startsWith(head) || head.startsWith(k)))) continue;
    if (cands.filter((c) => c.source === 'images').length >= 40) break;
    add({ key: `img:${head}`, name: head, latin: /^[a-z]/.test(head) ? head : '', source: 'images', pick: n >= 3, why: `이미지 ${n}장의 이름` });
  }
  return { card, analyzed, candidates: cands, worldCard };
}

export interface BuildInput {
  inference: Inference;
  /** 고른 후보와 고친 이름 */
  picked: { key: string; name: string; gender?: 'M' | 'F' }[];
  /** 인물이 아닌 로어북 항목을 세계 지식으로 */
  loreAsKnowledge: boolean;
  locationId: string;
  mature: boolean;
}

/** 고른 후보 → 인물·지식 (원문 그대로, AI 없음) */
export function buildEntities(world: WorldPackage, b: CharxBundle, inp: BuildInput): { characters: Character[]; facts: Fact[]; claims: Claim[]; beliefs: Belief[]; keyOf: Map<string, string> } {
  const { card, analyzed } = inp.inference;
  const keyOf = new Map<string, string>();
  const byKey = new Map(inp.inference.candidates.map((c) => [c.key, c]));
  const pickedLore = new Map(inp.picked.filter((p) => byKey.get(p.key)?.entry !== undefined).map((p) => [byKey.get(p.key)!.entry!, p]));
  // 로어북 인물 + 세계 지식
  const choices: EntryChoice[] = analyzed.map((a) => (pickedLore.has(a.index) ? 'character' : a.kind === 'instruction' || !card.lore[a.index]!.enabled || !inp.loreAsKnowledge ? 'skip' : 'world'));
  const fixed = analyzed.map((a) => (pickedLore.has(a.index) ? { ...a, kind: 'character' as const, displayName: pickedLore.get(a.index)!.name, ...(pickedLore.get(a.index)!.gender ? { gender: pickedLore.get(a.index)!.gender! } : {}) } : a));
  const ents = worldCardToEntities(card, world, fixed, { choices, locationId: inp.locationId, mature: inp.mature });
  const charIdx = fixed.filter((_, i) => choices[i] === 'character');
  ents.characters.forEach((c, i) => {
    const p = pickedLore.get(charIdx[i]!.index);
    if (p) { keyOf.set(p.key, c.id); if (p.gender) c.gender = p.gender; }
  });
  const scratch: WorldPackage = { ...world, characters: [...world.characters, ...ents.characters], facts: [...world.facts, ...ents.facts], claims: [...world.claims, ...ents.claims] };
  // 카드 본인
  const main = inp.picked.find((p) => p.key === 'card');
  if (main) {
    const r = cardToEntities(card, scratch, { locationId: inp.locationId, loreChoices: defaultLoreChoices(card).map(() => 'skip'), improvisation: 'minor', overrides: { name: main.name } });
    if (main.gender) r.character.gender = main.gender;
    ents.characters.push(r.character);
    keyOf.set('card', r.character.id);
    scratch.characters.push(r.character);
  }
  // 이미지로만 찾은 인물
  const taken = new Set(scratch.characters.map((c) => c.id));
  for (const p of inp.picked.filter((x) => x.key.startsWith('img:'))) {
    const base = `npc/${p.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'img'}`;
    let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`; taken.add(id);
    ents.characters.push({
      id, name: p.name, appearance: '(카드의 이미지로 찾은 인물 — 외형을 적어 주세요)', personality: '(정보 없음 — 편집기에서 채워 주세요)', speech: '(정보 없음)',
      locationId: inp.locationId, improvisation: 'minor', ...(p.gender ? { gender: p.gender } : {}),
      source: { format: card.format, name: `${card.name} / 이미지 ${p.name}`, ...(card.creator ? { creator: card.creator } : {}), importedAt: new Date().toISOString() },
    });
    keyOf.set(p.key, id);
  }
  return { ...ents, keyOf };
}

/** 모든 이미지를 이름 규칙으로 인물·장소에 붙인다 (세계 에셋 ID로) */
export function matchCardImages(b: CharxBundle, chars: { id: string; name: string; aliases: string[]; gender?: 'M' | 'F' }[], world: WorldPackage, prefix: string): AssetMeta[] {
  const inputs = b.assets.map((a) => ({ name: a.name, mime: a.mime, size: a.size, ...(a.cardType ? { cardType: a.cardType } : {}) }));
  const main = chars.length === 1 ? { mainCharacterId: chars[0]!.id } : {};
  return matchAssets(inputs, chars.map((c) => ({ id: c.id, aliases: [c.name, ...c.aliases].filter(Boolean), ...(c.gender ? { gender: c.gender } : {}) })), world.locations.map((l) => ({ id: l.id, aliases: [l.name, l.id.replace(/^loc\//, '')] })), main)
    .map((m, i) => ({ ...m, id: `${prefix}${i}` }));
}
