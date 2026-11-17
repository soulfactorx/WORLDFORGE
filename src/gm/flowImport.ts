/**
 * 흐름도 ＋ 「만계서고에서」 (v0.158): 다른 세계·내 에셋의 것을 복사해 붙이고, 고른 상자 다음에 이어 붙인다.
 * 복사는 만계서고 가져오기(borrow) — 딸린 것·그림·ID 겹침·출처를 그대로 처리한다.
 */
import { borrow, type BorrowKind, type BorrowPick, type BorrowResult } from '../engine/borrow';
import type { Condition, WorldPackage } from '../engine/schema';
import { andCond, getCond, OPEN_SLOT, setCond } from './flowLink';
import type { GNode, NodeKind } from './storyGraph';

/** 가져오는 종류 → 세계의 목록 */
export const COLL_OF: Partial<Record<BorrowKind, string>> = {
  character: 'characters', location: 'locations', item: 'items', monster: 'monsters', scene: 'scenes', faction: 'factions', knowledge: 'claims', class: 'classes',
  quest: 'quests', arc: 'arcs', choice: 'choices', clock: 'clocks', event: 'events', ending: 'endings', flag: 'flags', var: 'vars', encounter: 'encounters', storylet: 'storylets', rule: 'rules',
};
const NODE_OF: Partial<Record<BorrowKind, NodeKind>> = {
  character: 'character', location: 'location', item: 'item', monster: 'monster', knowledge: 'claim', quest: 'quest', arc: 'arc', choice: 'choice', clock: 'clock',
  event: 'event', ending: 'ending', flag: 'flag', encounter: 'encounter', storylet: 'card', rule: 'rule', faction: 'faction',
};
/** 흐름도에 붙일 수 있는 종류 */
export const FLOW_IMPORT_KINDS: BorrowKind[] = ['quest', 'storylet', 'scene', 'choice', 'encounter', 'ending', 'arc', 'event', 'clock', 'rule', 'flag', 'knowledge', 'location', 'character', 'faction', 'item', 'monster'];

export interface FlowImport extends BorrowResult { newKey?: string; newName?: string }

export function importFromLibrary(target: WorldPackage, source: WorldPackage, pick: BorrowPick, after?: Condition): FlowImport {
  const r = borrow(target, source, [pick], { withKnowledge: true, withImages: true, withFaction: true });
  const coll = COLL_OF[pick.kind];
  if (!coll) return r;
  type Ent = { id: string; name?: string; title?: string; statement?: string; gimmick?: unknown };
  const before = new Set((((target as unknown as Record<string, Ent[] | undefined>)[coll]) ?? []).map((x) => x.id));
  const fresh = (((r.world as unknown as Record<string, Ent[] | undefined>)[coll]) ?? []).filter((x) => !before.has(x.id));
  const orig = (((source as unknown as Record<string, Ent[] | undefined>)[coll]) ?? []).find((x) => x.id === pick.id);
  const label = (x?: Ent) => x?.name ?? x?.title ?? x?.statement ?? x?.id;
  const ent = fresh.find((x) => label(x) === label(orig)) ?? fresh[0];
  if (!ent) return r;
  const kind: NodeKind | undefined = pick.kind === 'scene' ? (ent.gimmick ? 'gimmick' : 'scene') : NODE_OF[pick.kind];
  if (!kind) return r;
  const node: GNode = { key: `${kind}:${ent.id}`, kind, id: ent.id, name: String(label(ent)) };
  let world = r.world;
  if (after) {
    const slot = kind === 'ending' ? 'condition' : OPEN_SLOT[kind];
    if (slot) world = { ...world, ...setCond(world, node, slot, andCond(getCond(world, node, slot), after)) };
  }
  return { ...r, world, newKey: node.key, newName: node.name };
}
