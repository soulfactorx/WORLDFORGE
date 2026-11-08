/**
 * 출처 카드 관리 (v0.53) — 세계에 들어간 다른 사람의 카드 파일을 모두 기록하고, 하나씩 뺄 수 있다.
 * 기기 간 이동은 기록된 모든 카드의 지문으로 잠그고, 받는 기기에서 모든 원본 파일을 확인한다.
 */
import type { SourceCard, WorldPackage } from './schema';

/** 기록된 출처 (예전 세계는 private.cardHash로 하나를 만든다) */
export function sourcesOf(world: WorldPackage): SourceCard[] {
  if (world.manifest.sources?.length) return world.manifest.sources;
  const p = world.manifest.private;
  if (p?.cardHash) return [{ hash: p.cardHash, name: p.source, importedAt: '', via: 'world' }];
  return [];
}

/** 기기 간 이동에 필요한 카드 지문 (중복 없이, 순서 고정) */
export const sourceHashes = (world: WorldPackage) => [...new Set(sourcesOf(world).map((s) => s.hash).filter(Boolean))].sort();

/** 출처 더하기: 같은 카드(지문)면 합친다 */
export function addSource(world: WorldPackage, src: SourceCard): WorldPackage {
  const list = sourcesOf(world).map((s) => ({ ...s }));
  const hit = list.find((s) => s.hash === src.hash);
  if (hit) {
    const ids = hit.ids ?? { characters: [], facts: [], claims: [], assets: [] };
    const add = src.ids ?? { characters: [], facts: [], claims: [], assets: [] };
    hit.ids = { characters: [...ids.characters, ...add.characters], facts: [...ids.facts, ...add.facts], claims: [...ids.claims, ...add.claims], assets: [...ids.assets, ...add.assets] };
    hit.importedAt = src.importedAt;
  } else list.push(src);
  return { ...world, manifest: { ...world.manifest, sources: list } };
}

export interface RemoveResult { world: WorldPackage; removed: { characters: number; facts: number; claims: number; beliefs: number; assets: number }; unlocked: boolean }

/**
 * 출처 카드 하나에서 온 것을 지운다: 인물·사실·명제·이미지, 그리고 그것을 가리키는 믿음·관계·관계 사건·이미지 연결.
 * 다른 곳(임무·장면 등)에서 지운 인물을 쓰면 그 자리는 비우거나 검사기가 알려 준다.
 * 마지막 출처를 지웠고 세계 전체를 카드로 만든 게 아니면 개인용 잠금을 푼다.
 */
export function removeSource(world: WorldPackage, hash: string): RemoveResult {
  const all = sourcesOf(world);
  const src = all.find((s) => s.hash === hash);
  if (!src) throw new Error('없는 출처입니다.');
  if (src.via === 'world') throw new Error('이 카드로 세계 전체를 만들었기 때문에 뺄 수 없습니다.');
  const ids = src.ids ?? { characters: [], facts: [], claims: [], assets: [] };
  const C = new Set(ids.characters), F = new Set(ids.facts), L = new Set(ids.claims), A = new Set(ids.assets);
  const w = world;
  const beliefs = w.beliefs.filter((b) => !C.has(b.holder) && !L.has(b.claim));
  const next: WorldPackage = {
    ...w,
    characters: w.characters.filter((c) => !C.has(c.id)),
    facts: w.facts.filter((f) => !F.has(f.id)).map((f) => (f.subjects?.some((x) => C.has(x)) ? { ...f, subjects: f.subjects.filter((x) => !C.has(x)) } : f)),
    claims: w.claims.filter((c) => !L.has(c.id)),
    beliefs,
    ...(w.assets ? { assets: w.assets.filter((a) => !A.has(a.id) && !(a.characterId && C.has(a.characterId))) } : {}),
    ...(w.relations ? { relations: w.relations.filter((r) => !C.has(r.a) && !C.has(r.b)) } : {}),
    ...(w.relationBeats ? { relationBeats: w.relationBeats.filter((b) => !C.has(b.npcId)) } : {}),
    ...(w.rules ? { rules: w.rules.map((r) => (r.reactions?.some((x) => C.has(x.npcId)) ? { ...r, reactions: r.reactions.filter((x) => !C.has(x.npcId)) } : r)) } : {}),
    ...(w.quests ? { quests: w.quests.map((q) => { const { giver, target, ...rest } = q; return { ...rest, ...(giver && !C.has(giver) ? { giver } : {}), ...(target && !C.has(target) ? { target } : {}) }; }) } : {}),
    ...(w.scenes ? { scenes: w.scenes.map((s) => (s.npcId && C.has(s.npcId) ? (({ npcId: _n, ...r }) => r)(s) : s)) } : {}),
  };
  const rest = all.filter((s) => s.hash !== hash);
  const unlocked = rest.length === 0 && !!w.manifest.private;
  const { private: _p, ...manifestNoPrivate } = w.manifest;
  next.manifest = { ...(unlocked ? manifestNoPrivate : w.manifest), sources: rest };
  if (!unlocked && w.manifest.private) {
    const { cardHash, ...p } = w.manifest.private;
    const keep = cardHash && cardHash !== hash ? cardHash : rest[0]?.hash;
    next.manifest.private = { ...p, source: rest.map((s) => s.name).join(' · ') || p.source, ...(keep ? { cardHash: keep } : {}) };
  }
  return {
    world: next, unlocked,
    removed: { characters: w.characters.length - next.characters.length, facts: w.facts.length - next.facts.length, claims: w.claims.length - next.claims.length, beliefs: w.beliefs.length - beliefs.length, assets: (w.assets?.length ?? 0) - (next.assets?.length ?? 0) },
  };
}
