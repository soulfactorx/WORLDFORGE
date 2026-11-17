/**
 * 흐름도에서 잇기·끊기 (v0.143): 상자 A를 B로 끌면 "A가 ~하면 B가 열린다"를 세계 설정에 적는다.
 *  - 조건으로: B의 조건 칸(임무 시작·단계 끝·결말 조건·카드 덱 조건 …)에 "A가 ~했다"를 「그리고」로 더한다
 *  - 효과로: A의 효과 칸(장면의 끝·선택지·사건 …)에 "B를 세움·시작·펼침"을 더한다 (B가 플래그·장면·전투·카드·임무·지식일 때)
 * 끊기는 그 반대: 조건에서 A를 가리키는 부분을 빼거나, 효과에서 B를 일으키는 것을 뺀다.
 */
import type { Condition, Quest, QuestStage, StoryEffect, WorldPackage } from '../engine/schema';
import { setLink } from '../engine/locationLinks';
import { type GEdge, type GNode, START_KEY } from './storyGraph';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface LinkWay { label: string; cond: Condition }
export interface Slot { key: string; label: string }
export interface LinkOption { group: 'cond' | 'effect' | 'start' | 'place'; label: string; note?: string; apply: (w: WorldPackage) => Partial<WorldPackage> }

const LIST: Partial<Record<GNode['kind'], keyof WorldPackage>> = {
  quest: 'quests', ending: 'endings', card: 'storylets', scene: 'scenes', gimmick: 'scenes', encounter: 'encounters',
  choice: 'choices', arc: 'arcs', event: 'events', rule: 'rules', clock: 'clocks', location: 'locations', character: 'characters', item: 'items', monster: 'monsters',
};
const entity = (w: WorldPackage, n: GNode): Any => { const l = LIST[n.kind]; return l ? ((w[l] as Any[] | undefined) ?? []).find((x) => x.id === n.id) : undefined; };
function edit(w: WorldPackage, n: GNode, fn: (x: Any) => Any): Partial<WorldPackage> {
  const l = LIST[n.kind]!;
  return { [l]: ((w[l] as Any[] | undefined) ?? []).map((x) => (x.id === n.id ? syncGimmick(fn(structuredClone(x))) : x)) } as Partial<WorldPackage>;
}

/**
 * 함정·퍼즐 장면 (v0.149): 끝의 효과는 gimmick.onSuccess / onFail에서 다시 만들어진다 — 흐름도에서 끝에 더한 효과를 그쪽에도 적어
 * 「함정·퍼즐」 탭에서 고쳐도 사라지지 않게 한다.
 */
function syncGimmick(x: Any): Any {
  if (!x?.gimmick || !Array.isArray(x.ends)) return x;
  const fx = (id: string) => x.ends.find((e: Any) => e.id === id)?.effects as StoryEffect[] | undefined;
  const ok = fx('solved'), bad = fx('failed');
  const g = { ...x.gimmick };
  if (ok !== undefined) g.onSuccess = { ...(g.onSuccess ?? {}), effects: ok };
  if (bad !== undefined) g.onFail = { ...(g.onFail ?? {}), effects: bad };
  return { ...x, gimmick: g };
}

/** A가 "일어났다"를 말하는 조건들 (B의 조건에 넣는다) */
export function sourceWays(w: WorldPackage, n: GNode): LinkWay[] {
  const x = entity(w, n);
  switch (n.kind) {
    case 'quest': return [
      { label: '완료하면', cond: { questDone: n.id } },
      { label: '실패하면', cond: { questFailed: n.id } },
      ...((x?.outcomes ?? []) as Any[]).map((o) => ({ label: `결과 「${o.name}」로 끝나면`, cond: { questOutcome: n.id, is: o.id } as Condition })),
      ...((x?.stages ?? []) as Any[]).map((_s, i) => ({ label: `${i + 1}단계 중이면`, cond: { questStage: n.id, is: i } as Condition })),
    ];
    case 'scene': return [
      { label: '성공으로 끝나면', cond: { sceneEnd: n.id, outcome: 'success' } },
      { label: '실패로 끝나면', cond: { sceneEnd: n.id, outcome: 'failure' } },
      { label: '어떻게든 끝나면', cond: { sceneEnd: n.id } },
      ...((x?.ends ?? []) as Any[]).map((e) => ({ label: `끝 「${e.name}」이면`, cond: { sceneEnd: n.id, is: e.id } as Condition })),
    ];
    case 'gimmick': return [
      { label: '통과하면', cond: { sceneEnd: n.id, outcome: 'success' } },
      { label: '실패하면', cond: { sceneEnd: n.id, outcome: 'failure' } },
      { label: '어떻게든 끝나면', cond: { sceneEnd: n.id } },
    ];
    case 'encounter': return [
      { label: '이기면', cond: { cleared: n.id } },
      { label: '지면', cond: { encounter: n.id, is: 'defeat' } },
      { label: '도망치면', cond: { encounter: n.id, is: 'fled' } },
      { label: '치르면 (결과 무관)', cond: { encounter: n.id } },
    ];
    case 'card': return [
      { label: '아무 갈림길이나 고르면', cond: { storylet: n.id } },
      ...((x?.options ?? []) as Any[]).map((o) => ({ label: `「${o.label}」을 고르면`, cond: { storylet: n.id, is: o.id } as Condition })),
    ];
    case 'choice': return [
      { label: '무엇이든 고르면', cond: { choice: n.id } },
      ...((x?.options ?? []) as Any[]).map((o) => ({ label: `「${o.text}」을 고르면`, cond: { choice: n.id, is: o.id } as Condition })),
    ];
    case 'arc': return [
      { label: '끝나면', cond: { arcDone: n.id } },
      { label: '실패로 끝나면', cond: { arcDone: n.id, failed: true } },
      ...((x?.chapters ?? []) as Any[]).map((_c, i) => ({ label: `${i + 1}장을 끝내면`, cond: { chapter: n.id, gte: i + 1 } as Condition })),
    ];
    case 'clock': return [{ label: `가득 차면 (${x?.segments ?? '?'}칸)`, cond: { clock: n.id, gte: x?.segments ?? 1 } }];
    case 'flag': return [{ label: '서 있으면', cond: { flag: n.id } }];
    case 'claim': return [{ label: '알고 있으면', cond: { knows: n.id } }];
    case 'phase': return [{ label: '이 국면이면', cond: { phase: n.id } }];
    case 'location': return [{ label: '이곳에 있으면', cond: { at: n.id } }];
    case 'character': return [
      { label: '살아 있으면', cond: { npcAlive: n.id } },
      { label: '동료로 함께면', cond: { inParty: n.id } },
      { label: '신뢰가 50 이상이면', cond: { relationship: n.id, axis: 'trust', gte: 50 } },
      { label: '호감이 50 이상이면', cond: { relationship: n.id, axis: 'affinity', gte: 50 } },
      { label: '원한이 50 이상이면', cond: { relationship: n.id, axis: 'grudge', gte: 50 } },
    ];
    case 'item': return [{ label: '가지고 있으면', cond: { hasItem: n.id } }];
    case 'monster': return [{ label: '한 마리 쓰러뜨리면', cond: { defeated: n.id } }, { label: '세 마리 쓰러뜨리면', cond: { defeated: n.id, n: 3 } }];
    default: return [];
  }
}

/** B의 조건 칸 */
export function condSlots(w: WorldPackage, n: GNode): Slot[] {
  const x = entity(w, n);
  switch (n.kind) {
    case 'quest': return [
      { key: 'start', label: '시작 조건' },
      ...((x?.stages ?? []) as Any[]).map((s, i) => ({ key: `stage:${i}`, label: `${i + 1}단계 「${s.objective}」 끝 조건` })),
      { key: 'fail', label: '실패 조건' },
    ];
    case 'ending': return [{ key: 'condition', label: '결말 조건' }];
    case 'card': return [{ key: 'when', label: '덱에 들어오는 조건' }];
    case 'scene': case 'gimmick': return [{ key: 'start', label: '열리는 조건' }];
    case 'encounter': return [{ key: 'when', label: '일어날 수 있는 조건' }, { key: 'force', label: '반드시 일어나는 조건' }];
    case 'choice': return [{ key: 'when', label: '열리는 조건' }];
    case 'arc': return [{ key: 'start', label: '시작 조건' }, ...((x?.chapters ?? []) as Any[]).map((c, i) => ({ key: `chapter:${i}`, label: `${i + 1}장 「${c.name ?? ''}」 끝 조건` }))];
    case 'event': return [{ key: 'when.condition', label: '일어나는 조건' }, { key: 'unless', label: '막히는 조건' }];
    case 'rule': return [...(x?.trigger?.kind === 'state' ? [{ key: 'trigger', label: '발동 조건' }] : []), { key: 'requires', label: '추가 조건 (이것도 참이어야 발동)' }];
    default: return [];
  }
}
/** 이것이 열리는 조건 칸 (▶ 시작과의 연결) */
export const OPEN_SLOT: Partial<Record<GNode['kind'], string>> = { quest: 'start', card: 'when', scene: 'start', gimmick: 'start', encounter: 'when', choice: 'when', arc: 'start', event: 'when.condition' };
/** 비면 없애도 되는 칸 (필수 칸은 비면 「항상 참」이 된다) */
const optional = (n: GNode, slot: string) =>
  (n.kind === 'quest' && slot === 'fail') || (n.kind === 'card' && slot === 'when') || ((n.kind === 'scene' || n.kind === 'gimmick') && slot === 'start')
  || (n.kind === 'encounter' && (slot === 'when' || slot === 'force')) || (n.kind === 'event' && (slot === 'when.condition' || slot === 'unless')) || (n.kind === 'rule' && slot === 'requires');

function getSlot(x: Any, slot: string): Condition | undefined {
  const [a, b] = slot.split(':');
  if (a === 'stage') return x.stages?.[Number(b)]?.complete;
  if (a === 'chapter') return x.chapters?.[Number(b)]?.complete;
  if (slot === 'when.condition') return x.when?.condition;
  if (slot === 'trigger') return x.trigger?.condition;
  return x[slot];
}
function setSlot(x: Any, slot: string, c: Condition | undefined): Any {
  const [a, b] = slot.split(':');
  if (a === 'stage') { x.stages[Number(b)].complete = c ?? { all: [] }; return x; }
  if (a === 'chapter') { x.chapters[Number(b)].complete = c ?? { all: [] }; return x; }
  if (slot === 'when.condition') { x.when = { ...x.when }; if (c) x.when.condition = c; else delete x.when.condition; return x; }
  if (slot === 'trigger') { x.trigger = { ...x.trigger, condition: c ?? { all: [] } }; return x; }
  if (c) x[slot] = c; else delete x[slot];
  return x;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 조건에 「그리고」로 더한다 (이미 있으면 그대로) */
export function andCond(c: Condition | undefined, add: Condition): Condition {
  // 비었거나 「아직 정하지 않음」({ any: [] } — 늘 거짓)이면 그 자리에 넣는다
  if (!c || ('all' in c && !c.all.length) || ('any' in c && !c.any.length)) return add;
  if (same(c, add)) return c;
  if ('all' in c) return c.all.some((x) => same(x, add)) ? c : { all: [...c.all, add] };
  return { all: [c, add] };
}

/**
 * 자리 표시 플래그 (v0.150): 흐름도가 새 임무·결말과 함께 만든 「…_done」 「…_reached」 플래그가 그 칸에 혼자 있고
 * 세계의 다른 곳에서 쓰이지 않으면, 처음 잇는 조건이 그것을 대신한다 (「그리고」로 더하면 영영 막힌다).
 */
export function placeholderFlag(w: WorldPackage, c: Condition | undefined): string | null {
  if (!c || !('flag' in c) || Object.keys(c).length !== 1 || !/_(done|reached)_*$/.test(c.flag)) return null;
  if (!(w.flags ?? []).some((f) => f.id === c.flag)) return null;
  const uses = JSON.stringify(w).split(`"${c.flag}"`).length - 1; // 선언 하나 + 이 칸 하나
  return uses === 2 ? c.flag : null;
}

/** A의 효과 칸 */
export function effectSlots(w: WorldPackage, n: GNode): Slot[] {
  const x = entity(w, n);
  if (!x) return [];
  switch (n.kind) {
    case 'scene': case 'gimmick': return ((x.ends ?? []) as Any[]).map((e, i) => ({ key: `ends:${i}`, label: `끝 「${e.name}」에` }));
    case 'card': return ((x.options ?? []) as Any[]).flatMap((o, i) => [{ key: `opt:${i}:success`, label: `「${o.label}」 성공에` }, { key: `opt:${i}:fail`, label: `「${o.label}」 실패에` }]);
    case 'choice': return ((x.options ?? []) as Any[]).map((o, i) => ({ key: `opt:${i}:effects`, label: `「${o.text}」을 고르면` }));
    case 'quest': return ((x.outcomes ?? []) as Any[]).map((o, i) => ({ key: `outcome:${i}`, label: `결과 「${o.name}」에` }));
    case 'arc': return ((x.chapters ?? []) as Any[]).map((c, i) => ({ key: `chapter:${i}`, label: `${i + 1}장 「${c.name ?? ''}」 끝에` }));
    case 'clock': return ((x.at ?? []) as Any[]).map((a, i) => ({ key: `at:${i}`, label: `${a.segment}칸 찼을 때` }));
    case 'event': case 'rule': return [{ key: 'effects', label: '일어날 때' }];
    default: return [];
  }
}
function effectList(x: Any, slot: string): { get: () => StoryEffect[]; set: (l: StoryEffect[]) => void } {
  const p = slot.split(':');
  const holder = p[0] === 'ends' ? x.ends[Number(p[1])] : p[0] === 'opt' ? x.options[Number(p[1])] : p[0] === 'outcome' ? x.outcomes[Number(p[1])] : p[0] === 'chapter' ? x.chapters[Number(p[1])] : p[0] === 'at' ? x.at[Number(p[1])] : x;
  const field = p[0] === 'opt' ? p[2]! : 'effects';
  return { get: () => holder[field] ?? [], set: (l) => { holder[field] = l; } };
}
const allEffectSlots = (w: WorldPackage, n: GNode) => effectSlots(w, n).map((s) => s.key);

/** B를 일으키는 효과 */
export function effectFor(n: GNode): { effect: StoryEffect; label: string } | null {
  switch (n.kind) {
    case 'flag': return { effect: { setFlag: n.id }, label: '플래그를 세움' };
    case 'scene': case 'gimmick': return { effect: { startScene: n.id }, label: '바로 시작' };
    case 'encounter': return { effect: { startEncounter: n.id }, label: '전투 시작' };
    case 'card': return { effect: { openStorylet: n.id }, label: '카드 펼침' };
    case 'quest': return { effect: { advanceQuest: n.id }, label: '단계 진행' };
    case 'claim': return { effect: { reveal: n.id }, label: '알려 줌' };
    case 'location': return { effect: { moveTo: n.id }, label: '이곳으로 옮김' };
    case 'character': return { effect: { relationship: n.id, delta: { trust: 10 } }, label: '신뢰 +10' };
    case 'item': return { effect: { giveItem: n.id }, label: '얻음' };
    default: return null;
  }
}

/** A → B로 이을 수 있는 방법들 */
export function linkOptions(w: WorldPackage, a: GNode, b: GNode): LinkOption[] {
  if (a.key === b.key || b.key === START_KEY) return [];
  // ▶ 시작 → B (v0.145): B를 처음부터 열리게 — 열리는 조건을 비운다
  // 장소에서 (v0.147): 그곳에서 일어나게 · 인물이 그곳에 있게 · 길로 잇기
  const place: LinkOption[] = [];
  if (a.kind === 'location' && entity(w, b)) {
    if (['scene', 'gimmick', 'encounter', 'choice', 'card'].includes(b.kind)) place.push({ group: 'place', label: `「${b.name}」이(가) 「${a.name}」에서 일어나게`, note: '이 장소에 있을 때만 일어납니다 (장소 칸을 정한다).', apply: (w2) => edit(w2, b, (x) => { x.locationId = a.id; return x; }) });
    if (b.kind === 'character') place.push({ group: 'place', label: `「${b.name}」이(가) 「${a.name}」에 있게`, note: '인물이 머무는 곳을 정합니다.', apply: (w2) => edit(w2, b, (x) => { x.locationId = a.id; return x; }) });
    if (b.kind === 'item') {
      place.push({ group: 'place', label: `「${b.name}」을(를) 「${a.name}」에서 주울 수 있게`, note: '그 장소를 조사하면 주울 수 있습니다.', apply: (w2) => ({ locations: w2.locations.map((l) => (l.id === a.id && !(l.pickups ?? []).some((pk) => pk.itemId === b.id) ? { ...l, pickups: [...(l.pickups ?? []), { itemId: b.id, n: 1, hint: '' }] } : l)) }) });
      place.push({ group: 'place', label: `「${b.name}」을(를) 「${a.name}」 상점에서 팔게`, note: '상점이 없으면 새로 엽니다.', apply: (w2) => ({ locations: w2.locations.map((l) => (l.id === a.id ? { ...l, shop: { ...(l.shop ?? { name: `${l.name} 상점` }), items: [...new Set([...(l.shop?.items ?? []), b.id])] } } : l)) }) });
    }
    if (b.kind === 'location') place.push({ group: 'place', label: `「${a.name}」 ↔ 「${b.name}」 길로 잇기`, note: '두 장소를 오갈 수 있게 양쪽 모두 잇습니다.', apply: (w2) => ({ locations: setLink(w2.locations, a.id, b.id, true) }) });
  }
  // 적 → 전투: 그 전투에 나오게 · 인물 → 아이템: 그 인물이 주게 (v0.148)
  if (a.kind === 'monster' && b.kind === 'encounter' && entity(w, b)) place.push({ group: 'place', label: `「${a.name}」이(가) 「${b.name}」에 나오게`, note: '전투의 적 목록에 더합니다 (먼 칸).', apply: (w2) => edit(w2, b, (x) => { x.enemies = [...(x.enemies ?? []), { monsterId: a.id, zone: 3 }]; return x; }) });
  if (a.kind === 'character' && b.kind === 'item' && entity(w, a)) place.push({ group: 'place', label: `「${a.name}」이(가) 「${b.name}」을(를) 주게`, note: '인물이 주는 물건에 더합니다 (조건은 「인물」 탭에서).', apply: (w2) => edit(w2, a, (x) => { if (!(x.gives ?? []).some((g: { itemId: string }) => g.itemId === b.id)) x.gives = [...(x.gives ?? []), { itemId: b.id, n: 1 }]; return x; }) });
  if (a.key === START_KEY) {
    const slot = OPEN_SLOT[b.kind];
    if (!slot || !entity(w, b)) return [];
    const cur = getSlot(entity(w, b), slot);
    const empty = !cur || ('all' in cur && !cur.all.length);
    return [{ group: 'start', label: `「${b.name}」을(를) 처음부터 열리게`, note: empty ? '이미 조건이 비어 있어 처음부터 열립니다.' : '지금의 열리는 조건을 비웁니다 — 다른 상자와의 연결(이 조건으로 이어진 화살표)이 사라집니다.',
      apply: (w2) => edit(w2, b, (x) => setSlot(x, slot, optional(b, slot) ? undefined : { all: [] })) }];
  }
  const out: LinkOption[] = [];
  const slots = condSlots(w, b);
  for (const way of sourceWays(w, a)) for (const s of slots) {
    const ph = placeholderFlag(w, getSlot(entity(w, b) ?? {}, s.key));
    out.push({ group: 'cond', label: `「${a.name}」 ${way.label} → 「${b.name}」의 ${s.label}`,
      ...(ph ? { note: `지금은 자리 표시 플래그 「${ph}」뿐이라, 그것을 빼고 이 조건으로 바꿉니다.` } : {}),
      apply: (w2) => {
        const patch = edit(w2, b, (x) => setSlot(x, s.key, ph ? way.cond : andCond(getSlot(x, s.key), way.cond)));
        return ph ? { ...patch, flags: (w2.flags ?? []).filter((f) => f.id !== ph) } : patch;
      } });
  }
  out.unshift(...place);
  const fx = effectFor(b);
  if (fx) for (const s of effectSlots(w, a)) {
    out.push({ group: 'effect', label: `「${a.name}」 ${s.label} → 「${b.name}」 ${fx.label}`,
      apply: (w2) => edit(w2, a, (x) => { const l = effectList(x, s.key); if (!l.get().some((e) => same(e, fx.effect))) l.set([...l.get(), fx.effect]); return x; }) });
  }
  return out;
}

/** 조건에서 맞는 잎을 뺀다. 남는 것이 없으면 null */
export function pruneCond(c: Condition, hit: (leaf: Condition) => boolean): Condition | null {
  if ('all' in c) { const rest = c.all.map((x) => pruneCond(x, hit)).filter((x): x is Condition => !!x); return rest.length || !c.all.length ? { all: rest } : null; }
  if ('any' in c) { const rest = c.any.map((x) => pruneCond(x, hit)).filter((x): x is Condition => !!x); return rest.length ? { any: rest } : null; }
  if ('not' in c) { const p = pruneCond(c.not, hit); return p ? { not: p } : null; }
  return hit(c) ? null : c;
}

/** 조건의 잎이 노드 a를 가리키는가 */
export function leafPoints(w: WorldPackage, leaf: Condition, a: GNode): boolean {
  const r = leaf as Record<string, unknown>;
  switch (a.kind) {
    case 'quest': return [r.questDone, r.questFailed, r.questOutcome, r.questStage].includes(a.id);
    case 'scene': case 'gimmick': return r.sceneEnd === a.id;
    case 'encounter': return r.cleared === a.id || r.encounter === a.id;
    case 'card': return r.storylet === a.id;
    case 'choice': return r.choice === a.id;
    case 'arc': return r.arcDone === a.id || r.chapter === a.id;
    case 'clock': return r.clock === a.id;
    case 'flag': return r.flag === a.id;
    case 'claim': return r.knows === a.id;
    case 'phase': return r.phase === a.id;
    case 'location': return r.at === a.id;
    case 'character': return [r.npcAlive, r.inParty, r.relationship, r.stage, r.npcAt].includes(a.id);
    case 'item': return r.hasItem === a.id;
    case 'monster': return r.defeated === a.id;
    default: return false;
  }
}

/**
 * 화살표 하나를 끊는다. 돌려주는 것: 바꿀 것 · 알림 (끊을 수 없으면 patch 없음)
 * 조건 화살표: B의 모든 조건 칸에서 A를 가리키는 잎을 뺀다. 효과 화살표: A의 모든 효과 칸에서 B를 일으키는 효과를 뺀다.
 */
export function unlink(w: WorldPackage, e: GEdge, a: GNode, b: GNode): { patch?: Partial<WorldPackage>; note: string } {
  if (e.from === START_KEY) return { note: '「플레이 시작」 화살표는 조건이 없어서 생긴 것입니다 — 이 상자에 조건을 넣으면 사라집니다.' };
  if (e.kind === 'stage') return { note: '임무 단계의 고비(장면·전투)는 그 단계의 끝 조건에서 고치세요.' };
  if (e.kind === 'place') {
    // 장소 칸: 조우·인물은 장소가 꼭 있어야 한다
    if (a.kind === 'monster' && b.kind === 'encounter') {
      const left = (entity(w, b)?.enemies ?? []).filter((en: { monsterId: string }) => en.monsterId !== a.id);
      if (!left.length) return { note: `「${b.name}」의 적이 「${a.name}」뿐입니다 — 다른 적을 먼저 넣으세요.` };
      return { patch: edit(w, b, (x) => { x.enemies = left; return x; }), note: `「${b.name}」에서 「${a.name}」을(를) 뺐습니다.` };
    }
    if (a.kind === 'location' && b.kind === 'item') return { patch: { locations: w.locations.map((l) => (l.id === a.id ? { ...l, ...(l.pickups ? { pickups: l.pickups.filter((pk) => pk.itemId !== b.id) } : {}), ...(l.shop ? { shop: { ...l.shop, items: l.shop.items.filter((x) => x !== b.id) } } : {}) } : l)) }, note: `「${a.name}」에서 「${b.name}」을(를) 뺐습니다 (줍기·상점).` };
    if (a.kind === 'character' && b.kind === 'item') return { patch: edit(w, a, (x) => { x.gives = (x.gives ?? []).filter((g: { itemId: string }) => g.itemId !== b.id); return x; }), note: `「${a.name}」이(가) 주는 물건에서 「${b.name}」을(를) 뺐습니다.` };
    if (b.kind === 'encounter' || b.kind === 'character') return { note: `「${b.name}」은(는) 장소가 꼭 있어야 합니다 — 다른 장소로 끌어 옮기거나 상자를 눌러 고치세요.` };
    return { patch: edit(w, b, (x) => { delete x.locationId; return x; }), note: `「${b.name}」의 장소를 뺐습니다 (어디서나 일어난다).` };
  }
  if (e.kind === 'effect') {
    const fx = effectFor(b);
    if (!fx || !entity(w, a)) return { note: '이 효과는 전체 편집 탭에서 고치세요.' };
    return { patch: edit(w, a, (x) => { for (const k of allEffectSlots(w, a)) { const l = effectList(x, k); l.set(l.get().filter((ef) => !effectHits(ef, b))); } return x; }), note: `「${a.name}」의 효과에서 「${b.name}」을(를) 뺐습니다.` };
  }
  if (!entity(w, b)) return { note: '이 조건은 전체 편집 탭에서 고치세요.' };
  let emptied = '';
  const patch = edit(w, b, (x) => {
    for (const s of condSlots(w, b)) {
      const c = getSlot(x, s.key);
      if (!c) continue;
      const p = pruneCond(c, (leaf) => leafPoints(w, leaf, a));
      if (same(p, c)) continue;
      const empty = !p || ('all' in p && !p.all.length);
      if (empty && optional(b, s.key)) setSlot(x, s.key, undefined);
      else { setSlot(x, s.key, p ?? { all: [] }); if (empty) emptied = s.label; }
    }
    return x;
  });
  return { patch, note: `「${b.name}」의 조건에서 「${a.name}」을(를) 뺐습니다.${emptied ? ` ⚠ ${emptied}이 비었습니다 — 비어 있으면 바로 참이 됩니다. 새 조건을 넣으세요.` : ''}` };
}
function effectHits(ef: StoryEffect, b: GNode): boolean {
  const r = ef as Record<string, unknown>;
  return (b.kind === 'flag' && r.setFlag === b.id) || ((b.kind === 'scene' || b.kind === 'gimmick') && r.startScene === b.id) || (b.kind === 'encounter' && r.startEncounter === b.id)
    || (b.kind === 'card' && r.openStorylet === b.id) || (b.kind === 'quest' && r.advanceQuest === b.id) || (b.kind === 'claim' && r.reveal === b.id)
    || (b.kind === 'item' && (r.giveItem === b.id || r.takeItem === b.id)) || (b.kind === 'location' && r.moveTo === b.id) || (b.kind === 'character' && (r.relationship === b.id || r.killNpc === b.id || r.moveNpc === b.id));
}

// ---------------------------------------------------------------- 화살표 고치기 (v0.145)

/** 조건 안에 a를 가리키는 잎이 있나 */
export function condMentions(w: WorldPackage, c: Condition | undefined, a: GNode): boolean {
  if (!c) return false;
  return !same(pruneCond(c, (leaf) => leafPoints(w, leaf, a)), c);
}
/** 화살표 A → B가 나온 칸들: 조건 화살표면 B의 조건 칸, 효과 화살표면 A의 효과 칸 */
export function edgeSlots(w: WorldPackage, e: GEdge, a: GNode, b: GNode): { where: 'cond' | 'effect'; node: GNode; slot: Slot }[] {
  if (e.from === START_KEY) { const k = OPEN_SLOT[b.kind]; const sl = k ? condSlots(w, b).find((x) => x.key === k) : undefined; return sl ? [{ where: 'cond', node: b, slot: sl }] : []; }
  if (e.kind === 'effect') {
    const x = entity(w, a); if (!x) return [];
    return effectSlots(w, a).filter((sl) => effectList(structuredClone(x), sl.key).get().some((ef) => effectHits(ef, b))).map((slot) => ({ where: 'effect' as const, node: a, slot }));
  }
  const x = entity(w, b); if (!x) return [];
  // 단계의 고비: 그 단계의 끝 조건
  if (e.kind === 'stage') { const m = /^(\d+)단계/.exec(e.label); if (m) { const sl = condSlots(w, b).find((y) => y.key === `stage:${Number(m[1]) - 1}`); return sl ? [{ where: 'cond', node: b, slot: sl }] : []; } return []; }
  return condSlots(w, b).filter((sl) => condMentions(w, getSlot(x, sl.key), a)).map((slot) => ({ where: 'cond' as const, node: b, slot }));
}
export function getCond(w: WorldPackage, n: GNode, slot: string): Condition | undefined { const x = entity(w, n); return x ? getSlot(x, slot) : undefined; }
export function setCond(w: WorldPackage, n: GNode, slot: string, c: Condition | undefined): Partial<WorldPackage> {
  return edit(w, n, (x) => setSlot(x, slot, c ?? (optional(n, slot) ? undefined : { all: [] })));
}
export function getEffects(w: WorldPackage, n: GNode, slot: string): StoryEffect[] { const x = entity(w, n); return x ? effectList(structuredClone(x), slot).get() : []; }
export function setEffects(w: WorldPackage, n: GNode, slot: string, list: StoryEffect[]): Partial<WorldPackage> { return edit(w, n, (x) => { effectList(x, slot).set(list); return x; }); }

/** 조건에서 a를 가리키는 첫 잎 */
export function firstLeaf(w: WorldPackage, c: Condition | undefined, a: GNode): Condition | undefined {
  if (!c) return undefined;
  if ('all' in c) { for (const x of c.all) { const f = firstLeaf(w, x, a); if (f) return f; } return undefined; }
  if ('any' in c) { for (const x of c.any) { const f = firstLeaf(w, x, a); if (f) return f; } return undefined; }
  if ('not' in c) return firstLeaf(w, c.not, a);
  return leafPoints(w, c, a) ? c : undefined;
}
/** 조건에서 a를 가리키는 잎을 모두 바꾼다 (예: 「완료하면」 → 「실패하면」) */
export function replaceLeaf(w: WorldPackage, c: Condition, a: GNode, to: Condition): Condition {
  if ('all' in c) return { all: c.all.map((x) => replaceLeaf(w, x, a, to)) };
  if ('any' in c) return { any: c.any.map((x) => replaceLeaf(w, x, a, to)) };
  if ('not' in c) return { not: replaceLeaf(w, c.not, a, to) };
  return leafPoints(w, c, a) ? to : c;
}

// ---------------------------------------------------------------- 임무 단계 바꾸기 (v0.154)

/**
 * 임무의 단계를 바꾸고(순서·더하기·지우기), 세계 어디든 「이 임무가 n단계 중이면」({ questStage, is }) 조건의 번호를 따라 고친다.
 * map: 옛 단계 번호 → 새 번호 (지운 단계는 가장 가까운 남은 단계로).
 */
export function restageQuest(w: WorldPackage, questId: string, stages: QuestStage[], map: (old: number) => number): Partial<WorldPackage> {
  const fix = (v: unknown): unknown => JSON.parse(JSON.stringify(v), (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) && x.questStage === questId && typeof x.is === 'number' ? { ...x, is: Math.max(0, Math.min(stages.length - 1, map(x.is))) } : x));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) {
    if (k === 'manifest' || v === undefined) continue;
    const nv = k === 'quests' ? fix((v as Quest[]).map((q) => (q.id === questId ? { ...q, stages } : q))) : fix(v);
    if (JSON.stringify(nv) !== JSON.stringify(v)) out[k] = nv;
  }
  return out as Partial<WorldPackage>;
}

