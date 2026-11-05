/**
 * 콘텐츠 패키지 (설계 v3 10장 · R7): 세계와 따로 주고받는 인물 패키지(.chp)·규칙 패키지(.rule).
 * 가져올 때 ID 충돌·없는 의존성·맞지 않는 참조를 보여주고, 덮어쓰지 않고 사용자가 고른다 (v2 원칙).
 * 순수 함수 — 파일 읽기·이미지 저장은 storage/packs.
 */
import type { AssetMeta, Belief, Character, Claim, CustomMonster, EntityId, ItemDef, NpcRelation, WorldPackage } from '../schema';

export interface PackManifest {
  id: string;
  type: 'character' | 'rules';
  name: string;
  version: string;
  author: string;
  license: string;
  contentRating: WorldPackage['manifest']['contentRating'];
  description?: string;
  /** 이 패키지가 쓰는 다른 패키지 (예: 인물이 쓰는 아이템이 든 규칙 패키지) */
  requires?: { id: string; version: string }[];
}

export interface CharacterPack {
  manifest: PackManifest & { type: 'character' };
  characters: Character[];
  /** 이 인물들이 아는 명제와 그 지식 */
  claims: Claim[];
  beliefs: Belief[];
  /** 이 인물들 사이의 관계 */
  relations: NpcRelation[];
  /** 이 인물들이 건네는 세계 고유 아이템 */
  items: ItemDef[];
  /** 이 인물들의 이미지 정보 (그림은 zip 안 images/) */
  assets: AssetMeta[];
}

export interface RulesPack {
  manifest: PackManifest & { type: 'rules' };
  items: ItemDef[];
  /** 세계만의 적 */
  monsters?: CustomMonster[];
  genre?: { terms?: Record<string, string>; currency?: string; levelCap?: number };
}

export type ContentPack = CharacterPack | RulesPack;

const ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/** 고른 인물로 인물 패키지를 만든다. 내 기본 이미지(user.…)는 내 라이브러리 것이라 넣지 않는다 */
export function buildCharacterPack(world: WorldPackage, ids: EntityId[], manifest: Omit<PackManifest, 'type' | 'contentRating'>): { pack: CharacterPack; notes: string[] } {
  const notes: string[] = [];
  const set = new Set(ids);
  const characters = world.characters.filter((c) => set.has(c.id)).map((c) => structuredClone(c));
  const beliefs = world.beliefs.filter((b) => set.has(b.holder));
  const claimIds = new Set(beliefs.map((b) => b.claim));
  const claims = world.claims.filter((c) => claimIds.has(c.id)).map(({ relatesTo: _r, ...c }) => c); // 진실(fact)은 세계의 것 — 넣지 않는다
  const relations = (world.relations ?? []).filter((r) => set.has(r.a) && set.has(r.b));
  const giveIds = new Set(characters.flatMap((c) => (c.gives ?? []).map((g) => g.itemId)));
  const items = (world.items ?? []).filter((i) => giveIds.has(i.id));
  const assets = (world.assets ?? []).filter((a) => a.characterId && set.has(a.characterId) && !a.id.startsWith('user.'));
  const dropped = (world.assets ?? []).filter((a) => a.characterId && set.has(a.characterId) && a.id.startsWith('user.')).length;
  if (dropped) notes.push(`내 기본 이미지 ${dropped}장은 내 라이브러리의 것이라 넣지 않았습니다.`);
  for (const c of characters) {
    if (c.faction) { notes.push(`${c.name}: 소속 세력은 세계의 것이라 뺐습니다.`); delete c.faction; }
    if (c.gives?.some((g) => g.condition)) { c.gives = c.gives.map(({ condition: _c, ...g }) => g); notes.push(`${c.name}: 건넬 것의 조건은 세계에 맞게 다시 정해야 해서 뺐습니다.`); }
  }
  return { pack: { manifest: { ...manifest, type: 'character', contentRating: world.manifest.contentRating }, characters, claims, beliefs, relations, items, assets }, notes };
}

export function buildRulesPack(world: WorldPackage, manifest: Omit<PackManifest, 'type' | 'contentRating'>): RulesPack {
  const g = world.genre;
  const genre = g && (g.terms || g.currency || g.levelCap) ? { ...(g.terms ? { terms: g.terms } : {}), ...(g.currency ? { currency: g.currency } : {}), ...(g.levelCap ? { levelCap: g.levelCap } : {}) } : undefined;
  return { manifest: { ...manifest, type: 'rules', contentRating: world.manifest.contentRating }, items: structuredClone(world.items ?? []),
    ...(world.monsters?.length ? { monsters: structuredClone(world.monsters) } : {}), ...(genre ? { genre } : {}) };
}

/** 패키지 JSON 검사 (형식만 — 참조는 가져올 때 계획에서 본다) */
export function checkPack(data: unknown): string[] {
  const errs: string[] = [];
  const d = data as ({ manifest?: PackManifest } & Record<string, unknown>) | null;
  if (!d || typeof d !== 'object' || !d.manifest) return ['패키지 정보(manifest)가 없습니다.'];
  const m = d.manifest;
  if (m.type !== 'character' && m.type !== 'rules') errs.push(`알 수 없는 패키지 종류 "${String(m.type)}" (character·rules)`);
  if (!ID_RE.test(String(m.id))) errs.push('패키지 ID가 올바르지 않습니다.');
  if (!m.name) errs.push('패키지 이름이 없습니다.');
  if (!['all', 'teen', 'mature'].includes(m.contentRating)) errs.push('콘텐츠 등급이 없습니다.');
  if (m.type === 'character') {
    if (!Array.isArray(d.characters) || !d.characters.length) errs.push('인물이 없습니다.');
    for (const k of ['claims', 'beliefs', 'relations', 'items', 'assets']) if (!Array.isArray(d[k])) errs.push(`${k} 목록이 없습니다.`);
  }
  if (m.type === 'rules' && !Array.isArray(d.items)) errs.push('items 목록이 없습니다.');
  return errs;
}

// ---------------------------------------------------------------- 가져오기 계획

export type Resolution = 'rename' | 'replace' | 'skip';

export interface ImportPlan {
  /** 세계에 이미 있는 ID (사용자가 이름 바꿔 넣기·바꾸기·건너뛰기를 고른다) */
  conflicts: { kind: '인물' | '명제' | '아이템' | '이미지' | '적'; id: string; existing: string; incoming: string }[];
  /** 세계에 없는 의존성 */
  missingRequires: { id: string; version: string }[];
  /** 세계에 없는 장소를 가리키는 인물·일정 (가져올 때 고른 장소로 옮긴다) */
  unknownLocations: string[];
  /** 막는 문제 (가져올 수 없음) */
  blockers: string[];
  warnings: string[];
}

const RATING_RANK = { all: 0, teen: 1, mature: 2 } as const;

export function planImport(world: WorldPackage, pack: ContentPack): ImportPlan {
  const plan: ImportPlan = { conflicts: [], missingRequires: [], unknownLocations: [], blockers: [], warnings: [] };
  const wr = world.manifest.contentRating, pr = pack.manifest.contentRating;
  if (RATING_RANK[pr] > RATING_RANK[wr]) plan.blockers.push(`패키지 등급(${pr})이 세계 등급(${wr})보다 높아 넣을 수 없습니다.`);
  const included = new Set((world.manifest.includes ?? []).map((x) => x.id));
  plan.missingRequires = (pack.manifest.requires ?? []).filter((r) => !included.has(r.id));
  const itemConf = (items: ItemDef[]) => items.forEach((i) => {
    const ex = world.items?.find((x) => x.id === i.id);
    if (ex) plan.conflicts.push({ kind: '아이템', id: i.id, existing: ex.name, incoming: i.name });
  });
  if (pack.manifest.type === 'character') {
    const p = pack as CharacterPack;
    for (const c of p.characters) { const ex = world.characters.find((x) => x.id === c.id); if (ex) plan.conflicts.push({ kind: '인물', id: c.id, existing: ex.name, incoming: c.name }); }
    for (const c of p.claims) { const ex = world.claims.find((x) => x.id === c.id); if (ex && ex.statement !== c.statement) plan.conflicts.push({ kind: '명제', id: c.id, existing: ex.statement.slice(0, 40), incoming: c.statement.slice(0, 40) }); }
    for (const a of p.assets) { const ex = world.assets?.find((x) => x.id === a.id); if (ex && !a.id.startsWith('stock.')) plan.conflicts.push({ kind: '이미지', id: a.id, existing: ex.name, incoming: a.name }); }
    itemConf(p.items);
    const locs = new Set(world.locations.map((l) => l.id));
    plan.unknownLocations = [...new Set(p.characters.flatMap((c) => [c.locationId, ...(c.schedule ?? []).map((s) => s.locationId)]).filter((l) => !locs.has(l)))];
    const usedItems = p.characters.flatMap((c) => (c.gives ?? []).map((g) => g.itemId));
    const known = new Set([...(world.items ?? []).map((i) => i.id), ...p.items.map((i) => i.id)]);
    const missing = [...new Set(usedItems.filter((i) => !i.startsWith('std/') && !known.has(i)))];
    if (missing.length) plan.warnings.push(`세계에 없는 아이템을 건네는 인물이 있습니다 (${missing.join(', ')}) — 그 항목은 뺍니다.`);
  } else {
    itemConf((pack as RulesPack).items);
    for (const m of (pack as RulesPack).monsters ?? []) { const ex = world.monsters?.find((x) => x.id === m.id); if (ex) plan.conflicts.push({ kind: '적', id: m.id, existing: ex.name, incoming: m.name }); }
    const g = (pack as RulesPack).genre;
    if (g?.terms && world.genre?.terms) {
      const clash = Object.keys(g.terms).filter((k) => world.genre!.terms![k] && world.genre!.terms![k] !== g.terms![k]);
      if (clash.length) plan.warnings.push(`용어 바꿈표가 다른 항목은 세계의 것을 그대로 둡니다: ${clash.slice(0, 8).join(', ')}`);
    }
  }
  return plan;
}

// ---------------------------------------------------------------- 합치기

export interface ApplyOptions {
  /** 충돌한 ID마다 (기본 rename) */
  resolve?: Record<string, Resolution>;
  /** 세계에 없는 장소를 가리키는 인물을 둘 곳 (기본 시작 장소) */
  locationId?: EntityId;
  /** 규칙 패키지: 화폐·최대 레벨도 바꿀까 */
  applyGenreSettings?: boolean;
}

export interface ApplyResult {
  world: WorldPackage;
  notes: string[];
  /** 패키지 안 이미지 ID → 세계에 저장할 ID */
  assetIds: Record<string, string>;
}

/** 겹치지 않는 새 ID */
function freshId(id: string, taken: Set<string>): string {
  let n = 2, out = `${id}-${n}`;
  while (taken.has(out)) out = `${id}-${++n}`;
  taken.add(out);
  return out;
}

export function applyPack(world: WorldPackage, pack: ContentPack, opts: ApplyOptions = {}): ApplyResult {
  const plan = planImport(world, pack);
  if (plan.blockers.length) throw new Error(plan.blockers.join(' '));
  const w: WorldPackage = structuredClone(world);
  const notes: string[] = [];
  const res = (id: string): Resolution => opts.resolve?.[id] ?? 'rename';
  const conflict = (id: string) => plan.conflicts.some((c) => c.id === id);
  const taken = new Set<string>([...w.characters, ...w.claims, ...w.locations, ...w.facts, ...(w.items ?? []), ...(w.assets ?? []), ...(w.monsters ?? [])].map((x) => x.id));
  const idMap = new Map<string, string>(); // 이름 바꾼 ID
  const skipped = new Set<string>();
  const place = (id: string) => {
    if (!conflict(id)) return id;
    const r = res(id);
    if (r === 'skip') { skipped.add(id); return null; }
    if (r === 'replace') return id;
    const nid = freshId(id, taken);
    idMap.set(id, nid);
    return nid;
  };
  const map = (id: string) => idMap.get(id) ?? id;

  // 아이템 (인물 패키지·규칙 패키지 공통)
  for (const it of pack.items) {
    const id = place(it.id);
    if (!id) continue;
    w.items = [...(w.items ?? []).filter((x) => x.id !== id), { ...it, id }];
  }
  if (pack.manifest.type === 'rules') {
    for (const m of (pack as RulesPack).monsters ?? []) {
      const id = place(m.id);
      if (!id) continue;
      w.monsters = [...(w.monsters ?? []).filter((x) => x.id !== id), { ...m, id }];
    }
    if ((pack as RulesPack).monsters?.length) notes.push(`적 ${(pack as RulesPack).monsters!.length}종을 넣었습니다 (조우 탭에서 쓸 수 있습니다).`);
    const g = (pack as RulesPack).genre;
    if (g?.terms) {
      const terms = { ...g.terms, ...(w.genre?.terms ?? {}) }; // 세계의 것이 이긴다
      w.genre = { id: w.genre?.id ?? 'high_fantasy', ...w.genre, terms };
    }
    if (opts.applyGenreSettings && (g?.currency || g?.levelCap)) {
      w.genre = { id: w.genre?.id ?? 'high_fantasy', ...w.genre, ...(g.currency ? { currency: g.currency } : {}), ...(g.levelCap ? { levelCap: g.levelCap } : {}) };
      notes.push('화폐·최대 레벨을 패키지 값으로 바꿨습니다.');
    }
    notes.push(`아이템 ${pack.items.length - [...skipped].length}개를 넣었습니다.`);
  } else {
    const p = pack as CharacterPack;
    const locs = new Set(w.locations.map((l) => l.id));
    const home = opts.locationId && locs.has(opts.locationId) ? opts.locationId : w.start.locationId;
    // 명제: 같은 내용이면 함께 쓴다
    for (const c of p.claims) {
      const same = w.claims.find((x) => x.id === c.id && x.statement === c.statement);
      if (same) continue;
      const id = place(c.id);
      if (!id) continue;
      w.claims = [...w.claims.filter((x) => x.id !== id), { ...c, id }];
    }
    const assetIds: Record<string, string> = {};
    for (const a of p.assets) {
      const id = a.id.startsWith('stock.') ? a.id : place(a.id);
      if (!id) continue;
      assetIds[a.id] = id;
    }
    const itemIds = new Set([...(w.items ?? []).map((i) => i.id)]);
    for (const c of p.characters) {
      const id = place(c.id);
      if (!id) continue;
      const ch: Character = structuredClone(c);
      ch.id = id;
      if (!locs.has(ch.locationId)) ch.locationId = home;
      if (ch.schedule) { ch.schedule = ch.schedule.filter((s) => locs.has(s.locationId)); if (!ch.schedule.length) delete ch.schedule; }
      if (ch.gives) {
        ch.gives = ch.gives.map((g) => ({ ...g, itemId: map(g.itemId) })).filter((g) => g.itemId.startsWith('std/') || itemIds.has(g.itemId));
        if (!ch.gives.length) delete ch.gives;
      }
      w.characters = [...w.characters.filter((x) => x.id !== id), ch];
    }
    const inPack = (id: string) => p.characters.some((c) => c.id === id) && !skipped.has(id);
    for (const b of p.beliefs) {
      if (!inPack(b.holder) || skipped.has(b.claim)) continue;
      const nb = { ...b, holder: map(b.holder), claim: map(b.claim) };
      w.beliefs = [...w.beliefs.filter((x) => !(x.holder === nb.holder && x.claim === nb.claim)), nb];
    }
    for (const r of p.relations) {
      if (!inPack(r.a) || !inPack(r.b)) continue;
      w.relations = [...(w.relations ?? []), { ...r, a: map(r.a), b: map(r.b) }];
    }
    for (const a of p.assets) {
      if (!assetIds[a.id] || (a.characterId && !inPack(a.characterId))) continue;
      const na = { ...a, id: assetIds[a.id]!, ...(a.characterId ? { characterId: map(a.characterId) } : {}) };
      w.assets = [...(w.assets ?? []).filter((x) => x.id !== na.id), na];
    }
    const added = p.characters.filter((c) => !skipped.has(c.id));
    notes.push(`인물 ${added.length}명(${added.map((c) => c.name).join(', ')})과 지식 ${p.claims.length}개를 넣었습니다.`);
    if (plan.unknownLocations.length) notes.push(`세계에 없는 장소를 가리키던 인물은 "${w.locations.find((l) => l.id === home)?.name}"에 두었습니다.`);
    if (idMap.size) notes.push(`ID가 겹쳐 이름을 바꿔 넣은 것: ${[...idMap.entries()].map(([a, b]) => `${a} → ${b}`).join(', ')}`);
    w.manifest = { ...w.manifest, includes: [...(w.manifest.includes ?? []).filter((x) => x.id !== pack.manifest.id), { id: pack.manifest.id, version: pack.manifest.version, type: pack.manifest.type, name: pack.manifest.name }] };
    return { world: w, notes: [...notes, ...plan.warnings], assetIds };
  }
  w.manifest = { ...w.manifest, includes: [...(w.manifest.includes ?? []).filter((x) => x.id !== pack.manifest.id), { id: pack.manifest.id, version: pack.manifest.version, type: pack.manifest.type, name: pack.manifest.name }] };
  return { world: w, notes: [...notes, ...plan.warnings], assetIds: {} };
}
