/**
 * AI 장면 생성 (v0.51) — AI로 세계 만들기·카드 세계 만들기·편집기에서 장면(협상·추격·의식·대결·데이트…)을 만든다.
 * AI는 단순한 평면 초안(JSON)을 내고, 엔진이 참조를 고치고 검사한 뒤 장면 그림을 채운다. 고칠 수 없는 장면은 버린다.
 */
import { SKILL_IDS } from '../../engine/character/rules';
import { genreGuide } from '../../engine/genre';
import { validateWorld } from '../../engine/package/validate';
import type { SceneAction, SceneCond, SceneDef, SceneDelta, SceneEnd, StoryEffect, StoryFlag, WorldPackage } from '../../engine/schema';
import type { LlmClient } from '../../llm/types';
import { autoSceneArt } from '../../data/sceneArt';
import { worldSummary } from './generate';
import { applySpine, SPINE_RULES, SPINE_SCHEMA, type SpineDraft } from './spine';

// ---------------------------------------------------------------- 초안 형식

export interface SceneDraftChange { gauge: string; by: number }
export interface SceneDraftEffect { type: 'set_flag' | 'reveal' | 'relationship' | 'reputation' | 'none'; ref: string; axis: '' | 'affinity' | 'trust' | 'respect' | 'fear' | 'intimacy' | 'grudge'; value: number }
export interface SceneDraft {
  key: string; name: string; kind: string; description: string; npc: string; location: string; start_knows: string;
  /** v0.85: GM이 이 장면을 여는 계기 */
  entry_trigger?: string;
  gauges: { key: string; name: string; start: number; min: number; max: number }[];
  states: { key: string; name: string; edge: number }[];
  likes: string[]; dislikes: string[];
  actions: {
    key: string; name: string; text: string; check: string; dc: number; tags: string[];
    requires_gauge: string; requires_gte: number; mod_gauge: string; mod_per: number;
    success: SceneDraftChange[]; success_text: string; success_add_state: string;
    great: SceneDraftChange[]; great_text: string;
    failure: SceneDraftChange[]; failure_text: string; failure_add_state: string;
  }[];
  reactions: { when_gauge: string; when_gte: number; when_state: string; chance: number; changes: SceneDraftChange[]; text: string }[];
  ends: { key: string; name: string; outcome: 'success' | 'failure' | 'neutral'; gauge: string; op: 'gte' | 'lte'; value: number; text: string; effects: SceneDraftEffect[] }[];
  max_rounds: number;
}

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;
const num = { type: 'number' } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items: unknown) => ({ type: 'array', items });
const CHECKS = ['', ...SKILL_IDS.map((k) => `skill:${k}`), ...['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => `ability:${a}`)];
const CHANGE = obj({ gauge: { type: 'string', description: '수치 key' }, by: int });

export const SCENES_DRAFT_SCHEMA = obj({
  scenes: arr(obj({
    key: { type: 'string', description: '영문 소문자와 -' }, name: str,
    kind: { type: 'string', enum: ['negotiation', 'chase', 'ritual', 'crafting', 'interrogation', 'duel', 'date', 'auction', 'infiltration', 'debate', 'other'] },
    description: { type: 'string', description: 'GM용: 어떤 장면인가, 언제 권하나' },
    npc: { type: 'string', description: '상대 인물 key 또는 ""' }, location: { type: 'string', description: '장소 key 또는 ""' },
    start_knows: { type: 'string', description: '플레이어가 이 명제를 알면 열린다 (명제 key) 또는 "" (항상)' },
    entry_trigger: { type: 'string', description: '상대 인물이 있는 장면: 플레이어의 어떤 행동·상황이 이 장면으로 들어가는가 (GM용 한 문장, 예: "촌장에게 아이들 일을 따져 묻는다"). 없으면 ""' },
    gauges: arr(obj({ key: str, name: str, start: int, min: int, max: int })),
    states: arr(obj({ key: str, name: str, edge: { type: 'integer', enum: [-1, 0, 1] } })),
    likes: arr(str), dislikes: arr(str),
    actions: arr(obj({
      key: str, name: str, text: { type: 'string', description: '버튼 아래 설명 한 줄' },
      check: { type: 'string', enum: CHECKS, description: '판정 기술·능력치, 판정 없으면 ""' }, dc: { type: 'integer', description: '10~15' },
      tags: arr(str), requires_gauge: { type: 'string', description: '이 수치가 requires_gte 이상일 때만 (없으면 "")' }, requires_gte: int,
      mod_gauge: { type: 'string', description: '이 수치가 굴림에 더해진다 (없으면 "")' }, mod_per: { type: 'number', description: '수치 1당 더할 값 (예: -1, 0.5)' },
      success: arr(CHANGE), success_text: str, success_add_state: { type: 'string', description: '성공하면 붙는 상태 key 또는 ""' },
      great: arr(CHANGE), great_text: str,
      failure: arr(CHANGE), failure_text: str, failure_add_state: str,
    })),
    reactions: arr(obj({ when_gauge: str, when_gte: int, when_state: str, chance: num, changes: arr(CHANGE), text: str })),
    ends: arr(obj({
      key: str, name: str, outcome: { type: 'string', enum: ['success', 'failure', 'neutral'] },
      gauge: str, op: { type: 'string', enum: ['gte', 'lte'] }, value: int, text: str,
      effects: arr(obj({ type: { type: 'string', enum: ['set_flag', 'reveal', 'relationship', 'reputation', 'none'] }, ref: str, axis: { type: 'string', enum: ['', 'affinity', 'trust', 'respect', 'fear', 'intimacy', 'grudge'] }, value: int })),
    })),
    max_rounds: int,
  })),
});

const SCENES_SYSTEM = `너는 TRPG 세계관 제작 도우미다. 주어진 세계에 어울리는 "장면"을 만든다.
장면은 전투가 아닌(또는 수치로 겨루는) 상호작용을 차례와 판정으로 진행하는 장치다 — 협상·추격·의식·제작·심문·비무·데이트·경매·잠입·설전 등.
- 장면마다: 수치 2~4개(이름은 장면에 맞게, 예: 인내심·합의·경계 / 거리·숨 / 기세·균형), 행동 4~6개, 반작용 1~3개, 끝 2~3개(성공·실패·중립).
- 행동: 판정(check)은 기술·능력치 하나, dc 10~15. 성공·실패마다 수치 변화(success/failure), 대성공(great)은 더 큰 변화. 수치가 굴림에 영향을 주면 mod_gauge·mod_per (예: 상대의 경계 1당 -1).
- 상대의 성향: likes·dislikes는 행동 tags와 맞춘다 (좋아하는 꼬리표의 행동은 판정 이점).
- 반작용: 플레이어가 행동할 때마다 상대·상황이 수치를 움직인다 (when_gauge/when_state 조건, chance 0~1).
- 끝: gauge가 value 이상(gte)·이하(lte)가 되면 끝난다. effects로 세계에 남는 결과(플래그·명제 공개·관계·세력 평판). 실패로 끝나는 길을 반드시 하나 둔다. max_rounds 6~12.
- 이 세계의 인물·장소·명제 key만 쓴다 (목록에 있는 것). 상대 인물은 그 인물이 있는 장소와 맞춘다.
- "이야기 뼈대"가 있으면 고비가 장면(scene)인 장을 먼저 장면으로 만든다 — key는 뼈대의 climax_key를 그대로 쓴다. 남는 개수는 사이드·인물 관계의 장면으로.
- 장면의 끝은 이야기에 남아야 한다: 성공의 effects는 다음으로 가는 열쇠(플래그·명제 공개), 실패의 effects는 이야기가 이어지게 하는 대가(관계·평판·다른 단서의 소문). 효과 없는 끝을 두지 않는다. 이 뒤에 임무가 이 장면의 결과를 조건으로 쓴다.
- 상대 인물이 있는 장면은 entry_trigger에 "플레이어가 무엇을 하면 이 장면이 되는가"를 적는다 (플레이어의 그 행동을 보고 GM이 장면을 연다).
- 장면마다 종류를 다르게 하고, 세계의 갈등·비밀·관계에 이어지게 한다. 판정 숫자는 엔진이 정한다.
- 성인용이 아닌 세계에서는 수위를 지킨다.`;

// ---------------------------------------------------------------- 변환

const slug = (s: string) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const short = (id: string) => id.replace(/^[a-z]+\//, '');

/** AI 초안 → 장면 (참조를 고치고, 고칠 수 없는 것은 버린다). 새로 필요한 플래그는 flags로 돌려준다 */
export function scenesFromDraft(world: WorldPackage, drafts: SceneDraft[]): { scenes: SceneDef[]; flags: StoryFlag[]; notes: string[] } {
  const notes: string[] = [];
  const flags: StoryFlag[] = [];
  const taken = new Set((world.scenes ?? []).map((s) => s.id));
  const flagIds = new Set((world.flags ?? []).map((f) => f.id));
  const findBy = <T extends { id: string; name?: string }>(list: T[] | undefined, key: string) =>
    key ? (list ?? []).find((x) => x.id === key || short(x.id) === key || x.name === key || short(x.id) === slug(key)) : undefined;
  const out: SceneDef[] = [];
  for (const d of drafts ?? []) {
    if (!d || !d.name) continue;
    let id = `scene/${slug(d.key || d.name)}`;
    for (let n = 2; taken.has(id); n++) id = `scene/${slug(d.key || d.name)}-${n}`;
    // 수치
    const gk = new Map<string, string>();
    const gauges = (d.gauges ?? []).filter((g) => g?.name).slice(0, 5).map((g) => {
      let gid = slug(g.key || g.name); while ([...gk.values()].includes(gid)) gid += '2';
      gk.set(g.key, gid); gk.set(g.name, gid);
      const min = Number.isFinite(g.min) ? g.min : 0;
      const max = Number.isFinite(g.max) && g.max > min ? g.max : min + 10;
      return { id: gid, name: g.name, start: Math.max(min, Math.min(max, Number.isFinite(g.start) ? g.start : min)), min, max };
    });
    if (!gauges.length) { notes.push(`장면 "${d.name}": 수치가 없어 버렸습니다.`); continue; }
    const G = (k: string) => gk.get(k) ?? (gauges.some((g) => g.id === slug(k)) ? slug(k) : undefined);
    const sk = new Map<string, string>();
    const states = (d.states ?? []).filter((s) => s?.name).slice(0, 4).map((s) => { const sid = slug(s.key || s.name); sk.set(s.key, sid); sk.set(s.name, sid); return { id: sid, name: s.name, ...(s.edge === 1 || s.edge === -1 ? { edge: s.edge as 1 | -1 } : {}) }; });
    const S = (k: string) => (k ? sk.get(k) ?? (states.some((s) => s.id === slug(k)) ? slug(k) : undefined) : undefined);
    const changes = (list: SceneDraftChange[] | undefined) => { const o: Record<string, number> = {}; for (const c of list ?? []) { const g = G(c?.gauge); if (g && Number.isFinite(c.by) && c.by) o[g] = (o[g] ?? 0) + Math.round(c.by); } return Object.keys(o).length ? o : undefined; };
    const delta = (ch: SceneDraftChange[] | undefined, text: string, add?: string): SceneDelta | undefined => {
      const g = changes(ch); const st = S(add ?? '');
      const r: SceneDelta = { ...(g ? { gauges: g } : {}), ...(st ? { addStates: [st] } : {}), ...(text ? { text } : {}) };
      return Object.keys(r).length ? r : undefined;
    };
    const ak = new Set<string>();
    const actions: SceneAction[] = (d.actions ?? []).filter((a) => a?.name).slice(0, 8).map((a) => {
      let aid = slug(a.key || a.name); while (ak.has(aid)) aid += '2'; ak.add(aid);
      const check = CHECKS.includes(a.check) && a.check ? a.check : undefined;
      const req = G(a.requires_gauge);
      const mg = G(a.mod_gauge);
      return {
        id: aid, name: a.name, ...(a.text ? { text: a.text } : {}),
        ...(check ? { check, dc: Math.max(8, Math.min(18, Math.round(a.dc || 12))) } : {}),
        ...(a.tags?.length ? { tags: a.tags.filter(Boolean).slice(0, 3) } : {}),
        ...(req ? { requires: { gauge: req, gte: a.requires_gte } } : {}),
        ...(check && mg && Number.isFinite(a.mod_per) && a.mod_per ? { mods: [{ gauge: mg, per: Math.max(-3, Math.min(3, a.mod_per)), max: 4 }] } : {}),
        ...(delta(a.success, a.success_text, a.success_add_state) ? { success: delta(a.success, a.success_text, a.success_add_state) } : {}),
        ...(check && delta(a.great, a.great_text) ? { great: delta(a.great, a.great_text) } : {}),
        ...(check && delta(a.failure, a.failure_text, a.failure_add_state) ? { failure: delta(a.failure, a.failure_text, a.failure_add_state) } : {}),
      };
    }).filter((a) => a.success || a.failure);
    if (!actions.length) { notes.push(`장면 "${d.name}": 쓸 만한 행동이 없어 버렸습니다.`); continue; }
    // 언제나 쓸 수 있는 행동이 하나는 있어야 장면이 멈추지 않는다
    if (actions.every((a) => a.requires)) delete actions[0]!.requires;
    const reactions = (d.reactions ?? []).slice(0, 4).flatMap((r) => {
      const g = changes(r?.changes); if (!g) return [];
      const wg = G(r.when_gauge); const ws = S(r.when_state);
      const when: SceneCond | undefined = wg ? { gauge: wg, gte: r.when_gte } : ws ? { state: ws } : undefined;
      const chance = Number.isFinite(r.chance) && r.chance > 0 && r.chance < 1 ? Math.round(r.chance * 100) / 100 : undefined;
      return [{ ...(when ? { when } : {}), ...(chance ? { chance } : {}), delta: { gauges: g, ...(r.text ? { text: r.text } : {}) } }];
    });
    const effects = (list: SceneDraftEffect[] | undefined): StoryEffect[] => (list ?? []).flatMap((e): StoryEffect[] => {
      if (!e || e.type === 'none') return [];
      if (e.type === 'reveal') { const c = findBy(world.claims, e.ref); return c ? [{ reveal: c.id, state: 'partial' }] : []; }
      if (e.type === 'relationship') { const n = findBy(world.characters, e.ref); return n && e.axis ? [{ relationship: n.id, delta: { [e.axis]: Math.max(-15, Math.min(15, e.value || 5)) } }] : []; }
      if (e.type === 'reputation') { const f = findBy(world.factions, e.ref); return f ? [{ reputation: f.id, delta: Math.max(-15, Math.min(15, e.value || 5)) }] : []; }
      const fid = slug(e.ref).replace(/-/g, '_');
      if (!fid || fid === 'x') return [];
      if (!flagIds.has(fid)) { flagIds.add(fid); flags.push({ id: fid, when: `(엔진) 장면 「${d.name}」의 결과` }); }
      return [{ setFlag: fid }];
    });
    const ek = new Set<string>();
    const ends: SceneEnd[] = (d.ends ?? []).filter((e) => e?.name).slice(0, 4).flatMap((e) => {
      const g = G(e.gauge); if (!g) return [];
      let eid = slug(e.key || e.name); while (ek.has(eid)) eid += '2'; ek.add(eid);
      const fx = effects(e.effects);
      return [{ id: eid, name: e.name, outcome: (['success', 'failure', 'neutral'] as const).includes(e.outcome) ? e.outcome : 'neutral', when: e.op === 'lte' ? { gauge: g, lte: e.value } : { gauge: g, gte: e.value }, ...(e.text ? { text: e.text } : {}), ...(fx.length ? { effects: fx } : {}) }];
    });
    if (!ends.some((e) => e.outcome === 'success')) { notes.push(`장면 "${d.name}": 성공으로 끝나는 길이 없어 버렸습니다.`); continue; }
    // 차례 한도와 시간 초과 끝 (실패 길이 없어도 끝나게)
    let timeoutEnd = ends.find((e) => e.outcome === 'neutral')?.id;
    if (!timeoutEnd) { timeoutEnd = 'timeout'; ends.push({ id: 'timeout', name: '시간이 다했다', when: { round: 99 }, outcome: 'neutral' }); }
    const npc = findBy(world.characters, d.npc);
    const loc = npc ? undefined : findBy(world.locations, d.location);
    const knows = findBy(world.claims, d.start_knows);
    out.push(autoSceneArt({
      id, name: d.name, description: d.description || d.name,
      ...(npc ? { npcId: npc.id } : {}), ...(loc ? { locationId: loc.id } : {}), ...(knows ? { start: { knows: knows.id } } : {}),
      ...(npc && d.entry_trigger?.trim() ? { entry: { mode: 'offer' as const, trigger: d.entry_trigger.trim().slice(0, 200) } } : {}),
      gauges, ...(states.length ? { states } : {}),
      ...(d.likes?.length ? { likes: d.likes.filter(Boolean).slice(0, 4) } : {}), ...(d.dislikes?.length ? { dislikes: d.dislikes.filter(Boolean).slice(0, 4) } : {}),
      actions, ...(reactions.length ? { reactions } : {}), ends,
      maxRounds: Math.max(4, Math.min(14, Math.round(d.max_rounds || 8))), timeoutEnd,
    }));
    taken.add(id);
  }
  // 검사기로 마지막 확인: 오류가 남은 장면은 버린다
  const trial: WorldPackage = { ...world, flags: [...(world.flags ?? []), ...flags], scenes: [...(world.scenes ?? []), ...out] };
  const base = (world.scenes ?? []).length;
  const bad = new Set(validateWorld(trial).filter((i) => i.level === 'error' && i.path.startsWith('scenes[')).map((i) => Number(/^scenes\[(\d+)\]/.exec(i.path)?.[1])).filter((n) => n >= base).map((n) => n - base));
  const kept = out.filter((s, i) => { if (bad.has(i)) notes.push(`장면 "${s.name}": 검사를 통과하지 못해 버렸습니다.`); return !bad.has(i); });
  return { scenes: kept, flags: flags.filter((f) => kept.some((s) => s.ends.some((e) => e.effects?.some((x) => 'setFlag' in x && x.setFlag === f.id)))), notes };
}

/** AI로 장면 만들기 → 세계에 더한다 */
export async function generateScenes(
  llm: LlmClient, world: WorldPackage, onStage: (stage: string, at?: number, next?: number) => void, signal?: AbortSignal, request = '', count = 3,
  /** withSpine (v0.92): 이야기 뼈대를 같은 호출에서 먼저 짜고 그 뼈대대로 장면을 쓴다 — 뼈대만을 위한 AI 호출 한 번을 줄인다 */
  opts: { withSpine?: boolean } = {},
): Promise<{ world: WorldPackage; notes: string[] }> {
  onStage(opts.withSpine ? 'AI가 이야기 뼈대를 짜고 장면을 쓰는 중…' : 'AI가 장면을 쓰는 중 (협상·추격·대결·데이트…)…', 5, 90);
  const schema = opts.withSpine ? { ...SCENES_DRAFT_SCHEMA, required: ['spine', 'scenes'], properties: { spine: SPINE_SCHEMA, ...SCENES_DRAFT_SCHEMA.properties } } : SCENES_DRAFT_SCHEMA;
  const draft = await llm.json<{ scenes: SceneDraft[]; spine?: SpineDraft }>({
    system: `${SCENES_SYSTEM}${opts.withSpine ? `\n\n먼저 spine에 "이야기 뼈대"를 짠다 (그다음 scenes를 그 뼈대대로 쓴다):\n${SPINE_RULES}` : ''}\n- ${genreGuide(world)}`,
    user: `${worldSummary(world)}${world.scenes?.length ? `\n\n## 이미 있는 장면 (겹치지 않게)\n${world.scenes.map((s) => `- ${s.name}`).join('\n')}` : ''}\n\n## 만들 개수\n${count}개${request ? `\n\n## 제작자 요청\n${request}` : ''}`,
    maxTokens: 12000, effort: 'medium',
  }, schema, signal);
  onStage('받은 장면을 정리하고 검사하는 중…', 92, 99);
  if (opts.withSpine) world = applySpine(world, draft?.spine).world;
  const r = scenesFromDraft(world, draft?.scenes ?? []);
  const next: WorldPackage = { ...world, ...(r.flags.length ? { flags: [...(world.flags ?? []), ...r.flags] } : {}), ...(r.scenes.length ? { scenes: [...(world.scenes ?? []), ...r.scenes] } : {}) };
  onStage('완료', 100, 100);
  return { world: next, notes: [...(r.scenes.length ? [`장면 ${r.scenes.length}개를 만들었습니다: ${r.scenes.map((s) => s.name).join(', ')}. 편집기 장면 탭에서 다듬을 수 있습니다.`] : ['장면을 만들지 못했습니다. 편집기 장면 탭에서 "AI로 장면 추가"로 다시 시도할 수 있습니다.']), ...r.notes] };
}
