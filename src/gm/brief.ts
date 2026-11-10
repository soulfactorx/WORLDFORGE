/**
 * 이야기 브리프 (v0.85) — 엔진이 확정한 "지금 이야기가 어디에 있는가"를 한곳에서 만들고, 역할마다 범위만 달리해 준다.
 *  - GM 판단: 전부 (힌트·고비·열 수 있는 장면)
 *  - 서술: 수첩의 목표와 엔진이 확정한 전환만 (힌트·숨은 진실은 주지 않는다)
 *  - NPC 연기: 자기가 의뢰인·당사자인 임무에서의 역할
 *  - GM 안내: 수첩의 목표 + 플레이어가 알 만한 고비(장소·장면 이름)
 * 지금까지는 임무 힌트가 GM 판단 AI에게만 가서, 서술·연기·안내가 이야기의 방향을 몰랐다.
 */
import { allEncounters, encounterBlocked, stageGates } from '../engine/encounter';
import { itemDef } from '../engine/items';
import { displayName } from '../engine/names';
import { activeQuests, playerKnows } from '../engine/scenario';
import { availableScenes, offerableScenes, sceneEntry } from '../engine/scene';
import { pendingChoice } from '../engine/story';
import { npcLocationOf } from '../engine/world';
import type { Character, Condition, Quest, QuestStage, SceneDef, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';

/** 이 단계가 무엇으로 풀리는가 */
export interface Via {
  kind: 'encounter' | 'scene' | 'talk' | 'discover' | 'go' | 'item' | 'companion';
  id: string;
  /** GM용 한 줄 */
  gm: string;
  /** 플레이어가 알아도 되는 한 줄 (없으면 플레이어에게는 보이지 않는다) */
  open?: string;
}

const locName = (w: WorldPackage, id?: string) => (id ? w.locations.find((l) => l.id === id)?.name ?? id : '');

function walkPositive(c: Condition | undefined, visit: (c: Condition) => void) {
  if (!c) return;
  if ('all' in c) c.all.forEach((x) => walkPositive(x, visit));
  else if ('any' in c) c.any.forEach((x) => walkPositive(x, visit));
  else if (!('not' in c)) visit(c);
}

/** 단계의 고비: via + 완료 조건에서 뽑는다. 이미 채운 조건은 뺀다 */
export function viaOf(world: WorldPackage, state: GameState, stage: QuestStage): Via[] {
  const out: Via[] = [];
  const add = (v: Via) => { if (!out.some((x) => x.kind === v.kind && x.id === v.id)) out.push(v); };
  const gates = stageGates(stage);
  for (const id of gates.encounters) {
    if (state.clearedEncounters.includes(id)) continue;
    const e = allEncounters(world, state).find((x) => x.id === id);
    if (!e) continue;
    const blocked = encounterBlocked(world, state, e);
    add({ kind: 'encounter', id, gm: `전투 「${e.name}」 — ${locName(world, e.locationId)}에서${blocked ? ` (지금은 열리지 않는다: ${blocked})` : ''}`, open: `${locName(world, e.locationId)}에 위험이 기다린다` });
  }
  for (const id of gates.scenes) {
    if (state.sceneResults?.[id] && state.sceneResults[id]!.outcome !== 'abandoned') continue;
    const d = world.scenes?.find((x) => x.id === id);
    if (!d) continue;
    const npc = d.npcId ? world.characters.find((c) => c.id === d.npcId) : undefined;
    const where = d.locationId ?? (npc ? npcLocationOf(state, npc) : undefined);
    const who = npc ? displayName(state, npc) : '';
    add({ kind: 'scene', id, gm: `장면 「${d.name}」${who ? ` — 상대 ${who}` : ''}${where ? ` · ${locName(world, where)}에서` : ''}`, open: `${who ? `${who}와(과) ` : ''}「${d.name}」${where ? ` (${locName(world, where)})` : ''}` });
  }
  walkPositive(stage.complete, (c) => {
    if ('at' in c && state.player.locationId !== c.at) add({ kind: 'go', id: c.at, gm: `${locName(world, c.at)}(으)로 간다`, open: `${locName(world, c.at)}(으)로 간다` });
    if ('knows' in c && !playerKnows(state, c.knows, c.min)) {
      const tellers = world.characters.filter((ch) => !state.deadNpcs.includes(ch.id) && [...world.beliefs, ...state.beliefs].some((b) => b.holder === ch.id && b.claim === c.knows && b.state !== 'mistaken'));
      const places = world.locations.filter((l) => l.discoveries?.some((d) => d.claim === c.knows));
      for (const t of tellers.slice(0, 2)) add({ kind: 'talk', id: t.id, gm: `${t.name}이(가) 아는 것을 듣는다 (${locName(world, npcLocationOf(state, t))})` });
      for (const p of places.slice(0, 2)) add({ kind: 'discover', id: p.id, gm: `${p.name}을(를) 조사해 알아낸다` });
    }
    if ('hasItem' in c && (state.inventory?.[c.hasItem] ?? 0) < (c.n ?? 1)) add({ kind: 'item', id: c.hasItem, gm: `${itemDef(world, c.hasItem)?.name ?? c.hasItem}을(를) 손에 넣는다`, open: `${itemDef(world, c.hasItem)?.name ?? c.hasItem}이(가) 필요하다` });
    if ('inParty' in c && !state.party[c.inParty]) { const n = world.characters.find((x) => x.id === c.inParty); if (n) add({ kind: 'companion', id: n.id, gm: `${n.name}을(를) 동료로 삼는다` }); }
  });
  return out;
}

export interface BriefQuest { quest: Quest; stage: QuestStage; index: number; via: Via[]; daysLeft?: number }
export interface StoryBrief {
  /** 지금 가장 앞에 있는 일: 기한이 급한 것 > 메인 > 나머지 */
  focus?: BriefQuest;
  quests: BriefQuest[];
  /** GM이 흐름에 따라 열 수 있는 장면 */
  offerScenes: SceneDef[];
  /** 버튼으로만 여는 장면 */
  buttonScenes: SceneDef[];
  pendingChoice?: { name: string; prompt: string };
}

export function storyBrief(world: WorldPackage, state: GameState): StoryBrief {
  const quests: BriefQuest[] = activeQuests(world, state).map((q) => {
    const started = state.quests[q.quest.id]?.startedAt;
    const daysLeft = q.quest.timeLimit && started !== undefined ? Math.max(0, Math.ceil(q.quest.timeLimit.days - (state.worldMinutes - started) / 1440)) : undefined;
    return { ...q, via: viaOf(world, state, q.stage), ...(daysLeft !== undefined ? { daysLeft } : {}) };
  });
  const rank = (q: BriefQuest) => (q.daysLeft !== undefined && q.daysLeft <= 2 ? 0 : q.quest.kind === 'main' ? 1 : 2);
  const focus = [...quests].sort((a, b) => rank(a) - rank(b))[0];
  const offer = offerableScenes(world, state);
  const open = availableScenes(world, state, { auto: false });
  const ch = pendingChoice(world, state);
  return {
    ...(focus ? { focus } : {}), quests,
    offerScenes: offer, buttonScenes: open.filter((d) => !offer.includes(d)),
    ...(ch ? { pendingChoice: { name: ch.name, prompt: ch.prompt } } : {}),
  };
}

/** GM 판단 AI: 맨 위에 두는 "지금 가장 앞에 있는 일" */
export function focusLines(world: WorldPackage, state: GameState, b: StoryBrief): string[] {
  const f = b.focus;
  if (!f) return ['## 지금 가장 앞에 있는 일', '(진행 중인 임무가 없다 — 인물의 목표·관계·장소의 수상한 점으로 이야기를 연다)', ''];
  return [
    '## 지금 가장 앞에 있는 일 (플레이어는 목표만 안다 — 연출 지시(beat)는 보통 이쪽으로 한 걸음)',
    `${f.quest.name} — 목표: ${f.stage.objective}${f.daysLeft !== undefined ? ` (기한 ${f.daysLeft}일 남음)` : ''}`,
    `힌트: ${f.stage.hint}`,
    ...(f.via.length ? ['이 단계가 풀리는 고비:', ...f.via.map((v) => `- ${v.gm}`)] : []),
    '',
  ];
}

/** GM 판단 AI: 지금 열 수 있는 장면 (start_scene으로 열 수 있는 것과 버튼으로만 여는 것) */
export function sceneLines(world: WorldPackage, state: GameState, b: StoryBrief): string[] {
  const line = (d: SceneDef) => {
    const npc = d.npcId ? world.characters.find((c) => c.id === d.npcId) : undefined;
    const trig = sceneEntry(d).trigger || (world.relationBeats ?? []).find((x) => x.scene === d.id && state.beats?.[x.id] && !state.beats[x.id]!.done)?.hint || '';
    return `- ${d.id}: ${d.name}${npc ? ` (상대 ${npc.name})` : ''} — ${d.description}${trig ? ` / 계기: ${trig}` : ''}`;
  };
  return [
    ...(b.offerScenes.length ? ['## 지금 열 수 있는 장면 (플레이어의 이번 행동이 이 장면으로 들어가는 것이면 start_scene에 ID — 결과는 장면에서 정해진다. 대신 정하지 않는다)', ...b.offerScenes.map(line), ''] : []),
    ...(b.buttonScenes.length ? ['## 버튼으로 여는 장면 (플레이어가 화면의 🎭 버튼으로 연다 — start_scene에 넣지 않는다. 그쪽으로 분위기를 이끌 수는 있다)', ...b.buttonScenes.map(line), ''] : []),
  ];
}

/** 서술 AI: 수첩의 목표만 (플레이어가 아는 것). 힌트·고비의 속사정은 주지 않는다 */
export function narratorBrief(b: StoryBrief): string[] {
  if (!b.quests.length) return [];
  return ['## 수첩의 목표 (플레이어가 아는 것 — 이야기가 향하는 곳. 억지로 끌고 가지 않는다)', ...b.quests.slice(0, 4).map((q) => `- ${q.quest.name}: ${q.stage.objective}${q.daysLeft !== undefined ? ` (기한 ${q.daysLeft}일 남음)` : ''}`), ''];
}

/** GM 안내: 수첩의 목표와 플레이어가 알 만한 고비, 열 수 있는 장면 */
export function guideBrief(b: StoryBrief): { quests: string[]; scenes: string[] } {
  return {
    quests: b.quests.map((q) => `- ${q.quest.name}: ${q.stage.objective}${q.daysLeft !== undefined ? ` (기한 ${q.daysLeft}일 남음)` : ''}${q.via.some((v) => v.open) ? ` → ${q.via.filter((v) => v.open).map((v) => v.open).join(' · ')}` : ''}`),
    scenes: [...b.offerScenes, ...b.buttonScenes].map((d) => `- ${d.id}: ${d.name} — ${d.description}`),
  };
}

/** NPC 연기 AI: 이 인물이 의뢰인·당사자인 임무에서 바라는 것 */
export function actorBrief(world: WorldPackage, state: GameState, npc: Character): string[] {
  const lines: string[] = [];
  for (const q of activeQuests(world, state)) {
    if (q.quest.giver === npc.id) {
      const asked = (state.npcMemory[npc.id] ?? []).length > 0 && (state.quests[q.quest.id]?.startedAt ?? 0) < state.worldMinutes;
      lines.push(`- 네가 이 사람에게 맡긴(맡기려는) 일 「${q.quest.name}」: 지금 바라는 것은 "${q.stage.objective}".${q.quest.motive ? ` 이유: ${q.quest.motive}` : ''} ${asked ? '이 일이 화제에 오르면 진척을 묻고, 네 성격대로 재촉하거나 돕는다.' : '아직 직접 부탁하지 않았다면 자연스러운 때에 네 입으로 먼저 꺼낸다.'}`);
    } else if (q.quest.target === npc.id) {
      lines.push(`- 너는 「${q.quest.name}」의 당사자다 (지금 상황: ${q.stage.objective}). 이 일에 네 안위가 걸려 있다.`);
    }
  }
  const mine = availableScenes(world, state, { auto: false }).filter((d) => d.npcId === npc.id);
  for (const d of mine) lines.push(`- 이 사람과 지금 벌어질 수 있는 일 「${d.name}」: ${d.description} — 상대가 그쪽으로 나오면 피하지 않고 맞선다 (결과는 여기서 정하지 않는다).`);
  return lines.length ? ['## 네가 이 낯선 이에게 바라는 것 (한 번 거절당하면 조르지 않는다)', ...lines, ''] : [];
}

/**
 * 이번에 엔진이 확정한 이야기 전환을 서술자에게 주는 글로 (서술 앞에 확정된 것).
 * 서술은 이 일들이 "일어나는 순간"을 담고, 전투·장면·결정은 그 문턱에서 멈춘다.
 */
export function transitionLines(world: WorldPackage, events: GameEvent[]): string[] {
  const out: string[] = [];
  const giver = (id: string) => { const g = world.quests?.find((q) => q.id === id)?.giver; return g ? world.characters.find((c) => c.id === g)?.name : undefined; };
  for (const e of events) {
    if (e.type === 'quest_started') { const g = giver(e.questId); out.push(`새 임무 (엔진 확정): 「${e.name}」 — 목표: ${e.objective}.${g ? ` 의뢰인은 ${g} — 이 자리에 있으면 그가 부탁하거나 일이 맡겨지는 순간을 서술에 담는다 (확정된 대사가 없으면 몸짓·상황으로).` : ' 플레이어가 이 일을 떠안게 되는 순간을 서술에 담는다.'}`); }
    else if (e.type === 'quest_advanced') out.push(`임무 진전 (엔진 확정): 「${e.name}」 — 다음 목표: ${e.objective}. 한 고비를 넘겼다는 것이 느껴지게 쓴다.`);
    else if (e.type === 'quest_completed') out.push(`임무 완료 (엔진 확정): 「${e.name}」 — 매듭지어지는 순간을 담는다.`);
    else if (e.type === 'quest_failed') out.push(`임무 실패 (엔진 확정): 「${e.name}」 — ${e.reason}. 놓친 것의 무게를 담는다.`);
    else if (e.type === 'quest_outcome') out.push(`임무의 결과 (엔진 확정): 「${e.questName}」 — ${e.name}${e.text ? `: ${e.text}` : ''}`);
    else if (e.type === 'chapter_completed') out.push(`이야기의 한 장이 끝났다 (엔진 확정): ${e.name}${e.next ? ` → 다음 장 「${e.next}」` : ''}. 국면이 바뀌는 느낌을 한 문장으로.`);
    else if (e.type === 'choice_offered') { const c = world.choices?.find((x) => x.id === e.choiceId); out.push(`결정의 순간 (엔진 확정): ${c?.prompt ?? e.name} — 선택지가 플레이어 화면에 뜬다. 서술은 그 갈림길 앞에서 멈춘다. 대신 고르지 않는다.`); }
    else if (e.type === 'scene_started') out.push(`장면 시작 (엔진 확정): 「${e.name}」${e.intro ? ` — ${e.intro}` : ''} 서술은 이 장면으로 들어가는 순간에서 멈춘다 (결과를 서술하지 않는다).`);
    else if (e.type === 'combat_started') { const enc = world.encounters?.find((x) => x.id === e.combat.encounterId); out.push(`전투 시작 (엔진 확정): ${enc?.name ?? '싸움'}${enc?.intro ? ` — ${enc.intro}` : ''} 서술은 적이 나타나 전투가 시작되는 순간에서 멈춘다 (결과를 서술하지 않는다).`); }
    else if (e.type === 'clock_reached' && e.omen) out.push(`징조 (엔진 확정): ${e.omen} — 분위기·소리·사람들의 반응으로 녹인다.`);
    else if (e.type === 'world_event' && !e.skipped && e.announce) out.push(`세상에 일어난 일 (엔진 확정): ${e.announce}`);
    else if (e.type === 'goal_ended' && e.announce) out.push(`소식 (엔진 확정): ${e.announce}`);
    else if (e.type === 'faction_acted' && e.news) out.push(`소식 (엔진 확정): ${e.news}`);
    else if (e.type === 'npc_approached') out.push(`(엔진 확정) ${e.text}`);
    else if (e.type === 'ending_reached') out.push(`결말에 이르렀다 (엔진 확정): ${e.name} — 이 서술은 결말 직전의 마지막 순간까지. 에필로그는 따로 쓴다.`);
  }
  return out;
}

/**
 * 전투·장면이 끝난 뒤 "이 결과로 바뀐 것" (끝날 때 엔진이 확정한 이벤트에서).
 * 서술이 결과의 여파와 다음 상황으로 이어지게 한다.
 */
export function aftermathLines(world: WorldPackage, events: GameEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === 'item_gained') out.push(`얻은 것: ${e.name}${e.n > 1 ? ` ×${e.n}` : ''} (${e.reason})`);
    else if (e.type === 'money_changed' && e.delta) out.push(`${e.delta > 0 ? '얻은' : '잃은'} 돈: ${Math.abs(e.delta)}${e.currency ? ` ${e.currency}` : ''} (${e.reason})`);
    else if (e.type === 'relationship_changed' && e.name) out.push(`${e.name}의 마음이 움직였다 (${e.reason})`);
    else if (e.type === 'relation_stage') out.push(`${e.name}와(과)의 사이: ${e.from} → ${e.to}`);
    else if (e.type === 'reputation_changed') out.push(`${e.name}의 평판 ${e.delta > 0 ? '상승' : '하락'} (${e.reason})`);
    else if (e.type === 'level_up' && e.who === 'player') out.push(`한층 강해졌다 (${e.sheet.level}레벨) — 숫자는 쓰지 않고 몸의 감각으로`);
    else if (e.type === 'companion_died') out.push(`${e.name}이(가) 숨을 거두었다`);
    else if (e.type === 'npc_killed') out.push(`${e.name}이(가) 죽었다`);
    else if (e.type === 'knowledge_revealed' && e.statement && e.belief.holder === 'player') out.push(`알게 된 것: ${e.statement}`);
    else if (e.type === 'moved') out.push(`자리가 옮겨졌다 → ${locName(world, e.to)}`);
    else if (e.type === 'rule_fired' && e.announce) out.push(e.announce);
  }
  return [...out, ...transitionLines(world, events.filter((e) => e.type !== 'combat_started' || !events.some((x) => x.type === 'combat_ended') || events.indexOf(e) > events.findIndex((x) => x.type === 'combat_ended')))];
}

/** 전투·장면 서술 공용 꼬리 (v0.85): 이 결과로 바뀐 것 + 이제 플레이어 앞에 놓인 것 */
export function aftermathBlock(world: WorldPackage, after: GameState, events: GameEvent[]): string {
  const changed = aftermathLines(world, events);
  const b = storyBrief(world, after);
  const next = [
    ...(after.combat ? ['곧바로 싸움이 이어진다 — 서술은 그 문턱에서 멈춘다'] : []),
    ...(after.scene ? ['곧바로 장면이 이어진다 — 서술은 그 문턱에서 멈춘다'] : []),
    ...(b.pendingChoice ? [`결정의 순간: ${b.pendingChoice.prompt} (대신 고르지 않는다)`] : []),
    ...b.quests.slice(0, 3).map((q) => `${q.quest.name}: ${q.stage.objective}`),
  ];
  return `## 이 결과로 바뀐 것 (엔진 확정 — 숫자 없이 장면으로 보여 준다)\n${changed.map((x) => `- ${x}`).join('\n') || '- (눈에 띄게 바뀐 것은 없다)'}\n\n## 이제 플레이어 앞에 놓인 것 (마지막 문단이 이쪽을 향한다)\n${next.map((x) => `- ${x}`).join('\n') || '- (정해진 것은 없다 — 이 자리에 남은 것에서 끝낸다)'}`;
}

/** 서술 4종(턴·전투·장면 끝·장면 차례)이 함께 지키는 규칙 */
export const NARRATION_CORE = `- 한국어 2인칭("당신은 …")으로 쓴다. 플레이어의 대사·생각·감정·다음 행동을 대신 쓰지 않는다.
- 엔진이 확정한 결과를 그대로 따른다. 결과를 바꾸거나 새 판정·새 사건·새 보상을 만들지 않는다.
- 숫자(주사위·수치·피해량·AC)는 쓰지 않는다. 높고 낮음은 몸짓과 분위기로 보여 준다.
- 직전 이야기에서 바로 이어 쓴다. 이미 소개한 장소·인물을 처음 보는 것처럼 다시 소개하지 않고, 지난 일을 다시 요약하지 않는다.`;

/** 지금 목표와 이어지는 명제·인물 (v0.89): 실마리가 이쪽부터 흘러나온다 */
export function focusTargets(world: WorldPackage, state: GameState, b: StoryBrief): { claims: string[]; npcs: string[] } {
  const claims = new Set<string>(); const npcs = new Set<string>();
  for (const q of b.quests) {
    walkPositive(q.stage.complete, (c) => { if ('knows' in c) claims.add(c.knows); if ('relationship' in c) npcs.add(c.relationship); if ('stage' in c) npcs.add(c.stage); if ('inParty' in c) npcs.add(c.inParty); });
    for (const id of [q.quest.truth, ...(q.quest.clues ?? [])]) if (id) claims.add(id);
    if (q.quest.giver) npcs.add(q.quest.giver);
    for (const v of q.via) if (v.kind === 'talk') npcs.add(v.id);
  }
  return { claims: [...claims], npcs: [...npcs] };
}
