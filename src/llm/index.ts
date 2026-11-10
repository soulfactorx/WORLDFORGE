import { createAnthropicClient } from './anthropic';
import { createOpenAiCompatibleClient } from './openai-compatible';
import type { LlmClient, LlmRequest, LlmSettings, Meter, RoleGroup } from './types';
import { finishCall, traceCall } from '../debug/trace';
import { robust, type RobustOptions } from './robust';
import { createLimiter, limited } from './limiter';
import { holdAwake } from './visibility';
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
export function createLlmClient(s: LlmSettings, opts?: RobustOptions & { sink?: (r: CallRecord) => void; /** 동시에 보내는 요청 수 (기본 6) */ maxConcurrent?: number }): LlmClient {
  const cache = new Map<string, LlmClient>();
  // 동시 요청 제한 (v0.92): 모델이 달라도 같은 제공자·키이므로 함께 센다
  const limiter = createLimiter(opts?.maxConcurrent ?? 6);
  // 계측은 바깥에서: 재시도까지 포함한 걸린 시간·토큰을 한 번의 요청으로 센다
  const forModel = (model: string) => {
    let c = cache.get(model);
    if (!c) {
      const ms = { ...s, model };
      const raw = limited(s.provider === 'anthropic' ? createAnthropicClient(ms) : createOpenAiCompatibleClient(ms), limiter);
      c = traced(metered(robust(raw, { ...opts, onRateLimit: () => { limiter.penalize(); opts?.onRateLimit?.(); }, learnKey: `${s.provider}:${s.baseUrl ?? ''}:${model}` }), model, opts?.sink), s, model);
      cache.set(model, c);
    }
    return c;
  };
  // AI 처리 중에는 화면이 꺼지지 않게 (모바일, v0.79.8)
  return {
    stream: (req, onText, signal) => holdAwake(() => forModel(modelFor(s, req.system)).stream(req, onText, signal)),
    json: (req, schema, signal) => holdAwake(() => forModel(modelFor(s, req.system)).json(req, schema, signal)),
  };
}

export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

/** 디버그 기록 래퍼 (v0.57): 디버그 모드일 때만 요청·응답 전체를 남긴다 */
function traced(llm: LlmClient, s: LlmSettings, model: string): LlmClient {
  const wrap = async <T>(kind: 'stream' | 'json', req: LlmRequest, schema: Record<string, unknown> | undefined, run: (r: LlmRequest) => Promise<T>): Promise<T> => {
    const call = traceCall({
      role: roleOf(req.system), model, provider: s.provider === 'anthropic' ? 'anthropic' : `openai-compatible (${s.baseUrl ?? 'https://api.openai.com/v1'})`, kind,
      ...(req.label ? { label: req.label } : {}),
      params: { maxTokens: req.maxTokens, ...(kind === 'json' ? { effort: req.effort ?? 'low (기본)' } : req.effort ? { effort: req.effort } : {}) },
      system: req.system, user: req.user, ...(schema ? { schema } : {}),
    });
    if (!call) return run(req);
    const meter: Meter = req.meter ?? { input: 0, output: 0, calls: 0 };
    const t0 = performance.now();
    try {
      const out = await run({ ...req, meter, trace: call });
      finishCall(call, { ...(kind === 'stream' ? { output: out as string } : { parsed: out }), ms: Math.round(performance.now() - t0), usage: meter });
      return out;
    } catch (e) {
      finishCall(call, { error: String((e as Error)?.message ?? e), ms: Math.round(performance.now() - t0), usage: meter });
      throw e;
    }
  };
  return {
    stream: (req, onText, signal) => wrap('stream', req, undefined, (r) => llm.stream(r, onText, signal)),
    json: <T,>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal) => wrap<T>('json', req, schema, (r) => llm.json<T>(r, schema, signal)),
  };
}
