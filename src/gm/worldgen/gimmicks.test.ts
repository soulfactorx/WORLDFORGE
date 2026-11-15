import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import { validateWorld } from '../../engine/package/validate';
import type { LlmClient } from '../../llm/types';
import { generateGimmicks, gimmickFromDraft, type GimmickDraft, mergeGimmicks } from './gimmicks';

const from = sampleWorld.locations[0]!;
const next = sampleWorld.locations.find((l) => l.id === from.connections[0])!;
const far = sampleWorld.locations.find((l) => l.id !== from.id && !from.connections.includes(l.id));
const base: GimmickDraft = { kind: 'trap', name: '압력판', location: from.name, guards: next.name, intro: '바닥 돌 하나가 솟아 있다', reveal: '압력판', sprung: '화살!', find_dc: 40, disarm_skill: 'lockpicking', avoid_skill: 'acrobatics',
  question: '', answers: [], steps: [], skill: '', label: '', alt_skill: '', alt_label: '', goal: 0, dc: 3, damage: 'rm -rf', hint_skill: '', hint_text: '', success_text: '', fail_text: '', reward: '' };

describe('함정·퍼즐 자동 생성 (v0.130)', () => {
  it('AI 값을 다시 확인한다: 장소 이름·막는 길·기술·난이도·피해 표기', () => {
    const r = gimmickFromDraft(sampleWorld, base, 'scene/x');
    const g = r.scene!.gimmick!;
    expect(r.scene!.locationId).toBe(from.id);
    expect(g.guards).toBe(next.id);
    expect(g.findDc).toBe(20);
    expect(g.disarm).toEqual({ check: 'skill:sleight_of_hand', dc: 8 });
    expect(g.damage).toBeUndefined();
    if (far) expect(gimmickFromDraft(sampleWorld, { ...base, guards: far.name }, 'scene/y').scene!.gimmick!.guards).toBeUndefined();
    expect(gimmickFromDraft(sampleWorld, { ...base, location: '없는 곳' }, 'scene/z').scene).toBeNull();
  });
  it('수수께끼·순서는 답·순서가 없으면 뺀다', () => {
    expect(gimmickFromDraft(sampleWorld, { ...base, kind: 'riddle', question: '?', answers: [] }, 'a').scene).toBeNull();
    expect(gimmickFromDraft(sampleWorld, { ...base, kind: 'sequence', steps: ['하나'] }, 'b').scene).toBeNull();
    expect(gimmickFromDraft(sampleWorld, { ...base, kind: 'sequence', steps: ['해', '달', '해', '별'], damage: '1d4' }, 'c').scene!.gimmick).toMatchObject({ steps: ['해', '달', '별'], damage: '1d4' });
  });
  it('생성 → 오류 없는 세계 · 합치기', async () => {
    const llm = { stream: async () => '', json: async <T,>() => ({ gimmicks: [
      { ...base, damage: '2d6', dc: 13, find_dc: 14 },
      { ...base, kind: 'riddle', name: '문지기', question: '아침엔 네 발?', answers: ['사람'], hint_skill: 'history', hint_text: '지팡이' },
      { ...base, kind: 'device', name: '봉인', skill: 'arcana', alt_skill: 'athletics', goal: 9 },
      { ...base, kind: 'spell' },
    ] }) as T } as unknown as LlmClient;
    const r = await generateGimmicks(llm, sampleWorld, () => {}, undefined, '', 4);
    const gs = (r.world.scenes ?? []).filter((s) => s.gimmick);
    expect(gs.map((s) => s.gimmick!.kind)).toEqual(['trap', 'riddle', 'device']);
    expect(new Set(gs.map((s) => s.id)).size).toBe(3);
    expect(gs[2]!.gimmick!.goal).toBe(4);
    expect(validateWorld(r.world).filter((i) => i.level === 'error')).toEqual([]);
    expect(r.notes.join(' ')).toContain('알 수 없는 종류');
    expect((mergeGimmicks(sampleWorld, r.world).scenes ?? []).filter((s) => s.gimmick)).toHaveLength(3);
  });
});
