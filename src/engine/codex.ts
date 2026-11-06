/**
 * 도감 · 결말 수집 (설계 v4 E8) — "또 하고 싶다".
 * 대부분 이미 기록에 있다: 쓰러뜨린 적, 가 본 곳, 만난 사람, 알게 된 것, 칭호. 결말은 세이브를 넘어 세계별로 모은다 (UI 저장소).
 */
import { monsterTable } from './combat/monsters';
import { epithetOf, knowsName } from './names';
import { allTitles } from './renown';
import type { WorldPackage } from './schema';
import type { GameState } from './state/state';

export interface CodexEntry { id: string; name: string; note?: string; n?: number }
export interface CodexSection { key: string; label: string; found: CodexEntry[]; total: number | null }

export function codexOf(world: WorldPackage, state: GameState, endingsSeen: string[] = []): CodexSection[] {
  const table = monsterTable(world);
  const foes = Object.entries(state.kills ?? {}).map(([id, n]) => ({ id, name: table[id]?.name ?? id, n, ...(table[id]?.role === 'boss' ? { note: '보스' } : {}) }))
    .sort((a, b) => b.n - a.n);
  const visited = new Set([...(state.visited ?? []), state.player.locationId]);
  const places = world.locations.filter((l) => visited.has(l.id)).map((l) => ({ id: l.id, name: l.name }));
  const metIds = new Set([...Object.keys(state.npcMemory), ...Object.keys(state.party), ...Object.keys(state.relationships)]);
  const people = world.characters.filter((c) => metIds.has(c.id))
    .map((c) => ({ id: c.id, name: knowsName(state, c.id) ? c.name : epithetOf(c), ...(state.deadNpcs.includes(c.id) ? { note: '죽음' } : {}) }));
  const claims = new Map(world.claims.map((c) => [c.id, c]));
  const facts = state.beliefs.filter((b) => b.holder === 'player' && b.state === 'confirmed' && claims.has(b.claim))
    .map((b) => ({ id: b.claim, name: claims.get(b.claim)!.statement }));
  const titleDefs = allTitles(world);
  const have = new Set(state.titles ?? []);
  const titles = titleDefs.filter((t) => have.has(t.id)).map((t) => ({ id: t.id, name: t.name, note: t.desc }));
  const seen = new Set([...endingsSeen, ...(state.ending ? [state.ending] : [])]);
  const endings = (world.endings ?? []).filter((e) => seen.has(e.id)).map((e) => ({ id: e.id, name: e.name }));
  return [
    { key: 'foes', label: '쓰러뜨린 적', found: foes, total: null },
    { key: 'places', label: '가 본 곳', found: places, total: world.locations.length },
    { key: 'people', label: '만난 사람', found: people, total: world.characters.length },
    { key: 'facts', label: '확인한 사실', found: facts, total: world.claims.length },
    { key: 'titles', label: '칭호', found: titles, total: titleDefs.length },
    { key: 'endings', label: '결말', found: endings, total: (world.endings ?? []).length },
  ];
}
