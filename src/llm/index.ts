import { createAnthropicClient } from './anthropic';
import { createOpenAiCompatibleClient } from './openai-compatible';
import type { LlmClient, LlmSettings } from './types';
import { robust, type RobustOptions } from './robust';
import { type CallRecord, metered } from './metrics';

/** 재시도·잘린 응답 처리가 들어간 클라이언트 */
export function createLlmClient(s: LlmSettings, opts?: RobustOptions & { sink?: (r: CallRecord) => void }): LlmClient {
  // 계측은 바깥에서: 재시도까지 포함한 걸린 시간·토큰을 한 번의 요청으로 센다
  return metered(robust(s.provider === 'anthropic' ? createAnthropicClient(s) : createOpenAiCompatibleClient(s), opts), s.model, opts?.sink);
}

export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
