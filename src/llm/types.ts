import type { DebugCall } from '../debug/trace';
/**
 * 제공자 독립 LLM 인터페이스. 게임 엔진은 이 인터페이스만 알고, 특정 업체를 모른다.
 */
export type ProviderKind = 'anthropic' | 'openai-compatible';

export interface LlmSettings {
  provider: ProviderKind;
  apiKey: string;
  model: string;
  /** openai-compatible 전용: OpenAI, OpenRouter, Ollama(http://localhost:11434/v1), LM Studio 등 */
  baseUrl?: string;
  /** 역할별 모델 (설계 v3 R9): 비우면 model. 같은 제공자·키를 쓴다 — v0.101부터는 roles를 쓰고, 이 칸은 예전 설정을 읽을 때만 */
  roleModels?: Partial<Record<RoleGroup, string>>;
  /**
   * 여러 제공자 (v0.101). 있으면 위의 provider·apiKey·model·baseUrl은 "기본 제공자"의 사본이다
   * (이 칸을 모르는 코드가 그대로 돌게). 없으면 위의 것 하나가 유일한 제공자다.
   */
  providers?: LlmProvider[];
  /** 기본 제공자의 id (providers가 있을 때) */
  defaultProvider?: string;
  /** 역할 묶음별로 쓸 제공자와 모델. 제공자를 비우면 기본 제공자, 모델을 비우면 그 제공자의 기본 모델 */
  roles?: Partial<Record<RoleGroup, RoleRoute>>;
}

/** 등록한 제공자 하나: 연결 정보와 그 제공자의 기본 모델 */
export interface LlmProvider {
  id: string;
  /** 목록에 보이는 이름 (예: "OpenRouter", "집 Ollama") */
  name: string;
  provider: ProviderKind;
  apiKey: string;
  baseUrl?: string;
  model: string;
}
export interface RoleRoute { provider?: string; model?: string }

/**
 * 모델을 따로 고를 수 있는 역할 묶음.
 * v0.101: 세계 만들기를 셋으로 나눴다 — 설계(build) · 인물 찾기(extract) · 번역·이미지(bulk).
 * extract·bulk를 정하지 않으면 build의 설정을 따른다 (예전 설정이 그대로 돌게).
 */
export type RoleGroup = 'judge' | 'actor' | 'narrator' | 'build' | 'extract' | 'bulk';
export const ROLE_GROUPS: RoleGroup[] = ['judge', 'actor', 'narrator', 'build', 'extract', 'bulk'];
export const ROLE_GROUP_LABEL: Record<RoleGroup, string> = {
  judge: 'GM 판단·기록 (정확 모드에서 매 턴 1번 · 기록은 8턴마다)',
  actor: 'NPC 연기 (말하는 인물마다)',
  narrator: '서술·전투 서술 (기본 턴 방식에서는 판단·대사·선택지까지 매 턴 1번)',
  build: '세계 설계 (세계 구조·뼈대·장면·임무·규칙·점검)',
  extract: '인물 찾기 (카드 로어북에서 인물 뽑기)',
  bulk: '번역·이미지 분류 (단순하고 양이 많은 일)',
};
/**
 * 묶음마다 어떤 모델이 어울리는지 (설정 화면 안내). 특정 모델의 성능·가격은 자주 바뀌므로 급으로 적는다.
 * work: 이 묶음이 하는 일과 양 · fit: 어울리는 모델 · caution: 조심할 점
 */
export const ROLE_GROUP_HINT: Record<RoleGroup, { work: string; fit: string; caution: string }> = {
  judge: {
    work: '플레이어의 행동을 읽고 판정·이동·장면 전환을 정한다(GM 판단, 매 턴 1번). 8턴마다 그동안의 일을 기록·요약한다. 짧은 구조화 응답(JSON). 선택지는 서술 끝에 함께 나오고, 서술이 선택지를 빠뜨렸을 때만 여기서 따로 만든다.',
    fit: '빠르고 지시를 정확히 따르는 중간급~작은 모델. Claude라면 Sonnet이나 Haiku. 다른 제공자라면 mini·flash급 중 JSON을 잘 지키는 것.',
    caution: '너무 작은 모델은 규칙을 어긴 제안(없는 인물·장소, 과한 판정)을 자주 내 엔진이 거부한다. 바꾼 뒤 아래 "품질 점검"에서 거부 횟수를 본다. 매 턴 기다리는 시간에 바로 드러나므로 생각(추론)이 긴 모델은 맞지 않는다.',
  },
  actor: {
    work: '그 턴에 말하는 인물마다 한 번씩, 인물의 성격·말투·아는 것 안에서 대사와 반응을 정한다. 짧은 응답.',
    fit: '중간급 모델이면 충분한 경우가 많다. Claude라면 Sonnet이나 Haiku. 인물이 많은 세계에서는 호출 수가 늘어 빠른 모델이 유리하다.',
    caution: '작은 모델은 인물마다 말투가 비슷해지거나, 인물이 모르는 것을 말하게 될 수 있다.',
  },
  narrator: {
    work: '기본 턴 방식(AI 한 번)에서는 이 묶음 하나가 매 턴 판단·인물의 대사·서술·선택지를 모두 쓴다 (서술은 스트리밍, 끝에 엔진이 읽는 JSON). 정확 모드에서는 서술과 선택지만.',
    fit: '가장 글을 잘 쓰고 지시를 잘 지키는 모델을 여기에. Claude라면 Opus나 Sonnet. 비용을 한 곳에만 쓴다면 이 묶음이다. 작은 모델은 서술 끝의 JSON을 자주 깨뜨린다 — 그러면 소리·화면 설정의 「턴 방식」을 정확 모드로.',
    caution: '생각(추론)이 긴 모델은 첫 글자가 나오기까지 오래 걸린다. 한국어 문장이 어색한 모델은 여기서 가장 티가 난다.',
  },
  build: {
    work: '세계 구조·이야기 뼈대·장면·임무·세계 규칙·점검을 만든다. 세계 하나에 6~8번, 한 번의 출력이 길고 서로 맞물려야 한다.',
    fit: '가장 똑똑한 모델을 권한다. 생각(추론)하는 모델이 잘 맞는다. Claude라면 Opus나 Sonnet. 호출 수가 적어 좋은 모델을 써도 전체 비용에서 차지하는 몫이 작다.',
    caution: '작은 모델은 임무·장면·조우가 서로 이어지지 않거나, 없는 인물·장소를 가리켜 검사에서 버려지는 것이 늘어난다. 출력 한도가 작은 모델(8k 이하)은 응답이 잘린다.',
  },
  extract: {
    work: '카드의 긴 로어북을 읽고 이름 있는 인물의 외형·성격·말투를 뽑아 정리한다. 큰 카드는 10번 안팎, 출력이 길다.',
    fit: '긴 글을 빠르게 읽고 정리하는 중간급 모델. Claude라면 Sonnet이나 Haiku. 출력 속도(초당 토큰)가 빠른 것이 체감에 크다.',
    caution: '작은 모델은 인물을 빠뜨리거나 조직·장소를 인물로 잘못 뽑는다. 비우면 세계 설계의 설정을 따른다.',
  },
  bulk: {
    work: '설정 글 번역, 이미지 파일 이름 분류, 기본 이미지 고르기. 큰 카드는 100번을 넘는다. 하나하나는 단순하다.',
    fit: '가장 작고 싸고 빠른 모델. Claude라면 Haiku. 다른 제공자라면 mini·flash급이나 로컬 모델도 된다. OpenRouter에서는 이 묶음을 생각(추론)을 끄고 요청한다.',
    caution: '번역 품질은 모델의 한국어 실력을 그대로 따른다 — 한국어가 약한 모델이면 번역만 어색해진다. 비우면 세계 설계의 설정을 따른다.',
  },
};

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** 추론 노력 (지원하는 제공자만). 기본: 구조화 응답은 low */
  /** minimal (v0.97): 번역·분류처럼 생각이 필요 없는 일 — OpenRouter에서는 생각을 끈다 (v0.98). 받지 못하는 제공자에서는 low로 보낸다 */
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  /** 진행 표시용 이름 (예: "번역 3/8") — 재시도 안내에 어느 단계인지 보여 준다 */
  label?: string;
  /** 사용량 기록 (계측 래퍼가 넣고, 어댑터가 채운다. 재시도한 호출도 모두 더한다) */
  meter?: Meter;
  /** 디버그 기록 (v0.57): 어댑터가 실제 요청·응답을 붙인다 */
  trace?: DebugCall;
}

export interface Meter {
  input: number;
  output: number;
  /** 실제 API 호출 수 (재시도 포함) */
  calls: number;
  /** 제공자가 사용량을 주지 않아 글자 수로 추정했다 */
  estimated?: boolean;
  /** 진단 (v0.93): 동시 요청 제한 때문에 차례를 기다린 시간(ms) · 실제로 보낸 출력 한도 (재시도 중 마지막 값) */
  waitMs?: number;
  sentMaxTokens?: number;
  /** 진단 (v0.95): 출력 토큰 가운데 생각(추론)에 쓴 몫 — 제공자가 알려 줄 때만 */
  reasoning?: number;
  /** 진단 (v0.99): 다시 보낸 까닭 (길이 제한 · JSON 오류 · HTTP 429 …) */
  retryNotes?: string[];
}

/** 사용량이 없으면 글자 수로 추정 (한국어 기준 대략 2글자당 1토큰) */
export function addUsage(m: Meter | undefined, input: number | undefined, output: number | undefined, fallback: { inChars: number; outChars: number }, reasoning?: number) {
  if (!m) return;
  m.calls++;
  if (reasoning) m.reasoning = (m.reasoning ?? 0) + reasoning;
  if (input === undefined || output === undefined) {
    m.estimated = true;
    m.input += Math.ceil(fallback.inChars / 2);
    m.output += Math.ceil(fallback.outChars / 2);
  } else {
    m.input += input;
    m.output += output;
  }
}

export interface LlmClient {
  /** 스트리밍 텍스트 생성. onText로 부분 텍스트를 받고, 완성된 전체 텍스트를 반환한다. */
  stream(req: LlmRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<string>;
  /** JSON 스키마에 맞는 구조화 응답. */
  json<T>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
}

export class LlmRefusalError extends Error {}

/** 응답이 길이 제한에 걸려 잘렸다 (text = 잘린 응답) */
export class LlmTruncatedError extends Error {
  constructor(readonly text: string) { super('AI 응답이 길이 제한에 걸려 잘렸습니다.'); }
}
/** JSON으로 해석할 수 없는 응답 */
export class LlmJsonError extends Error {
  constructor(readonly text: string, cause: string) { super(`AI 응답을 JSON으로 해석할 수 없습니다: ${cause}`); }
}
/** 서버·네트워크 오류 (status 0 = 네트워크) */
export class LlmHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
