import { createAnthropicClient } from './anthropic';
import { createOpenAiCompatibleClient } from './openai-compatible';
import type { LlmClient, LlmSettings } from './types';

export function createLlmClient(s: LlmSettings): LlmClient {
  return s.provider === 'anthropic' ? createAnthropicClient(s) : createOpenAiCompatibleClient(s);
}

export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
