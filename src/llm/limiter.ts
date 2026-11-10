/**
 * 동시 요청 제한 (v0.92). 한 번에 보내는 AI 요청 수를 묶는다.
 *
 * v0.86에서 카드 변환의 이미지 정리와 이야기 만들기를 동시에 돌리면서, 번역(3) + 이미지 분류(4) + 세계 구조 + 이야기 단계가
 * 한꺼번에 나가 제공자의 요청 한도(429)에 걸리기 쉬워졌다. 한도에 걸리면 1~3분짜리 요청을 처음부터 다시 보내므로 오히려 느려진다.
 *  - 기본은 동시에 4개까지 (v0.86 이전에 한 단계가 쓰던 최대치). 나머지는 순서대로 기다린다
 *  - 요청 한도에 걸리면 동시 수를 하나 줄이고, 한동안(90초) 한도에 걸리지 않으면 다시 하나씩 늘린다
 */
import type { LlmClient } from './types';

export interface Limiter {
  run<T>(job: () => Promise<T>): Promise<T>;
  /** 요청 한도에 걸렸다: 동시 수를 줄인다 */
  penalize(): void;
  /** 지금 허용하는 동시 수 (진단용) */
  readonly limit: number;
}

export function createLimiter(max = 4, recoverMs = 90_000): Limiter {
  let limit = max, active = 0, lastPenalty = 0;
  const queue: (() => void)[] = [];
  const pump = () => {
    // 한도에 걸린 지 오래됐으면 조금씩 되돌린다
    if (limit < max && lastPenalty && Date.now() - lastPenalty > recoverMs) { limit++; lastPenalty = limit < max ? Date.now() : 0; }
    while (active < limit && queue.length) { active++; queue.shift()!(); }
  };
  return {
    get limit() { return limit; },
    penalize() { limit = Math.max(1, limit - 1); lastPenalty = Date.now(); },
    async run<T>(job: () => Promise<T>): Promise<T> {
      await new Promise<void>((go) => { queue.push(go); pump(); });
      try { return await job(); } finally { active--; pump(); }
    },
  };
}

/** 실제 요청을 보내는 구간만 제한한다 (재시도를 기다리는 동안에는 자리를 차지하지 않게 robust 안쪽에 둔다) */
export function limited(llm: LlmClient, limiter: Limiter): LlmClient {
  return {
    stream: (req, onText, signal) => limiter.run(() => llm.stream(req, onText, signal)),
    json: (req, schema, signal) => limiter.run(() => llm.json(req, schema, signal)),
  };
}
