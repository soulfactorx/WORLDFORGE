import { finishAttempt, traceAttempt } from '../debug/trace';
import { addUsage, type LlmClient, LlmHttpError, LlmJsonError, type LlmRequest, type LlmSettings, LlmTruncatedError } from './types';

/**
 * OpenAI 호환 Chat Completions 엔드포인트 어댑터 (OpenAI, OpenRouter, Ollama, LM Studio 등).
 * 로컬 모델은 브라우저 요청(CORS)을 허용하도록 설정해야 한다. 예: OLLAMA_ORIGINS=*
 */
export function createOpenAiCompatibleClient(s: LlmSettings): LlmClient {
  const url = `${(s.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
  const messages = (req: LlmRequest) => [
    { role: 'system', content: req.system },
    { role: 'user', content: req.user },
  ];

  return {
    async stream(req, onText, signal) {
      const body = { model: s.model, max_tokens: req.maxTokens, stream: true, messages: messages(req) };
      const at = traceAttempt(req.trace, `POST ${url}`, body);
      let res: Response;
      try { res = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(body) }); } catch (e) { finishAttempt(at, { error: String((e as Error)?.message ?? e) }); throw e; }
      if (!res.ok || !res.body) { const t = (await res.text()).slice(0, 2000); finishAttempt(at, { status: res.status, raw: t, error: `HTTP ${res.status}` }); throw new LlmHttpError(res.status, `LLM 요청 실패 (${res.status}): ${t.slice(0, 500)}`); }
      let finish: unknown;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '', full = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, '').trim();
          if (!data || data === '[DONE]' || !line.startsWith('data:')) continue;
          const chunk = JSON.parse(data);
          if (chunk.usage) usage = chunk.usage;
          if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason;
          const delta = chunk.choices?.[0]?.delta?.content as string | undefined;
          if (delta) { full += delta; onText(delta); }
        }
      }
      addUsage(req.meter, usage?.prompt_tokens, usage?.completion_tokens, { inChars: req.system.length + req.user.length, outChars: full.length });
      finishAttempt(at, { status: res.status, meta: { finish_reason: finish, usage }, raw: full });
      return full;
    },
    async json<T>(req: LlmRequest, schema: Record<string, unknown>, signal?: AbortSignal) {
      // 모든 호환 서버가 json_schema를 지원하지는 않으므로 프롬프트로 스키마를 알리고 json_object 모드를 요청한다.
      const reqBody = {
        model: s.model, max_tokens: req.maxTokens, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${req.system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다:\n${JSON.stringify(schema)}` },
          { role: 'user', content: req.user },
        ],
      };
      const at = traceAttempt(req.trace, `POST ${url}`, reqBody);
      let res: Response;
      try { res = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(reqBody) }); } catch (e) { finishAttempt(at, { error: String((e as Error)?.message ?? e) }); throw e; }
      if (!res.ok) { const t = (await res.text()).slice(0, 2000); finishAttempt(at, { status: res.status, raw: t, error: `HTTP ${res.status}` }); throw new LlmHttpError(res.status, `LLM 요청 실패 (${res.status}): ${t.slice(0, 500)}`); }
      const body = await res.json();
      const text: string = body.choices?.[0]?.message?.content ?? '';
      finishAttempt(at, { status: res.status, meta: { id: body.id, model: body.model, finish_reason: body.choices?.[0]?.finish_reason, usage: body.usage }, raw: text });
      addUsage(req.meter, body.usage?.prompt_tokens, body.usage?.completion_tokens, { inChars: req.system.length + req.user.length + JSON.stringify(schema).length, outChars: text.length });
      const start = text.indexOf('{');
      if (body.choices?.[0]?.finish_reason === 'length') throw new LlmTruncatedError(start >= 0 ? text.slice(start) : text);
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new LlmJsonError(text, 'JSON 객체가 없습니다');
      try { return JSON.parse(match[0]) as T; } catch (e) { throw new LlmJsonError(start >= 0 ? text.slice(start) : text, (e as Error).message); }
    },
  };
}
