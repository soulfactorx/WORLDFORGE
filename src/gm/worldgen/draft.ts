/**
 * AI 세계관 생성 초안 → 패키지 변환 (설계서 5.3절).
 *
 * LLM에게는 평평하고 단순한 초안 스키마(재귀 조건식 없음, 접두사 없는 키)를 받는다.
 * 이 모듈은 순수 함수로 초안을 정리한다: 키 정규화, 중복 제거, 끊어진 참조 제거, 양방향 연결,
 * 조건식 변환. 고친 내용은 notes로 제작자에게 알린다. 결과는 반드시 검사기를 다시 거친다.
 */
import { ABILITIES, CLASSES, SKILL_IDS } from '../../engine/character/rules';
import { suggestedStandardArray } from '../../engine/character/sheet';
import { MONSTERS, monsterTable } from '../../engine/combat/monsters';
import { STD_ITEM_MAP, STD_ITEMS } from '../../data/items';
import { QUEST_TYPES, type QuestType } from '../../engine/schema';
import type { Clock, Condition, DecisiveChoice, Encounter, Ending, KnowledgeState, NpcRelationKind, Quest, RelationBeat, StoryEffect, StoryFlag, WorldPackage } from '../../engine/schema';

// ---------------------------------------------------------------- 초안 타입 (LLM 출력)

export interface DraftAtom {
  type: 'always' | 'knows' | 'at' | 'cleared' | 'in_party' | 'relationship' | 'stage' | 'reputation' | 'flag' | 'quest_done' | 'level';
  ref: string;
  min: '' | 'rumor' | 'partial' | 'confirmed';
  axis: '' | 'affinity' | 'trust' | 'respect' | 'fear' | 'intimacy' | 'grudge';
  /** stage: 관계 단계 하나 (그 단계 이상 가까운 사이) */
  stage?: string;
  value: number;
}
export interface DraftCond { op: 'all' | 'any'; items: DraftAtom[] }

export interface WorldDraft {
  name: string;
  premise: string;
  /** 세계 개요 (v0.54): 플레이어도 알아도 되는 배경 */
  overview?: string;
  opening_scene: string;
  start_location: string;
  locations: { key: string; name: string; description: string; connections: string[]; improvisation: 'none' | 'minor' | 'free' }[];
  characters: {
    key: string; name: string; appearance: string; personality: string; speech: string; location: string;
    improvisation: 'none' | 'minor' | 'free'; companion_class: string; join_condition: string;
    initial_affinity: number; initial_trust: number; secret_trust: number;
    romanceable?: boolean; faction?: string;
    schedule?: { from: number; to: number; location: string }[];
  }[];
  factions?: { key: string; name: string; description: string; reputation: number; activity?: string; every_days?: number }[];
  /** 상점 (설계 v3 6.4): 장소 key + 표준 아이템 ID */
  shops?: { location: string; name: string; items: string[]; faction: string }[];
  relations?: { a: string; b: string; kind: NpcRelationKind; note: string }[];
  truths: { key: string; statement: string; secrecy: number; subjects: string[]; protected_topic: string }[];
  claims: { key: string; statement: string; truth: 'true' | 'false' | 'partial'; relates_to: string }[];
  knowledge: { holder: string; claim: string; state: KnowledgeState }[];
  discoveries: { location: string; claim: string; check: string; hint: string }[];
}

export interface ScenarioDraft {
  encounters: { key: string; name: string; location: string; enemies: { monster: string; zone: number }[]; trigger: string }[];
  flags: { key: string; when: string; location: string; requires: DraftCond }[];
  quests: { key: string; name: string; kind: 'main' | 'side'; start: DraftCond; stages: { objective: string; hint: string; complete: DraftCond }[]; reward_xp: number; reward_money?: number;
    type?: QuestType | ''; giver?: string; target?: string; time_limit_days?: number }[];
  /** 의뢰판 (설계 v3 6.3) */
  board?: { location: string; name: string; jobs: { key: string; name: string; type: QuestType; description: string; location: string; enemies: { monster: string; zone: number }[]; reward_money: number; repeatable: boolean }[] };
  endings: { key: string; name: string; condition: DraftCond; epilogue: string }[];
  relation_beats?: { key: string; npc: string; name: string; condition: DraftCond; hint: string; resolve_flag: string }[];
  /** 이야기 엔진 (설계 v3 5장): 이번에 덧붙이는 줄기 하나와 시계·결정적 선택 */
  arc?: { name: string; kind: 'main' | 'faction' | 'character'; chapters: { name: string; goal: string; summary: string; complete: DraftCond; fail: DraftCond }[] };
  clocks?: { key: string; name: string; segments: number; per_day: number; omens: { segment: number; text: string; set_flag: string }[] }[];
  choices?: { key: string; name: string; prompt: string; when: DraftCond; location: string; options: { text: string; effects: DraftEffect[] }[] }[];
}

export interface DraftEffect {
  type: 'set_flag' | 'reveal' | 'relationship' | 'reputation' | 'clock';
  ref: string;
  axis: '' | 'affinity' | 'trust' | 'respect' | 'fear' | 'intimacy' | 'grudge';
  value: number;
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
    type: { type: 'string', enum: ['always', 'knows', 'at', 'cleared', 'in_party', 'relationship', 'stage', 'reputation', 'flag', 'quest_done', 'level'] },
    ref: { type: 'string', description: 'knows=명제 key, at=장소 key, cleared=조우 key, in_party/relationship/stage=인물 key, reputation=세력 key, flag=플래그 key, quest_done=임무 key. always/level은 ""' },
    min: { type: 'string', enum: ['', 'rumor', 'partial', 'confirmed'] },
    axis: { type: 'string', enum: ['', 'affinity', 'trust', 'respect', 'fear', 'intimacy', 'grudge'] },
    stage: { type: 'string', enum: ['', '아는 사이', '믿는 사이', '친구', '절친', '연인', '경계', '적대', '숙적'], description: 'stage: 이 단계 이상 (가까운 쪽은 더 가까운 단계 포함, 적대 쪽은 더 나쁜 단계 포함). 그 외 ""' },
    value: { type: 'integer', description: 'relationship/reputation: 최소값(-100~100), level: 최소 레벨, 그 외 0' },
  })),
});

export const WORLD_DRAFT_SCHEMA = obj({
  name: str, premise: { type: 'string', description: '제작자용 한 문단 요약 (숨은 진실 포함 — GM 메모가 된다)' },
  overview: { type: 'string', description: '플레이어도 알아도 되는 세계 개요 3~6문장: 시대·지역·분위기·사회의 큰 규칙·지금 벌어지는 일. 비밀·진실은 쓰지 않는다' }, opening_scene: { type: 'string', description: '플레이어가 깨어나는 첫 장면 (2인칭, 세계 설명 금지)' },
  start_location: str,
  locations: arr(obj({ key: { type: 'string', description: '영문 소문자 슬러그' }, name: str, description: { type: 'string', description: '감각으로 알 수 있는 것만' }, connections: arr(str), improvisation: IMPROV })),
  characters: arr(obj({
    key: str, name: str, appearance: str, personality: str, speech: str, location: str, improvisation: IMPROV,
    companion_class: { type: 'string', enum: ['', ...Object.keys(CLASSES)], description: '동료로 영입 가능하면 직업, 아니면 ""' },
    join_condition: { type: 'string', description: '동료라면 이 인물이 동행을 수락하는 기준, 아니면 ""' },
    initial_affinity: int, initial_trust: int, secret_trust: { type: 'integer', description: '비밀을 털어놓는 신뢰 기준 (20~70)' },
    romanceable: { type: 'boolean', description: '플레이어와 연인이 될 수 있는 인물인가 (성인으로 설정된 인물만)' },
    faction: { type: 'string', description: '소속 세력 key 또는 ""' },
    schedule: { type: 'array', description: '시각에 따라 다른 곳에 있으면 (예: 밤에는 여관). 늘 같은 곳이면 []', items: obj({ from: { type: 'integer', description: '0~23시' }, to: { type: 'integer', description: '0~24시 (from보다 작으면 자정을 넘김)' }, location: { type: 'string', description: '장소 key' } }) },
  })),
  factions: arr(obj({
    key: str, name: str, description: str, reputation: { type: 'integer', description: '플레이어에 대한 처음 평판 (-30~30, 보통 0)' },
    activity: { type: 'string', description: '이 세력이 며칠마다 벌이는 일이 플레이어에게 소문으로 들리는 한 줄 (예: "📜 상인 조합이 통행세를 또 올렸다는 소문"). 없으면 ""' },
    every_days: { type: 'integer', description: 'activity가 며칠마다인지 (2~7, 없으면 0)' },
  })),
  shops: arr(obj({
    location: { type: 'string', description: '상점이 있는 장소 key' }, name: { type: 'string', description: '상점 이름 (예: 잡화점, 대장간)' },
    items: { type: 'array', items: { type: 'string', enum: STD_ITEMS.map((i) => i.id) }, description: '파는 표준 아이템 3~8개' },
    faction: { type: 'string', description: '상점이 속한 세력 key 또는 ""' },
  })),
  relations: arr(obj({ a: { type: 'string', description: '인물 key' }, b: { type: 'string', description: '인물 key' }, kind: { type: 'string', enum: ['family', 'ally', 'rival', 'lover', 'master', 'enemy'] }, note: str })),
  truths: arr(obj({ key: str, statement: str, secrecy: { type: 'integer', description: '0 상식 ~ 5 극비' }, subjects: arr(str), protected_topic: { type: 'string', description: '비밀이면 내용을 드러내지 않는 짧은 이름표, 아니면 ""' } })),
  claims: arr(obj({ key: str, statement: str, truth: { type: 'string', enum: ['true', 'false', 'partial'] }, relates_to: { type: 'string', description: '관련 truth key 또는 ""' } })),
  knowledge: arr(obj({ holder: { type: 'string', description: '인물 key' }, claim: str, state: { type: 'string', enum: ['rumor', 'partial', 'confirmed', 'mistaken', 'secret'] } })),
  discoveries: arr(obj({ location: str, claim: str, check: { type: 'string', enum: ['', ...SKILL_IDS] }, hint: str })),
});

/** 이야기 초안 스키마. 적 목록은 기본 적 + 세계만의 적 */
export const scenarioDraftSchema = (monsterIds: string[] = Object.keys(MONSTERS)) => obj({
  encounters: arr(obj({ key: str, name: str, location: str, enemies: arr(obj({ monster: { type: 'string', enum: monsterIds }, zone: { type: 'integer', enum: [2, 3] } })), trigger: str })),
  flags: arr(obj({ key: { type: 'string', description: '영문 소문자와 _' }, when: str, location: { type: 'string', description: '장소 key 또는 ""' }, requires: COND_SCHEMA })),
  quests: arr(obj({
    key: str, name: str, kind: { type: 'string', enum: ['main', 'side'] }, start: COND_SCHEMA,
    stages: arr(obj({ objective: str, hint: str, complete: COND_SCHEMA })), reward_xp: int,
    reward_money: { type: 'integer', description: '보상 돈 (사이드 20~100, 메인 100~300)' },
    type: { type: 'string', enum: ['', ...QUEST_TYPES], description: '임무 유형' },
    giver: { type: 'string', description: '의뢰인 인물 key 또는 ""' },
    target: { type: 'string', description: '호위·구출 대상 인물 key (죽으면 실패) 또는 ""' },
    time_limit_days: { type: 'integer', description: '기한 일수 (급한 일만, 없으면 0)' },
  })),
  board: obj({
    location: { type: 'string', description: '의뢰판이 있는 장소 key (마을·길드 등). 없으면 ""' }, name: { type: 'string', description: '의뢰판 이름 (예: 마을 게시판)' },
    jobs: arr(obj({
      key: str, name: str, type: { type: 'string', enum: [...QUEST_TYPES] }, description: { type: 'string', description: '의뢰 내용 한두 문장' },
      location: { type: 'string', description: '일이 벌어지는 장소 key' },
      enemies: arr(obj({ monster: { type: 'string', enum: monsterIds }, zone: { type: 'integer', enum: [2, 3] } })),
      reward_money: { type: 'integer', description: '보상 돈 (0이면 엔진이 위협도로 정함)' }, repeatable: { type: 'boolean' },
    })),
  }),
  endings: arr(obj({ key: str, name: str, condition: COND_SCHEMA, epilogue: str })),
  arc: obj({
    name: { type: 'string', description: '이번 이야기 줄기의 이름' }, kind: { type: 'string', enum: ['main', 'faction', 'character'] },
    chapters: arr(obj({
      name: str, goal: { type: 'string', description: 'GM용: 이 장에서 일어나야 할 일' }, summary: { type: 'string', description: '플레이어 수첩에 보이는 한 줄 (비밀 누설 금지)' },
      complete: COND_SCHEMA, fail: { ...COND_SCHEMA, description: '이 조건이면 줄기가 실패로 끝난다. 없으면 items []' },
    })),
  }),
  clocks: arr(obj({
    key: str, name: { type: 'string', description: '진행 시계 이름 (예: 도적의 습격 준비) — 플레이어가 막지 않으면 다가오는 위협' },
    segments: { type: 'integer', description: '칸 수 4~8' }, per_day: { type: 'integer', description: '하루에 차는 칸 (보통 1, 느리면 0)' },
    omens: arr(obj({ segment: int, text: { type: 'string', description: '그 칸에 이르면 플레이어에게 보이는 징조 한 줄 (소문·분위기)' }, set_flag: { type: 'string', description: '그 칸에서 세울 flags key 또는 ""' } })),
  })),
  choices: arr(obj({
    key: str, name: str, prompt: { type: 'string', description: '플레이어에게 보이는 결정의 질문' }, when: COND_SCHEMA, location: { type: 'string', description: '장소 key 또는 ""' },
    options: arr(obj({
      text: str,
      effects: arr(obj({
        type: { type: 'string', enum: ['set_flag', 'reveal', 'relationship', 'reputation', 'clock'] },
        ref: { type: 'string', description: 'set_flag=flags key, reveal=명제 key, relationship=인물 key, reputation=세력 key, clock=시계 key' },
        axis: { type: 'string', enum: ['', 'affinity', 'trust', 'respect', 'fear', 'intimacy', 'grudge'] },
        value: { type: 'integer', description: 'relationship·reputation·clock의 변화량 (-10~10), 그 외 0' },
      })),
    })),
  })),
  relation_beats: arr(obj({
    key: str, npc: { type: 'string', description: '인물 key' }, name: str, condition: COND_SCHEMA,
    hint: { type: 'string', description: 'GM·인물에게 주는 장면 방향 (예: 그가 과거를 털어놓는다)' },
    resolve_flag: { type: 'string', description: '장면이 끝났음을 나타내는 flags의 key 또는 ""' },
  })),
});
export const SCENARIO_DRAFT_SCHEMA = scenarioDraftSchema();

// ---------------------------------------------------------------- 정리

const slug = (s: string) => String(s ?? '').toLowerCase().trim().replace(/^(loc|npc|fact|claim|enc|quest|ending)\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
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
  faction?: (k: string) => string | undefined;
}

const CLOSE = ['아는 사이', '믿는 사이', '친구', '절친', '연인'];
const HOSTILE = ['경계', '적대', '숙적'];
/** "친구" → 친구 이상 가까운 단계들, "적대" → 적대·숙적 */
function stagesFrom(stage: string | undefined): string[] | null {
  if (!stage) return null;
  const c = CLOSE.indexOf(stage);
  if (c >= 0) return CLOSE.slice(c);
  const h = HOSTILE.indexOf(stage);
  return h >= 0 ? HOSTILE.slice(h) : null;
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
      case 'stage': { const id = refs.npc(a.ref); const st = stagesFrom(a.stage); if (id && st) items.push({ stage: id, in: st }); else miss('인물·관계 단계'); break; }
      case 'reputation': { const id = refs.faction?.(a.ref); if (id) items.push({ reputation: id, gte: clamp(a.value, -100, 100) }); else miss('세력'); break; }
      case 'flag': { const id = refs.flag(a.ref); if (id) items.push({ flag: id }); else miss('플래그'); break; }
      case 'quest_done': { const id = refs.quest(a.ref); if (id) items.push({ questDone: id }); else miss('임무'); break; }
      case 'level': items.push({ level: clamp(a.value, 1, 5) }); break;
    }
  }
  if (items.length === 1) return items[0]!;
  return c?.op === 'any' && items.length ? { any: items } : { all: items };
}

/** 세계 초안 → 패키지 (시나리오 없음) */
/** AI 응답에서 빠진 목록은 빈 목록으로 (v0.46.3 — "t.quests is undefined" 같은 오류 방지) */
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as T[]) : []);
type Sch = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, Sch>; items?: Sch; anyOf?: Sch[] };
/** 스키마를 따라 빠진 필드를 안전한 기본값으로 채운다 (문자열 '', 수 0, 목록 [], 열거형은 '' 또는 첫 값) */
function fill(s: Sch, v: unknown): unknown {
  if (s.anyOf) return v === undefined || v === null ? fill(s.anyOf[0]!, undefined) : v;
  if (s.enum) return v !== undefined && v !== null ? v : s.enum.includes('') ? '' : s.enum[0];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === 'object') {
    const o = (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}) as Record<string, unknown>;
    for (const [k, ps] of Object.entries(s.properties ?? {})) o[k] = fill(ps, o[k]);
    return o;
  }
  if (t === 'array') return Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map((x) => fill(s.items ?? {}, x)) : [];
  if (t === 'integer' || t === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  if (t === 'boolean') return typeof v === 'boolean' ? v : false;
  if (t === 'string') return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  return v;
}
const hasCond = (c: unknown) => !!c && typeof c === 'object' && Array.isArray((c as { items?: unknown }).items);

function fixWorldDraft(raw: WorldDraft): WorldDraft {
  const d = fill(WORLD_DRAFT_SCHEMA as Sch, raw) as WorldDraft;
  d.locations = list<WorldDraft['locations'][number]>(d.locations).map((l) => ({ ...l, connections: list<string>(l.connections as unknown).filter((x) => typeof x === 'string') }));
  d.characters = list(d.characters);
  d.truths = list<WorldDraft['truths'][number]>(d.truths).map((t) => ({ ...t, subjects: Array.isArray(t.subjects) ? t.subjects : [] }));
  d.claims = list(d.claims);
  d.knowledge = list(d.knowledge);
  d.discoveries = list(d.discoveries);
  return d;
}
function fixScenarioDraft(raw0: ScenarioDraft): ScenarioDraft {
  // 조건이 아예 없는 결말·장은 곧바로 참이 되므로 버린다 (채우기 전에 본다)
  const raw = { ...(raw0 ?? {}) } as ScenarioDraft;
  if (Array.isArray(raw.endings)) raw.endings = raw.endings.filter((e) => e && hasCond(e.condition));
  if (raw.arc && Array.isArray(raw.arc.chapters)) raw.arc = { ...raw.arc, chapters: raw.arc.chapters.filter((c) => c && hasCond(c.complete)) };
  const d = fill(SCENARIO_DRAFT_SCHEMA as Sch, raw) as ScenarioDraft;
  if (raw.arc === undefined) delete d.arc;
  if (raw.board === undefined) delete d.board;
  d.encounters = list<ScenarioDraft['encounters'][number]>(d.encounters).map((e) => ({ ...e, enemies: list(e.enemies) }));
  d.flags = list(d.flags);
  d.quests = list<ScenarioDraft['quests'][number]>(d.quests).map((q) => ({ ...q, stages: list<ScenarioDraft['quests'][number]['stages'][number]>(q.stages) })).filter((q) => q.stages.length);
  d.endings = list(d.endings);
  if (d.relation_beats !== undefined) d.relation_beats = list(d.relation_beats);
  if (d.clocks !== undefined) d.clocks = list<NonNullable<ScenarioDraft['clocks']>[number]>(d.clocks).map((c) => ({ ...c, omens: list(c.omens) }));
  if (d.choices !== undefined) d.choices = list<NonNullable<ScenarioDraft['choices']>[number]>(d.choices).map((c) => ({ ...c, options: list<{ text: string; effects: DraftEffect[] }>(c.options).map((o) => ({ ...o, effects: list<DraftEffect>(o.effects) })) })).filter((c) => c.options.length);
  if (d.arc) d.arc = { ...d.arc, chapters: list(d.arc.chapters) };
  if (d.arc && !d.arc.chapters.length) delete d.arc;
  if (d.board) d.board = { ...d.board, jobs: list<NonNullable<ScenarioDraft['board']>['jobs'][number]>(d.board.jobs).map((j) => ({ ...j, enemies: list(j.enemies) })) };
  return d;
}

export function worldFromDraft(raw: WorldDraft, opts: { id: string; contentRating: WorldPackage['manifest']['contentRating']; author?: string }): { world: WorldPackage; notes: string[] } {
  const d = fixWorldDraft(raw);
  const notes: string[] = [];
  const taken = new Set<string>();
  const locs = d.locations.length ? d.locations : [{ key: 'start', name: '시작 장소', description: '낯선 곳', connections: [], improvisation: 'minor' as const }];
  if (!d.locations.length) notes.push('장소가 없어 시작 장소 하나를 만들었습니다.');
  const locMap = idMap(locs.map((l) => l.key), 'loc', taken);
  const npcMap = idMap(d.characters.map((c) => c.key), 'npc', taken);
  const factMap = idMap(d.truths.map((t) => t.key), 'fact', taken);
  const claimMap = idMap(d.claims.map((c) => c.key), 'claim', taken);
  const facMap = idMap((d.factions ?? []).map((f) => f.key), 'fac', taken);
  const loc = resolver(locMap), npc = resolver(npcMap), fact = resolver(factMap), claim = resolver(claimMap), fac = resolver(facMap);
  const factions: NonNullable<WorldPackage['factions']> = [];
  for (const f of d.factions ?? []) {
    const id = fac(f.key)!;
    if (!factions.some((x) => x.id === id)) factions.push({
      id, name: f.name, description: f.description, ...(f.reputation ? { reputation: clamp(f.reputation, -100, 100) } : {}),
      ...(f.activity && (f.every_days ?? 0) > 0 ? { actions: [{ name: f.activity.slice(0, 40), every: clamp(f.every_days!, 1, 30), effects: [], news: f.activity }] } : {}),
    });
  }

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
      ...(c.romanceable ? { romanceable: true } : {}),
      ...(() => {
        const schedule = (c.schedule ?? []).flatMap((x) => { const l = loc(x.location); const from = clamp(x.from, 0, 23), to = clamp(x.to, 0, 24); return l && from !== to ? [{ from, to, locationId: l }] : []; });
        return schedule.length ? { schedule } : {};
      })(),
      ...(c.faction && fac(c.faction) ? { faction: fac(c.faction)! } : {}),
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

  for (const sh of d.shops ?? []) {
    const l = locations.find((x) => x.id === loc(sh.location));
    const items = [...new Set(sh.items)].filter((i) => STD_ITEM_MAP[i]);
    if (!l || !items.length) { notes.push(`상점 "${sh.name}": 없는 장소이거나 파는 물건이 없어 뺐습니다.`); continue; }
    l.shop = { name: sh.name || '상점', items, ...(sh.faction && fac(sh.faction) ? { factionId: fac(sh.faction)! } : {}) };
  }
  const relations: NonNullable<WorldPackage['relations']> = [];
  for (const r of d.relations ?? []) {
    const a = npc(r.a), b = npc(r.b);
    if (!a || !b || a === b) { notes.push(`인물 관계: 없는 인물 ("${r.a}" ↔ "${r.b}")을 뺐습니다.`); continue; }
    if (!relations.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) relations.push({ a, b, kind: r.kind, ...(r.note ? { note: r.note } : {}) });
  }

  const world: WorldPackage = {
    manifest: { id: opts.id, type: 'world', name: d.name || 'AI가 만든 세계', version: '0.1.0', schemaVersion: '0', author: opts.author ?? '', license: 'CC-BY-4.0', contentRating: opts.contentRating, locales: ['ko'], aiAssisted: true },
    locations, characters, facts, claims, beliefs, encounters: [], quests: [], flags: [], endings: [],
    ...(factions.length ? { factions } : {}), ...(relations.length ? { relations } : {}),
    start: { locationId: startId, openingScene: d.opening_scene || '낯선 곳에서 눈을 뜬다.' },
    ...(d.overview?.trim() ? { overview: d.overview.trim().slice(0, 2500) } : {}),
    ...(d.premise?.trim() ? { gmNotes: d.premise.trim().slice(0, 2500) } : {}),
  };
  return { world, notes };
}

/** 시나리오 초안을 기존 세계에 덧붙인다 (기존 ID와 겹치지 않게) */
export function addScenario(world: WorldPackage, raw: ScenarioDraft): { world: WorldPackage; notes: string[] } {
  const d = fixScenarioDraft(raw);
  const notes: string[] = [];
  if (!d.quests.length && !d.endings.length && !d.encounters.length) notes.push('AI 응답에 임무·조우·결말이 비어 있었습니다. 편집기에서 "AI로 임무·조우·결말 추가"로 다시 만들 수 있습니다.');
  const MT = monsterTable(world);
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
    faction: byExisting('fac', w.factions ?? []),
  };

  const encounters: Encounter[] = [];
  for (const e of d.encounters) {
    const locationId = refs.loc(e.location);
    const enemies = e.enemies.filter((x) => MT[x.monster]).map((x) => ({ monsterId: x.monster, zone: (x.zone === 3 ? 3 : 2) as 2 | 3 }));
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
      ...(q.type ? { type: q.type } : {}),
      ...(q.giver && refs.npc(q.giver) ? { giver: refs.npc(q.giver)! } : {}),
      ...(q.target && refs.npc(q.target) ? { target: refs.npc(q.target)! } : {}),
      ...((q.time_limit_days ?? 0) > 0 ? { timeLimit: { days: clamp(q.time_limit_days!, 1, 60) } } : {}),
      ...(q.reward_xp > 0 || (q.reward_money ?? 0) > 0 ? { rewards: { ...(q.reward_xp > 0 ? { xp: q.kind === 'main' ? 'major' as const : 'minor' as const } : {}), ...((q.reward_money ?? 0) > 0 ? { money: clamp(q.reward_money!, 0, 5000) } : {}) } } : {}),
    });
  }
  const endings: Ending[] = d.endings.map((e) => ({ id: endMap.get(e.key)!, name: e.name, condition: convertCond(e.condition, refs, `결말 "${e.name}"`, notes), epilogue: e.epilogue }));
  for (const e of endings) if ('all' in e.condition && e.condition.all.length === 0) notes.push(`결말 "${e.name}": 조건이 비어 게임 시작과 동시에 도달합니다. 조건을 넣어 주세요.`);

  const beatTaken = new Set((w.relationBeats ?? []).map((b) => b.id));
  const beats: RelationBeat[] = [];
  for (const b of d.relation_beats ?? []) {
    const npcId = refs.npc(b.npc);
    if (!npcId) { notes.push(`관계 사건 "${b.name}": 없는 인물 "${b.npc}"이라 뺐습니다.`); continue; }
    let id = `beat/${slug(b.key)}`;
    for (let n = 2; beatTaken.has(id) || taken.has(id); n++) id = `beat/${slug(b.key)}-${n}`;
    beatTaken.add(id);
    const condition = convertCond(b.condition, refs, `관계 사건 "${b.name}"`, notes);
    if ('all' in condition && condition.all.length === 0) { notes.push(`관계 사건 "${b.name}": 조건이 비어 뺐습니다.`); continue; }
    const flag = b.resolve_flag ? refs.flag(b.resolve_flag) : undefined;
    beats.push({ id, npcId, name: b.name, condition, hint: b.hint, ...(flag ? { resolveFlag: flag } : {}) });
  }
  w.relationBeats = [...(w.relationBeats ?? []), ...beats];

  // ---- 이야기 엔진: 시계 → 결정적 선택 → 줄기
  const idTaken = new Set([...taken, ...(w.arcs ?? []), ...(w.clocks ?? []), ...(w.choices ?? [])].map((x) => (typeof x === 'string' ? x : x.id)));
  const freshId = (prefix: string, key: string) => { let id = `${prefix}/${slug(key)}`; for (let n = 2; idTaken.has(id); n++) id = `${prefix}/${slug(key)}-${n}`; idTaken.add(id); return id; };
  const clockMap = new Map<string, string>();
  const clocks: Clock[] = [];
  for (const c of d.clocks ?? []) {
    const id = freshId('clock', c.key);
    clockMap.set(c.key, id);
    const segments = clamp(c.segments, 2, 12);
    clocks.push({
      id, name: c.name, segments, tick: c.per_day > 0 ? [{ every: 'day', by: clamp(c.per_day, 1, 3) }] : [],
      at: c.omens.filter((o) => o.segment >= 1).map((o) => {
        const flag = o.set_flag ? refs.flag(o.set_flag) : undefined;
        return { segment: clamp(o.segment, 1, segments), ...(o.text ? { omen: o.text } : {}), ...(flag ? { effects: [{ setFlag: flag }] } : {}) };
      }),
    });
  }
  const effect = (e: DraftEffect, where: string): StoryEffect | null => {
    const v = clamp(e.value, -10, 10);
    switch (e.type) {
      case 'set_flag': { const f = refs.flag(e.ref); if (f) return { setFlag: f }; break; }
      case 'reveal': { const c = refs.claim(e.ref); if (c) return { reveal: c }; break; }
      case 'relationship': { const n = refs.npc(e.ref); if (n && e.axis && v) return { relationship: n, delta: { [e.axis]: v } }; break; }
      case 'reputation': { const f = refs.faction?.(e.ref); if (f && v) return { reputation: f, delta: v }; break; }
      case 'clock': { const c = clockMap.get(e.ref) ?? (w.clocks ?? []).find((x) => x.id === e.ref)?.id; if (c && v) return { clock: c, by: v }; break; }
    }
    notes.push(`${where}: 쓸 수 없는 효과 (${e.type} "${e.ref}")를 뺐습니다.`);
    return null;
  };
  const choices: DecisiveChoice[] = [];
  for (const c of d.choices ?? []) {
    const options = c.options.map((o, i) => ({ id: String.fromCharCode(97 + i), text: o.text, effects: o.effects.map((e) => effect(e, `결정 "${c.name}"`)).filter((x): x is StoryEffect => !!x) }));
    if (options.length < 2) { notes.push(`결정 "${c.name}": 선택지가 둘 미만이라 뺐습니다.`); continue; }
    const when = convertCond(c.when, refs, `결정 "${c.name}"`, notes);
    const loc = refs.loc(c.location);
    choices.push({ id: freshId('choice', c.key), name: c.name, prompt: c.prompt, when, ...(loc ? { locationId: loc } : {}), options });
  }
  if (d.arc?.chapters?.length) {
    const chapters = d.arc.chapters.map((ch, i) => {
      const complete = convertCond(ch.complete, refs, `줄기 "${d.arc!.name}" ${i + 1}장`, notes);
      const fail = ch.fail?.items?.length ? convertCond(ch.fail, refs, `줄기 "${d.arc!.name}" ${i + 1}장 실패`, notes) : undefined;
      return { name: ch.name, goal: ch.goal, ...(ch.summary ? { summary: ch.summary } : {}), complete, ...(fail ? { fail } : {}) };
    });
    // 새 줄기는 이전 줄기가 끝난 뒤에 열린다 (첫 줄기는 바로)
    const prev = (w.arcs ?? []).at(-1);
    w.arcs = [...(w.arcs ?? []), { id: freshId('arc', d.arc.name || 'story'), name: d.arc.name || '새 이야기', kind: d.arc.kind, start: prev ? { arcDone: prev.id } : { all: [] }, chapters }];
  }
  w.clocks = [...(w.clocks ?? []), ...clocks];
  w.choices = [...(w.choices ?? []), ...choices];
  // 의뢰판: 토벌 의뢰는 그 장르의 적만 (적이 없는 의뢰는 조건이 없어 뺀다 — 편집기에서 complete를 넣을 수 있다)
  if (d.board?.location && d.board.jobs?.length) {
    const boardLoc = w.locations.find((l) => l.id === refs.loc(d.board!.location));
    const jobs = d.board.jobs.flatMap((j) => {
      const locationId = refs.loc(j.location);
      const enemies = j.enemies.filter((x) => MT[x.monster]).map((x) => ({ monsterId: x.monster, zone: (x.zone === 3 ? 3 : 2) as 2 | 3 })).slice(0, 4);
      if (!locationId || !enemies.length) { notes.push(`의뢰 "${j.name}": 장소나 토벌할 적이 없어 뺐습니다.`); return []; }
      return [{ id: freshId('job', j.key), name: j.name, type: j.type, description: j.description, locationId, enemies, ...(j.reward_money > 0 ? { rewards: { money: clamp(j.reward_money, 1, 5000) } } : {}), ...(j.repeatable === false ? { repeatable: false } : {}) }];
    });
    if (boardLoc && jobs.length) boardLoc.board = { name: d.board.name || '의뢰판', jobs: [...(boardLoc.board?.jobs ?? []), ...jobs] };
  }
  w.encounters = [...(w.encounters ?? []), ...encounters];
  w.flags = [...(w.flags ?? []), ...flags];
  w.quests = [...(w.quests ?? []), ...quests];
  w.endings = [...(w.endings ?? []), ...endings];
  return { world: w, notes };
}
