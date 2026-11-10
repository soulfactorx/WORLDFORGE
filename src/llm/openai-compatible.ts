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
  // v0.95: OpenRouter는 생각(추론) 깊이를 받는다. 생각하는 모델은 생각 토큰이 출력의 대부분이라 (번역 한 묶음에 답 1.5k·생각 7k)
  // 깊이를 알리지 않으면 모든 호출이 모델 기본 깊이로 길게 생각한다. Claude 쪽과 같은 값(기본 low)을 보낸다.
  // 다른 호환 서버는 모르는 칸을 거절할 수 있어 보내지 않는다.
  const openRouter = /(^|\/\/|\.)openrouter\.ai(\/|:|$)/i.test(s.baseUrl ?? '');
  // minimal을 거절(400)하는 모델이면 그 뒤로는 low로 보낸다
  let minimalOk = true;
  const reasoning = (req: LlmRequest) => (openRouter ? { reasoning: { effort: req.effort === 'minimal' && !minimalOk ? 'low' : req.effort ?? 'low' } } : {});
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
      const build = () => ({
        model: s.model, max_tokens: req.maxTokens, response_format: { type: 'json_object' }, ...reasoning(req),
        messages: [
          { role: 'system', content: `${req.system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다:\n${JSON.stringify(schema)}` },
          { role: 'user', content: req.user },
        ],
      });
      let reqBody = build();
      let at = traceAttempt(req.trace, `POST ${url}`, reqBody);
      let res: Response;
      try { res = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(reqBody) }); } catch (e) { finishAttempt(at, { error: String((e as Error)?.message ?? e) }); throw e; }
      // minimal을 받지 못하는 모델(400): 그 뒤로는 low로 보내고, 이번 요청도 low로 한 번 다시 보낸다
      if (res.status === 400 && openRouter && req.effort === 'minimal' && minimalOk) {
        finishAttempt(at, { status: 400, raw: (await res.text()).slice(0, 2000), error: 'HTTP 400 (생각 깊이 minimal → low로 다시)' });
        minimalOk = false;
        reqBody = build();
        at = traceAttempt(req.trace, `POST ${url}`, reqBody);
        try { res = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(reqBody) }); } catch (e) { finishAttempt(at, { error: String((e as Error)?.message ?? e) }); throw e; }
      }
      if (!res.ok) { const t = (await res.text()).slice(0, 2000); finishAttempt(at, { status: res.status, raw: t, error: `HTTP ${res.status}` }); throw new LlmHttpError(res.status, `LLM 요청 실패 (${res.status}): ${t.slice(0, 500)}`); }
      const body = await res.json();
      const text: string = body.choices?.[0]?.message?.content ?? '';
      finishAttempt(at, { status: res.status, meta: { id: body.id, model: body.model, finish_reason: body.choices?.[0]?.finish_reason, usage: body.usage }, raw: text });
      addUsage(req.meter, body.usage?.prompt_tokens, body.usage?.completion_tokens, { inChars: req.system.length + req.user.length + JSON.stringify(schema).length, outChars: text.length }, body.usage?.completion_tokens_details?.reasoning_tokens);
      const start = text.indexOf('{');
      if (body.choices?.[0]?.finish_reason === 'length') throw new LlmTruncatedError(start >= 0 ? text.slice(start) : text);
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new LlmJsonError(text, 'JSON 객체가 없습니다');
      try { return JSON.parse(match[0]) as T; } catch (e) { throw new LlmJsonError(start >= 0 ? text.slice(start) : text, (e as Error).message); }
    },
  };
}
