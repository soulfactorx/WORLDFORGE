import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import { startEvents } from '../gm/turn';
import { createLlmClient } from '../llm';
import { beginDebug, debugStage, diffState, endDebug, loadDebug, setDebugOn, traceCall } from './trace';

const mem = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) });
  mem.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

const state0 = () => replay(startEvents(sampleWorld, legacyCharacter('나'), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

describe('디버그 기록 (v0.57)', () => {
  it('꺼져 있으면 아무것도 기록하지 않는다', () => {
    expect(beginDebug('turn', 'x')).toBeNull();
    expect(traceCall({ role: 'narrator', model: 'm', provider: 'p', kind: 'stream', params: { maxTokens: 1 }, system: 's', user: 'u' })).toBeNull();
  });

  it('AI 호출의 프롬프트·파라미터·실제 요청 본문·응답 원문을 남기고, API 키는 남기지 않는다', async () => {
    setDebugOn(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'r1', model: 'mock', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }), { status: 200 })));
    const llm = createLlmClient({ provider: 'openai-compatible', apiKey: 'sk-SECRET-KEY', model: 'mock', baseUrl: 'http://mock.local/v1' }, { sink: () => {} });
    const { db } = await import('../storage/db');
    await db.saves.put({ id: 's', name: '테스트', packageId: 'p', packageVersion: '1', createdAt: 1, updatedAt: 1 });
    const e = beginDebug('turn', '턴 1: 둘러본다', { saveId: 's', input: '둘러본다' });
    debugStage('GM이 행동을 판단하는 중');
    const out = await llm.json<{ ok: boolean }>({ system: '너는 판단 모듈이다', user: '## 컨텍스트\n플레이어 입력', maxTokens: 500 }, { type: 'object' });
    expect(out.ok).toBe(true);
    const s0 = state0();
    const s1 = { ...s0, flags: [...s0.flags, 'met_elder'], worldMinutes: s0.worldMinutes + 10 };
    await endDebug(e, { events: [{ type: 'flag_set', flag: 'met_elder' } as never], before: s0, after: s1, rejected: ['세울 수 없는 플래그: x'] });

    const [saved] = await loadDebug('s');
    expect(saved!.input).toBe('둘러본다');
    expect(saved!.stages[0]!.text).toContain('판단');
    const c = saved!.calls[0]!;
    expect(c.role).toBe('director');
    expect(c.params.maxTokens).toBe(500);
    expect(c.user).toContain('플레이어 입력');
    expect(c.schema).toEqual({ type: 'object' });
    expect(c.attempts[0]!.endpoint).toBe('POST http://mock.local/v1/chat/completions');
    expect((c.attempts[0]!.request as { max_tokens: number }).max_tokens).toBe(500);
    expect(c.attempts[0]!.raw).toBe('{"ok":true}');
    expect(c.usage?.input).toBe(12);
    expect(c.parsed).toEqual({ ok: true });
    expect(saved!.rejected).toEqual(['세울 수 없는 플래그: x']);
    expect(saved!.diff!.map((d) => d.path)).toEqual(expect.arrayContaining(['flags (+1)', 'worldMinutes']));
    expect(JSON.stringify(saved)).not.toContain('SECRET');
  });

  it('턴 밖 AI 호출(세계 만들기 등)은 따로 한 건으로 남는다', async () => {
    setDebugOn(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 500 })));
    const llm = createLlmClient({ provider: 'openai-compatible', apiKey: '', model: 'mock', baseUrl: 'http://mock.local/v1' }, { sink: () => {}, attempts: 2, baseDelayMs: 1 });
    await expect(llm.json({ system: '세계관 설계자', user: 'u', maxTokens: 10, label: '세계 만들기' }, {})).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    const all = await loadDebug();
    const solo = all.find((x) => x.kind === 'other' && x.title.includes('세계 만들기'));
    expect(solo?.calls[0]?.error).toBeTruthy();
    expect(solo?.calls[0]?.attempts.map((a) => a.status)).toEqual([500, 500]);
  });

  it('상태 차이: 바뀐 곳만, 기록 로그는 빼고', () => {
    const a = state0();
    const b = { ...a, player: { ...a.player, sheet: { ...a.player.sheet, hp: a.player.sheet.hp - 3 } }, log: [...a.log, { kind: 'narration', text: 'x' } as never] };
    const d = diffState(a, b);
    expect(d).toEqual([{ path: 'player.sheet.hp', before: a.player.sheet.hp, after: a.player.sheet.hp - 3 }]);
  });
});

describe('세이브를 지우면 디버그 기록도 지운다 (v0.57.2)', () => {
  it('deleteSave와 고아 기록 정리', async () => {
    setDebugOn(true);
    const { db, deleteSave } = await import('../storage/db');
    await db.debug.clear();
    await db.saves.bulkPut([{ id: 'old', name: '옛 세이브', packageId: 'p', packageVersion: '1', createdAt: 1, updatedAt: 1 }, { id: 'new', name: '새 세이브', packageId: 'p', packageVersion: '1', createdAt: 2, updatedAt: 2 }]);
    const s0 = state0();
    for (const id of ['old', 'new', 'ghost']) await endDebug(beginDebug('turn', `턴 1 (${id})`, { saveId: id }), { before: s0, after: s0 });
    await deleteSave('old');
    const left = await loadDebug();
    expect(left.map((e) => e.saveId)).toEqual(['new']); // old는 지우면서, ghost(세이브 없음)는 불러올 때 정리
  });
});
