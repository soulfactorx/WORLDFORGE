/**
 * 장소 사이의 길 (v0.128): 길은 늘 양쪽으로 — 한쪽을 이으면 다른 쪽도, 끊으면 다른 쪽도.
 * 편집기에서 장소를 지우거나 ID를 바꾸면 다른 장소의 길도 함께 고친다.
 */
import type { EntityId, Location } from './schema';

/** a와 b 사이의 길을 잇거나 끊는다 (양쪽 모두) */
export function setLink(locs: Location[], a: EntityId, b: EntityId, on: boolean): Location[] {
  if (a === b) return locs;
  return locs.map((l) => {
    const other = l.id === a ? b : l.id === b ? a : null;
    if (!other) return l;
    const has = l.connections.includes(other);
    if (on === has) return l;
    return { ...l, connections: on ? [...l.connections, other] : l.connections.filter((c) => c !== other) };
  });
}

/** 한쪽만 이어진 길 [from, to] (to에서 from으로 돌아오는 길이 없다) */
export function oneWayLinks(locs: Location[]): [EntityId, EntityId][] {
  const ids = new Set(locs.map((l) => l.id));
  const out: [EntityId, EntityId][] = [];
  for (const l of locs) for (const c of l.connections) if (ids.has(c) && !locs.find((x) => x.id === c)!.connections.includes(l.id)) out.push([l.id, c]);
  return out;
}

/** 한쪽만 이어진 길을 모두 양쪽으로 */
export function makeTwoWay(locs: Location[]): Location[] {
  return oneWayLinks(locs).reduce((acc, [a, b]) => setLink(acc, a, b, true), locs);
}

/**
 * 목록이 바뀐 뒤 길 정리: 지운 장소로 가는 길은 없애고, ID를 바꾼 장소는 다른 장소의 길도 새 ID로.
 * (ID 바꾸기는 같은 자리의 항목 ID가 달라진 것으로 알아본다)
 */
export function tidyLinks(prev: Location[], next: Location[]): Location[] {
  const renamed = new Map<EntityId, EntityId>();
  if (prev.length === next.length) prev.forEach((p, i) => { const n = next[i]!; if (p.id !== n.id) renamed.set(p.id, n.id); });
  const ids = new Set(next.map((l) => l.id));
  return next.map((l) => {
    const conns = [...new Set(l.connections.map((c) => renamed.get(c) ?? c))].filter((c) => ids.has(c) && c !== l.id);
    return conns.length === l.connections.length && conns.every((c, i) => c === l.connections[i]) ? l : { ...l, connections: conns };
  });
}
