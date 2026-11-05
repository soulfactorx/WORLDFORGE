import { createAnthropicClient } from './anthropic';
import { createOpenAiCompatibleClient } from './openai-compatible';
import type { LlmClient, LlmSettings, RoleGroup } from './types';
import { robust, type RobustOptions } from './robust';
import { type CallRecord, metered, type Role, roleOf } from './metrics';

/** 역할 → 모델 묶음 */
export function groupOf(role: Role): RoleGroup {
  if (role === 'director' || role === 'guide' || role === 'recorder') return 'judge';
  if (role === 'actor') return 'actor';
  if (role === 'narrator' || role === 'combat') return 'narrator';
  return 'build';
}

/** 이 요청에 쓸 모델 */
export function modelFor(s: LlmSettings, system: string): string {
  return s.roleModels?.[groupOf(roleOf(system))]?.trim() || s.model;
}

/** 재시도·잘린 응답 처리·계측이 들어간 클라이언트. 역할별 모델이 있으면 요청마다 골라 쓴다 */
export function createLlmClient(s: LlmSettings, opts?: RobustOptions & { sink?: (r: CallRecord) => void }): LlmClient {
  const cache = new Map<string, LlmClient>();
  // 계측은 바깥에서: 재시도까지 포함한 걸린 시간·토큰을 한 번의 요청으로 센다
  const forModel = (model: string) => {
    let c = cache.get(model);
    if (!c) {
      const ms = { ...s, model };
      c = metered(robust(s.provider === 'anthropic' ? createAnthropicClient(ms) : createOpenAiCompatibleClient(ms), opts), model, opts?.sink);
      cache.set(model, c);
    }
    return c;
  };
  return {
    stream: (req, onText, signal) => forModel(modelFor(s, req.system)).stream(req, onText, signal),
    json: (req, schema, signal) => forModel(modelFor(s, req.system)).json(req, schema, signal),
  };
}

export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
