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
  /** 역할별 모델 (설계 v3 R9): 비우면 model. 같은 제공자·키를 쓴다 */
  roleModels?: Partial<Record<RoleGroup, string>>;
}

/** 모델을 따로 고를 수 있는 역할 묶음 */
export type RoleGroup = 'judge' | 'actor' | 'narrator' | 'build';
export const ROLE_GROUP_LABEL: Record<RoleGroup, string> = {
  judge: 'GM 판단·안내·기록 (구조화 응답, 매 턴 3번)',
  actor: 'NPC 연기 (말하는 인물마다)',
  narrator: '서술·전투 서술 (플레이어가 읽는 글)',
  build: '세계·카드 만들기·번역·이미지 고르기',
};

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** 추론 노력 (지원하는 제공자만). 기본: 구조화 응답은 low */
  effort?: 'low' | 'medium' | 'high';
  /** 진행 표시용 이름 (예: "번역 3/8") — 재시도 안내에 어느 단계인지 보여 준다 */
  label?: string;
  /** 사용량 기록 (계측 래퍼가 넣고, 어댑터가 채운다. 재시도한 호출도 모두 더한다) */
  meter?: Meter;
}

export interface Meter {
  input: number;
  output: number;
  /** 실제 API 호출 수 (재시도 포함) */
  calls: number;
  /** 제공자가 사용량을 주지 않아 글자 수로 추정했다 */
  estimated?: boolean;
}

/** 사용량이 없으면 글자 수로 추정 (한국어 기준 대략 2글자당 1토큰) */
export function addUsage(m: Meter | undefined, input: number | undefined, output: number | undefined, fallback: { inChars: number; outChars: number }) {
  if (!m) return;
  m.calls++;
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
