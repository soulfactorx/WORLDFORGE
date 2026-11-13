/**
 * AI 국면·갈래 카드 생성 (v0.116, 설계 v6 M7 5.3절).
 * 순서: 세계의 방향(기류 축) → 국면(축·긴장·임무로 들어가는 문턱) → 국면마다의 카드 덱.
 * AI는 평면 초안을 내고, 엔진이 참조(인물·장소·명제·임무·세력)를 고치고 검사한다. 고칠 수 없는 것은 버린다.
 */
import { genreGuide } from '../../engine/genre';
import { SKILL_IDS } from '../../engine/character/rules';
import { TENSION } from '../../engine/vars';
import type { Condition, Phase, PhaseTint, StoryEffect, Storylet, StoryletOption, WorldPackage, WorldVar } from '../../engine/schema';
import type { LlmClient } from '../../llm/types';
import { worldSummary } from './generate';

const COND_KINDS = ['drama_gte', 'drama_lte', 'axis_gte', 'axis_lte', 'quest_done', 'at', 'knows', 'chose'] as const;
const FX_KINDS = ['axis', 'drama', 'reveal', 'trust', 'grudge', 'reputation', 'move', 'fight', 'advance_quest', 'open_card'] as const;
const STAKES = ['escalate', 'defuse', 'side', 'bond', 'betray', 'expose', 'theme_low', 'theme_high', 'none'] as const;
const DCS = ['easy', 'medium', 'hard'] as const;

interface DCond { kind: (typeof COND_KINDS)[number]; ref: string; value: number }
interface DFx { kind: (typeof FX_KINDS)[number]; ref: string; value: number }
interface DOption { key: string; label: string; stake: (typeof STAKES)[number]; stake_ref: string; check_skill: string; check_dc: (typeof DCS)[number]; success: DFx[]; fail: DFx[] }
interface DCard { key: string; title: string; situation: string; phases: string[]; location: string; quest: string; when: DCond[]; twist: boolean; options: DOption[] }
interface DPhase { key: string; name: string; tone: string; announce: string; tint: PhaseTint; music: 'calm' | 'tense' | 'dark' | 'combat'; when: DCond[]; from: string[] }
export interface DeckDraft { axes: { key: string; name: string; low: string; high: string }[]; phases: DPhase[]; cards: DCard[] }

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items: unknown) => ({ type: 'array', items });
const COND = obj({ kind: { type: 'string', enum: [...COND_KINDS], description: 'drama_gte/lte=긴장(0~10) 이상/이하 · axis_gte/lte=기류 축(ref=축 key, -5~5) · quest_done=임무 끝남(ref=임무 key) · at=플레이어가 이 장소에(ref) · knows=플레이어가 이 명제를 앎(ref) · chose=다른 카드에서 이 갈림길을 골랐다(ref="카드key#갈림길key")' }, ref: str, value: int });
const FX = obj({ kind: { type: 'string', enum: [...FX_KINDS], description: 'axis=기류 축 ±(ref=축 key) · drama=긴장 ± · reveal=플레이어가 명제를 앎(ref) · trust/grudge=인물의 신뢰/원한 ±(ref=인물 key) · reputation=세력 평판 ±(ref) · move=플레이어가 장소로(ref) · fight=조우 시작(ref=조우 key) · advance_quest=임무의 지금 단계를 끝냄(ref) · open_card=그 카드를 다음 턴에 펼침(ref=카드 key)' }, ref: str, value: int });
export const DECK_SCHEMA = obj({
  axes: arr(obj({ key: { type: 'string', description: '영문 소문자와 _' }, name: str, low: { type: 'string', description: '-5 쪽 끝의 이름' }, high: { type: 'string', description: '+5 쪽 끝의 이름' } })),
  phases: arr(obj({
    key: { type: 'string', description: '영문 소문자와 _' }, name: str, tone: { type: 'string', description: '이 국면의 공기·문체 (2~3문장): 빛·소리·사람들의 태도·문장의 속도' }, announce: { type: 'string', description: '이 국면으로 바뀔 때 알리는 한 줄' },
    tint: { type: 'string', enum: ['calm', 'warm', 'tense', 'dark', 'bright'] }, music: { type: 'string', enum: ['calm', 'tense', 'dark', 'combat'] },
    when: arr(COND), from: arr({ type: 'string', description: '이 국면으로 올 수 있는 국면 key (비우면 어디서든)' }),
  })),
  cards: arr(obj({
    key: { type: 'string', description: '영문 소문자와 _' }, title: str, situation: { type: 'string', description: '플레이어 앞에 펼쳐지는 상황 (누가·어디서·무엇이 걸려 있나, 2~3문장, 플레이어가 볼 수 있는 일만)' },
    phases: arr({ type: 'string', description: '이 카드가 나오는 국면 key (비우면 모든 국면)' }), location: { type: 'string', description: '장소 key (비우면 어디서나)' }, quest: { type: 'string', description: '이 카드가 속한 임무 key 또는 ""' },
    when: arr(COND), twist: { type: 'boolean', description: '반전 카드 (국면마다 하나만 나온다)' },
    options: arr(obj({
      key: { type: 'string', description: 'a·b·c' }, label: { type: 'string', description: '1인칭 행동 한 줄 (40자 이내)' },
      stake: { type: 'string', enum: [...STAKES], description: '이 갈림길에 걸린 것: escalate=판을 키움 · defuse=가라앉힘 · side=세력 편(stake_ref=세력 key) · bond=인물과 가까워짐(stake_ref=인물) · betray=인물을 저버림(stake_ref=인물) · expose=비밀 폭로(stake_ref=명제) · theme_low/high=기류 축의 이쪽/저쪽(stake_ref=축 key)' },
      stake_ref: str, check_skill: { type: 'string', enum: ['', ...SKILL_IDS] }, check_dc: { type: 'string', enum: [...DCS] },
      success: arr(FX), fail: arr(FX),
    })),
  })),
});

const DECK_SYSTEM = `너는 인터랙티브 픽션의 이야기 설계자다. 주어진 세계에 "국면"과 "갈래 카드 덱"을 만든다. 목표: 플레이어의 선택에 따라 이야기의 분위기와 흐름이 크게 갈라지는 것.
설계 순서:
1) 기류 축 1~2개: 이 세계의 방향을 가르는 큰 갈림 (예: 봉인 수호 ↔ 봉인 해방, 왕국 ↔ 제국). 양 끝은 모두 매력적이어야 한다.
2) 국면 4~6개: 세계의 공기. 예: 평온한 시작 · 술렁임 · 위기 · (축의 한쪽 끝에서) 연대 · (다른 쪽 끝에서) 어둠. 조건은 긴장(drama 0~10)·축·임무로 정한다. 첫 국면(시작)은 조건 drama_lte 3, from 없음. 나머지는 from으로 어디서 오는지 정한다. 국면마다 tone이 확연히 달라야 한다 (문체·속도·인물의 태도).
3) 카드 18~26장: 국면마다 3~5장 + 어느 국면에나 나오는 카드 4~6장. 카드마다 갈림길 3개.
규칙:
- 갈림길 셋은 서로 다른 stake를 건다 (같은 결과로 가는 갈림길을 만들지 않는다). 하나는 판을 키우거나 저버리는 쪽, 하나는 가라앉히거나 가까워지는 쪽, 하나는 축의 한쪽으로.
- 카드의 when·phases로 플레이어가 만든 상황을 읽는다: 축의 값, 긴장, 끝낸 임무, 다른 카드에서 고른 갈림길(chose). 조건 없는 카드는 전체의 1/3 이하.
- 효과는 작고 분명하게: 축 ±1~2, 긴장 ±1~2, 명제 공개, 인물의 신뢰·원한 ±3~8, 세력 평판 ±3~6, 장소 이동, 조우 시작, 임무 단계 끝내기, 다른 카드 펼치기(후속).
- 판정은 결과가 불확실한 갈림길에만 (check_skill + check_dc). 판정이 없으면 check_skill "".
- 숨겨진 진실의 답을 situation에 쓰지 않는다. 비밀 폭로(expose)는 플레이어가 이미 알 수 있는 명제에만.
- 모든 key·ref는 아래 세계 요약에 있는 것만 쓴다 (축·국면·카드 key는 새로 만든다). 한국어로 쓴다.`;

const short = (id: string) => id.replace(/^[a-z]+\//, '');
function resolver(world: WorldPackage) {
  const pick = (list: { id: string }[] | undefined, key: string) => (key ? (list ?? []).find((x) => x.id === key || short(x.id) === key)?.id : undefined);
  return {
    loc: (k: string) => pick(world.locations, k), npc: (k: string) => pick(world.characters, k), claim: (k: string) => pick(world.claims, k),
    quest: (k: string) => pick(world.quests, k), fac: (k: string) => pick(world.factions, k), enc: (k: string) => pick(world.encounters, k),
  };
}

/** 초안 → 세계 (참조를 고치고, 고칠 수 없는 것은 버린다) */
export function deckFromDraft(world: WorldPackage, d: DeckDraft): { vars: WorldVar[]; phases: Phase[]; storylets: Storylet[]; notes: string[] } {
  const r = resolver(world);
  const notes: string[] = [];
  const slug = (k: string) => k.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'x';
  const axisId = new Map<string, string>();
  const vars: WorldVar[] = (d.axes ?? []).slice(0, 2).filter((a) => a?.key && a.low && a.high).map((a) => {
    const id = `axis_${slug(a.key)}`;
    axisId.set(a.key, id);
    return { id, name: a.name || a.key, initial: 0, min: -5, max: 5, visible: true, poles: [a.low, a.high] };
  });
  const phaseId = new Map<string, string>((d.phases ?? []).map((p) => [p.key, `phase/${slug(p.key)}`]));
  const cardId = new Map<string, string>((d.cards ?? []).map((c) => [c.key, `card/${slug(c.key)}`]));
  const cond = (cs: DCond[] | undefined): Condition | undefined => {
    const out: Condition[] = [];
    for (const c of cs ?? []) {
      if (c.kind === 'drama_gte') out.push({ var: TENSION, gte: c.value });
      else if (c.kind === 'drama_lte') out.push({ var: TENSION, lte: c.value });
      else if ((c.kind === 'axis_gte' || c.kind === 'axis_lte') && axisId.has(c.ref)) out.push({ var: axisId.get(c.ref)!, ...(c.kind === 'axis_gte' ? { gte: c.value } : { lte: c.value }) });
      else if (c.kind === 'quest_done' && r.quest(c.ref)) out.push({ questDone: r.quest(c.ref)! });
      else if (c.kind === 'at' && r.loc(c.ref)) out.push({ at: r.loc(c.ref)! });
      else if (c.kind === 'knows' && r.claim(c.ref)) out.push({ knows: r.claim(c.ref)! });
      else if (c.kind === 'chose') { const [ck, ok] = c.ref.split('#'); if (ck && cardId.has(ck)) out.push(ok ? { storylet: cardId.get(ck)!, is: ok } : { storylet: cardId.get(ck)! }); }
    }
    return !out.length ? undefined : out.length === 1 ? out[0] : { all: out };
  };
  const fx = (list: DFx[] | undefined): StoryEffect[] => (list ?? []).flatMap((f): StoryEffect[] => {
    const v = Math.round(Number(f.value) || 0);
    switch (f.kind) {
      case 'axis': return axisId.has(f.ref) ? [{ var: axisId.get(f.ref)!, add: Math.max(-2, Math.min(2, v)) || 1 }] : [];
      case 'drama': return [{ var: TENSION, add: Math.max(-3, Math.min(3, v)) || 1 }];
      case 'reveal': return r.claim(f.ref) ? [{ reveal: r.claim(f.ref)!, state: 'partial' }] : [];
      case 'trust': return r.npc(f.ref) ? [{ relationship: r.npc(f.ref)!, delta: { trust: Math.max(-10, Math.min(10, v)) } }] : [];
      case 'grudge': return r.npc(f.ref) ? [{ relationship: r.npc(f.ref)!, delta: { grudge: Math.max(0, Math.min(10, Math.abs(v))) } }] : [];
      case 'reputation': return r.fac(f.ref) ? [{ reputation: r.fac(f.ref)!, delta: Math.max(-8, Math.min(8, v)) }] : [];
      case 'move': return r.loc(f.ref) ? [{ moveTo: r.loc(f.ref)! }] : [];
      case 'fight': return r.enc(f.ref) ? [{ startEncounter: r.enc(f.ref)! }] : [];
      case 'advance_quest': return r.quest(f.ref) ? [{ advanceQuest: r.quest(f.ref)! }] : [];
      case 'open_card': return cardId.has(f.ref) ? [{ openStorylet: cardId.get(f.ref)!, inTurns: Math.max(1, Math.min(4, v || 2)) }] : [];
    }
    return [];
  });
  const stake = (o: DOption): string | undefined => {
    switch (o.stake) {
      case 'escalate': case 'defuse': return o.stake;
      case 'side': return r.fac(o.stake_ref) ? `side:${r.fac(o.stake_ref)}` : undefined;
      case 'bond': case 'betray': return r.npc(o.stake_ref) ? `${o.stake}:${r.npc(o.stake_ref)}` : undefined;
      case 'expose': return r.claim(o.stake_ref) ? `expose:${r.claim(o.stake_ref)}` : undefined;
      case 'theme_low': case 'theme_high': return axisId.has(o.stake_ref) ? `theme:${axisId.get(o.stake_ref)}:${o.stake === 'theme_high' ? '+' : '-'}` : undefined;
      default: return undefined;
    }
  };
  const phases: Phase[] = (d.phases ?? []).filter((p) => p?.key && p.name && p.tone).slice(0, 6).map((p) => ({
    id: phaseId.get(p.key)!, name: p.name, tone: p.tone, enter: cond(p.when) ?? { var: TENSION, lte: 10 },
    ...(p.from?.length ? { from: p.from.map((k) => phaseId.get(k)).filter((x): x is string => !!x) } : {}),
    ...(p.announce ? { announce: p.announce } : {}), ...(p.tint ? { tint: p.tint } : {}), ...(p.music ? { music: p.music } : {}),
  }));
  // 시작 국면(어디서든 들어올 수 있는 것)이 맨 아래에 오게 — 엔진은 위에서부터 본다
  phases.sort((a, b) => Number(!a.from?.length) - Number(!b.from?.length));
  if (phases.length && !phases.some((p) => !p.from?.length)) { phases.at(-1)!.from = undefined; notes.push('어디서든 들어올 수 있는 국면이 없어 마지막 국면을 시작 국면으로 삼았습니다.'); }
  const validPhase = new Set(phases.map((p) => p.id));
  const storylets: Storylet[] = [];
  let dropped = 0;
  for (const c of d.cards ?? []) {
    if (!c?.key || !c.title || !c.situation) { dropped++; continue; }
    const used = new Set<string>();
    const options: StoryletOption[] = (c.options ?? []).slice(0, 4).filter((o) => o?.label).map((o, i) => {
      let st = stake(o);
      if (st && used.has(st)) st = undefined;
      if (st) used.add(st);
      const success = fx(o.success), fail = fx(o.fail);
      return { id: slug(o.key || String.fromCharCode(97 + i)) + (i ? '' : ''), label: o.label.slice(0, 60), ...(st ? { stake: st } : {}),
        ...(o.check_skill && (SKILL_IDS as readonly string[]).includes(o.check_skill) ? { check: { skill: o.check_skill, dc: o.check_dc } } : {}),
        ...(success.length ? { success } : {}), ...(fail.length ? { fail } : {}) };
    });
    // 갈림길 ID가 겹치면 a·b·c로
    if (new Set(options.map((o) => o.id)).size < options.length) options.forEach((o, i) => { o.id = String.fromCharCode(97 + i); });
    if (options.length < 2) { dropped++; continue; }
    const ph = (c.phases ?? []).map((k) => phaseId.get(k)).filter((x): x is string => !!x && validPhase.has(x));
    storylets.push({
      id: cardId.get(c.key)!, title: c.title.slice(0, 40), situation: c.situation, options,
      ...(ph.length ? { phases: ph } : {}), ...(r.loc(c.location) ? { locationId: r.loc(c.location)! } : {}), ...(r.quest(c.quest) ? { quest: r.quest(c.quest)! } : {}),
      ...(cond(c.when) ? { when: cond(c.when)! } : {}), ...(c.twist ? { tags: ['twist' as const] } : {}),
    });
  }
  if (dropped) notes.push(`갈래 카드 ${dropped}장은 내용이 모자라 버렸습니다.`);
  // 카드끼리의 참조(고른 길·후속 카드)가 버려진 카드를 가리키면 지운다
  const ids = new Set(storylets.map((c) => c.id));
  for (const c of storylets) for (const o of c.options) for (const k of ['success', 'fail'] as const) if (o[k]) o[k] = o[k]!.filter((e) => !('openStorylet' in e) || ids.has(e.openStorylet));
  return { vars, phases, storylets, notes };
}

/** 세계에 국면·갈래 카드를 만든다 (이미 있는 카드는 그대로 두고 더한다) */
export async function generateDeck(llm: LlmClient, world: WorldPackage, onStage: (stage: string, at?: number, next?: number) => void, signal?: AbortSignal, request = ''): Promise<{ world: WorldPackage; notes: string[]; added: number }> {
  onStage('AI가 세계의 방향·국면·갈래 카드를 쓰는 중…', 5, 90);
  const draft = await llm.json<DeckDraft>({
    system: `${DECK_SYSTEM}\n- ${genreGuide(world)}`,
    user: `${worldSummary(world, { level: 'focus' })}${world.overview ? `\n\n## 세계 개요\n${world.overview.slice(0, 2000)}` : ''}${world.phases?.length ? `\n\n## 이미 있는 국면 (이것은 다시 만들지 않는다 — phases는 [])\n${world.phases.map((p) => `- ${p.name}`).join('\n')}` : ''}${world.storylets?.length ? `\n\n## 이미 있는 카드 (겹치지 않게)\n${world.storylets.map((c) => `- ${c.title}`).join('\n')}` : ''}${request ? `\n\n## 제작자 요청\n${request}` : ''}`,
    maxTokens: 16000, effort: 'medium', label: '국면·갈래 카드',
  }, DECK_SCHEMA, signal);
  onStage('받은 초안을 세계에 맞춰 정리하는 중…', 92, 99);
  const r = deckFromDraft(world, draft ?? { axes: [], phases: [], cards: [] });
  const next: WorldPackage = {
    ...world,
    ...(r.vars.length ? { vars: [...(world.vars ?? []), ...r.vars.filter((v) => !(world.vars ?? []).some((x) => x.id === v.id))] } : {}),
    ...(r.phases.length && !world.phases?.length ? { phases: r.phases } : {}),
    ...(r.storylets.length ? { storylets: [...(world.storylets ?? []), ...r.storylets.filter((c) => !(world.storylets ?? []).some((x) => x.id === c.id))] } : {}),
  };
  onStage('완료', 100, 100);
  return { world: next, added: r.storylets.length, notes: [`${r.phases.length ? `국면 ${r.phases.length}개(${r.phases.map((p) => p.name).join(' · ')}), ` : ''}${r.vars.length ? `세계의 방향 ${r.vars.map((v) => `${v.poles![0]}↔${v.poles![1]}`).join(', ')}, ` : ''}갈래 카드 ${r.storylets.length}장을 만들었습니다.`, ...r.notes] };
}
