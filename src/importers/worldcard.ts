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

/** 프로필 첫 제목: "### 윤 (Yun) ─ 윤 사무소 대표, 23구" → 이름·괄호·직함 */
const PROFILE_HEAD = /^#{1,6}\s+([^\n(─—–]{1,24}?)\s*\(([^)\n]{1,40})\)\s*(?:[─—–-]\s*([^\n]*))?$/m;
/** "- Look: …" 식 항목 프로필 */
const FIELD_BULLET = /^\s*[-*]\s*(look|looks|appearance|speech|voice|manner|personality|where|who|routine|wants|weak spot|ties|외모|외형|말투|성격|정체|직업)\s*[:：]/gim;

function bulletProfile(text: string): boolean {
  const fields = new Set([...text.matchAll(FIELD_BULLET)].map((m) => m[1]!.toLowerCase()));
  return fields.size >= 2 && [...fields].some((f) => /look|appearance|speech|voice|manner|personality|외모|외형|말투|성격/.test(f));
}

function looksLikeCharacter(e: LoreEntry): boolean {
  if (/list|목록|명단/i.test(e.name)) return false;
  // 항목형 프로필 (### 이름 (별칭) ─ 직함 + - Look: / - Speech: …)
  if (PROFILE_HEAD.test(e.content.slice(0, 300)) && bulletProfile(e.content)) return true;
  const n = parseName(e.name);
  // 이름 괄호가 영문 이름이거나(헤드비히(Hedwig)), 성별 기호가 붙은 항목(♂️카르엔야(NPC 버전))만 인물로 본다
  if (!(LATIN.test(n.latin) || n.gender) || /list|목록/i.test(e.name)) return false;
  return /#{2,4}\s*(appearance|voice|personality|background|basic|first impression)|외모|외형|성격|말투/i.test(e.content) || e.content.length > 800;
}

export function analyzeEntries(card: NormalizedCard): AnalyzedEntry[] {
  const seen = new Map<string, number>();
  return card.lore.map((e, index) => {
    const n = parseName(e.name);
    const head = PROFILE_HEAD.exec(replaceMacros(e.content, '').slice(0, 300));
    if (head && !NAME_RE.test(e.name)) {
      // 항목 이름에 괄호가 없으면 첫 제목에서: "### 오목련 (목련 반장) ─ 심연 로프 조합 반장, 12구"
      const inParen = head[2]!.trim();
      if (LATIN.test(inParen)) n.latin = inParen;
      n.displayName = head[1]!.trim() || n.displayName;
      const role = (head[3] ?? '').replace(/\(이 세계 창작\)/, '').trim();
      n.title = [LATIN.test(inParen) ? '' : inParen, role].filter(Boolean).join(' · ');
    }
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

/** "- Look: 179 cm; …" 항목을 구역으로 */
function bulletSections(text: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  for (const m of text.matchAll(/^\s*[-*]\s*([A-Za-z가-힣' ]{2,20})\s*[:：]\s*(.+)$/gm)) out.push({ heading: m[1]!.trim(), body: m[2]!.trim() });
  return out;
}

const pick = (secs: { heading: string; body: string }[], re: RegExp) => secs.filter((s) => re.test(s.heading)).map((s) => s.body).join('\n');

export function profileFields(entry: LoreEntry, name: string, mature: boolean) {
  let text = replaceMacros(entry.content, name);
  if (!mature) text = dropExplicit(text);
  const bullets = bulletSections(text);
  const heads = sections(text);
  // 소제목(#### Appearance 등)이 없고 "- Look:" 식 항목만 있는 프로필이면 항목을 구역으로 쓴다
  const secs = heads.length <= 1 && bullets.length >= 3 ? bullets : heads;
  const appearance = pick(secs, /appearance|looks?$|외모|외형/i);
  const personality = [pick(secs, /personality|first impression|성격|인상|briefly|manner|^who$/i), pick(secs, /wants|weak spot|don.?t flatten/i)].filter(Boolean).join('\n');
  const speech = pick(secs, /voice|speech|tone|말투|목소리/i);
  const used = /appearance|looks?$|외모|외형|personality|first impression|성격|인상|briefly|voice|speech|tone|말투|목소리|manner|wants|weak spot|don.?t flatten|^who$/i;
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

/** 설정 글을 명제 조각으로: 소제목 구역마다, 긴 구역은 줄 단위로 380자 안쪽씩 */
export function knowledgePieces(text: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  const secs = sections(text);
  for (const sec of secs.length ? secs : [{ heading: '', body: text }]) {
    let cur = '';
    for (const line of sec.body.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (cur && cur.length + line.length > 380) { out.push({ heading: sec.heading, body: cur }); cur = ''; }
      cur = cur ? `${cur} ${line}` : line;
    }
    if (cur) out.push({ heading: sec.heading, body: cur });
  }
  return out;
}

/** 이 설정 항목을 이 인물이 알 만한가 */
function relevantTo(e: LoreEntry, text: string, c: Character, profile: string): boolean {
  const parts = e.name.split(/[·,/()]|\s[-─]\s/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2);
  if (parts.some((p) => profile.includes(p))) return true;
  const latin = c.id.replace(/^npc\//, '').replace(/-\d+$/, '').replace(/-/g, ' ');
  if ((c.name.length >= 2 && text.includes(c.name)) || (latin.length >= 3 && new RegExp(`\\b${latin}\\b`, 'i').test(text))) return true;
  // 같은 구역 (예: 23구)
  const districts = e.name.match(/\d+구/g) ?? [];
  return districts.some((d) => (c.background ?? '').includes(d));
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

  const charEntries: AnalyzedEntry[] = [];
  analyzed.forEach((a, i) => {
    if (opts.choices[i] !== 'character') return;
    charEntries.push(a);
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

  // 세계 지식: 항목을 400자 안쪽 명제로 나눈다 (항목당 최대 8개)
  // 설정 항목이 많으면(30개 초과) 모두가 다 알지 않는다: 늘 켜진(상수) 항목은 모두가,
  // 나머지는 그 항목을 언급하거나 그 항목에 언급되는 인물, 같은 구역의 인물만 안다
  const worldCount = analyzed.filter((_, i) => opts.choices[i] === 'world').length;
  const selective = worldCount > 30;
  const charText = new Map(characters.map((c, k) => [c.id, `${c.name} ${c.background ?? ''} ${card.lore[charEntries[k]!.index]!.content}`.toLowerCase()]));
  analyzed.forEach((a, i) => {
    if (opts.choices[i] !== 'world') return;
    const e = card.lore[a.index]!;
    let text = replaceMacros(e.content, '');
    if (!opts.mature) text = dropExplicit(text);
    const pieces = knowledgePieces(text).slice(0, 8);
    const knowers = !selective || e.constant ? characters : characters.filter((c) => relevantTo(e, text, c, charText.get(c.id)!));
    pieces.forEach((sec, j) => {
      const statement = cut(`${e.name}${sec.heading ? ` — ${sec.heading}` : ''}: ${sec.body.replace(/\s+/g, ' ')}`, 400);
      const id = unique(`claim/${cardSlug}-${slug(sec.heading) || `lore-${i + 1}`}-${j + 1}`);
      claims.push({ id, statement, truth: 'true' });
      for (const c of knowers) beliefs.push({ holder: c.id, claim: id, state: 'confirmed' });
    });
  });
  return { characters, facts, claims, beliefs };
}
