import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { runTurn, startEvents } from './turn';
import { SCENE_PRESETS } from '../data/scenePresets';
import { sandboxAct, sandboxState, testSheet } from './sceneTest';
import { sceneActions } from '../engine/scene';
import { applyEvent } from '../engine/state/state';
import { narrateSceneTurn } from './scene';

describe('이야기 이어 쓰기 (v0.79.3)', () => {
  it('서술 AI는 줄거리·직전 서술 전문·흐른 시간·이번 턴 기록을 받고, 안내는 직전 서술을 두 번 받지 않는다', async () => {
    let s = replay(startEvents(sampleWorld, legacyCharacter('나'), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    const narr: string[] = []; const guide: string[] = []; const actor: string[] = [];
    let n = 0;
    const llm: LlmClient = {
      stream: async (r, on) => { narr.push(r.user); n++; const t = `서술${n}의 첫 문장. 둘째 문장. 마지막 순간-${n}.`; on(t); return t; },
      json: async <T,>(r: { system: string; user: string }) => {
        if (r.system.includes('판단 모듈')) return { action_summary: '행동', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: n === 1 ? 'loc/village-gate' : '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', time_spent: n === 2 ? 'hours' : 'short' } as T;
        if (r.system.includes('안내자')) { guide.push(r.user); return { summary: `상황${n}`, suggestion: '', choices: [{ text: 'a', skill: '', kind: 'advance' }] } as T; }
        if (r.system.includes('한 명의 NPC')) { actor.push(r.user); return {} as T; }
        return { facts: [] } as T;
      } };
    for (const act of ['마을로 간다', '경비병을 지켜본다', '말을 건다']) s = (await runTurn(llm, sampleWorld, s, act, () => {})).state;
    const last = narr.at(-1)!;
    expect(last).toContain('## 지금까지의 줄거리');
    expect(last).toMatch(/턴 1 \(\d\d:\d\d · 숲속 공터\): 당신 「마을로 간다」 → 서술1의 첫 문장/);
    expect(last).toContain('## 직전 서술 (턴 2');
    expect(last).toContain('마지막 순간-2.');
    expect(last).toMatch(/직전 서술 이후 .*흘렀다 → 지금 \d\d:\d\d/);
    expect(last).toContain('[player] 말을 건다');
    expect(last).toContain('이 장소에서 2번째 턴이다'); // 턴 2에 도착 → 턴 3은 두 번째
    // 안내: 줄거리는 받되, 방금 서술은 따로 한 번만
    const g = guide.at(-1)!;
    expect(g.match(/마지막 순간-3\./g)?.length).toBe(2); // 방금 서술 + 마지막 장면 (줄거리 쪽엔 앞부분만)
    expect(g).not.toContain('## 직전 서술');
    // 선택지는 방금 서술의 마지막 장면·방금 한 행동·지금 있는 사람에서 이어진다 (v0.79.5)
    expect(g).toContain('## 방금 서술의 마지막 장면 (선택지는 여기서 바로 이어진다)\n서술3의 첫 문장');
    expect(g).toContain('## 플레이어가 방금 한 행동\n말을 건다');
    expect(g).toContain('## 지금 이 자리에 있는 사람');
  });

  it('장면 매 차례 서술은 장면 직전 이야기와 이 장면에서 앞서 쓴 서술을 받아 이어 쓴다', async () => {
    const w = { ...structuredClone(sampleWorld), scenes: SCENE_PRESETS.map((p) => p.make()) };
    const def = w.scenes!.find((d) => d.id === 'scene/negotiation')!;
    let s = sandboxState(w, def.id, testSheet(w, 0, 3));
    s = { ...s, log: [{ turn: 0, kind: 'narration', text: '여관 문을 밀고 들어선다. 장면 전의 마지막 순간.' }, ...s.log] };
    const act = () => sceneActions(def, s.scene!, s.player.sheet).find((a) => a.ok)!.action.id;
    s = sandboxAct(w, s, act());
    s = applyEvent(s, { type: 'narration', text: '첫 차례 서술 — 상대가 눈썹을 치켜든다.' }, s.turn);
    s = sandboxAct(w, s, act());
    let user = '';
    const llm: LlmClient = { stream: async (r) => { user = r.user; return 'x'; }, json: async () => ({}) as never };
    await narrateSceneTurn(llm, w, s, def, s.scene!.log.at(-1)!, () => {});
    expect(user).toContain('## 장면 직전 이야기\n여관 문을 밀고 들어선다');
    expect(user).toContain('(직전 서술 — 여기서 이어 쓴다) 첫 차례 서술');
    expect(user.indexOf('첫 차례 서술')).toBeLessThan(user.indexOf('## 방금 차례'));
  });
});

describe('선택지의 마지막 장면 (v0.79.5)', () => {
  it('서술의 마지막 두 문단만, 길면 끝부분', async () => {
    const { lastScene } = await import('./guide');
    expect(lastScene('첫 문단.\n\n둘째 문단.\n\n셋째 문단 — 그가 대답을 기다린다.')).toBe('둘째 문단.\n\n셋째 문단 — 그가 대답을 기다린다.');
    expect(lastScene('가'.repeat(900)).startsWith('…')).toBe(true);
  });
});

describe('이어서 진행 (v0.79.9)', () => {
  it('빈 입력이면 판단·서술 AI에 "흐름대로 이어서"를 알리고, 기록에는 (이어서)로 남는다', async () => {
    const { runTurn: run, startEvents: begin, CONTINUE_INPUT } = await import('./turn');
    const s0 = replay(begin(sampleWorld, legacyCharacter('나'), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    const users: Record<string, string> = {};
    const llm: LlmClient = {
      stream: async (r, on) => { users.narr = r.user; on('이어지는 서술'); return '이어지는 서술'; },
      json: async <T,>(r: { system: string; user: string }) => {
        if (r.system.includes('판단 모듈')) { users.dir = r.user; return { action_summary: '지켜본다', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', time_spent: 'moment' } as T; }
        if (r.system.includes('안내자')) return { summary: 's', suggestion: '', choices: [{ text: 'a', skill: '', kind: 'advance' }] } as T;
        return { facts: [] } as T;
      } };
    const r = await run(llm, sampleWorld, s0, '   ', () => {});
    expect(users.dir).toContain('## 이번 턴은 "이어서 진행"이다');
    expect(users.narr).toContain('몽타주로 쓴다');
    expect(r.state.log.find((l) => l.kind === 'player')?.text).toBe(CONTINUE_INPUT);
  });
});
