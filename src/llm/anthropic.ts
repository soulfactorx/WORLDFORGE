import Anthropic from '@anthropic-ai/sdk';
import { finishAttempt, traceAttempt } from '../debug/trace';
import { addUsage, type LlmClient, LlmJsonError, type LlmRequest, type LlmSettings, LlmRefusalError, LlmTruncatedError } from './types';

/** 입력 토큰 = 일반 + 캐시 쓰기 + 캐시 읽기 */
const usageIn = (u: { input_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined) =>
  u?.input_tokens === undefined ? undefined : u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** 구조화 출력이 받지 못한 스키마 (너무 크거나 지원하지 않는 형식) */
const tooLarge = new WeakSet<object>();

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
      const effort = !req.effort || req.effort === 'minimal' ? 'low' as const : req.effort;
      // 구조화 출력(json_schema)은 스키마가 크면 "compiled grammar is too large"(400)로 거절된다 (장면·임무 초안이 그렇다).
      // 그런 스키마는 형식 강제 없이, 스키마를 프롬프트에 적어 JSON으로 받는다 — 한 번 거절된 스키마는 기억해 다음부터 바로 그렇게 보낸다 (v0.102)
      const run = async (loose: boolean) => {
        const body = loose
          ? { ...base(req), system: `${req.system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다 (설명·코드 울타리 없이 { 로 시작해 } 로 끝낸다):\n${JSON.stringify(schema)}`, output_config: { effort } }
          : { ...base(req), output_config: { effort, format: { type: 'json_schema' as const, schema } } };
        const at = traceAttempt(req.trace, `Anthropic Messages API — beta.messages.create${loose ? ' (스키마를 프롬프트로)' : ''}`, body);
        let msg;
        try { msg = await client.beta.messages.create(body, { signal }); } catch (e) { finishAttempt(at, { error: String((e as Error)?.message ?? e) }); throw e; }
        const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        finishAttempt(at, { status: 'ok', meta: { id: msg.id, model: msg.model, stop_reason: msg.stop_reason, usage: msg.usage }, raw: text });
        addUsage(req.meter, usageIn(msg.usage), msg.usage?.output_tokens, { inChars: req.system.length + req.user.length, outChars: 0 });
        if (msg.stop_reason === 'refusal') throw new LlmRefusalError('모델이 이 요청을 거절했습니다.');
        const start = text.indexOf('{');
        if (msg.stop_reason === 'max_tokens') throw new LlmTruncatedError(loose && start >= 0 ? text.slice(start) : text);
        if (!loose) { try { return JSON.parse(text) as T; } catch (e) { throw new LlmJsonError(text, (e as Error).message); } }
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new LlmJsonError(text, 'JSON 객체가 없습니다');
        try { return JSON.parse(match[0]) as T; } catch (e) { throw new LlmJsonError(start >= 0 ? text.slice(start) : text, (e as Error).message); }
      };
      if (tooLarge.has(schema)) return run(true);
      try { return await run(false); } catch (e) {
        if (!(e instanceof Anthropic.BadRequestError) || !/grammar|schema/i.test(e.message)) throw e;
        tooLarge.add(schema);
        return run(true);
      }
    },
  };
}
