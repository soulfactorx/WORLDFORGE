import Anthropic from '@anthropic-ai/sdk';
import { type LlmClient, LlmJsonError, type LlmRequest, type LlmSettings, LlmRefusalError, LlmTruncatedError } from './types';

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
      const stream = client.beta.messages.stream(base(req), { signal });
      stream.on('text', onText);
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new LlmRefusalError('모델이 이 요청을 거절했습니다.');
      return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    },
    async json<T>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal) {
      const msg = await client.beta.messages.create(
        { ...base(req), output_config: { effort: req.effort ?? 'low', format: { type: 'json_schema', schema } } },
        { signal },
      );
      if (msg.stop_reason === 'refusal') throw new LlmRefusalError('모델이 이 요청을 거절했습니다.');
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      if (msg.stop_reason === 'max_tokens') throw new LlmTruncatedError(text);
      try { return JSON.parse(text) as T; } catch (e) { throw new LlmJsonError(text, (e as Error).message); }
    },
  };
}
