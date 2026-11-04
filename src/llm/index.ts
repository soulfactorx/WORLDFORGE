import { createAnthropicClient } from './anthropic';
import { createOpenAiCompatibleClient } from './openai-compatible';
import type { LlmClient, LlmSettings } from './types';
import { robust, type RobustOptions } from './robust';

/** 재시도·잘린 응답 처리가 들어간 클라이언트 */
export function createLlmClient(s: LlmSettings, opts?: RobustOptions): LlmClient {
  return robust(s.provider === 'anthropic' ? createAnthropicClient(s) : createOpenAiCompatibleClient(s), opts);
}

export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
