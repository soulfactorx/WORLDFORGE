import { genreGuide } from '../../engine/genre';
import { genreOf } from '../../data/genres';
import { CLASSES } from '../../engine/character/rules';
import { companionClass } from '../../engine/classes';
import { monsterTable, monstersOfWorld } from '../../engine/combat/monsters';
import { validateWorld, type Issue } from '../../engine/package/validate';
import type { WorldPackage } from '../../engine/schema';
import type { LlmClient } from '../../llm/types';
import { assignStockImages } from './stock';
import { imageNeeds } from './imageNeeds';
import { generateScenes } from './scenes';
import { generateRules } from './rules';
import { generateSpine, spineOf } from './spine';
import { linkWarnings } from '../../engine/package/flow';
import { sceneEntry } from '../../engine/scene';
import { addScenario, scenarioDraftSchema, type ScenarioDraft, WORLD_DRAFT_SCHEMA, type WorldDraft, worldFromDraft } from './draft';

/**
 * AI 세계관 생성 보조 (설계서 5.3절).
 * 생성 결과는 "초안"이다. 제작자가 편집기에서 검토하고 저장(승인)해야 패키지가 된다.
 */

export type Size = 'small' | 'medium';
const SIZE_TEXT: Record<Size, string> = {
  small: '장소 3~4곳, 인물 3~4명, 진실 2~3개, 명제 5~8개',
  medium: '장소 5~7곳, 인물 5~7명, 진실 3~5개, 명제 8~14개',
};
const RATING_TEXT = { all: '전체 이용가 (폭력·공포 묘사 최소)', teen: '청소년 이용가 (적당한 긴장과 위험)', mature: '성인 이용가 (잔혹하고 노골적인 묘사 허용. 미성년자 관련 성적 내용·실존 인물 성적 묘사는 금지)' };

const WORLD_SYSTEM = `너는 1인칭 AI TRPG의 세계관 설계자다. 제작자의 요청을 바탕으로 플레이 가능한 세계관 초안을 만든다.
설계 원칙:
- 플레이어는 이 세계에 아무것도 모른 채 소환되어 깨어난다. 첫 장면(opening_scene)은 감각만 묘사하고 세계를 설명하지 않는다.
- 장소 묘사(description)는 그 자리에서 보고 듣고 냄새 맡을 수 있는 것만 쓴다. 역사나 비밀을 쓰지 않는다.
- truths는 세계의 실제 진실, claims는 누군가 믿거나 말할 수 있는 명제(거짓·부분적 진실 포함)다.
- 핵심 비밀은 소수의 인물만 secret 상태로 알고, 다른 인물은 소문(rumor)이나 잘못된 정보(mistaken)를 갖게 한다.
- 비밀 truth에는 protected_topic(내용을 드러내지 않는 이름표)과 subjects(관련 장소·인물 key)를 단다.
- 플레이어가 단서를 모을 수 있도록 discoveries(장소를 조사해 알아내는 명제)를 2개 이상 둔다.
- 모든 장소는 서로 이어져 있어야 하고, 시작 장소에서 갈 수 있어야 한다. connections는 장소 key만 쓴다.
- 동료로 영입할 만한 인물 1~2명에게 companion_class와 join_condition을 준다.
- 몇몇 인물은 시각에 따라 다른 곳에 있게 한다 (schedule, 예: 밤에는 여관·낮에는 시장). 세계가 살아 있게 느껴지도록.
- 세력(factions) 1~3개를 만들고 (activity: 며칠마다 들리는 그 세력의 움직임 소문) 인물의 faction에 소속을 단다 (소속 없는 인물도 있다).
- 인물 사이의 관계(relations)를 3개 이상 둔다: 가족·동지·라이벌·연인·스승·원수. 한 사람과 가까워지면 다른 사람이 등을 돌리는 긴장을 만든다.
- 사람이 사는 곳에는 상점(shops) 1~2개: 잡화점(물약·밧줄·횃불)이나 대장간(무기·갑옷) 등. 표준 아이템만 판다.
- 연애 상대가 될 수 있는 성인 인물에게만 romanceable: true. 미성년자(또는 그렇게 보이는 인물)는 절대 romanceable이 아니다.
- key는 영문 소문자 슬러그(예: old-mill), 이름과 내용은 한국어.
- 핵심 플롯 인물·장소는 improvisation을 none으로, 평범한 인물은 minor로.
- 실존 인물·실존 작품의 캐릭터나 고유 설정을 그대로 쓰지 않는다. 독창적으로 만든다.`;

const SCENARIO_SYSTEM = `너는 1인칭 AI TRPG의 시나리오 설계자다. 주어진 세계관 위에 임무·조우·이야기 플래그·결말을 설계한다.
설계 원칙:
- "이야기 뼈대"가 있으면 그것을 그대로 따른다: 장마다 그 고비에 필요한 장치를 만든다 (고비가 전투면 조우를, 장면이면 "이미 있는 장면"을, 결정이면 결정적 선택을, 발견이면 knows 조건을 그 단계의 완료 조건으로). 뼈대의 계기(lead_in)는 단계의 hint에, 실패하면 이어지는 길(on_failure)은 조우의 after_scene_failure·on_defeat_flag나 다른 완료 조건(any)으로 옮긴다.
- 메인 임무 1개(3~5단계)와 사이드 임무 1~2개. 각 단계의 objective는 플레이어용 목표, hint는 진행을 돕는 GM용 힌트다 (누가·어디서·무엇을 계기로 이 단계에 이르는가).
- 단계 완료 조건(complete)은 엔진이 판정할 수 있는 것만 쓴다: knows(명제 key), at(장소 key), cleared(조우 key), scene_done·scene_success(장면 key), in_party, relationship, flag, quest_done, level.
- 모든 조우는 이야기에 걸려 있어야 한다: 어느 임무 단계의 완료 조건(cleared)이거나, 어느 장면이 실패했을 때 번지는 싸움(after_scene_failure)이거나, 지면 서는 플래그(on_defeat_flag)가 있다. 임무 단계의 완료 조건이 된 조우는 그 단계가 진행 중일 때만 일어난다 (엔진이 잠근다).
- "이미 있는 장면"이 있으면 임무에 엮는다: 그 장면으로 풀리는 단계는 via_scene에 장면 key를 적고 완료 조건을 scene_success(또는 그 장면이 성공하면 세우는 플래그·알려 주는 명제)로 한다. 장면이 실패해도 이야기가 이어지게 any로 다른 길(전투 cleared·다른 단서)을 함께 둔다.
- 의뢰인(giver)이 있는 임무는 그 인물이 부탁하는 장면이 그려지게 한다: 시작 조건은 보통 그 인물이 있는 장소(at)나 그 인물이 알려 주는 명제(knows).
- 단서를 안다(knows)는 조건은 그 명제를 누군가 알거나 발견할 수 있어야 한다.
- 엔진이 알 수 없는 플레이어의 결정(예: 남겠다고 선언)은 flags로 선언하고 조건에 flag로 쓴다.
- 결말 1~2개. 결말 조건에는 보통 메인 임무 완료(quest_done)와 결정 플래그를 넣는다. 조건이 비면 즉시 결말이 나므로 절대 비우지 않는다.
- 조우의 적은 아래 "쓸 수 있는 적" 목록에서만 고른다. 1레벨 2인 일행 기준 경험치 합계: 쉬움 ≤100 · 보통 ≤150 · 어려움 ≤200. 초반 조우는 쉬움~보통, 보스(boss·leader)는 메인 임무 후반에. trigger는 GM용 발동 조건.
- 첫 단계 시작 조건이 없으면 { op: "all", items: [] } (항상 시작).
- 관계 사건(relation_beats) 1~3개: 인물과의 관계가 일정 단계에 이르면 열리는 그 인물의 결정적 장면 (비밀 고백·부탁·질투·배신 등). 조건은 보통 stage(인물 key + 단계)나 relationship(친밀 intimacy·원한 grudge 등). 장면이 끝났음을 나타내는 플래그를 flags에 선언하고 resolve_flag에 쓴다.
- 세력 평판 조건은 reputation(세력 key, 최소값).
- 임무마다 유형(type: 토벌 hunt·호위 escort·전달 deliver·수집 gather·조사 investigate·잠입 infiltrate·구출 rescue·방어 defend·협상 negotiate·생존 survive·결투 duel·관계 bond)과 의뢰인(giver)을 정한다. 호위·구출은 target(죽으면 실패), 급한 일만 time_limit_days.
- 동료 후보 인물의 개인 임무(bond) 하나: 관계가 깊어지면(stage 조건) 시작된다.
- 마을·도시가 있으면 의뢰판(board): 반복할 수 있는 토벌 의뢰 2~3개 (쓸 수 있는 적 목록에서, 쉬움~보통 난이도). 없으면 location "".
- 이야기 줄기(arc) 하나: 이번 이야기의 큰 흐름을 장 3~5개로 나눈다. 장의 complete는 임무 완료(quest_done)·지식·플래그 등으로, 메인 임무 단계와 겹쳐도 된다. 실패 조건(fail)은 필요할 때만.
- 진행 시계(clocks) 1~2개: 플레이어가 막지 않으면 다가오는 위협 (예: 습격 준비, 의식 완성). 칸 4~8, 하루 1칸 정도. 중간 칸에 징조(omens.text), 마지막 칸에 결과 플래그(set_flag, flags에 선언).
- 결정적 선택(choices) 1~2개: 이야기의 갈림길에서 플레이어가 고르는 고정 선택지 2~3개. 각 선택지는 플래그(set_flag, flags에 선언)를 세우고, 결말 조건이 그 플래그를 읽는다. when은 그 결정을 내릴 만한 지식·장면이 갖춰졌을 때.
- key는 영문 소문자 슬러그, 이름과 내용은 한국어.`;

export interface GenerateOptions {
  prompt: string;
  size: Size;
  contentRating: WorldPackage['manifest']['contentRating'];
  withScenario: boolean;
  /** 장면(협상·추격·대결…)까지 만들기 (v0.51, 기본 예) */
  withScenes?: boolean;
  /** 세계 규칙(행동 → 결과 · 연쇄 반응)까지 만들기 (v0.83, 기본 예) */
  withRules?: boolean;
  author?: string;
  /** 장르 프로필 ID (설계 v3 2장) */
  genre?: string;
  /** genre가 'custom'일 때 (v0.81) */
  genreCustom?: import('../../data/genres').CustomGenre;
}

export interface GenerateResult {
  world: WorldPackage;
  notes: string[];
  issues: Issue[];
}

/** 세계 요약: 시나리오 단계에 넘길 key 목록 */
export function worldSummary(w: WorldPackage): string {
  const short = (id: string) => id.replace(/^[a-z]+\//, '');
  return [
    `# ${w.manifest.name}`,
    '## 장소', ...w.locations.map((l) => `- ${short(l.id)}: ${l.name} — ${l.description.slice(0, 80)} (연결: ${l.connections.map(short).join(', ')})${l.discoveries?.length ? ` [발견 가능: ${l.discoveries.map((d) => short(d.claim)).join(', ')}]` : ''}`),
    '## 인물', ...w.characters.map((c) => `- ${short(c.id)}: ${c.name} @${short(c.locationId)} — ${c.personality.slice(0, 60)}${c.companion ? ` [동료 후보: ${companionClass(w, c.companion).role?.name ?? CLASSES[c.companion.classId]?.name}]` : ''}${c.romanceable ? ' [연인 가능]' : ''}${c.faction ? ` [소속: ${short(c.faction)}]` : ''}`),
    ...(w.factions?.length ? ['## 세력', ...w.factions.map((f) => `- ${short(f.id)}: ${f.name} — ${f.description.slice(0, 60)}`)] : []),
    ...(w.relations?.length ? ['## 인물 사이 관계', ...w.relations.map((r) => `- ${short(r.a)} ↔ ${short(r.b)}: ${r.kind}${r.note ? ` (${r.note})` : ''}`)] : []),
    '## 진실', ...w.facts.map((f) => `- ${short(f.id)} (비밀 ${f.secrecy}): ${f.statement}`),
    '## 명제', ...w.claims.map((c) => `- ${short(c.id)} (${c.truth}): ${c.statement} — 아는 사람: ${w.beliefs.filter((b) => b.claim === c.id).map((b) => `${short(b.holder)}(${b.state})`).join(', ') || '없음'}`),
    // v0.85: 뒤 단계가 앞 단계와 이을 수 있게 내용까지 준다 (지금까지는 임무 이름만 갔다)
    ...(spineOf(w) ? ['## 이야기 뼈대 (이것을 따른다)', spineOf(w)] : []),
    ...(w.scenes?.length ? ['## 이미 있는 장면', ...w.scenes.map((s) => `- ${short(s.id)}: ${s.name}${s.npcId ? ` (상대 ${short(s.npcId)})` : ''}${s.locationId ? ` @${short(s.locationId)}` : ''} — ${s.description.slice(0, 70)} [진입: ${sceneEntry(s).mode}] [끝: ${s.ends.map((e) => `${e.name}(${e.outcome}${(e.effects ?? []).flatMap((x) => ('setFlag' in x ? [` → 플래그 ${x.setFlag}`] : 'reveal' in x ? [` → 명제 ${short(x.reveal)}`] : 'startEncounter' in x ? [` → 전투 ${short(x.startEncounter)}`] : [])).join('')})`).join(', ')}]`)] : []),
    ...(w.encounters?.length ? ['## 이미 있는 조우', ...w.encounters.map((e) => `- ${short(e.id)}: ${e.name} @${short(e.locationId)} — ${e.trigger.slice(0, 60)}`)] : []),
    ...(w.flags?.length ? ['## 이미 있는 플래그', ...w.flags.map((f) => `- ${f.id}: ${f.when.slice(0, 60)}`)] : []),
    ...(w.quests?.length ? ['## 이미 있는 임무', ...w.quests.map((q) => `- ${short(q.id)}: ${q.name}${q.giver ? ` (의뢰인 ${short(q.giver)})` : ''} — ${q.stages.map((st, i) => `${i + 1}) ${st.objective.slice(0, 40)}`).join(' ')}`)] : []),
    ...(w.arcs?.length ? ['## 이미 있는 이야기 줄기 (새 줄기는 이 뒤에 이어진다 — 이전 이야기의 결말 이후를 다룬다)', ...w.arcs.map((a) => `- ${short(a.id)}: ${a.name} (${a.chapters.map((c) => c.name).join(' → ')})`)] : []),
    ...(w.clocks?.length ? ['## 이미 있는 진행 시계', ...w.clocks.map((c) => `- ${short(c.id)}: ${c.name} (${c.segments}칸)`)] : []),
  ].join('\n');
}

export async function generateWorld(
  llm: LlmClient, opts: GenerateOptions, onStage: (stage: string, at?: number, next?: number) => void, signal?: AbortSignal,
): Promise<GenerateResult> {
  // 진행률 (v0.46.3): 단계가 시작할 때 [지금 %, 이 단계가 끝날 때 %]
  const scenes = opts.withScenes !== false;
  const [worldEnd, scenEnd] = opts.withScenario ? (scenes ? [50, 74] : [55, 88]) : (scenes ? [70, 70] : [85, 85]);
  const scenesEnd = scenes ? 88 : scenEnd;
  onStage('세계 만드는 중 (장소·인물·비밀)…', 2, worldEnd);
  const draft = await llm.json<WorldDraft>({
    system: `${WORLD_SYSTEM}\n- ${genreGuide({ genre: { id: opts.genre ?? 'high_fantasy', ...(opts.genreCustom ? { custom: opts.genreCustom } : {}) } })}${genreOf(opts.genre, opts.genreCustom).combat === 'rare' ? '\n- 이 장르는 전투보다 관계·사교가 중심이다. 동료 후보보다 관계가 깊어질 수 있는 인물을 늘린다.' : ''}`,
    user: `## 제작자 요청\n${opts.prompt}\n\n## 장르\n${genreOf(opts.genre, opts.genreCustom).label}\n\n## 규모\n${SIZE_TEXT[opts.size]}\n\n## 콘텐츠 등급\n${RATING_TEXT[opts.contentRating]}`,
    maxTokens: 16000, effort: 'medium',
  }, WORLD_DRAFT_SCHEMA, signal);
  const id = `ai.${Date.now().toString(36)}`;
  let { world, notes } = worldFromDraft(draft, { id, contentRating: opts.contentRating, author: opts.author });
  const gp = genreOf(opts.genre, opts.genreCustom);
  world = { ...world, genre: { id: gp.id, ...(gp.id === 'custom' && opts.genreCustom ? { custom: opts.genreCustom } : {}) } };
  // 기본 이미지 고르기는 인물·장소만 있으면 된다 (v0.86): 뼈대·장면·임무·규칙을 만드는 동안 함께 진행하고 끝에서 합친다
  const stockP = assignStockImages(world, llm, signal);
  stockP.catch(() => {});
  // 이야기 뼈대 (v0.85): 임무·장면·조우를 따로 만들기 전에 서로 어떻게 이어지는지 먼저 정한다. 실패해도 계속한다
  // v0.92: 장면을 만들 때는 뼈대를 장면과 같은 호출에서 짠다 (AI 호출 한 번을 줄인다). 장면 없이 임무만 만들 때만 따로 부른다
  if (opts.withScenario && !scenes) {
    try {
      onStage('이야기 뼈대 짜는 중 (장·고비·실패하면 이어지는 길)…', worldEnd, worldEnd + 4);
      const sp = await generateSpine(llm, world, worldSummary(world), opts.prompt.slice(0, 1500), signal);
      world = sp.world;
      if (sp.spine) notes = [...notes, '이야기 뼈대를 GM 메모에 남겼습니다 (장·고비·실패하면 이어지는 길). 기본 탭의 GM 메모에서 고칠 수 있습니다.'];
    } catch (e) {
      if (signal?.aborted) throw e;
      notes = [...notes, `이야기 뼈대를 만들지 못해 뼈대 없이 진행합니다: ${(e as Error).message}`];
    }
  }
  // 장면 (v0.51) — v0.85부터 임무보다 먼저 만든다: 임무가 장면의 결과를 완료 조건으로 쓸 수 있게. 실패해도 세계는 살린다
  if (scenes) {
    try {
      const r = await generateScenes(llm, world, (st) => onStage(st, worldEnd + 4, opts.withScenario ? scenesEnd - (scenEnd - worldEnd) : scenesEnd), signal, opts.prompt.slice(0, 1500), 3, { withSpine: true });
      world = r.world;
      notes = [...notes, ...r.notes];
    } catch (e) {
      if (signal?.aborted) throw e;
      notes = [...notes, `장면 생성에 실패했습니다 (편집기 장면 탭에서 다시 만들 수 있습니다): ${(e as Error).message}`];
    }
  }
  if (opts.withScenario) {
    const r = await generateScenario(llm, world, (st) => onStage(st, scenes ? scenesEnd - (scenEnd - worldEnd) : worldEnd + 4, scenesEnd), signal);
    world = r.world;
    notes = [...notes, ...r.notes];
  }
  // 세계 규칙 (v0.83): 임무·플래그·장면이 생긴 뒤에 만들어 그것들과 잇는다
  if (opts.withRules !== false) {
    try {
      const r = await generateRules(llm, world, (st) => onStage(st, scenesEnd, scenesEnd + 4), signal, opts.prompt.slice(0, 1500));
      world = r.world;
      notes = [...notes, ...r.notes];
    } catch (e) {
      if (signal?.aborted) throw e;
      notes = [...notes, `세계 규칙 생성에 실패했습니다 (편집기 세계 규칙 탭에서 다시 만들 수 있습니다): ${(e as Error).message}`];
    }
  }
  onStage('기본 이미지 고르기를 마무리하는 중…', opts.withRules !== false ? scenesEnd + 4 : scenesEnd, 97);
  const st = await stockP;
  world = { ...world, assets: st.assets };
  if (st.added) notes = [...notes, `인물·장소 ${st.added}곳에 앱 내장 기본 이미지를 붙였습니다. 편집기 이미지 탭에서 바꿀 수 있습니다.`];
  { const nd = imageNeeds(world); if (nd.length) notes = [...notes, `진짜 이미지가 없는 인물·장소 ${nd.length}곳은 편집기 이미지 탭의 "부족한 이미지"에서 그림을 올리거나, 추천 파일 이름(예: ${nd[0]!.fileName})으로 내 기본 이미지에 올리면 자동으로 붙습니다.`]; }
  onStage('검사 중…', 98, 100);
  // 연결 검사 (v0.85): 곁가지·막다른 고비를 메모로 알린다 (편집기 "이야기 흐름"·"전체 점검"에서도 보인다)
  { const lw = linkWarnings(world); if (lw.length) notes = [...notes, `이야기 연결 점검 ${lw.length}건 — ${lw.slice(0, 4).join(' / ')}${lw.length > 4 ? ' …' : ''}`]; }
  return { world, notes, issues: validateWorld(world) };
}

export async function generateScenario(
  llm: LlmClient, world: WorldPackage, onStage: (stage: string, at?: number, next?: number) => void, signal?: AbortSignal, request = '',
  /** encounters: 조우만 만든다 (v0.79.4 — 점검에서 "조우 없음"을 고칠 때) */
  focus: 'all' | 'encounters' = 'all',
): Promise<{ world: WorldPackage; notes: string[] }> {
  onStage('세계 요약을 보내는 중…', 2, 5);
  onStage(focus === 'encounters' ? 'AI가 조우를 쓰는 중…' : 'AI가 임무·조우·결말을 쓰는 중…', 5, 90);
  const rare = genreOf(world.genre?.id, world.genre?.custom).combat === 'rare';
  const focusRule = focus === 'encounters'
    ? `\n- 이번 요청은 조우만이다: 조우를 2~3개 반드시 만든다. 장소(location)는 아래 장소 목록의 key를 그대로, 적(monster)은 "쓸 수 있는 적" 목록의 ID만. 임무·결말·플래그는 빈 배열로 둔다. "이미 있는 임무"의 단계나 "이미 있는 장면"과 이어지는 조우를 먼저 만든다 (장면이 실패하면 번지는 싸움은 after_scene_failure). on_defeat_flag는 ""로 둔다.${rare ? '\n- 전투가 드문 장르이므로 이 세계에 어울리는 현실적인 위기(불량배·소매치기·사나운 짐승 등)로 만든다.' : ''}`
    : rare ? '\n- 이 장르는 전투가 드물다: 조우는 0~1개, 임무는 관계·사교·조사 중심으로.' : '';
  const draft = await llm.json<ScenarioDraft>({
    system: `${SCENARIO_SYSTEM}\n- ${genreGuide(world)}${focusRule}`,
    user: `${worldSummary(world)}\n\n## 쓸 수 있는 적 (이 세계의 장르)\n${monstersOfWorld(world).map((m) => `- ${m.id}: ${m.name} · ${m.role} · 경험치 ${m.xp} · ${m.look}`).join('\n')}${request ? `\n\n## 제작자 요청\n${request}` : ''}`,
    maxTokens: 12000, effort: 'medium',
  }, scenarioDraftSchema(Object.keys(monsterTable(world))), signal);
  onStage('받은 초안을 세계에 맞춰 정리하고 검사하는 중…', 92, 99);
  const r = addScenario(world, focus === 'encounters' ? { ...draft, quests: [], endings: [], flags: [] } : draft);
  // 무엇이 실제로 더해졌는지 (v0.79.4): 뺀 것이 있으면 이유와 함께
  const added = (k: 'quests' | 'encounters' | 'endings' | 'flags') => (r.world[k]?.length ?? 0) - (world[k]?.length ?? 0);
  r.notes.unshift(`추가됨 — 임무 ${added('quests')} · 조우 ${added('encounters')} · 결말 ${added('endings')} · 플래그 ${added('flags')}`);
  if (focus === 'encounters' && added('encounters') === 0) r.notes.unshift('⚠ 조우가 하나도 추가되지 않았습니다. 아래 메모(장소·적이 맞지 않아 뺀 것)를 확인하고 다시 시도하거나, 조우 탭에서 직접 만들어 주세요.');
  onStage('완료', 100, 100);
  return r;
}
