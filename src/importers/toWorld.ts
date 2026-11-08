import type { Belief, Character, Claim, Fact, WorldPackage } from '../engine/schema';
import { type NormalizedCard, replaceMacros } from './charx';
import { looksLikeInstruction } from './worldcard';

/** 로어북 항목을 세계관 지식으로 어떻게 바꿀지 */
export type LoreChoice = 'known' | 'secret' | 'rumor' | 'skip';
export const LORE_CHOICES: [LoreChoice, string][] = [
  ['known', '이 인물이 아는 사실'], ['secret', '이 인물의 비밀'], ['rumor', '이 인물이 들은 소문'], ['skip', '가져오지 않음'],
];
export const MAX_DEFAULT_LORE = 30;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** 설명에서 외형 문장을 추정한다: "외모/외형/appearance" 줄이 있으면 그것, 없으면 첫 문장 */
export function guessAppearance(description: string): string {
  const line = description.split('\n').map((l) => l.trim()).find((l) => /^(외모|외형|생김새|appearance|looks)\s*[:：-]/i.test(l));
  if (line) return cut(line.replace(/^[^:：-]+[:：-]\s*/, ''), 300);
  const first = description.split(/(?<=[.!?。])\s+|\n/).map((x) => x.trim()).find(Boolean) ?? '';
  return cut(first, 300) || '(외형 정보 없음 — 편집기에서 적어 주세요)';
}

export interface CardImportOptions {
  locationId: string;
  loreChoices: LoreChoice[];
  improvisation: Character['improvisation'];
  /** UI에서 축소·변환한 초상화 data URL */
  portrait?: string;
  /** 사용자가 고친 필드 (기본은 카드에서 추정) */
  overrides?: Partial<Pick<Character, 'name' | 'appearance' | 'personality' | 'speech' | 'background' | 'greeting'>>;
}

export function defaultLoreChoices(card: NormalizedCard): LoreChoice[] {
  return card.lore.map((e, i) => (e.enabled && i < MAX_DEFAULT_LORE && !looksLikeInstruction(e) ? 'known' : 'skip'));
}

/** 카드에서 추정한 인물 필드 (편집 전 기본값) */
export function cardFields(card: NormalizedCard) {
  const name = card.nickname || card.name;
  const m = (t: string) => replaceMacros(t, name);
  return {
    name,
    appearance: guessAppearance(m(card.description)),
    personality: cut(m(card.personality) || cut(m(card.description), 400) || '(성격 정보 없음)', 800),
    speech: card.mesExample ? cut(`대화 예시를 참고한 말투:\n${m(card.mesExample).replace(/<START>/gi, '').trim()}`, 900) : (card.firstMes || card.alternateGreetings?.length) ? '첫 인사말의 말투를 따른다.' : '(말투 정보 없음)',
    background: cut(m(card.description), 2000),
    greeting: cut(m(card.firstMes || card.alternateGreetings?.[0] || ''), 800),
  };
}

/** 카드 → 인물 + 지식. 기존 세계의 ID와 겹치지 않게 만든다. */
export function cardToEntities(card: NormalizedCard, world: WorldPackage, opts: CardImportOptions): {
  character: Character; facts: Fact[]; claims: Claim[]; beliefs: Belief[];
} {
  const taken = new Set([...world.characters, ...world.facts, ...world.claims, ...world.locations].map((x) => x.id));
  const unique = (base: string) => { let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`; taken.add(id); return id; };
  const base = slug(card.name) || 'imported';
  const id = unique(`npc/${base}`);
  const f = { ...cardFields(card), ...opts.overrides };
  const character: Character = {
    id, name: f.name, appearance: f.appearance, personality: f.personality, speech: f.speech,
    locationId: opts.locationId, improvisation: opts.improvisation,
    ...(f.background ? { background: f.background } : {}),
    ...(f.greeting ? { greeting: f.greeting } : {}),
    ...(opts.portrait ? { portrait: opts.portrait } : {}),
    source: { format: card.format, name: card.name, ...(card.creator ? { creator: card.creator } : {}), ...(card.version ? { version: card.version } : {}), importedAt: new Date().toISOString() },
  };
  const facts: Fact[] = [], claims: Claim[] = [], beliefs: Belief[] = [];
  card.lore.forEach((entry, i) => {
    const choice = opts.loreChoices[i] ?? 'skip';
    if (choice === 'skip') return;
    const statement = cut(replaceMacros(entry.content, f.name), 400);
    const key = slug(entry.name) || `lore-${i + 1}`;
    const claimId = unique(`claim/${base}-${key}`);
    if (choice === 'secret') {
      const factId = unique(`fact/${base}-${key}`);
      facts.push({ id: factId, statement, secrecy: 4, subjects: [id], protectedTopic: cut(`${f.name}의 ${entry.name || '비밀'}`, 40) });
      claims.push({ id: claimId, statement, truth: 'true', relatesTo: factId });
      beliefs.push({ holder: id, claim: claimId, state: 'secret' });
    } else {
      claims.push({ id: claimId, statement, truth: choice === 'rumor' ? 'partial' : 'true' });
      beliefs.push({ holder: id, claim: claimId, state: choice === 'rumor' ? 'rumor' : 'confirmed' });
    }
  });
  return { character, facts, claims, beliefs };
}
