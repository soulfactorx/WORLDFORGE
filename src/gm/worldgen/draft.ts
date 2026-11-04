/**
 * AI 세계관 생성 초안 → 패키지 변환 (설계서 5.3절).
 *
 * LLM에게는 평평하고 단순한 초안 스키마(재귀 조건식 없음, 접두사 없는 키)를 받는다.
 * 이 모듈은 순수 함수로 초안을 정리한다: 키 정규화, 중복 제거, 끊어진 참조 제거, 양방향 연결,
 * 조건식 변환. 고친 내용은 notes로 제작자에게 알린다. 결과는 반드시 검사기를 다시 거친다.
 */
import { ABILITIES, CLASSES, SKILL_IDS } from '../../engine/character/rules';
import { suggestedStandardArray } from '../../engine/character/sheet';
import { MONSTERS } from '../../engine/combat/monsters';
import type { Condition, Encounter, Ending, KnowledgeState, Quest, StoryFlag, WorldPackage } from '../../engine/schema';

// ---------------------------------------------------------------- 초안 타입 (LLM 출력)

export interface DraftAtom {
  type: 'always' | 'knows' | 'at' | 'cleared' | 'in_party' | 'relationship' | 'flag' | 'quest_done' | 'level';
  ref: string;
  min: '' | 'rumor' | 'partial' | 'confirmed';
  axis: '' | 'affinity' | 'trust' | 'respect' | 'fear';
  value: number;
}
export interface DraftCond { op: 'all' | 'any'; items: DraftAtom[] }

export interface WorldDraft {
  name: string;
  premise: string;
  opening_scene: string;
  start_location: string;
  locations: { key: string; name: string; description: string; connections: string[]; improvisation: 'none' | 'minor' | 'free' }[];
  characters: {
    key: string; name: string; appearance: string; personality: string; speech: string; location: string;
    improvisation: 'none' | 'minor' | 'free'; companion_class: string; join_condition: string;
    initial_affinity: number; initial_trust: number; secret_trust: number;
  }[];
  truths: { key: string; statement: string; secrecy: number; subjects: string[]; protected_topic: string }[];
  claims: { key: string; statement: string; truth: 'true' | 'false' | 'partial'; relates_to: string }[];
  knowledge: { holder: string; claim: string; state: KnowledgeState }[];
  discoveries: { location: string; claim: string; check: string; hint: string }[];
}

export interface ScenarioDraft {
  encounters: { key: string; name: string; location: string; enemies: { monster: string; zone: number }[]; trigger: string }[];
  flags: { key: string; when: string; location: string; requires: DraftCond }[];
  quests: { key: string; name: string; kind: 'main' | 'side'; start: DraftCond; stages: { objective: string; hint: string; complete: DraftCond }[]; reward_xp: number }[];
  endings: { key: string; name: string; condition: DraftCond; epilogue: string }[];
}

// ---------------------------------------------------------------- JSON 스키마 (구조화 출력용)

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items: unknown) => ({ type: 'array', items });
const IMPROV = { type: 'string', enum: ['none', 'minor', 'free'] };

const COND_SCHEMA = obj({
  op: { type: 'string', enum: ['all', 'any'] },
  items: arr(obj({
    type: { type: 'string', enum: ['always', 'knows', 'at', 'cleared', 'in_party', 'relationship', 'flag', 'quest_done', 'level'] },
    ref: { type: 'string', description: 'knows=명제 key, at=장소 key, cleared=조우 key, in_party/relationship=인물 key, flag=플래그 key, quest_done=임무 key. always/level은 ""' },
    min: { type: 'string', enum: ['', 'rumor', 'partial', 'confirmed'] },
    axis: { type: 'string', enum: ['', 'affinity', 'trust', 'respect', 'fear'] },
    value: { type: 'integer', description: 'relationship: 최소값(-100~100), level: 최소 레벨, 그 외 0' },
  })),
});

export const WORLD_DRAFT_SCHEMA = obj({
  name: str, premise: { type: 'string', description: '제작자용 한 문단 요약' }, opening_scene: { type: 'string', description: '플레이어가 깨어나는 첫 장면 (2인칭, 세계 설명 금지)' },
  start_location: str,
  locations: arr(obj({ key: { type: 'string', description: '영문 소문자 슬러그' }, name: str, description: { type: 'string', description: '감각으로 알 수 있는 것만' }, connections: arr(str), improvisation: IMPROV })),
  characters: arr(obj({
    key: str, name: str, appearance: str, personality: str, speech: str, location: str, improvisation: IMPROV,
    companion_class: { type: 'string', enum: ['', ...Object.keys(CLASSES)], description: '동료로 영입 가능하면 직업, 아니면 ""' },
    join_condition: { type: 'string', description: '동료라면 이 인물이 동행을 수락하는 기준, 아니면 ""' },
    initial_affinity: int, initial_trust: int, secret_trust: { type: 'integer', description: '비밀을 털어놓는 신뢰 기준 (20~70)' },
  })),
  truths: arr(obj({ key: str, statement: str, secrecy: { type: 'integer', description: '0 상식 ~ 5 극비' }, subjects: arr(str), protected_topic: { type: 'string', description: '비밀이면 내용을 드러내지 않는 짧은 이름표, 아니면 ""' } })),
  claims: arr(obj({ key: str, statement: str, truth: { type: 'string', enum: ['true', 'false', 'partial'] }, relates_to: { type: 'string', description: '관련 truth key 또는 ""' } })),
  knowledge: arr(obj({ holder: { type: 'string', description: '인물 key' }, claim: str, state: { type: 'string', enum: ['rumor', 'partial', 'confirmed', 'mistaken', 'secret'] } })),
  discoveries: arr(obj({ location: str, claim: str, check: { type: 'string', enum: ['', ...SKILL_IDS] }, hint: str })),
});

export const SCENARIO_DRAFT_SCHEMA = obj({
  encounters: arr(obj({ key: str, name: str, location: str, enemies: arr(obj({ monster: { type: 'string', enum: Object.keys(MONSTERS) }, zone: { type: 'integer', enum: [2, 3] } })), trigger: str })),
  flags: arr(obj({ key: { type: 'string', description: '영문 소문자와 _' }, when: str, location: { type: 'string', description: '장소 key 또는 ""' }, requires: COND_SCHEMA })),
  quests: arr(obj({
    key: str, name: str, kind: { type: 'string', enum: ['main', 'side'] }, start: COND_SCHEMA,
    stages: arr(obj({ objective: str, hint: str, complete: COND_SCHEMA })), reward_xp: int,
  })),
  endings: arr(obj({ key: str, name: str, condition: COND_SCHEMA, epilogue: str })),
});

// ---------------------------------------------------------------- 정리

const slug = (s: string) => s.toLowerCase().trim().replace(/^(loc|npc|fact|claim|enc|quest|ending)\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : 0)));

/** key → 접두사 붙은 고유 ID 지도 (중복은 -2, -3…) */
function idMap(keys: string[], prefix: string, taken: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const k of keys) {
    if (map.has(k)) continue;
    let id = `${prefix}/${slug(k)}`;
    for (let n = 2; taken.has(id); n++) id = `${prefix}/${slug(k)}-${n}`;
    taken.add(id);
    map.set(k, id);
  }
  return map;
}

/** 키 조회: 정확히 → 슬러그 일치 → 이미 접두사가 붙은 ID */
function resolver(map: Map<string, string>) {
  const bySlug = new Map([...map].map(([k, v]) => [slug(k), v]));
  const ids = new Set(map.values());
  return (k: string) => map.get(k) ?? bySlug.get(slug(k)) ?? (ids.has(k) ? k : undefined);
}

export interface Refs {
  loc: (k: string) => string | undefined;
  npc: (k: string) => string | undefined;
  claim: (k: string) => string | undefined;
  enc: (k: string) => string | undefined;
  quest: (k: string) => string | undefined;
  flag: (k: string) => string | undefined;
}

/** 평평한 조건 → 조건식. 참조가 깨진 항목은 버리고 notes에 남긴다. */
export function convertCond(c: DraftCond | undefined, refs: Refs, where: string, notes: string[]): Condition {
  const items: Condition[] = [];
  for (const a of c?.items ?? []) {
    const miss = (what: string) => notes.push(`${where}: 없는 ${what} "${a.ref}"를 가리키는 조건을 뺐습니다.`);
    switch (a.type) {
      case 'always': break;
      case 'knows': { const id = refs.claim(a.ref); if (id) items.push({ knows: id, ...(a.min ? { min: a.min } : {}) }); else miss('명제'); break; }
      case 'at': { const id = refs.loc(a.ref); if (id) items.push({ at: id }); else miss('장소'); break; }
      case 'cleared': { const id = refs.enc(a.ref); if (id) items.push({ cleared: id }); else miss('조우'); break; }
      case 'in_party': { const id = refs.npc(a.ref); if (id) items.push({ inParty: id }); else miss('인물'); break; }
      case 'relationship': { const id = refs.npc(a.ref); if (id && a.axis) items.push({ relationship: id, axis: a.axis, gte: clamp(a.value, -100, 100) }); else miss('인물·관계 축'); break; }
      case 'flag': { const id = refs.flag(a.ref); if (id) items.push({ flag: id }); else miss('플래그'); break; }
      case 'quest_done': { const id = refs.quest(a.ref); if (id) items.push({ questDone: id }); else miss('임무'); break; }
      case 'level': items.push({ level: clamp(a.value, 1, 3) }); break;
    }
  }
  if (items.length === 1) return items[0]!;
  return c?.op === 'any' && items.length ? { any: items } : { all: items };
}

/** 세계 초안 → 패키지 (시나리오 없음) */
export function worldFromDraft(d: WorldDraft, opts: { id: string; contentRating: WorldPackage['manifest']['contentRating']; author?: string }): { world: WorldPackage; notes: string[] } {
  const notes: string[] = [];
  const taken = new Set<string>();
  const locs = d.locations.length ? d.locations : [{ key: 'start', name: '시작 장소', description: '낯선 곳', connections: [], improvisation: 'minor' as const }];
  if (!d.locations.length) notes.push('장소가 없어 시작 장소 하나를 만들었습니다.');
  const locMap = idMap(locs.map((l) => l.key), 'loc', taken);
  const npcMap = idMap(d.characters.map((c) => c.key), 'npc', taken);
  const factMap = idMap(d.truths.map((t) => t.key), 'fact', taken);
  const claimMap = idMap(d.claims.map((c) => c.key), 'claim', taken);
  const loc = resolver(locMap), npc = resolver(npcMap), fact = resolver(factMap), claim = resolver(claimMap);

  const locations: WorldPackage['locations'] = [];
  for (const l of locs) {
    const id = loc(l.key)!;
    if (locations.some((x) => x.id === id)) continue;
    locations.push({ id, name: l.name, description: l.description, connections: [], improvisation: l.improvisation });
  }
  // 연결: 있는 장소만, 양방향
  for (const l of locs) {
    const a = locations.find((x) => x.id === loc(l.key))!;
    for (const c of l.connections) {
      const bId = loc(c);
      if (!bId) { notes.push(`장소 "${l.name}": 없는 장소 "${c}"로의 연결을 뺐습니다.`); continue; }
      if (bId === a.id) continue;
      const b = locations.find((x) => x.id === bId)!;
      if (!a.connections.includes(bId)) a.connections.push(bId);
      if (!b.connections.includes(a.id)) b.connections.push(a.id);
    }
  }
  const startId = loc(d.start_location) ?? locations[0]!.id;
  if (!loc(d.start_location)) notes.push(`시작 장소 "${d.start_location}"가 없어 "${locations[0]!.name}"로 정했습니다.`);
  // 고립된 장소는 시작 장소와 잇는다
  const reach = new Set([startId]);
  const queue = [startId];
  while (queue.length) { const cur = locations.find((x) => x.id === queue.shift()); for (const n of cur?.connections ?? []) if (!reach.has(n)) { reach.add(n); queue.push(n); } }
  for (const l of locations) {
    if (reach.has(l.id)) continue;
    const s = locations.find((x) => x.id === startId)!;
    s.connections.push(l.id); l.connections.push(startId); reach.add(l.id);
    notes.push(`"${l.name}"에 갈 길이 없어 시작 장소와 연결했습니다.`);
  }

  const characters: WorldPackage['characters'] = [];
  for (const c of d.characters) {
    const id = npc(c.key)!;
    if (characters.some((x) => x.id === id)) continue;
    const at = loc(c.location) ?? startId;
    if (!loc(c.location)) notes.push(`인물 "${c.name}": 없는 장소 "${c.location}" 대신 시작 장소에 두었습니다.`);
    const cls = CLASSES[c.companion_class];
    characters.push({
      id, name: c.name, appearance: c.appearance, personality: c.personality, speech: c.speech, locationId: at,
      improvisation: c.improvisation,
      relationship: { affinity: clamp(c.initial_affinity, -100, 100), trust: clamp(c.initial_trust, -100, 100) },
      secretTrust: clamp(c.secret_trust || 40, 0, 100),
      ...(cls ? {
        companion: {
          classId: cls.id,
          abilities: Object.fromEntries(ABILITIES.map((a) => [a, suggestedStandardArray(cls.id)[a]])) as never,
          joinCondition: c.join_condition || '함께 갈 만한 이유가 있으면 동행한다.',
        },
      } : {}),
    });
  }

  const facts: WorldPackage['facts'] = d.truths.map((t) => ({
    id: fact(t.key)!, statement: t.statement, secrecy: clamp(t.secrecy, 0, 5) as 0,
    subjects: t.subjects.map((s) => loc(s) ?? npc(s)).filter((x): x is string => !!x),
    ...(t.protected_topic ? { protectedTopic: t.protected_topic } : {}),
  })).filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i);
  const claims: WorldPackage['claims'] = d.claims.map((c) => ({
    id: claim(c.key)!, statement: c.statement, truth: c.truth, ...(fact(c.relates_to) ? { relatesTo: fact(c.relates_to)! } : {}),
  })).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);

  const beliefs: WorldPackage['beliefs'] = [];
  for (const k of d.knowledge) {
    const holder = npc(k.holder), cl = claim(k.claim);
    if (!holder || !cl) { notes.push(`지식: 없는 인물·명제 ("${k.holder}" → "${k.claim}")를 뺐습니다.`); continue; }
    if (!beliefs.some((b) => b.holder === holder && b.claim === cl)) beliefs.push({ holder, claim: cl, state: k.state });
  }
  for (const disc of d.discoveries) {
    const l = locations.find((x) => x.id === loc(disc.location));
    const cl = claim(disc.claim);
    if (!l || !cl) { notes.push(`발견: 없는 장소·명제 ("${disc.location}" → "${disc.claim}")를 뺐습니다.`); continue; }
    (l.discoveries ??= []).push({ claim: cl, hint: disc.hint, ...(SKILL_IDS.includes(disc.check as never) ? { check: disc.check } : {}) });
  }

  const world: WorldPackage = {
    manifest: { id: opts.id, type: 'world', name: d.name || 'AI가 만든 세계', version: '0.1.0', schemaVersion: '0', author: opts.author ?? '', license: 'CC-BY-4.0', contentRating: opts.contentRating, locales: ['ko'], aiAssisted: true },
    locations, characters, facts, claims, beliefs, encounters: [], quests: [], flags: [], endings: [],
    start: { locationId: startId, openingScene: d.opening_scene || '낯선 곳에서 눈을 뜬다.' },
  };
  return { world, notes };
}

/** 시나리오 초안을 기존 세계에 덧붙인다 (기존 ID와 겹치지 않게) */
export function addScenario(world: WorldPackage, d: ScenarioDraft): { world: WorldPackage; notes: string[] } {
  const notes: string[] = [];
  const w: WorldPackage = structuredClone(world);
  const taken = new Set<string>([...w.locations, ...w.characters, ...w.facts, ...w.claims, ...(w.encounters ?? []), ...(w.quests ?? []), ...(w.endings ?? [])].map((x) => x.id));
  const encMap = idMap(d.encounters.map((e) => e.key), 'enc', taken);
  const questMap = idMap(d.quests.map((q) => q.key), 'quest', taken);
  const endMap = idMap(d.endings.map((e) => e.key), 'ending', taken);
  const flagTaken = new Set((w.flags ?? []).map((f) => f.id));
  const flagMap = new Map<string, string>();
  for (const f of d.flags) {
    let id = f.key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'flag';
    for (let n = 2; flagTaken.has(id); n++) id = `${id}_${n}`;
    flagTaken.add(id); flagMap.set(f.key, id);
  }
  const byExisting = (prefix: string, list: { id: string }[]) => {
    const m = new Map(list.map((x) => [x.id.replace(`${prefix}/`, ''), x.id]));
    return (k: string) => (list.some((x) => x.id === k) ? k : m.get(slug(k)));
  };
  const refs: Refs = {
    loc: byExisting('loc', w.locations), npc: byExisting('npc', w.characters), claim: byExisting('claim', w.claims),
    enc: (k) => resolver(encMap)(k) ?? byExisting('enc', w.encounters ?? [])(k),
    quest: (k) => resolver(questMap)(k) ?? byExisting('quest', w.quests ?? [])(k),
    flag: (k) => flagMap.get(k) ?? ((w.flags ?? []).some((f) => f.id === k) ? k : undefined),
  };

  const encounters: Encounter[] = [];
  for (const e of d.encounters) {
    const locationId = refs.loc(e.location);
    const enemies = e.enemies.filter((x) => MONSTERS[x.monster]).map((x) => ({ monsterId: x.monster, zone: (x.zone === 3 ? 3 : 2) as 2 | 3 }));
    if (!locationId || !enemies.length) { notes.push(`조우 "${e.name}": 장소나 적이 올바르지 않아 뺐습니다.`); continue; }
    encounters.push({ id: encMap.get(e.key)!, name: e.name, locationId, enemies: enemies.slice(0, 4), trigger: e.trigger });
  }
  const flags: StoryFlag[] = d.flags.map((f) => ({
    id: flagMap.get(f.key)!, when: f.when,
    ...(refs.loc(f.location) ? { locationId: refs.loc(f.location)! } : {}),
    ...(f.requires?.items?.length ? { requires: convertCond(f.requires, refs, `플래그 "${f.key}"`, notes) } : {}),
  }));
  const quests: Quest[] = [];
  for (const q of d.quests) {
    const stages = q.stages.map((st, i) => {
      const complete = convertCond(st.complete, refs, `임무 "${q.name}" ${i + 1}단계`, notes);
      if ('all' in complete && complete.all.length === 0) notes.push(`임무 "${q.name}" ${i + 1}단계: 완료 조건이 비어 바로 완료됩니다. 조건을 넣어 주세요.`);
      return { objective: st.objective, hint: st.hint, complete };
    });
    if (!stages.length) { notes.push(`임무 "${q.name}": 단계가 없어 뺐습니다.`); continue; }
    quests.push({
      id: questMap.get(q.key)!, name: q.name, kind: q.kind, start: convertCond(q.start, refs, `임무 "${q.name}" 시작`, notes), stages,
      ...(q.reward_xp > 0 ? { rewards: { xp: clamp(q.reward_xp, 0, 1000) } } : {}),
    });
  }
  const endings: Ending[] = d.endings.map((e) => ({ id: endMap.get(e.key)!, name: e.name, condition: convertCond(e.condition, refs, `결말 "${e.name}"`, notes), epilogue: e.epilogue }));
  for (const e of endings) if ('all' in e.condition && e.condition.all.length === 0) notes.push(`결말 "${e.name}": 조건이 비어 게임 시작과 동시에 도달합니다. 조건을 넣어 주세요.`);

  w.encounters = [...(w.encounters ?? []), ...encounters];
  w.flags = [...(w.flags ?? []), ...flags];
  w.quests = [...(w.quests ?? []), ...quests];
  w.endings = [...(w.endings ?? []), ...endings];
  return { world: w, notes };
}
