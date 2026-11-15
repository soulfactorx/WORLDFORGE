/**
 * 함정·퍼즐 기믹 (v0.129): 쉬운 양식(Gimmick) → 장면(SceneDef).
 * 장면 엔진이 그대로 돌리므로 플레이·서술·시험실·자동 플레이가 모두 같은 길을 쓴다.
 * 길 막기: 기믹이 가로막은 길은 그 기믹을 지나가기 전에는 갈 수 없다 (함정은 어떻게든 지나가면, 퍼즐은 풀어야).
 */
import type { Gimmick, SceneAction, SceneDef, SceneEnd, WorldPackage } from './schema';
import type { GameState } from './state/state';

export const GIMMICK_KINDS: [Gimmick['kind'], string, string][] = [
  ['trap', '함정', '숨은 함정 — 찾고, 해제하거나 피해 가거나, 걸리면 다친다'],
  ['riddle', '수수께끼·암호', '질문에 답을 적는다 — 기회는 몇 번뿐'],
  ['sequence', '순서 맞추기', '레버·문양·종을 올바른 순서로 — 틀리면 처음부터'],
  ['device', '장치·장애물', '여러 번 판정에 성공해야 — 봉인 풀기, 무너진 다리 건너기'],
];

const hashOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
/** 화면에 보일 순서 (정답 순서가 드러나지 않게, ID로 정해져 늘 같다) */
export function shuffledOrder(n: number, seed: string): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let h = hashOf(seed);
  for (let i = n - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; const j = h % (i + 1); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
  // 우연히 정답 순서 그대로면 한 칸 돌린다
  return n > 1 && idx.every((v, i) => v === i) ? [...idx.slice(1), idx[0]!] : idx;
}

const hintAction = (g: Gimmick): SceneAction[] => g.hint?.text?.trim() ? [{
  id: 'hint', name: '단서 떠올리기', text: '알고 있는 것을 떠올려 실마리를 찾는다', check: g.hint.check || 'skill:investigation', dc: g.hint.dc || 12, once: true,
  success: { addStates: ['hinted'], text: `💡 ${g.hint.text.trim()}` }, failure: { text: '떠오르는 것이 없다' },
}] : [];
const dmg = (g: Gimmick) => (g.damage?.trim() ? { damage: g.damage.trim() } : {});

/** 기믹 → 장면. base: 장면의 이름·ID·장소 등 (편집기에서 정한 것) */
export function gimmickScene(base: Pick<SceneDef, 'id' | 'name'> & Partial<SceneDef>, g: Gimmick): SceneDef {
  const ok: SceneEnd = { id: 'solved', name: '성공', when: { state: 'solved' }, outcome: 'success', text: g.onSuccess?.text?.trim() || '해냈다', ...(g.onSuccess?.effects?.length ? { effects: g.onSuccess.effects } : {}), rewards: g.onSuccess?.rewards ?? { xp: 'minor' } };
  const bad = (when: SceneEnd['when'], text: string): SceneEnd => ({ id: 'failed', name: '실패', when, outcome: 'failure', text: g.onFail?.text?.trim() || text, ...(g.onFail?.effects?.length ? { effects: g.onFail.effects } : {}) });
  const common = {
    ...base, gimmick: g, description: base.description || g.intro, intro: g.intro,
    entry: g.kind === 'trap' ? { mode: 'auto' as const } : { mode: 'offer' as const, trigger: `플레이어가 ${base.name}을(를) 살피거나 건드리거나 풀려고 하면` },
    narration: base.narration ?? 'end' as const,
  };
  switch (g.kind) {
    case 'trap': {
      const sprung = g.sprung?.trim() || '함정이 작동했다!';
      return {
        // 장면에는 수치가 하나 있어야 한다 — 함정은 보이지 않는 긴장 수치 하나
        ...common, gauges: [{ id: 'tension', name: '긴장', start: 0, min: 0, max: 1, visible: false }],
        states: [{ id: 'spotted', name: '함정을 찾음', edge: 1 }, { id: 'disarmed', name: '해제함' }, { id: 'passed', name: '지나감' }, { id: 'sprung', name: '걸림' }],
        actions: [
          { id: 'look', name: '살펴보기', text: '발밑과 주변을 꼼꼼히 살핀다', check: 'skill:perception', dc: g.findDc || 13, once: true,
            success: { addStates: ['spotted'], text: `🔍 ${g.reveal?.trim() || '함정을 찾았다'}` }, failure: { text: '이상한 점을 찾지 못했다' } },
          { id: 'disarm', name: '해제하기', text: '찾아낸 함정을 조심스럽게 무력화한다', check: g.disarm?.check || 'skill:sleight_of_hand', dc: g.disarm?.dc || 13, requires: { state: 'spotted' },
            success: { addStates: ['disarmed'], text: '함정을 해제했다' }, failure: { addStates: ['sprung'], ...dmg(g), text: sprung } },
          { id: 'avoid', name: '조심해서 지나가기', text: '위험한 곳을 피해 몸을 놀린다', check: g.avoid?.check || 'skill:acrobatics', dc: g.avoid?.dc || 12,
            success: { addStates: ['passed'], text: '무사히 지나갔다' }, failure: { addStates: ['sprung'], ...dmg(g), text: sprung } },
          { id: 'rush', name: '그냥 지나가기', text: '신경 쓰지 않고 걸어간다', success: { addStates: ['sprung'], ...dmg(g), text: sprung } },
        ],
        ends: [
          { ...ok, id: 'disarmed', name: '해제', when: { state: 'disarmed' }, text: g.onSuccess?.text?.trim() || '함정을 해제했다' },
          { id: 'passed', name: '피해 감', when: { state: 'passed' }, outcome: 'neutral', text: '함정을 피해 지나갔다' },
          { ...bad({ state: 'sprung' }, sprung), id: 'sprung', name: '걸림' },
        ],
      };
    }
    case 'riddle': {
      const tries = Math.max(1, g.tries || 3);
      return {
        ...common, intro: `${g.intro}${g.question?.trim() ? `\n\n「${g.question.trim()}」` : ''}`,
        gauges: [{ id: 'tries', name: '남은 기회', start: tries, min: 0, max: tries }],
        states: [{ id: 'solved', name: '풀림' }, { id: 'hinted', name: '실마리', edge: 1 }],
        actions: [
          { id: 'answer', name: '답하기', text: '답을 적는다', answer: (g.answers ?? []).filter((a) => a.trim()),
            success: { addStates: ['solved'], text: '맞았다!' }, failure: { gauges: { tries: -1 }, ...dmg(g), text: '틀렸다.' } },
          ...hintAction(g),
        ],
        ends: [ok, bad({ gauge: 'tries', lte: 0 }, '기회를 모두 잃었다')],
      };
    }
    case 'sequence': {
      const steps = (g.steps ?? []).filter((x) => x.trim());
      const miss = Math.max(1, g.mistakes || 3);
      return {
        ...common,
        gauges: [{ id: 'step', name: '맞춘 순서', start: 0, min: 0, max: Math.max(1, steps.length) }, { id: 'miss', name: '실수', start: 0, min: 0, max: miss }],
        states: [{ id: 'solved', name: '풀림' }, { id: 'hinted', name: '실마리', edge: 1 }],
        actions: [
          ...shuffledOrder(steps.length, base.id).map((i): SceneAction => ({
            id: `step${i}`, name: steps[i]!, text: `${steps[i]}을(를) 누른다·움직인다`, rightWhen: { gauge: 'step', gte: i, lte: i },
            success: { gauges: { step: 1 }, ...(i === steps.length - 1 ? { addStates: ['solved'] } : {}), text: `${steps[i]} — 딸깍, 맞물리는 소리` },
            failure: { gauges: { step: -99, miss: 1 }, ...dmg(g), text: `${steps[i]} — 덜컹, 처음으로 돌아갔다` },
          })),
          ...hintAction(g),
        ],
        ends: [ok, bad({ gauge: 'miss', gte: miss }, '장치가 잠겨 버렸다')],
      };
    }
    case 'device': {
      const goal = Math.max(1, g.goal || 3);
      const miss = Math.max(1, g.mistakes || 3);
      const act = (id: string, c: NonNullable<Gimmick['check']>, fallback: string): SceneAction => ({
        id, name: c.label?.trim() || fallback, check: c.check || 'skill:athletics', dc: c.dc || 13,
        success: { gauges: { prog: 1 } }, great: { gauges: { prog: 2 }, text: '한 번에 크게 나아갔다' }, failure: { gauges: { fail: 1 }, ...dmg(g), text: '실패했다' },
      });
      return {
        ...common,
        gauges: [{ id: 'prog', name: '진행', start: 0, min: 0, max: goal }, { id: 'fail', name: '실패', start: 0, min: 0, max: miss }],
        states: [{ id: 'hinted', name: '실마리', edge: 1 }],
        actions: [act('try', g.check ?? { check: 'skill:athletics', dc: 13 }, '시도하기'), ...(g.alt?.check ? [act('alt', g.alt, '다른 방법')] : []), ...hintAction(g)],
        ends: [{ ...ok, when: { gauge: 'prog', gte: goal } }, bad({ gauge: 'fail', gte: miss }, '더는 버틸 수 없었다')],
      };
    }
  }
}

/** 답 비교: 띄어쓰기·문장부호·대소문자 무시 */
export const normAnswer = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const answerMatches = (answers: string[], input: string) => { const n = normAnswer(input); return !!n && answers.some((a) => normAnswer(a) === n); };

/** 이 기믹을 지나갔나: 함정은 어떻게든 끝났으면(그만두기 제외), 퍼즐은 성공해야 */
export function gimmickPassed(def: SceneDef, s: GameState): boolean {
  const r = s.sceneResults?.[def.id];
  if (!r || r.outcome === 'abandoned') return false;
  return def.gimmick?.kind === 'trap' ? true : r.outcome === 'success';
}

/** 지금 있는 곳에서 to로 가는 길을 막고 있는 기믹 */
export function blockingGimmick(world: WorldPackage, s: GameState, to: string): SceneDef | undefined {
  return (world.scenes ?? []).find((d) => d.gimmick?.guards === to && d.locationId === s.player.locationId && !gimmickPassed(d, s));
}
