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
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** 추론 노력 (지원하는 제공자만). 기본: 구조화 응답은 low */
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmClient {
  /** 스트리밍 텍스트 생성. onText로 부분 텍스트를 받고, 완성된 전체 텍스트를 반환한다. */
  stream(req: LlmRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<string>;
  /** JSON 스키마에 맞는 구조화 응답. */
  json<T>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
}

export class LlmRefusalError extends Error {}
