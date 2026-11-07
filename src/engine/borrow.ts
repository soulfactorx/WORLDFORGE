/**
 * 세계 간 재사용 (v0.63): 이미 만든 세계의 인물·장소·아이템·장면·지식·이미지를 다른 세계로 가져온다.
 * AI를 다시 쓰지 않는다. ID가 겹치면 새 ID를 붙이고, 함께 딸려 오는 것(인물의 이미지·아는 지식·세력·장면 그림)도 옮긴다.
 *
 * 규칙
 * - 성인 등급 세계의 것은 성인 등급 세계로만 옮긴다.
 * - 개인용 세계(다른 사람의 카드로 만든 세계)의 것을 가져오면 대상 세계도 개인용이 되고, 출처 카드가 함께 기록된다
 *   (기기 간 이동 때 그 원본 카드 파일이 필요하다).
 */
import { STD_ITEMS } from '../data/items';
import { classesFor } from './classes';
import type { AssetMeta, Character, Claim, Fact, Rewards, SceneDef, WorldPackage } from './schema';
import { addSource, sourcesOf } from './sources';
import { validateWorld } from './package/validate';

export type BorrowKind = 'character' | 'location' | 'item' | 'monster' | 'scene' | 'faction' | 'knowledge' | 'class' | 'image'
  | 'quest' | 'arc' | 'choice' | 'clock' | 'event' | 'ending' | 'flag' | 'var' | 'encounter';
export const BORROW_LABEL: Record<BorrowKind, string> = {
  character: '인물', location: '장소', item: '아이템', monster: '몬스터', scene: '장면', faction: '세력', knowledge: '지식', class: '직업', image: '이미지',
  quest: '임무', arc: '이야기 줄기', choice: '결정적 선택', clock: '진행 시계', event: '연표 사건', ending: '결말', flag: '플래그', var: '세계 수치', encounter: '조우',
};
/** 이야기 장치 (v0.64): 다른 것을 많이 가리키므로, 가리키는 것을 끝까지 따라가 함께 가져온다 */
const LOGIC = { quest: 'quests', arc: 'arcs', choice: 'choices', clock: 'clocks', event: 'events', ending: 'endings', flag: 'flags', var: 'vars', encounter: 'encounters' } as const;
type LogicKind = keyof typeof LOGIC;
const isLogic = (k: BorrowKind): k is LogicKind => k in LOGIC;
const listOf = (w: WorldPackage, k: LogicKind) => ((w as unknown as Record<string, { id: string }[] | undefined>)[LOGIC[k]] ?? []);

/** 원래 세계의 모든 ID → 종류 */
function indexOf(w: WorldPackage): Map<string, BorrowKind> {
  const m = new Map<string, BorrowKind>();
  const put = (k: BorrowKind, list: { id: string }[] | undefined) => { for (const x of list ?? []) if (!m.has(x.id)) m.set(x.id, k); };
  put('character', w.characters); put('location', w.locations); put('item', w.items); put('monster', w.monsters); put('scene', w.scenes);
  put('faction', w.factions); put('knowledge', w.claims); put('knowledge', w.facts); put('class', w.classes);
  for (const k of Object.keys(LOGIC) as LogicKind[]) put(k, listOf(w, k));
  return m;
}
/** 객체 안의 모든 글 값 */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}
/** 고른 이야기 장치가 가리키는 것을 끝까지 모은다 (인물·장소 등은 그 자체의 딸린 것 규칙을 따른다) */
export function dependencies(source: WorldPackage, picks: BorrowPick[]): BorrowPick[] {
  const idx = indexOf(source);
  const have = new Set(picks.map((p) => `${p.kind}|${p.id}`));
  const out: BorrowPick[] = [];
  const queue = picks.filter((p) => isLogic(p.kind));
  while (queue.length) {
    const p = queue.shift()!;
    const obj = listOf(source, p.kind as LogicKind).find((x) => x.id === p.id);
    if (!obj) continue;
    for (const s of strings(obj)) {
      if (s === p.id) continue;
      const k = idx.get(s);
      if (!k || have.has(`${k}|${s}`)) continue;
      have.add(`${k}|${s}`);
      const np = { kind: k, id: s };
      out.push(np);
      if (isLogic(k)) queue.push(np);
    }
  }
  return out;
}

export interface CatalogEntry {
  kind: BorrowKind;
  id: string;
  name: string;
  /** 한 줄 설명 */
  sub: string;
  /** 검색용 */
  hay: string;
  /** 썸네일로 보여 줄 이미지 ID */
  thumb?: string;
  /** 초상화 (data URL) */
  portrait?: string;
}

const cut = (s: string | undefined, n = 60) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const STD_IDS = new Set(STD_ITEMS.map((i) => i.id));
/** 앱에 내장된 이미지(저장소에 파일이 없다) */
export const isBuiltinAsset = (id: string) => id.startsWith('stock.') || id.startsWith('user.');

/** 이 세계에서 가져올 수 있는 것 목록 */
export function catalogOf(w: WorldPackage): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const thumbOf = (pred: (a: AssetMeta) => boolean) => (w.assets ?? []).find((a) => pred(a) && a.tags.includes('default'))?.id ?? (w.assets ?? []).find(pred)?.id;
  const nImg = (pred: (a: AssetMeta) => boolean) => (w.assets ?? []).filter(pred).length;
  for (const c of w.characters) {
    const n = nImg((a) => a.characterId === c.id);
    out.push({ kind: 'character', id: c.id, name: c.name, sub: [cut(c.appearance, 40), n ? `이미지 ${n}` : '', c.companion ? '동료 가능' : '', c.romanceable ? '연인 가능' : ''].filter(Boolean).join(' · '),
      hay: [c.name, c.id, c.appearance, c.personality, c.background ?? ''].join(' '), ...(thumbOf((a) => a.characterId === c.id) ? { thumb: thumbOf((a) => a.characterId === c.id)! } : {}), ...(c.portrait ? { portrait: c.portrait } : {}) });
  }
  for (const l of w.locations) {
    const t = thumbOf((a) => a.locationId === l.id);
    out.push({ kind: 'location', id: l.id, name: l.name, sub: [cut(l.description, 50), l.shop ? '상점' : ''].filter(Boolean).join(' · '), hay: [l.name, l.id, l.description].join(' '), ...(t ? { thumb: t } : {}) });
  }
  for (const i of w.items ?? []) out.push({ kind: 'item', id: i.id, name: i.name, sub: cut(i.description, 50), hay: [i.name, i.id, i.description, i.kind].join(' ') });
  for (const m of w.monsters ?? []) out.push({ kind: 'monster', id: m.id, name: m.name, sub: cut((m as { description?: string }).description, 50), hay: [m.name, m.id, (m as { description?: string }).description ?? ''].join(' ') });
  for (const s of w.scenes ?? []) out.push({ kind: 'scene', id: s.id, name: s.name, sub: cut(s.description, 50), hay: [s.name, s.id, s.description].join(' '), ...(s.image ? { thumb: s.image } : {}) });
  for (const f of w.factions ?? []) out.push({ kind: 'faction', id: f.id, name: f.name, sub: cut(f.description, 50), hay: [f.name, f.id, f.description].join(' ') });
  for (const c of w.claims) out.push({ kind: 'knowledge', id: c.id, name: cut(c.statement, 40), sub: `주장·소문 (${c.truth === 'true' ? '참' : c.truth === 'false' ? '거짓' : '반쯤 참'}) · 아는 인물 ${w.beliefs.filter((b) => b.claim === c.id && b.holder !== 'player').length}`, hay: [c.statement, c.id].join(' ') });
  for (const f of w.facts) out.push({ kind: 'knowledge', id: f.id, name: cut(f.statement, 40), sub: `사실 · 비밀 등급 ${f.secrecy}`, hay: [f.statement, f.id].join(' ') });
  for (const c of w.classes ?? []) out.push({ kind: 'class', id: c.id, name: c.name, sub: [c.base, c.strengths ?? ''].filter(Boolean).join(' · '), hay: [c.name, c.id, c.blurb ?? '', c.strengths ?? ''].join(' ') });
  const logicSub: Record<LogicKind, (x: Record<string, unknown>) => string> = {
    quest: (x) => `${x.kind === 'main' ? '메인' : '사이드'} 임무 · 단계 ${(x.stages as unknown[] | undefined)?.length ?? 0}`,
    arc: (x) => `장 ${(x.chapters as unknown[] | undefined)?.length ?? 0}개 · ${(x.chapters as { name: string }[] | undefined)?.map((c) => c.name).slice(0, 3).join(' → ') ?? ''}`,
    choice: (x) => cut(x.prompt as string, 50),
    clock: (x) => `${x.segments ?? '?'}칸`,
    event: (x) => cut((x.announce as string) ?? '', 50),
    ending: (x) => cut(x.epilogue as string, 50),
    flag: (x) => cut(x.when as string, 50),
    var: (x) => `처음 ${x.initial ?? 0}`,
    encounter: (x) => cut(x.trigger as string, 50),
  };
  for (const k of Object.keys(LOGIC) as LogicKind[]) {
    for (const x of listOf(w, k) as unknown as Record<string, unknown>[]) {
      const name = String(x.name ?? x.id);
      out.push({ kind: k, id: String(x.id), name, sub: logicSub[k](x), hay: [name, String(x.id), logicSub[k](x)].join(' ') });
    }
  }
  for (const a of w.assets ?? []) {
    const who = a.characterId ? w.characters.find((c) => c.id === a.characterId)?.name : a.locationId ? w.locations.find((l) => l.id === a.locationId)?.name : '';
    out.push({ kind: 'image', id: a.id, name: a.name, sub: [who, a.tags.slice(0, 3).join('·')].filter(Boolean).join(' · '), hay: [a.name, a.id, who ?? '', ...a.tags].join(' '), thumb: a.id });
  }
  for (const e of out) e.hay = e.hay.toLowerCase();
  return out;
}

export interface BorrowPick { kind: BorrowKind; id: string }
export interface BorrowOptions {
  /** 인물이 아는 지식(믿음·관련 사실)도 함께 */
  withKnowledge?: boolean;
  /** 인물·장소의 이미지도 함께 */
  withImages?: boolean;
  /** 인물의 소속 세력도 함께 */
  withFaction?: boolean;
  /** 함께 가져오지 않은 장소에 있던 인물을 둘 곳 (기본: 대상 세계의 시작 장소) */
  placeAt?: string;
  /** 가져온 장소를 이 장소와 길로 잇는다 (가져온 장소끼리 이어진 게 없을 때) */
  linkTo?: string;
  /** 세계 통째로 (v0.67): 세계 설정(장르·개요·문체·시작·달력·시간)과 칭호·관계 사건·돌발 사건도 */
  whole?: boolean;
}

/** 아직 아무것도 없는 새 세계인가 (통째로 가져오면 원래 세계의 설정을 그대로 쓴다) */
export const isBlankWorld = (w: WorldPackage) => !w.characters.length && !(w.quests?.length) && !(w.arcs?.length) && w.locations.length <= 1 && !(w.assets?.length);

/** 세계 통째로 가져올 때 고를 것: 이 세계의 모든 항목 */
export const wholePicks = (w: WorldPackage): BorrowPick[] => catalogOf(w).map((e) => ({ kind: e.kind, id: e.id }));
export interface BorrowResult {
  world: WorldPackage;
  /** 저장소에서 복사해야 할 이미지 (원래 세계 → 대상 세계) */
  copies: { fromPkg: string; fromId: string; toId: string }[];
  notes: string[];
  added: Partial<Record<BorrowKind, number>>;
}

/** source의 picks를 target으로 가져온다 (target은 바꾸지 않고 새 객체를 돌려준다) */
export function borrow(target: WorldPackage, source: WorldPackage, picksIn: BorrowPick[], opts: BorrowOptions = {}): BorrowResult {
  let picks = picksIn;
  const o = { withKnowledge: true, withImages: true, withFaction: true, ...opts };
  if (source.manifest.contentRating === 'mature' && target.manifest.contentRating !== 'mature') {
    throw new Error(`"${source.manifest.name}"은(는) 성인 등급 세계라 성인 등급 세계로만 가져올 수 있습니다.`);
  }
  const w: WorldPackage = structuredClone(target);
  const base: Record<string, number> = Object.fromEntries(COLLS.map((k) => [k, ((target as unknown as Record<string, unknown[] | undefined>)[k] ?? []).length]));
  w.items ??= []; w.monsters ??= []; w.scenes ??= []; w.factions ??= []; w.assets ??= []; w.relations ??= [];
  const notes: string[] = [];
  const added: Partial<Record<BorrowKind, number>> = {};
  const count = (k: BorrowKind) => { added[k] = (added[k] ?? 0) + 1; };
  const taken = new Set<string>([
    ...w.characters.map((x) => x.id), ...w.locations.map((x) => x.id), ...w.items.map((x) => x.id), ...w.monsters.map((x) => x.id), ...w.scenes.map((x) => x.id),
    ...w.factions.map((x) => x.id), ...w.claims.map((x) => x.id), ...w.facts.map((x) => x.id), ...(w.classes ?? []).map((x) => x.id), ...w.assets.map((x) => x.id), ...STD_IDS,
    ...(Object.keys(LOGIC) as LogicKind[]).flatMap((k) => listOf(w, k).map((x) => x.id)),
  ]);
  const idMap = new Map<string, string>();
  const fresh = (id: string, sep = '-') => { let n = id; for (let i = 2; taken.has(n); i++) n = `${id}${sep}${i}`; taken.add(n); idMap.set(id, n); return n; };
  // 이야기 장치가 가리키는 것을 함께 (v0.64)
  const deps = dependencies(source, picks);
  if (deps.length) {
    const by: Partial<Record<BorrowKind, number>> = {};
    for (const d of deps) by[d.kind] = (by[d.kind] ?? 0) + 1;
    notes.push(`고른 임무·이야기 장치가 가리켜 함께 가져온 것: ${Object.entries(by).map(([k, n]) => `${BORROW_LABEL[k as BorrowKind]} ${n}`).join(' · ')}`);
    picks = [...picks, ...deps];
  }
  const want = (k: BorrowKind) => new Set(picks.filter((p) => p.kind === k).map((p) => p.id));

  // ---- 딸려 오는 것 모으기
  const chars = source.characters.filter((c) => want('character').has(c.id));
  const locs = source.locations.filter((l) => want('location').has(l.id));
  const scenes = (source.scenes ?? []).filter((s) => want('scene').has(s.id));
  const factionIds = new Set([...want('faction'), ...(o.withFaction ? chars.map((c) => c.faction).filter((x): x is string => !!x) : [])]);
  const claimIds = new Set(source.claims.filter((c) => want('knowledge').has(c.id)).map((c) => c.id));
  const factIds = new Set(source.facts.filter((f) => want('knowledge').has(f.id)).map((f) => f.id));
  const charIds = new Set(chars.map((c) => c.id));
  if (o.withKnowledge) {
    for (const b of source.beliefs) if (charIds.has(b.holder)) claimIds.add(b.claim);
    for (const f of source.facts) if (f.subjects?.some((s) => charIds.has(s))) factIds.add(f.id);
    for (const l of locs) for (const d of l.discoveries ?? []) claimIds.add(d.claim);
  }
  const itemIds = new Set([...want('item')]);
  const needItem = (id: string) => { if (!STD_IDS.has(id) && (source.items ?? []).some((i) => i.id === id)) itemIds.add(id); };
  for (const c of chars) for (const g of c.gives ?? []) needItem(g.itemId);
  for (const l of locs) { for (const p of l.pickups ?? []) needItem(p.itemId); for (const id of l.shop?.items ?? []) needItem(id); }
  const assetIds = new Set(want('image'));
  if (o.withImages) for (const a of source.assets ?? []) if ((a.characterId && charIds.has(a.characterId)) || (a.locationId && locs.some((l) => l.id === a.locationId))) assetIds.add(a.id);
  const sceneImages = (s: SceneDef) => [s.image, ...(s.phases ?? []).map((p) => p.image), ...s.actions.map((a) => a.image), ...s.ends.map((e) => e.image), ...(s.reactions ?? []).map((r) => (r as { delta?: { image?: string } }).delta?.image)].filter((x): x is string => !!x);
  for (const s of scenes) for (const id of sceneImages(s)) if ((source.assets ?? []).some((a) => a.id === id)) assetIds.add(id);

  // ---- ID 먼저 정하기 (서로를 가리키므로)
  for (const id of factionIds) if ((source.factions ?? []).some((f) => f.id === id)) fresh(id);
  for (const l of locs) fresh(l.id);
  for (const id of itemIds) fresh(id);
  for (const id of want('monster')) fresh(id);
  for (const id of claimIds) fresh(id);
  for (const id of factIds) fresh(id);
  for (const c of chars) fresh(c.id);
  for (const s of scenes) fresh(s.id);
  for (const id of want('class')) fresh(id);
  for (const id of assetIds) fresh(id);
  for (const k of Object.keys(LOGIC) as LogicKind[]) for (const id of want(k)) if (listOf(source, k).some((x) => x.id === id)) fresh(id, k === 'flag' ? '_' : '-');
  const map = (id: string | undefined) => (id ? idMap.get(id) : undefined);
  // 보상 안의 인물·세력·아이템: 새 ID로, 이 세계에 없는 것은 뺀다
  const fixRewards = (r: Rewards): Rewards => {
    const x: Rewards = { ...r };
    const has = (id: string) => w.characters.some((c) => c.id === id) || idMap.has(id);
    if (x.relationship) { x.relationship = x.relationship.map((q) => ({ ...q, npcId: map(q.npcId) ?? q.npcId })).filter((q) => has(q.npcId) || [...idMap.values()].includes(q.npcId)); if (!x.relationship.length) delete x.relationship; }
    if (x.reputation) { x.reputation = x.reputation.map((q) => ({ ...q, factionId: map(q.factionId) ?? q.factionId })).filter((q) => (w.factions ?? []).some((f) => f.id === q.factionId) || [...idMap.values()].includes(q.factionId)); if (!x.reputation.length) delete x.reputation; }
    if (x.items) { x.items = x.items.map((q) => ({ ...q, itemId: map(q.itemId) ?? q.itemId })).filter((q) => STD_IDS.has(q.itemId) || (w.items ?? []).some((i) => i.id === q.itemId) || [...idMap.values()].includes(q.itemId)); if (!x.items.length) delete x.items; }
    if (x.cards) { x.cards = x.cards.map((q) => ({ ...q, who: q.who === 'player' ? q.who : map(q.who) ?? q.who })).filter((q) => q.who === 'player' || [...idMap.values()].includes(q.who) || w.characters.some((c) => c.id === q.who)); if (!x.cards.length) delete x.cards; }
    return x;
  };
  const remap = (v: unknown): unknown => (typeof v === 'string' ? idMap.get(v) ?? v : Array.isArray(v) ? v.map(remap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)])) : v);
  const home = (o.placeAt && w.locations.some((l) => l.id === o.placeAt)) ? o.placeAt : w.start.locationId;

  // ---- 옮기기
  // 세력 행동·인물 목표·장면 조건 등 안의 ID는 새 ID로 바꾸고, 이 세계에 없는 것을 가리키는 부분만 나중에 정리한다 (v0.67)
  for (const f of source.factions ?? []) if (factionIds.has(f.id)) { const x = remap(structuredClone(f)) as typeof f; x.id = map(f.id)!; if (!x.actions?.length) delete x.actions; w.factions.push(x); count('faction'); }
  for (const i of source.items ?? []) if (itemIds.has(i.id)) { w.items.push({ ...structuredClone(i), id: map(i.id)! }); count('item'); }
  for (const m of source.monsters ?? []) if (want('monster').has(m.id)) { w.monsters.push({ ...structuredClone(m), id: map(m.id)! }); count('monster'); }
  for (const c of source.claims) if (claimIds.has(c.id)) { const x: Claim = { ...structuredClone(c), id: map(c.id)! }; if (c.relatesTo) { const r = map(c.relatesTo); if (r) x.relatesTo = r; else delete x.relatesTo; } w.claims.push(x); count('knowledge'); }
  for (const f of source.facts) if (factIds.has(f.id)) { const x: Fact = { ...structuredClone(f), id: map(f.id)! }; if (f.subjects) { const s = f.subjects.map(map).filter((y): y is string => !!y); if (s.length) x.subjects = s; else delete x.subjects; } w.facts.push(x); count('knowledge'); }
  for (const b of source.beliefs) {
    const claim = map(b.claim);
    if (!claim) continue;
    const holder = b.holder === 'player' || b.holder.startsWith('group:') ? b.holder : map(b.holder);
    if (!holder) continue;
    if (b.holder === 'player' && !want('knowledge').has(b.claim)) continue; // 플레이어의 시작 지식은 그 지식을 직접 고를 때만
    w.beliefs.push({ ...structuredClone(b), holder, claim, ...(b.source && map(b.source) ? { source: map(b.source)! } : {}) });
  }
  let droppedLinks = 0;
  for (const l of locs) {
    const x = structuredClone(l);
    x.id = map(l.id)!;
    const conns = l.connections.map(map).filter((y): y is string => !!y);
    droppedLinks += l.connections.length - conns.length;
    x.connections = conns;
    if (x.discoveries) { x.discoveries = x.discoveries.map((d) => ({ ...d, claim: map(d.claim) ?? '' })).filter((d) => d.claim); if (!x.discoveries.length) delete x.discoveries; }
    if (x.pickups) x.pickups = x.pickups.map((p) => ({ ...p, itemId: map(p.itemId) ?? p.itemId }));
    if (x.shop) { x.shop = { ...x.shop, items: x.shop.items.map((id) => map(id) ?? id) }; if (x.shop.factionId) { const f = map(x.shop.factionId); if (f) x.shop.factionId = f; else delete x.shop.factionId; } }
    if (x.board) x.board = remap(x.board) as typeof x.board;
    w.locations.push(x); count('location');
  }
  if (locs.length) {
    const link = o.linkTo && w.locations.some((l) => l.id === o.linkTo) ? o.linkTo : undefined;
    if (link) {
      const first = w.locations.find((l) => l.id === map(locs[0]!.id))!;
      const hub = w.locations.find((l) => l.id === link)!;
      if (!first.connections.includes(link)) first.connections.push(link);
      if (!hub.connections.includes(first.id)) hub.connections.push(first.id);
      notes.push(`가져온 장소 "${first.name}"을(를) "${hub.name}"와(과) 길로 이었습니다.`);
    } else if (droppedLinks) notes.push('가져온 장소는 이 세계의 다른 장소와 이어지지 않았습니다 — 장소 탭의 "연결"에서 길을 이어 주세요.');
  }
  const classIds = new Set((w.classes?.length ? w.classes : classesFor(w)).map((c) => c.id));
  for (const c of chars) {
    const x: Character = structuredClone(c);
    x.id = map(c.id)!;
    x.locationId = map(c.locationId) ?? home;
    if (x.schedule) { x.schedule = x.schedule.map((s) => ({ ...s, locationId: map(s.locationId) ?? '' })).filter((s) => s.locationId); if (!x.schedule.length) delete x.schedule; }
    if (x.faction) { const f = map(x.faction); if (f) x.faction = f; else delete x.faction; }
    if (x.gives) x.gives = remap(x.gives) as typeof x.gives;
    if (x.goals?.length) x.goals = remap(x.goals) as typeof x.goals;
    if (x.companion?.role && !classIds.has(x.companion.role) && !idMap.has(x.companion.role)) delete x.companion.role;
    else if (x.companion?.role && idMap.has(x.companion.role)) x.companion.role = idMap.get(x.companion.role)!;
    w.characters.push(x); count('character');
  }
  for (const r of source.relations ?? []) { const a = map(r.a), b = map(r.b); if (a && b && charIds.has(r.a) && charIds.has(r.b)) w.relations.push({ ...structuredClone(r), a, b }); }
  if (want('class').size) {
    if (!w.classes?.length) w.classes = structuredClone(classesFor(w));
    for (const c of source.classes ?? []) if (want('class').has(c.id)) { w.classes.push({ ...structuredClone(c), id: map(c.id)! }); count('class'); }
  }
  for (const s of scenes) {
    const x: SceneDef = structuredClone(s);
    x.id = map(s.id)!;
    if (x.npcId) { const n = map(x.npcId); if (n) x.npcId = n; else delete x.npcId; }
    if (x.locationId) { const l = map(x.locationId); if (l) x.locationId = l; else delete x.locationId; }
    if (x.start) x.start = remap(x.start) as typeof x.start;
    const img = (id: string | undefined) => (id ? map(id) ?? id : id);
    x.image = img(x.image);
    x.phases = x.phases?.map((p) => ({ ...p, ...(p.image ? { image: img(p.image)! } : {}) }));
    x.actions = x.actions.map((a) => ({ ...a, ...(a.image ? { image: img(a.image)! } : {}) }));
    x.ends = x.ends.map((e) => { const r = remap(e) as typeof e; return { ...r, ...(e.image ? { image: img(e.image)! } : {}), ...(e.rewards ? { rewards: fixRewards(r.rewards!) } : {}) }; });
    w.scenes.push(x); count('scene');
  }
  const copies: BorrowResult['copies'] = [];
  for (const a of source.assets ?? []) {
    if (!assetIds.has(a.id)) continue;
    const x: AssetMeta = { ...structuredClone(a), id: map(a.id)! };
    if (a.characterId) { const c = map(a.characterId); if (c) x.characterId = c; else { delete x.characterId; if (x.kind === 'character') x.kind = 'other'; } }
    if (a.locationId) { const l = map(a.locationId); if (l) x.locationId = l; else delete x.locationId; }
    w.assets.push(x); count('image');
    if (!isBuiltinAsset(a.id)) copies.push({ fromPkg: source.manifest.id, fromId: a.id, toId: x.id });
  }
  if (!w.items.length) delete w.items;
  if (!w.monsters.length) delete w.monsters;
  if (!w.scenes.length) delete w.scenes;
  if (!w.factions.length) delete w.factions;
  if (!w.assets.length) delete w.assets;
  if (!w.relations.length) delete w.relations;

  // ---- 이야기 장치: 통째로 복사하고, 안의 ID를 모두 새 ID로 (v0.64)
  for (const k of Object.keys(LOGIC) as LogicKind[]) {
    const ids = want(k);
    if (!ids.size) continue;
    const key = LOGIC[k];
    const list = ((w as unknown as Record<string, unknown[] | undefined>)[key] ??= []);
    for (const x of listOf(source, k)) if (ids.has(x.id)) { list.push(remap(structuredClone(x))); count(k); }
  }

  // ---- 세계 통째로 (v0.67): 세계 설정과 나머지 장치
  if (o.whole) {
    const blank = isBlankWorld(target);
    const R = <T,>(v: T) => remap(structuredClone(v)) as T;
    if (blank || !target.genre) { if (source.genre) w.genre = structuredClone(source.genre); }
    const join = (mine: string | undefined, theirs: string | undefined) => (!theirs ? mine : !mine?.trim() || blank ? theirs : `${mine}\n\n[${source.manifest.name}]\n${theirs}`);
    const ov = join(w.overview, source.overview); if (ov) w.overview = ov;
    const gm = join(w.gmNotes, source.gmNotes); if (gm) w.gmNotes = gm;
    if (source.style && (!w.style?.trim() || blank)) w.style = source.style;
    if (source.calendar && (!w.calendar || blank)) w.calendar = structuredClone(source.calendar);
    if (source.time && (!w.time || blank)) w.time = structuredClone(source.time);
    if (source.simulation && !w.simulation) w.simulation = structuredClone(source.simulation);
    for (const key of ['titles', 'relationBeats', 'randomEvents', 'starts'] as const) {
      const theirs = (source as unknown as Record<string, { id?: string }[] | undefined>)[key];
      if (!theirs?.length) continue;
      const list = ((w as unknown as Record<string, unknown[] | undefined>)[key] ??= []);
      for (const x of theirs) {
        const copy = R(x) as { id?: string };
        if (copy.id) { let n = copy.id; for (let i = 2; list.some((y) => (y as { id?: string }).id === n); i++) n = `${copy.id}-${i}`; copy.id = n; }
        list.push(copy);
      }
    }
    if (blank) {
      // 빈 새 세계: 원래 세계의 시작을 그대로 — 자리만 잡아 둔 "시작 장소"는 쓰지 않으면 지운다
      const start = R(source.start);
      if (w.locations.some((l) => l.id === start.locationId)) {
        w.start = start;
        const ph = target.locations[0];
        if (ph && ph.id !== start.locationId && !w.characters.some((c) => c.locationId === ph.id)) {
          w.locations = w.locations.filter((l) => l.id !== ph.id).map((l) => ({ ...l, connections: l.connections.filter((x) => x !== ph.id) }));
        }
      }
      notes.push(`「${source.manifest.name}」의 세계 설정(장르·개요·문체·시작 장면·달력·시간 규칙)을 그대로 썼습니다.`);
    } else notes.push(`「${source.manifest.name}」의 개요·GM 메모는 이 세계 것 뒤에 덧붙였고, 이 세계에 이미 있는 설정(장르·문체·달력·시작)은 그대로 두었습니다.`);
  }

  // ---- 정리: 가져온 것 안에서 이 세계에 없는 것(임무·조우·선택·플래그…)을 가리키는 부분을 뺀다
  pruneDangling(w, base, notes);

  // ---- 출처: 개인용 세계에서 가져오면 대상도 개인용 + 출처 카드 기록
  let out = w;
  const srcCards = sourcesOf(source);
  if (source.manifest.private || srcCards.length) {
    const ids = (list: string[] | undefined) => (list ?? []).map(map).filter((y): y is string => !!y);
    for (const sc of srcCards) {
      out = addSource(out, { ...sc, via: 'import', importedAt: new Date().toISOString(), ids: { characters: ids(sc.ids?.characters), facts: ids(sc.ids?.facts), claims: ids(sc.ids?.claims), assets: ids(sc.ids?.assets) } });
    }
    const names = sourcesOf(out).map((s) => s.name);
    out = { ...out, manifest: { ...out.manifest, private: { ...(out.manifest.private ?? { note: source.manifest.private?.note ?? '' }), source: names.join(' · ') || source.manifest.private?.source || source.manifest.name, ...(out.manifest.private?.cardHash ? {} : srcCards[0] ? { cardHash: srcCards[0].hash } : {}) } } };
    notes.push(`"${source.manifest.name}"은(는) 다른 사람의 작품으로 만든 개인용 세계라, 이 세계도 개인용이 됩니다 (내보내기·공유 불가, 기기 간 이동 때 원본 카드 파일 필요).`);
  }
  // 크로스오버 기록 (v0.64): 어느 세계에서 왔는가
  if (Object.keys(added).length && source.manifest.id !== out.manifest.id) {
    const cross = out.manifest.crossover ?? [];
    if (!cross.some((c) => c.id === source.manifest.id)) out = { ...out, manifest: { ...out.manifest, crossover: [...cross, { id: source.manifest.id, name: source.manifest.name }] } };
  }
  const renamed = [...idMap.entries()].filter(([a, b]) => a !== b).length;
  if (renamed) notes.push(`ID가 겹친 ${renamed}개는 새 ID를 붙였습니다 (예: ${[...idMap.entries()].find(([a, b]) => a !== b)!.join(' → ')}).`);
  return { world: out, copies, notes: [...new Set(notes)], added };
}

const COLLS = ['characters', 'locations', 'items', 'monsters', 'scenes', 'factions', 'classes', 'claims', 'facts', 'assets', 'quests', 'arcs', 'choices', 'clocks', 'events', 'endings', 'flags', 'vars', 'encounters'] as const;
const COLL_LABEL: Record<string, string> = { characters: '인물', locations: '장소', items: '아이템', monsters: '몬스터', scenes: '장면', factions: '세력', classes: '직업', claims: '지식', facts: '지식', assets: '이미지', quests: '임무', arcs: '이야기 줄기', choices: '결정적 선택', clocks: '진행 시계', events: '연표 사건', endings: '결말', flags: '플래그', vars: '세계 수치', encounters: '조우' };

/** 검사기 오류 중 새로 가져온 항목 안의 것: 그 부분(가장 가까운 목록 칸, 없으면 그 속성)을 지운다 */
function pruneDangling(w: WorldPackage, base: Record<string, number>, notes: string[]) {
  for (let round = 0; round < 6; round++) {
    const errs = validateWorld(w).filter((i) => i.level === 'error');
    const hits: { coll: string; idx: number; rest: string }[] = [];
    for (const e of errs) {
      const m = e.path.match(/^(\w+)\[(\d+)\](.*)$/);
      if (!m || !(COLLS as readonly string[]).includes(m[1]!) || Number(m[2]) < (base[m[1]!] ?? 0)) continue;
      if (m[3]) hits.push({ coll: m[1]!, idx: Number(m[2]), rest: m[3] });
    }
    if (!hits.length) return;
    // 같은 목록에서 뒤쪽부터 지워야 앞쪽 번호가 안 바뀐다
    const ops = hits.map((h) => {
      const segs = [...h.rest.matchAll(/\.(\w+)|\[(\d+)\]/g)].map((x) => (x[1] !== undefined ? x[1] : Number(x[2])));
      const lastArr = segs.map((x, i) => (typeof x === 'number' ? i : -1)).filter((i) => i >= 0).pop();
      return { ...h, segs: lastArr !== undefined ? segs.slice(0, lastArr + 1) : segs.slice(0, 1) };
    }).sort((a, b) => JSON.stringify(b.segs).localeCompare(JSON.stringify(a.segs)));
    const seen = new Set<string>();
    for (const op of ops) {
      const key = `${op.coll}[${op.idx}]${JSON.stringify(op.segs)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ent = ((w as unknown as Record<string, unknown[]>)[op.coll] ?? [])[op.idx] as Record<string, unknown> | undefined;
      if (!ent) continue;
      let parent: unknown = ent;
      for (const sgm of op.segs.slice(0, -1)) parent = (parent as Record<string | number, unknown>)?.[sgm as never];
      const last = op.segs.at(-1)!;
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else if (parent && typeof parent === 'object') delete (parent as Record<string, unknown>)[last as string];
      const name = (ent.name as string) ?? (ent.statement as string) ?? (ent.id as string);
      notes.push(`${COLL_LABEL[op.coll]} "${String(name).slice(0, 30)}"의 ${String(op.segs[0])} 일부는 원래 세계의 것을 가리켜 뺐습니다.`);
    }
  }
}

