import { CLASSES } from '../../engine/character/rules';
import { MONSTERS } from '../../engine/combat/monsters';
import { validateWorld, type Issue } from '../../engine/package/validate';
import type { WorldPackage } from '../../engine/schema';
import type { LlmClient } from '../../llm/types';
import { assignStockImages } from './stock';
import { imageNeeds } from './imageNeeds';
import { addScenario, SCENARIO_DRAFT_SCHEMA, type ScenarioDraft, WORLD_DRAFT_SCHEMA, type WorldDraft, worldFromDraft } from './draft';

/**
 * AI 세계관 생성 보조 (설계서 5.3절).
 * 생성 결과는 "초안"이다. 제작자가 편집기에서 검토하고 저장(승인)해야 패키지가 된다.
 */

export type Size = 'small' | 'medium';
const SIZE_TEXT: Record<Size, string> = {
  small: '장소 3~4곳, 인물 3~4명, 진실 2~3개, 명제 5~8개',
  medium: '장소 5~7곳, 인물 5~7명, 진실 3~5개, 명제 8~14개',
};
const RATING_TEXT = { all: '전체 이용가 (폭력·공포 묘사 최소)', teen: '청소년 이용가 (적당한 긴장과 위험)', mature: '성인 이용가 (어두운 주제 허용, 노골적 성적 묘사는 금지)' };

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
- key는 영문 소문자 슬러그(예: old-mill), 이름과 내용은 한국어.
- 핵심 플롯 인물·장소는 improvisation을 none으로, 평범한 인물은 minor로.
- 실존 인물·실존 작품의 캐릭터나 고유 설정을 그대로 쓰지 않는다. 독창적으로 만든다.`;

const SCENARIO_SYSTEM = `너는 1인칭 AI TRPG의 시나리오 설계자다. 주어진 세계관 위에 임무·조우·이야기 플래그·결말을 설계한다.
설계 원칙:
- 메인 임무 1개(3~5단계)와 사이드 임무 1~2개. 각 단계의 objective는 플레이어용 목표, hint는 진행을 돕는 GM용 힌트다.
- 단계 완료 조건(complete)은 엔진이 판정할 수 있는 것만 쓴다: knows(명제 key), at(장소 key), cleared(조우 key), in_party, relationship, flag, quest_done, level.
- 단서를 안다(knows)는 조건은 그 명제를 누군가 알거나 발견할 수 있어야 한다.
- 엔진이 알 수 없는 플레이어의 결정(예: 남겠다고 선언)은 flags로 선언하고 조건에 flag로 쓴다.
- 결말 1~2개. 결말 조건에는 보통 메인 임무 완료(quest_done)와 결정 플래그를 넣는다. 조건이 비면 즉시 결말이 나므로 절대 비우지 않는다.
- 조우는 이 몬스터만 쓴다: ${Object.values(MONSTERS).map((m) => `${m.id}(${m.name})`).join(', ')}. 1레벨 일행 기준으로 적 1~3마리. trigger는 GM용 발동 조건.
- 첫 단계 시작 조건이 없으면 { op: "all", items: [] } (항상 시작).
- key는 영문 소문자 슬러그, 이름과 내용은 한국어.`;

export interface GenerateOptions {
  prompt: string;
  size: Size;
  contentRating: WorldPackage['manifest']['contentRating'];
  withScenario: boolean;
  author?: string;
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
    '## 인물', ...w.characters.map((c) => `- ${short(c.id)}: ${c.name} @${short(c.locationId)} — ${c.personality.slice(0, 60)}${c.companion ? ` [동료 후보: ${CLASSES[c.companion.classId]?.name}]` : ''}`),
    '## 진실', ...w.facts.map((f) => `- ${short(f.id)} (비밀 ${f.secrecy}): ${f.statement}`),
    '## 명제', ...w.claims.map((c) => `- ${short(c.id)} (${c.truth}): ${c.statement} — 아는 사람: ${w.beliefs.filter((b) => b.claim === c.id).map((b) => `${short(b.holder)}(${b.state})`).join(', ') || '없음'}`),
    ...(w.quests?.length ? ['## 이미 있는 임무', ...w.quests.map((q) => `- ${short(q.id)}: ${q.name}`)] : []),
  ].join('\n');
}

export async function generateWorld(
  llm: LlmClient, opts: GenerateOptions, onStage: (stage: string) => void, signal?: AbortSignal,
): Promise<GenerateResult> {
  onStage('세계 만드는 중 (장소·인물·비밀)…');
  const draft = await llm.json<WorldDraft>({
    system: WORLD_SYSTEM,
    user: `## 제작자 요청\n${opts.prompt}\n\n## 규모\n${SIZE_TEXT[opts.size]}\n\n## 콘텐츠 등급\n${RATING_TEXT[opts.contentRating]}`,
    maxTokens: 16000, effort: 'medium',
  }, WORLD_DRAFT_SCHEMA, signal);
  const id = `ai.${Date.now().toString(36)}`;
  let { world, notes } = worldFromDraft(draft, { id, contentRating: opts.contentRating, author: opts.author });
  if (opts.withScenario) {
    const r = await generateScenario(llm, world, onStage, signal);
    world = r.world;
    notes = [...notes, ...r.notes];
  }
  onStage('인물·장소에 기본 이미지 고르는 중…');
  const st = await assignStockImages(world, llm, signal);
  world = { ...world, assets: st.assets };
  if (st.added) notes = [...notes, `인물·장소 ${st.added}곳에 앱 내장 기본 이미지를 붙였습니다. 편집기 이미지 탭에서 바꿀 수 있습니다.`];
  { const nd = imageNeeds(world); if (nd.length) notes = [...notes, `진짜 이미지가 없는 인물·장소 ${nd.length}곳은 편집기 이미지 탭의 "부족한 이미지"에서 그림을 올리거나, 추천 파일 이름(예: ${nd[0]!.fileName})으로 내 기본 이미지에 올리면 자동으로 붙습니다.`]; }
  onStage('검사 중…');
  return { world, notes, issues: validateWorld(world) };
}

export async function generateScenario(
  llm: LlmClient, world: WorldPackage, onStage: (stage: string) => void, signal?: AbortSignal, request = '',
): Promise<{ world: WorldPackage; notes: string[] }> {
  onStage('이야기 만드는 중 (임무·조우·결말)…');
  const draft = await llm.json<ScenarioDraft>({
    system: SCENARIO_SYSTEM,
    user: `${worldSummary(world)}${request ? `\n\n## 제작자 요청\n${request}` : ''}`,
    maxTokens: 12000, effort: 'medium',
  }, SCENARIO_DRAFT_SCHEMA, signal);
  return addScenario(world, draft);
}
