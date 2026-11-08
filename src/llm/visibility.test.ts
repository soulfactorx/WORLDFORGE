import { describe, expect, it } from 'vitest';
import { robust } from './robust';
import { simulateVisibility } from './visibility';
import type { LlmClient } from './types';

describe('모바일 백그라운드 대응 (v0.79.8)', () => {
  it('JSON: 앱을 벗어나 끊기면 돌아올 때까지 기다렸다 다시 요청한다 (재시도 횟수와 따로)', async () => {
    let calls = 0;
    const llm: LlmClient = { stream: async () => '', json: async <T,>() => {
      calls++;
      if (calls === 1) { simulateVisibility(true); throw new TypeError('Load failed'); }
      return { ok: true } as T;
    } };
    const p = robust(llm, { attempts: 1, baseDelayMs: 1 }).json<{ ok: boolean }>({ system: 's', user: 'u', maxTokens: 10 }, {});
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1); // 숨어 있는 동안은 다시 보내지 않는다
    simulateVisibility(false);
    expect(await p).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('스트림: 일부가 나간 뒤 끊겨도 돌아와 다시 받고, 새 글은 중복으로 내보내지 않고 결과로만 돌려준다', async () => {
    let calls = 0; const shown: string[] = [];
    const llm: LlmClient = { json: async () => ({}) as never, stream: async (_r, on) => {
      calls++;
      if (calls === 1) { on('앞부분…'); simulateVisibility(true); throw new TypeError('network error'); }
      on('완성된 '); on('서술'); return '완성된 서술';
    } };
    const p = robust(llm, { attempts: 1, baseDelayMs: 1 }).stream({ system: 's', user: 'u', maxTokens: 10 }, (d) => shown.push(d));
    await new Promise((r) => setTimeout(r, 20));
    simulateVisibility(false);
    expect(await p).toBe('완성된 서술');
    expect(shown).toEqual(['앞부분…']);
  });

  it('보이는 상태의 네트워크 오류는 예전처럼 재시도 횟수 안에서만', async () => {
    let calls = 0;
    const llm: LlmClient = { stream: async () => '', json: async () => { calls++; throw new TypeError('Failed to fetch'); } };
    await expect(robust(llm, { attempts: 2, baseDelayMs: 1 }).json({ system: 's', user: 'u', maxTokens: 10 }, {})).rejects.toThrow('Failed to fetch');
    expect(calls).toBe(2);
  });
});
