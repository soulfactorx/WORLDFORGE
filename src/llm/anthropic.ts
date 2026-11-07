import Anthropic from '@anthropic-ai/sdk';
import { finishAttempt, traceAttempt } from '../debug/trace';
import { addUsage, type LlmClient, LlmJsonError, type LlmRequest, type LlmSettings, LlmRefusalError, LlmTruncatedError } from './types';

/** 입력 토큰 = 일반 + 캐시 쓰기 + 캐시 읽기 */
const usageIn = (u: { input_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined) =>
  u?.input_tokens === undefined ? undefined : u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Claude API 어댑터. 브라우저에서 사용자 본인의 API 키로 직접 호출한다(BYOK).
 * - dangerouslyAllowBrowser: 키가 사용자 기기에만 있으므로 허용.
 * - fallbacks: "default": 안전 분류기가 요청을 거절하면 서버가 적절한 모델로 재시도.
 */
export function createAnthropicClient(s: LlmSettings): LlmClient {
  const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });

  const base = (req: LlmRequest) => ({
    model: s.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user' as const, content: req.user }],
    betas: [FALLBACK_BETA],
    fallbacks: 'default' as const,
  });

  return {
    async stream(req, onText, signal) {
      const body = base(req);
      const at = traceAttempt(req.trace, 'Anthropic Messages API (stream) — beta.messages.stream', body);
      let msg;
      try {
        const stream = client.beta.messages.stream(body, { signal });
        stream.on('text', onText);
        msg = await stream.finalMessage();
      } catch (e) { finishAttempt(at, { error: String((e as Error)?.message ?? e) }); throw e; }
      const out = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      finishAttempt(at, { status: 'ok', meta: { id: msg.id, model: msg.model, stop_reason: msg.stop_reason, usage: msg.usage }, raw: out });
      addUsage(req.meter, usageIn(msg.usage), msg.usage?.output_tokens, { inChars: req.system.length + req.user.length, outChars: out.length });
      if (msg.stop_reason === 'refusal') throw new LlmRefusalError('모델이 이 요청을 거절했습니다.');
      return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    },
    async json<T>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal) {
      const body = { ...base(req), output_config: { effort: req.effort ?? 'low', format: { type: 'json_schema' as const, schema } } };
      const at = traceAttempt(req.trace, 'Anthropic Messages API — beta.messages.create', body);
      let msg;
      try { msg = await client.beta.messages.create(body, { signal }); } catch (e) { finishAttempt(at, { error: String((e as Error)?.message ?? e) }); throw e; }
      finishAttempt(at, { status: 'ok', meta: { id: msg.id, model: msg.model, stop_reason: msg.stop_reason, usage: msg.usage }, raw: msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('') });
      addUsage(req.meter, usageIn(msg.usage), msg.usage?.output_tokens, { inChars: req.system.length + req.user.length, outChars: 0 });
      if (msg.stop_reason === 'refusal') throw new LlmRefusalError('모델이 이 요청을 거절했습니다.');
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      if (msg.stop_reason === 'max_tokens') throw new LlmTruncatedError(text);
      try { return JSON.parse(text) as T; } catch (e) { throw new LlmJsonError(text, (e as Error).message); }
    },
  };
}
