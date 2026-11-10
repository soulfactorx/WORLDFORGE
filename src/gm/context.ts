import { establishedFactsOf, improvisationOf, protectedTopicsOf } from '../engine/canon';
import { knowledgeOf } from '../engine/knowledge/knowledge';
import { AXES, AXIS_NAMES, canShareSecret, joinBlocker, loyaltyOf, OBEY_LOYALTY, relationsOf, relationshipOf, reputationLabel, reputationOf, secretTrustOf, stageFor, stageOf } from '../engine/relationship';
import { activeBeats, varLabel, varValue } from '../engine/scenario';
import { npcLocationOf } from '../engine/world';
import type { Character, EntityId, WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';
import { calendarDate } from '../engine/calendar';
import { appearanceOf, epithetOf, knowsName } from '../engine/names';
import { npcStatLine } from '../engine/npcStats';
import { allTitles, rankOf, renownOf, renownTier } from '../engine/renown';
import { classesFor, classLabel, subclassLabel } from '../engine/classes';
import { profileLine } from '../engine/profile';
import { traitImpression, traitLines } from '../engine/traits';
import { reskinner } from '../engine/genre';
import { actorBrief, narratorBrief, storyBrief } from './brief';

const dateLabel = (world: WorldPackage, minutes: number) => { const d = calendarDate(world, minutes); return d ? `${d.label}${d.countdown ? ` (${d.countdown})` : ''} ` : ''; };

/**
 * Context Builder — 역할별로 서로 다른 정보만 준다 (설계 리뷰 2.2절).
 *  - Director: 플레이어가 감각으로 알 수 있는 장면 + 장면 인물 목록. 비밀·NPC 지식 없음.
 *  - Actor:    해당 NPC 한 명의 프로필·지식·기억만. 다른 NPC의 지식이나 세계의 진실 없음.
 *  - Narrator: 장면 + 플레이어 지식 + Actor가 확정한 대사. NPC 지식 없음.
 * 세계의 진실(facts.statement)은 어떤 프롬프트에도 직접 들어가지 않는다.
 */

/** NPC의 현재 위치: 동료면 플레이어 곁, 아니면 세이브의 위치 변경 또는 패키지 기본값 */
/** NPC의 현재 위치 (동료 → 옮긴 곳 → 일정 → 기본, engine/world) */
export function npcLocation(state: GameState, c: Character): EntityId {
  return npcLocationOf(state, c);
}

export function presentCharacters(world: WorldPackage, state: GameState): Character[] {
  return world.characters.filter((c) => !state.deadNpcs?.includes(c.id) && npcLocation(state, c) === state.player.locationId);
}

function partyLines(world: WorldPackage, state: GameState): string[] {
  const ids = Object.keys(state.party);
  if (!ids.length) return ['(없음 — 혼자다)'];
  return ids.map((id) => {
    const sh = state.party[id]!;
    return `- ${sh.name} [${id}] ${classLabel(world, sh, reskinner(world))} ${sh.level}레벨 · HP ${sh.hp}/${sh.maxHp}`;
  });
}

export function sceneSubjects(world: WorldPackage, state: GameState): EntityId[] {
  return [state.player.locationId, ...presentCharacters(world, state).map((c) => c.id)];
}

const POLICY_TEXT = { none: '지어내기 금지 — 설명에 없는 흔적·단서·이상 징후를 덧붙이지 않는다', minor: '작은 세부사항만 지어낼 수 있음', free: '자유롭게 지어낼 수 있음' } as const;

/** 엔티티별 확정된 세부사항 + 즉흥 허용 범위 + 보호 주제 (Narrator·Actor 공용) */
function canonBlock(world: WorldPackage, state: GameState, id: EntityId, indent = '  '): string[] {
  const facts = establishedFactsOf(state.improvisedFacts, id);
  const topics = protectedTopicsOf(world, id);
  const policy = improvisationOf(world, id) ?? 'minor';
  return [
    `${indent}즉흥 설정: ${POLICY_TEXT[policy]}`,
    ...(facts.length ? [`${indent}이미 확정된 세부사항 (반드시 일관되게):`, ...facts.map((f) => `${indent}  · ${f}`)] : []),
    ...(topics.length ? [`${indent}보호 주제 (언급·추측·창작 금지): ${topics.join(' / ')}`] : []),
  ];
}

/** 세계 개요 (v0.54) — 모든 AI가 참고. withNotes면 GM 메모(비공개)도 */
export function worldBrief(world: WorldPackage, withNotes = false, limit = 2500): string[] {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const o = world.overview?.trim();
  const g = withNotes ? world.gmNotes?.trim() : '';
  return [
    ...(o ? [`## 이 세계 (${world.manifest.name}) — 개요 (플레이어도 아는 배경)`, cut(o, limit), ''] : []),
    ...(g ? ['## GM 메모 (플레이어는 모름 — 연출에 쓰되 직접 밝히지 않는다)', cut(g, limit), ''] : []),
  ];
}

function sceneHeader(world: WorldPackage, state: GameState): string[] {
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  if (!loc) throw new Error(`unknown location: ${state.player.locationId}`);
  const hh = Math.floor(state.worldMinutes / 60) % 24, mm = state.worldMinutes % 60;
  return [
    `## 현재 장소: ${loc.name} [${loc.id}]`,
    loc.description,
    `시각: ${dateLabel(world, state.worldMinutes)}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  ];
}

function exits(world: WorldPackage, state: GameState): string[] {
  const loc = world.locations.find((l) => l.id === state.player.locationId)!;
  return loc.connections.map((id) => `- ${id}: ${world.locations.find((x) => x.id === id)?.name ?? id}`);
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayPart = (m: number) => { const h = Math.floor(m / 60) % 24; return h < 5 ? '한밤' : h < 9 ? '이른 아침' : h < 12 ? '오전' : h < 14 ? '한낮' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤'; };
const span = (min: number) => (min >= 1440 ? `${Math.floor(min / 1440)}일 ${Math.round((min % 1440) / 60)}시간` : min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`);
const clip = (t: string, n: number) => { const x = t.replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
/** 서술의 앞부분 몇 문장 (줄거리용) */
const gist = (t: string, n = 120) => clip(t.split(/(?<=[.!?。…”"])\s+/).slice(0, 2).join(' '), n);

/** 장면·전투가 시작되기 직전의 서술과, 그 뒤 지금까지 이 장면에서 있었던 일 (v0.79.3) */
export function sceneSoFar(state: GameState, startMark = '🎭 장면 시작'): { before: string; since: string[]; lastNarration: string } {
  const log = state.log;
  let start = -1;
  for (let i = log.length - 1; i >= 0; i--) if (log[i]!.text.startsWith(startMark)) { start = i; break; }
  const upto = start >= 0 ? start : log.length;
  let before = '';
  for (let i = upto - 1; i >= 0; i--) if (log[i]!.kind === 'narration') { before = log[i]!.text; break; }
  const after = start >= 0 ? log.slice(start + 1) : [];
  const narr = after.filter((e) => e.kind === 'narration');
  const lastNarration = narr.at(-1)?.text ?? '';
  const lastIdx = after.lastIndexOf(narr.at(-1)!);
  const since = after.filter((e) => e.kind !== 'guide').map((e) => (e.kind !== 'narration' ? `[${e.kind}] ${clip(e.text, 240)}`
    : after.indexOf(e) === lastIdx ? `(직전 서술 — 여기서 이어 쓴다) ${e.text}` : `(서술) ${clip(e.text, 350)}`));
  return { before: clip(before.slice(-900), 900), since, lastNarration };
}

/**
 * 이야기의 흐름 (v0.79.3): 매 서술이 처음부터 다시 쓰는 것처럼 되지 않게
 * - 지금까지의 줄거리: 지난 턴마다 플레이어 행동 → 서술 앞부분 (시각·장소)
 * - 직전 서술 전문: 여기서 바로 이어 쓴다
 * - 그 뒤 엔진이 기록한 것: 이번 턴의 판정·관계·발견 등
 * - 흐른 시간: 직전 서술 이후 몇 분, 지금 시간대
 * mode 'brief'(GM 안내용): 직전 서술은 따로 받으므로 줄거리만
 */
export function storyThread(world: WorldPackage, state: GameState, opts: { chronicle?: number; lastChars?: number; mode?: 'narrate' | 'brief' } = {}): string[] {
  const { chronicle = 10, lastChars = 2200, mode = 'narrate' } = opts;
  const log = state.log;
  let lastIdx = -1;
  for (let i = log.length - 1; i >= 0; i--) if (log[i]!.kind === 'narration') { lastIdx = i; break; }
  const locName = (id?: string) => (id ? world.locations.find((l) => l.id === id)?.name ?? '' : '');
  // 줄거리: 서술 하나마다 바로 앞의 플레이어 행동과 짝짓는다
  const beats: string[] = [];
  let pendingInput = '';
  const upto = mode === 'brief' ? log.length : Math.max(0, lastIdx);
  for (let i = 0; i < upto; i++) {
    const e = log[i]!;
    if (e.kind === 'player') pendingInput = e.text;
    if (e.kind === 'narration') {
      const when = [e.at !== undefined ? hhmm(e.at) : '', locName(e.loc)].filter(Boolean).join(' · ');
      beats.push(`- 턴 ${e.turn}${when ? ` (${when})` : ''}: ${pendingInput ? `당신 「${clip(pendingInput, 50)}」 → ` : ''}${gist(e.text)}`);
      pendingInput = '';
    }
  }
  const out: string[] = [];
  // 이야기 요약 (v0.85): 줄거리에서 빠진 오래된 턴을 기억한다
  const sum = state.storySummary;
  if (sum?.text && beats.length > chronicle) out.push(`## 이야기 요약 (턴 ${sum.upto}까지 — 이미 일어난 일)`, sum.text, '');
  if (beats.length) out.push('## 지금까지의 줄거리 (오래된 것부터 — 이미 일어난 일, 다시 쓰지 않는다)', ...(beats.length > chronicle ? [`- (그 전 ${beats.length - chronicle}턴 생략${sum?.text ? ' — 위 요약 참고' : ''})`] : []), ...beats.slice(-chronicle), '');
  if (mode === 'brief') return out;
  const prev = lastIdx >= 0 ? log[lastIdx]! : undefined;
  if (prev) {
    const since = prev.at !== undefined ? state.worldMinutes - prev.at : undefined;
    out.push(`## 직전 서술 (턴 ${prev.turn}${prev.at !== undefined ? ` · ${hhmm(prev.at)}` : ''}${prev.loc ? ` · ${locName(prev.loc)}` : ''}) — 이 마지막 순간에서 바로 이어 쓴다`,
      prev.text.length > lastChars ? `…${prev.text.slice(-lastChars)}` : prev.text, '');
    const guide = log.slice(lastIdx + 1).find((e) => e.kind === 'guide');
    if (guide) out.push('## 그때 GM이 짚은 상황 (참고)', clip(guide.text, 300), '');
    if (since !== undefined) {
      const moved = prev.loc && prev.loc !== state.player.locationId;
      out.push('## 시간의 흐름 (엔진 확정)', `직전 서술 이후 ${since > 0 ? `${span(since)} 흘렀다` : '거의 시간이 흐르지 않았다'} → 지금 ${hhmm(state.worldMinutes)} (${dayPart(state.worldMinutes)}).${since >= 60 ? ' 빛·소리·사람들의 움직임이 그만큼 달라져 있다.' : ''}${moved ? ` 장소가 바뀌었다: ${locName(prev.loc)} → ${locName(state.player.locationId)}.` : ''}`, '');
    }
  }
  // 직전 서술 뒤의 기록 (v0.85): 지난 턴 끝에 일어난 일과 이번 턴에 확정된 일을 나눈다 — 지난 일을 이번 일처럼 다시 쓰지 않게
  const after = log.slice(lastIdx + 1).filter((e) => e.kind !== 'guide');
  const earlier = after.filter((e) => e.turn < state.turn);
  const now = after.filter((e) => e.turn >= state.turn);
  if (earlier.length) out.push('## 직전 서술 뒤에 일어난 일 (플레이어는 이미 화면에서 봤다 — 다시 일어난 것처럼 쓰지 않는다)', ...earlier.map((e) => `[${e.kind}] ${clip(e.text, 300)}`), '');
  if (now.length) out.push('## 이번 턴에 엔진이 기록한 것', ...now.map((e) => `[${e.kind}] ${clip(e.text, 300)}`), '');
  return out;
}

function playerKnowledge(world: WorldPackage, state: GameState): string[] {
  const k = knowledgeOf(world, state.beliefs, 'player').map((x) => x.source === 'start'
    ? `- (처음부터 알던 것: 원작·사전 지식 — 아직 일어나지 않았거나 바뀔 수 있는 일일 수 있다) ${x.statement}`
    : `- (${x.state}) ${x.statement}`);
  return k.length ? k : ['(아무것도 모른다 — 이 세계에 막 소환되었다)'];
}

/** 이 장소에 머문 시간 — 조우 조건("두 턴 이상 머물면")은 이것으로 판단한다 (엔진 확정) */
function stayLines(state: GameState): string[] {
  if (state.arrivedTurn === undefined) return [];
  // 도착한 턴이 1번째, 그다음 턴이 2번째 (v0.79.3: 이동한 다음 턴도 "방금 도착"으로 세던 것 수정). 게임 시작(턴 0)은 턴 1이 첫 턴
  const base = state.arrivedTurn === 0 ? 1 : state.arrivedTurn;
  const n = Math.max(1, state.turn - base + 1);
  return ['## 이 장소에 머문 시간 (엔진 확정)', n === 1 ? '이번이 이 장소에서의 첫 턴이다 (방금 도착했다).' : `이 장소에서 ${n}번째 턴이다.`, ''];
}

/** 주인공의 직업 (v0.56) — 장르에 맞는 역할로 이야기를 고른다. 규칙상 직업은 말하지 않는다 */
export function playerLines(world: WorldPackage, state: GameState): string[] {
  const sh = state.player.sheet;
  const wc = classesFor(world).find((c) => (sh.role ? c.id === sh.role : c.base === sh.classId));
  const desc = wc ? [wc.strengths && `잘하는 것: ${wc.strengths}`, wc.blurb].filter(Boolean).join(' — ') : '';
  const pl = profileLine(world, sh);
  return ['## 주인공의 성향 (행동이 쌓여 바뀐다 — 이야기 갈림길이 이것을 읽는다)', ...traitLines(world, sh), '', '## 주인공', `${sh.name} — ${classLabel(world, sh, reskinner(world))}${sh.subclass ? `·${subclassLabel(world, sh, reskinner(world))}` : ''} ${sh.level}레벨${desc ? ` (${desc})` : ''}`, ...(pl ? [pl, '서술할 때 주인공의 성별·외모를 이 정보에 맞춘다 (플레이어가 정한 것이다).'] : []), ''];
}

export function buildDirectorContext(world: WorldPackage, state: GameState): string {
  const npcs = presentCharacters(world, state).map((c) => `- ${c.id}: ${appearanceOf(c)} [능력: ${npcStatLine(world, state, c)}]`);
  return [
    ...worldBrief(world, true),
    ...sceneHeader(world, state), '',
    ...stayLines(state),
    ...playerLines(world, state),
    '## 이동 가능한 곳', ...exits(world, state), '',
    '## 이 장소에 있는 인물', ...(npcs.length ? npcs : ['(없음)']), '',
    '## 플레이어와 동행 중인 동료', ...partyLines(world, state), '',
    ...storyThread(world, state, { chronicle: 6, lastChars: 1200 }),
  ].join('\n');
}

const MAX_ACTOR_CLAIMS = 80;

/** 명성 (설계 v4 E4): 이름이 알려졌으면 NPC가 소문으로 안다 — "당신이 늑대를 잡은 그 사람이군요" */
function fameLines(world: WorldPackage, state: GameState): string[] {
  const renown = renownOf(world, state);
  if (renown < 5) return [];
  const defs = new Map(allTitles(world).map((t) => [t.id, t]));
  const titles = (state.titles ?? []).map((id) => defs.get(id)).filter((t) => !!t).sort((a, b) => b!.renown - a!.renown).slice(0, 3).map((t) => `${t!.name}(${t!.desc})`);
  const rank = rankOf(world, state);
  return ['## 이 낯선 이에 대해 들은 소문', `명성: ${renownTier(renown)} · ${rank.label} ${rank.name}${titles.length ? ` · 알려진 이야기: ${titles.join(', ')}` : ''}`,
    '소문이 맞는지는 모른다. 명성이 높을수록 존중하거나, 경계하거나, 부탁하고 싶어 한다 (네 성격대로).', ''];
}

export function buildActorContext(world: WorldPackage, state: GameState, npc: Character): string {
  const rel = relationshipOf(world, state.relationships, npc.id);
  const knows = knowledgeOf(world, state.beliefs, npc.id);
  const claimIds = [...world.beliefs, ...state.beliefs].filter((b) => b.holder === npc.id).map((b) => b.claim);
  const claimLines = [...new Set(claimIds)].map((id) => {
    const c = world.claims.find((x) => x.id === id);
    const st = knows.find((k) => k.statement === c?.statement)?.state;
    const secretNote = st !== 'secret' ? '' : canShareSecret(world, npc.id, rel)
      ? '  ← 비밀: 이제 털어놓을 수는 있지만, 꼭 필요할 때만'
      : '  ← 비밀: 지금 신뢰로는 절대 말하지 않는다';
    return c ? `- [${id}] (${st}) ${c.statement}${secretNote}` : '';
  }).filter(Boolean);
  // 아는 것이 너무 많으면(큰 세계) 지금 장면과 관련된 것 위주로 줄인다: 비밀 → 이 장소·이 자리 인물이 나오는 것 → 나머지
  if (claimLines.length > MAX_ACTOR_CLAIMS) {
    const here = world.locations.find((l) => l.id === state.player.locationId)?.name ?? '';
    const names = [here, ...presentCharacters(world, state).map((c) => c.name)].filter((n) => n.length >= 2);
    const rank = (l: string) => (l.includes('← 비밀') ? 0 : names.some((n) => l.includes(n)) ? 1 : 2);
    const kept = claimLines.map((l, i) => ({ l, i, r: rank(l) })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, MAX_ACTOR_CLAIMS).sort((a, b) => a.i - b.i).map((x) => x.l);
    claimLines.length = 0;
    claimLines.push(...kept, `- (그 밖에도 아는 것이 더 있다. 위 목록에 없는 일은 어렴풋하게만 기억한다)`);
  }
  const loc = world.locations.find((l) => l.id === state.player.locationId);
  return [
    // 세계의 공개 배경은 이 세계에 사는 인물이라면 안다 (v0.54)
    ...worldBrief(world, false, 1200),
    `## 너는 ${npc.name} [${npc.id}]`,
    `외형: ${appearanceOf(npc)}`,
    `능력: ${npcStatLine(world, state, npc)} (말과 행동이 이 능력에 어울리게 — 약한 능력을 과장하지 않는다)`,
    ...(npc.stats?.traits && traitImpression(world, { traits: npc.stats.traits }) ? [`너의 성향: ${traitImpression(world, { traits: npc.stats.traits })}`] : []),
    `성격: ${npc.personality}`,
    `말투: ${npc.speech}`,
    ...(npc.background ? [`배경: ${npc.background}`] : []),
    ...(npc.greeting && !state.npcMemory[npc.id]?.length ? [`처음 만났을 때 하는 말 (참고): ${npc.greeting}`] : []),
    ...canonBlock(world, state, npc.id, ''), '',
    `## 지금 있는 곳: ${loc?.name}`, '',
    '## 네가 아는 것 (이 목록 밖의 세계 사실은 모른다)', ...(claimLines.length ? claimLines : ['(특별히 아는 것 없음)']), '',
    ...fameLines(world, state),
    ...((v) => (v ? ['## 이 낯선 이의 겉모습 (네 눈에 보이는 것)', v, ''] : []))(profileLine(world, state.player.sheet, true)),
    ...((v) => (v ? ['## 이 낯선 이에게서 받는 인상 (행동에서 드러난 성향)', `${v} — 이 인상에 네 성격대로 반응한다`, ''] : []))(traitImpression(world, state.player.sheet)),
    `## 이 낯선 이에 대한 너의 감정: ${stageOf(rel, !!npc.romanceable)}`,
    AXES.map((a) => `${AXIS_NAMES[a]} ${rel[a]}`).join(' · ') + '  (-100 ~ 100)',
    `비밀을 털어놓으려면 신뢰 ${secretTrustOf(world, npc.id)} 이상이 필요하다.`,
    npc.romanceable
      ? '너는 이 사람과 연인이 될 수도 있다. 감정은 친밀과 호감이 쌓이는 만큼만 천천히 깊어진다. 서두르지 않는다.'
      : '너는 이 사람에게 연애 감정을 품지 않는다. 가까워져도 우정이나 신뢰로 남는다.',
    ...(state.party[npc.id] ? [`동료로서의 충성도: ${loyaltyOf(rel)} / 100${loyaltyOf(rel) < OBEY_LOYALTY ? ' — 낮다. 지시를 따르기 싫고, 불만을 드러낸다.' : ''}`] : []),
    ...relationLines(world, state, npc), '',
    ...beatLines(world, state, npc),
    ...actorBrief(world, state, npc),
    '## 이 낯선 이와의 지난 대화', ...(state.npcMemory[npc.id]?.length ? state.npcMemory[npc.id]! : ['(처음 만난다)']), '',
    // 방금 눈앞에서 벌어진 일 (v0.79.3) — 대화가 매번 처음인 것처럼 되지 않게
    ...(() => { let t = ''; for (let i = state.log.length - 1; i >= 0; i--) if (state.log[i]!.kind === 'narration') { t = state.log[i]!.text; break; } return t ? ['## 방금 네 눈앞에서 벌어진 일 (이어서 반응한다)', clip(t.slice(-600), 600), ''] : []; })(),
    '## 동행', ...(state.party[npc.id]
      ? ['너는 지금 이 낯선 이와 함께 다니는 동료다. 크게 실망하거나 위험이 지나치면 떠날 수 있다.']
      : npc.companion
        ? [
          `너는 아직 동료가 아니다. 함께 가자는 제안을 받으면 다음 기준으로 스스로 판단한다: ${npc.companion.joinCondition}`,
          ...(joinBlocker(npc.companion, rel) ? [`지금은 동행할 수 없다 (${joinBlocker(npc.companion, rel)}). 제안을 받으면 거절한다.`] : []),
        ]
        : ['너는 누구와도 동행하지 않는다. 동행 제안은 거절한다.']),
  ].join('\n');
}

/** 다른 인물과의 관계 + 그 인물과 플레이어의 사이 (파급을 연기에 반영) / 세력 */
function relationLines(world: WorldPackage, state: GameState, npc: Character): string[] {
  const rels = relationsOf(world, npc.id, state).flatMap((r) => {
    const o = world.characters.find((c) => c.id === r.other);
    if (!o) return [];
    const met = state.relationships[o.id] || state.npcMemory[o.id]?.length;
    return [`- ${o.name}: ${r.label}${r.note ? ` — ${r.note}` : ''}${state.deadNpcs.includes(o.id) ? ' (죽었다)' : met ? ` / 이 낯선 이와 ${o.name}의 사이: ${stageFor(world, state.relationships, o.id)}` : ''}`];
  });
  const f = npc.faction ? world.factions?.find((x) => x.id === npc.faction) : undefined;
  return [
    ...(rels.length ? ['', '## 너와 다른 인물의 관계', ...rels] : []),
    ...(f ? ['', `## 너의 소속: ${f.name} — ${f.description}`, `이 낯선 이에 대한 ${f.name}의 평판: ${reputationLabel(reputationOf(world, state.reputation ?? {}, f.id))}`] : []),
  ];
}

function beatLines(world: WorldPackage, state: GameState, npc: Character): string[] {
  const mine = activeBeats(world, state).filter((b) => b.npcId === npc.id);
  const came = mine.some((b) => state.beats[b.id]?.approached !== undefined && (b.approach ?? 'visit') === 'visit');
  const goals = activeGoals(world, state).filter((g) => g.npc.id === npc.id);
  return [
    ...(mine.length ? ['## 지금 너의 마음 (때가 무르익었다)', ...mine.map((b) => `- ${b.name}: ${b.hint}`), ...(came ? ['너는 이 낯선 이에게 할 말이 있어 일부러 찾아왔다. 먼저 말을 건다.'] : []), ''] : []),
    ...(goals.length ? ['## 너의 목표 (네가 스스로 이루려는 일 — 말과 행동에 은근히 드러난다)', ...goals.map((g) => `- ${g.goal.text}`), ''] : []),
  ];
}

/** 진행 중인 NPC 목표 (설계 v4 E7) */
export function activeGoals(world: WorldPackage, state: GameState) {
  return world.characters.flatMap((npc) => (npc.goals ?? []).flatMap((goal) => {
    const st = state.npcGoals?.[goal.id];
    if (!st || st.done || st.stopped) return [];
    const left = Math.max(0, Math.ceil(goal.days - (state.worldMinutes - st.startedAt) / 1440));
    return [{ npc, goal, left }];
  }));
}

export function buildNarratorContext(world: WorldPackage, state: GameState, opts: { thread?: Parameters<typeof storyThread>[2] } = {}): string {
  const npcs = presentCharacters(world, state).map((c) => [
    `- ${knowsName(state, c.id) ? c.name : `${epithetOf(c)} (플레이어가 아직 이름을 모름 — 이름을 쓰지 말고 이 호칭이나 생김새로 자연스럽게 부른다)`} [${c.id}] — 외형: ${appearanceOf(c)} — 능력: ${npcStatLine(world, state, c)} — 플레이어를 대하는 태도: ${stageFor(world, state.relationships, c.id)}`,
    ...canonBlock(world, state, c.id),
  ].join('\n'));
  return [
    ...worldBrief(world),
    ...sceneHeader(world, state),
    ...canonBlock(world, state, state.player.locationId, ''), '',
    '## 이동 가능한 곳', ...exits(world, state), '',
    '## 이 장소에 있는 인물', ...(npcs.length ? npcs : ['(없음)']), '',
    '## 동행 중인 동료', ...partyLines(world, state), '',
    ...playerLines(world, state),
    '## 플레이어의 몸 상태', `HP ${state.player.sheet.hp}/${state.player.sheet.maxHp}${state.player.sheet.hp <= state.player.sheet.maxHp / 3 ? ' (심하게 다침)' : ''}`, '',
    ...worldMood(world, state),
    ...narratorBrief(storyBrief(world, state)),
    '## 플레이어가 알고 있는 것', ...playerKnowledge(world, state), '',
    ...stayLines(state),
    ...storyThread(world, state, opts.thread ?? {}),
  ].join('\n');
}

/** 보이는 세계 수치 — 서술의 분위기 (설계 v4 E6) */
function worldMood(world: WorldPackage, state: GameState): string[] {
  const vs = (world.vars ?? []).filter((v) => v.visible);
  return vs.length ? ['## 세계의 분위기 (서술 톤에 반영)', ...vs.map((v) => `- ${v.name}: ${varLabel(v, varValue(world, state, v.id))}`), ''] : [];
}
