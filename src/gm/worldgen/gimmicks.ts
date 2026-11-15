/**
 * 함정·퍼즐 자동 생성 (v0.130): 세계에 어울리는 함정·수수께끼·순서 맞추기·장치를 AI가 짓고, 엔진이 검사해 장면으로 만든다.
 * AI가 낸 값은 그대로 믿지 않는다 — 기술 ID·난이도·피해 표기·장소·막는 길을 모두 다시 확인한다.
 */
import { genreOf } from '../../data/genres';
import { SKILL_IDS } from '../../engine/character/rules';
import { gimmickScene } from '../../engine/gimmick';
import { genreGuide } from '../../engine/genre';
import type { Gimmick, SceneDef, StoryEffect, WorldPackage } from '../../engine/schema';
import type { LlmClient } from '../../llm/types';
import { type SummaryOptions, worldSummary } from './generate';

export interface GimmickDraft {
  kind: string; name: string; location: string; guards: string; intro: string;
  /** 함정 */ reveal: string; sprung: string; find_dc: number; disarm_skill: string; avoid_skill: string;
  /** 수수께끼 */ question: string; answers: string[];
  /** 순서 */ steps: string[];
  /** 장치 */ skill: string; label: string; alt_skill: string; alt_label: string; goal: number;
  dc: number; damage: string; hint_skill: string; hint_text: string; success_text: string; fail_text: string; reward: string;
}

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['gimmicks'],
  properties: {
    gimmicks: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'name', 'location', 'guards', 'intro', 'reveal', 'sprung', 'find_dc', 'disarm_skill', 'avoid_skill', 'question', 'answers', 'steps', 'skill', 'label', 'alt_skill', 'alt_label', 'goal', 'dc', 'damage', 'hint_skill', 'hint_text', 'success_text', 'fail_text', 'reward'],
        properties: {
          kind: { type: 'string', enum: ['trap', 'riddle', 'sequence', 'device'] },
          name: str, location: { type: 'string', description: '장소 ID (목록에 있는 것)' }, guards: { type: 'string', description: '이 기믹이 막는 길: 그 장소와 이어진 장소 ID, 막지 않으면 ""' },
          intro: { type: 'string', description: '플레이어가 처음 보는 것 1~2문장. 함정이면 함정이라고 말하지 않고 낌새만' },
          reveal: { type: 'string', description: '함정: 찾았을 때 드러나는 정체. 아니면 ""' }, sprung: { type: 'string', description: '함정: 걸렸을 때. 아니면 ""' },
          find_dc: int, disarm_skill: { type: 'string', description: '함정 해제 기술 ID' }, avoid_skill: { type: 'string', description: '함정 피하기 기술 ID' },
          question: { type: 'string', description: '수수께끼: 문제. 아니면 ""' }, answers: { type: 'array', items: str, description: '수수께끼: 정답과 같은 뜻의 다른 답 1~4개 (짧은 낱말)' },
          steps: { type: 'array', items: str, description: '순서 맞추기: 올바른 순서대로 3~5개 (짧은 이름)' },
          skill: { type: 'string', description: '장치: 주된 판정 기술 ID' }, label: { type: 'string', description: '장치: 주된 방법 버튼 이름' },
          alt_skill: { type: 'string', description: '장치: 다른 방법 기술 ID 또는 ""' }, alt_label: str, goal: { type: 'integer', description: '장치: 필요한 성공 수 2~4' },
          dc: { type: 'integer', description: '주된 판정·해제 난이도 10~16' }, damage: { type: 'string', description: '실패·걸렸을 때 피해 주사위 (예: "1d6", "2d6") 또는 ""' },
          hint_skill: { type: 'string', description: '단서 떠올리기 기술 ID 또는 ""' }, hint_text: { type: 'string', description: '단서 — 답·순서를 직접 말하지 않고 실마리만' },
          success_text: str, fail_text: str, reward: { type: 'string', description: '성공 보상: 아이템 ID 또는 명제 ID (목록에 있는 것) 또는 ""' },
        },
      },
    },
  },
} as const;

const SYSTEM = `너는 텍스트 RPG의 시나리오 설계자다. 이 세계의 장소에 어울리는 함정·퍼즐 기믹을 설계한다.
- 세계관·장르·장소의 분위기에 맞는 소재로 (던전의 압력판, 궁궐의 비밀 장치, 연구소의 보안 잠금 …). 뻔한 것보다 그 세계라서 가능한 것.
- 종류: trap(숨은 함정) · riddle(수수께끼·암호 — 답이 짧은 낱말, 세계의 이야기·설정에서 풀 수 있게) · sequence(순서 맞추기 — 순서의 실마리가 장소나 이야기에 있게) · device(여러 번 판정해야 하는 장치·장애물).
- 여러 개를 만들면 종류를 섞는다. 이야기 속 비밀·장소와 이어지면 좋다 (막는 길이 그 너머의 장소로).
- 난이도는 10~16. 피해는 가볍게 (1d4~2d6). 단서는 답을 말하지 않는다.
- 기술 ID는 다음 중에서만: ${SKILL_IDS.join(', ')}.
- 해당 없는 칸은 ""·[]·0. 이름·글은 한국어.`;

const skillOr = (s: string, fallback: string) => (SKILL_IDS.includes(s as never) ? `skill:${s}` : fallback);
const clampDc = (n: number, fb: number) => (Number.isFinite(n) && n > 0 ? Math.max(8, Math.min(20, Math.round(n))) : fb);
const DICE = /^\s*\d{0,2}d\d{1,2}\s*([+-]\s*\d{1,2})?\s*$/i;
const short = (id: string) => id.replace(/^[a-z]+\//, '');

/** 초안 하나 → 기믹 장면 (못 쓰면 null과 까닭) */
export function gimmickFromDraft(world: WorldPackage, d: GimmickDraft, id: string): { scene: SceneDef | null; note?: string } {
  const findLoc = (key: string) => world.locations.find((l) => l.id === key || short(l.id) === key || l.name === key || (key && l.name.includes(key)));
  const loc = findLoc(String(d.location ?? '').trim());
  if (!loc) return { scene: null, note: `기믹 "${d.name}": 없는 장소 "${d.location}"라 뺐습니다.` };
  const kind = (['trap', 'riddle', 'sequence', 'device'] as const).find((k) => k === d.kind);
  if (!kind) return { scene: null, note: `기믹 "${d.name}": 알 수 없는 종류라 뺐습니다.` };
  const to = d.guards ? findLoc(String(d.guards).trim()) : undefined;
  const guards = to && loc.connections.includes(to.id) ? to.id : undefined;
  const dc = clampDc(d.dc, 13);
  const damage = DICE.test(d.damage ?? '') ? d.damage.replace(/\s+/g, '') : undefined;
  const hint = d.hint_text?.trim() ? { check: skillOr(d.hint_skill, 'skill:investigation'), dc: Math.max(8, dc - 2), text: d.hint_text.trim() } : undefined;
  const reward = String(d.reward ?? '').trim();
  const fx: StoryEffect[] = (world.items ?? []).some((i) => i.id === reward) ? [{ giveItem: reward }] : world.claims.some((c) => c.id === reward || short(c.id) === reward) ? [{ reveal: world.claims.find((c) => c.id === reward || short(c.id) === reward)!.id, state: 'confirmed' }] : [];
  const g: Gimmick = {
    kind, intro: d.intro?.trim() || `${loc.name}에 무언가가 있다.`,
    ...(guards ? { guards } : {}), ...(damage ? { damage } : {}), ...(hint && kind !== 'trap' ? { hint } : {}),
    onSuccess: { ...(d.success_text?.trim() ? { text: d.success_text.trim() } : {}), ...(fx.length ? { effects: fx } : {}), rewards: { xp: 'minor' } },
    ...(d.fail_text?.trim() ? { onFail: { text: d.fail_text.trim() } } : {}),
  };
  if (kind === 'trap') Object.assign(g, { findDc: clampDc(d.find_dc, 13), reveal: d.reveal?.trim() || '함정이다', sprung: d.sprung?.trim() || '함정이 작동했다!', disarm: { check: skillOr(d.disarm_skill, 'skill:sleight_of_hand'), dc }, avoid: { check: skillOr(d.avoid_skill, 'skill:acrobatics'), dc: Math.max(8, dc - 1) } });
  if (kind === 'riddle') {
    const answers = (d.answers ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, 6);
    if (!d.question?.trim() || !answers.length) return { scene: null, note: `수수께끼 "${d.name}": 문제나 정답이 없어 뺐습니다.` };
    Object.assign(g, { question: d.question.trim(), answers, tries: 3 });
  }
  if (kind === 'sequence') {
    const steps = [...new Set((d.steps ?? []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 6);
    if (steps.length < 2) return { scene: null, note: `순서 맞추기 "${d.name}": 순서가 둘보다 적어 뺐습니다.` };
    Object.assign(g, { steps, mistakes: 3 });
  }
  if (kind === 'device') Object.assign(g, {
    check: { check: skillOr(d.skill, 'skill:athletics'), dc, ...(d.label?.trim() ? { label: d.label.trim() } : {}) },
    ...(SKILL_IDS.includes(d.alt_skill as never) ? { alt: { check: `skill:${d.alt_skill}`, dc: dc + 2, ...(d.alt_label?.trim() ? { label: d.alt_label.trim() } : {}) } } : {}),
    goal: Math.max(2, Math.min(4, Math.round(d.goal || 3))), mistakes: 3,
  });
  return { scene: gimmickScene({ id, name: d.name?.trim() || '기믹', locationId: loc.id }, g) };
}

/** 이 세계에 맞는 개수 (전투가 드문 장르는 적게) */
export const gimmickCount = (world: WorldPackage) => (genreOf(world.genre?.id, world.genre?.custom).combat === 'rare' ? 1 : 3);

export async function generateGimmicks(
  llm: LlmClient, world: WorldPackage, onStage: (stage: string, at?: number, next?: number) => void, signal?: AbortSignal,
  request = '', count = gimmickCount(world), sum: SummaryOptions = {},
): Promise<{ world: WorldPackage; notes: string[] }> {
  onStage('AI가 함정·퍼즐을 짓는 중…', 5, 90);
  const existing = (world.scenes ?? []).filter((s) => s.gimmick);
  const r = await llm.json<{ gimmicks: GimmickDraft[] }>({
    system: `${SYSTEM}\n- ${genreGuide(world)}`,
    user: `${worldSummary(world, sum)}\n\n## 장소와 이어진 곳 (막는 길은 여기서 고른다)\n${world.locations.map((l) => `- ${l.id} ${l.name} → ${l.connections.join(', ') || '(없음)'}`).join('\n')}${(world.items ?? []).length ? `\n\n## 보상으로 줄 수 있는 아이템\n${(world.items ?? []).slice(0, 30).map((i) => `- ${i.id}: ${i.name}`).join('\n')}` : ''}${existing.length ? `\n\n## 이미 있는 기믹 (겹치지 않게)\n${existing.map((s) => `- ${s.name} (${s.gimmick!.kind}) @${s.locationId}`).join('\n')}` : ''}\n\n## 만들 개수\n${count}개${request.trim() ? `\n\n## 제작자 요청\n${request.trim()}` : ''}`,
    maxTokens: 5000, effort: 'medium', label: '함정·퍼즐',
  }, SCHEMA, signal);
  onStage('받은 기믹을 검사하는 중…', 92, 99);
  const taken = new Set((world.scenes ?? []).map((s) => s.id));
  const scenes: SceneDef[] = [];
  const notes: string[] = [];
  for (const d of (r?.gimmicks ?? []).slice(0, Math.max(1, count + 1))) {
    let n = 1, id = '';
    do id = `scene/gimmick-${String(d.kind || 'g').replace(/[^a-z]/g, '') || 'g'}-${n++}`; while (taken.has(id));
    const out = gimmickFromDraft(world, d, id);
    if (out.note) notes.push(out.note);
    if (out.scene) { taken.add(id); scenes.push(out.scene); }
  }
  onStage('완료', 100, 100);
  const next = scenes.length ? { ...world, scenes: [...(world.scenes ?? []), ...scenes] } : world;
  return { world: next, notes: [scenes.length ? `함정·퍼즐 ${scenes.length}개를 만들었습니다: ${scenes.map((s) => `${s.name}(${({ trap: '함정', riddle: '수수께끼', sequence: '순서', device: '장치' } as const)[s.gimmick!.kind]})`).join(', ')}. 편집기 「함정·퍼즐」 탭에서 다듬을 수 있습니다.` : '함정·퍼즐을 만들지 못했습니다. 편집기 「함정·퍼즐」 탭에서 다시 시도할 수 있습니다.', ...notes] };
}

/** 따로 만든 기믹을 세계에 합친다 (다른 단계와 동시에 만들었을 때) */
export function mergeGimmicks(world: WorldPackage, made: WorldPackage): WorldPackage {
  const have = new Set((world.scenes ?? []).map((s) => s.id));
  const add = (made.scenes ?? []).filter((s) => s.gimmick && !have.has(s.id));
  return add.length ? { ...world, scenes: [...(world.scenes ?? []), ...add] } : world;
}
