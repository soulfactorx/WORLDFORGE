/**
 * 세계관(시뮬레이터) 카드 가져오기.
 * RisuAI에는 카드 하나가 "세계 전체"이고 로어북 항목 하나하나가 인물·설정·AI 지시문인 경우가 많다.
 * 이런 카드는 로어북을 분석해 여러 인물 + 세계 지식으로 바꾸고, AI 지시문은 버린다.
 */
import type { Belief, Character, Claim, Fact, WorldPackage } from '../engine/schema';
import { type LoreEntry, type NormalizedCard, replaceMacros } from './charx';

export type EntryKind = 'character' | 'world' | 'instruction';
export type EntryChoice = 'character' | 'world' | 'skip';

export interface AnalyzedEntry {
  index: number;
  kind: EntryKind;
  /** 인물 이름 (예: "헤드비히") */
  displayName: string;
  /** 괄호 속 영문 이름 (예: "Hedwig") — 초상화 연결용 */
  latin: string;
  gender: 'M' | 'F' | '';
  /** 이름 앞의 직함 (예: "시녀장") */
  title: string;
  choice: EntryChoice;
  note: string;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** AI에게 주는 운영 규칙·출력 형식으로 보이는 항목 */
export function looksLikeInstruction(e: LoreEntry): boolean {
  if (/시스템|상태창|지침|출력|에셋|형식|규칙|운명의 개입|번역가|노트|rule|format|system|prompt|^lb-/i.test(e.name)) return true;
  const head = e.content.slice(0, 1500);
  return /(absolute rule|end every response|do not (describe|write|output|narrate)|show it with an image tag|<img\b|you must|as the (ai|narrator)|응답(의)?\s*(끝|마다|마지막)|출력(하라|한다|할 것)|반드시 .*(출력|작성))/i.test(head);
}

const NAME_RE = /^\s*([♂♀]️?)?\s*(.*?)\s*\(([^)]+)\)\s*$/u;

function parseName(raw: string): { displayName: string; latin: string; gender: 'M' | 'F' | ''; title: string } {
  const m = NAME_RE.exec(raw.replace(/[\u{1F300}-\u{1FAFF}☀-➿]️?/gu, (ch) => (ch.startsWith('♂') || ch.startsWith('♀') ? ch : '')));
  if (!m) return { displayName: raw.replace(/[^\p{L}\p{N}\s]/gu, '').trim(), latin: '', gender: '', title: '' };
  const words = m[2]!.split(/\s+/).filter(Boolean);
  const displayName = words.pop() ?? m[3]!;
  return { displayName, latin: m[3]!.trim(), gender: m[1]?.startsWith('♂') ? 'M' : m[1]?.startsWith('♀') ? 'F' : '', title: words.join(' ') };
}

/** 인물 프로필로 보이는가: 이름(영문) 형식이고 외형·목소리 같은 항목이 있거나 충분히 길다 */
const LATIN = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ .-]*$/;

function looksLikeCharacter(e: LoreEntry): boolean {
  const n = parseName(e.name);
  // 이름 괄호가 영문 이름이거나(헤드비히(Hedwig)), 성별 기호가 붙은 항목(♂️카르엔야(NPC 버전))만 인물로 본다
  if (!(LATIN.test(n.latin) || n.gender) || /list|목록/i.test(e.name)) return false;
  return /#{2,4}\s*(appearance|voice|personality|background|basic|first impression)|외모|외형|성격|말투/i.test(e.content) || e.content.length > 800;
}

export function analyzeEntries(card: NormalizedCard): AnalyzedEntry[] {
  const seen = new Map<string, number>();
  return card.lore.map((e, index) => {
    const n = parseName(e.name);
    if (!LATIN.test(n.latin)) {
      // 괄호가 영문 이름이 아니면(NPC 버전 등) 프로필 첫 제목의 영문 이름을 쓴다: "### Karenya Valkzephas …" → Karenya
      const h = /^#{1,6}\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]+)/m.exec(replaceMacros(e.content, ''));
      n.latin = h ? h[1]! : '';
    }
    const kind: EntryKind = looksLikeInstruction(e) ? 'instruction' : looksLikeCharacter(e) ? 'character' : 'world';
    let choice: EntryChoice = kind === 'instruction' ? 'skip' : kind;
    let note = kind === 'instruction' ? 'AI 운영 지시·출력 형식으로 보여 제외' : '';
    if (!e.enabled) { choice = 'skip'; note = '카드에서 꺼져 있는 항목'; }
    if (kind === 'character') {
      const key = (n.latin || n.displayName).toLowerCase();
      if (seen.has(key)) { choice = 'skip'; note = '같은 인물의 다른 버전 (성별 등) — 필요하면 바꿔서 선택'; }
      else seen.set(key, index);
    }
    return { index, kind, ...n, choice, note };
  });
}

/** 시뮬레이터 카드인가: 설명이 그렇게 말하거나, 인물 프로필 항목이 여럿 있다 */
export function isWorldCard(card: NormalizedCard, analyzed = analyzeEntries(card)): boolean {
  if (/not the character|simulator|시뮬레이터|롤플레잉 (게임|시뮬)/i.test(card.description)) return true;
  return analyzed.filter((a) => a.kind === 'character').length >= 3;
}

// ---------------------------------------------------------------- 프로필 → 인물 필드

/** "#### Appearance" 같은 소제목으로 나눈 구역 */
export function sections(text: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  let cur = { heading: '', body: '' };
  for (const line of text.split('\n')) {
    const h = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (h) { if (cur.body.trim() || cur.heading) out.push(cur); cur = { heading: h[1]!.trim(), body: '' }; }
    else cur.body += `${line}\n`;
  }
  if (cur.body.trim() || cur.heading) out.push(cur);
  return out.map((x) => ({ heading: x.heading, body: x.body.trim() })).filter((x) => x.body);
}

/** 성인 등급이 아닌 세계에는 노골적인 성적 묘사 줄을 넣지 않는다 */
export function dropExplicit(text: string): string {
  return text.split('\n').filter((l) => !/^\s*[-*]?\s*(intimate|sexual|nsfw|성적|19금|성감대)\s*[:：]/i.test(l)).join('\n');
}

const pick = (secs: { heading: string; body: string }[], re: RegExp) => secs.filter((s) => re.test(s.heading)).map((s) => s.body).join('\n');

export function profileFields(entry: LoreEntry, name: string, mature: boolean) {
  let text = replaceMacros(entry.content, name);
  if (!mature) text = dropExplicit(text);
  const secs = sections(text);
  const appearance = pick(secs, /appearance|looks|외모|외형/i);
  const personality = pick(secs, /personality|first impression|성격|인상|briefly/i);
  const speech = pick(secs, /voice|speech|tone|말투|목소리/i);
  const used = /appearance|looks|외모|외형|personality|first impression|성격|인상|briefly|voice|speech|tone|말투|목소리/i;
  const rest = secs.filter((s) => !used.test(s.heading)).map((s) => (s.heading ? `[${s.heading}] ${s.body}` : s.body)).join('\n');
  const firstLine = text.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? '';
  return {
    appearance: cut(appearance || firstLine || '(외형 정보 없음)', 500),
    personality: cut(personality || cut(text, 400), 900),
    speech: cut(speech || '(말투 정보 없음 — 배경을 참고)', 800),
    background: cut(rest || text, 2400),
  };
}

// ---------------------------------------------------------------- 변환

export interface WorldCardOptions {
  choices: EntryChoice[];
  locationId: string;
  mature: boolean;
  /** 인물 index → 초상화 data URL */
  portraits?: Record<number, string>;
}

/** 인물 이름(영문)·성별로 카드 에셋 이미지를 찾는다 (예: Hedwig(F)) */
export function findImage(card: NormalizedCard, a: AnalyzedEntry) {
  if (!a.latin) return undefined;
  const base = a.latin.toLowerCase();
  const exact = card.images.find((i) => i.name.toLowerCase() === `${base}(${a.gender.toLowerCase()})`);
  return exact ?? card.images.find((i) => i.name.toLowerCase().replace(/\(.*\)/, '') === base);
}

export function worldCardToEntities(card: NormalizedCard, world: WorldPackage, analyzed: AnalyzedEntry[], opts: WorldCardOptions): {
  characters: Character[]; facts: Fact[]; claims: Claim[]; beliefs: Belief[];
} {
  const taken = new Set([...world.characters, ...world.facts, ...world.claims, ...world.locations].map((x) => x.id));
  const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const unique = (base: string) => { let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`; taken.add(id); return id; };
  const characters: Character[] = [];
  const facts: Fact[] = [], claims: Claim[] = [], beliefs: Belief[] = [];
  const cardSlug = slug(card.name) || 'card';

  analyzed.forEach((a, i) => {
    if (opts.choices[i] !== 'character') return;
    const e = card.lore[a.index]!;
    const name = a.displayName || a.latin || `인물 ${i + 1}`;
    const f = profileFields(e, name, opts.mature);
    characters.push({
      id: unique(`npc/${slug(a.latin) || slug(name) || `npc-${i + 1}`}`), name,
      appearance: f.appearance, personality: f.personality, speech: f.speech,
      background: a.title ? `직함: ${a.title}\n${f.background}` : f.background,
      locationId: opts.locationId, improvisation: 'minor',
      ...(opts.portraits?.[i] ? { portrait: opts.portraits[i] } : {}),
      source: { format: card.format, name: `${card.name} / ${e.name}`, ...(card.creator ? { creator: card.creator } : {}), importedAt: new Date().toISOString() },
    });
  });

  // 세계 지식: 구역마다 명제 하나 (최대 6개, 각 400자), 가져온 인물 모두가 안다
  analyzed.forEach((a, i) => {
    if (opts.choices[i] !== 'world') return;
    const e = card.lore[a.index]!;
    let text = replaceMacros(e.content, '');
    if (!opts.mature) text = dropExplicit(text);
    const parts = sections(text).slice(0, 6);
    (parts.length ? parts : [{ heading: '', body: text }]).forEach((sec, j) => {
      const statement = cut(`${e.name}${sec.heading ? ` — ${sec.heading}` : ''}: ${sec.body.replace(/\s+/g, ' ')}`, 400);
      const id = unique(`claim/${cardSlug}-${slug(sec.heading) || `lore-${i + 1}`}-${j + 1}`);
      claims.push({ id, statement, truth: 'true' });
      for (const c of characters) beliefs.push({ holder: c.id, claim: id, state: 'confirmed' });
    });
  });
  return { characters, facts, claims, beliefs };
}
