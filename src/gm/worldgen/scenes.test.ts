import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import { validateWorld } from '../../engine/package/validate';
import { sceneActions, newRun } from '../../engine/scene';
import type { WorldPackage } from '../../engine/schema';
import { createCharacter, suggestedStandardArray } from '../../engine/character/sheet';
import { applyEvent, replay, type GameState } from '../../engine/state/state';
import type { LlmClient } from '../../llm/types';
import { sceneActionEvents } from '../scene';
import { startEvents } from '../turn';
import { generateScenes, SCENES_DRAFT_SCHEMA, type SceneDraft, scenesFromDraft } from './scenes';

const draft = (over: Partial<SceneDraft> = {}): SceneDraft => ({
  key: 'haggle', name: '여관 값 흥정', kind: 'negotiation', description: '일제와 방값을 흥정한다', npc: 'ilse', location: '', start_knows: 'village-name',
  gauges: [{ key: 'patience', name: '인내심', start: 4, min: 0, max: 5 }, { key: 'deal', name: '합의', start: 0, min: 0, max: 10 }],
  states: [{ key: 'warm', name: '호의', edge: 1 }], likes: ['칭찬'], dislikes: ['위협'],
  actions: [
    { key: 'praise', name: '여관 칭찬', text: '수프 맛을 칭찬한다', check: 'skill:persuasion', dc: 12, tags: ['칭찬'], requires_gauge: '', requires_gte: 0, mod_gauge: 'patience', mod_per: 0.5,
      success: [{ gauge: 'deal', by: 4 }], success_text: '일제가 웃는다', success_add_state: 'warm', great: [{ gauge: 'deal', by: 6 }], great_text: '', failure: [{ gauge: 'patience', by: -1 }], failure_text: '', failure_add_state: '' },
    { key: 'push', name: '값 깎기', text: '', check: 'skill:intimidation', dc: 14, tags: ['위협'], requires_gauge: 'deal', requires_gte: 4, mod_gauge: '', mod_per: 0,
      success: [{ gauge: 'deal', by: 6 }], success_text: '', success_add_state: '', great: [], great_text: '', failure: [{ gauge: 'patience', by: -2 }], failure_text: '', failure_add_state: 'nope' },
  ],
  reactions: [{ when_gauge: 'deal', when_gte: 6, when_state: '', chance: 0.5, changes: [{ gauge: 'patience', by: -1 }], text: '일제가 계산대를 두드린다' }],
  ends: [
    { key: 'deal', name: '합의', outcome: 'success', gauge: 'deal', op: 'gte', value: 10, text: '방값을 깎았다', effects: [{ type: 'set_flag', ref: 'cheap room', axis: '', value: 0 }, { type: 'relationship', ref: 'ilse', axis: 'trust', value: 5 }, { type: 'reveal', ref: 'altar-cursed', axis: '', value: 0 }] },
    { key: 'walk', name: '결렬', outcome: 'failure', gauge: 'patience', op: 'lte', value: 0, text: '', effects: [] },
  ],
  max_rounds: 8, ...over,
});

describe('AI 장면 생성 (v0.51)', () => {
  it('초안 → 장면: 참조를 실제 ID로 고치고, 새 플래그를 선언하고, 그림을 채우고, 검사를 통과한다', () => {
    const r = scenesFromDraft(sampleWorld, [draft()]);
    expect(r.scenes).toHaveLength(1);
    const s = r.scenes[0]!;
    expect(s).toMatchObject({ id: 'scene/haggle', npcId: 'npc/ilse', start: { knows: 'claim/village-name' } });
    expect(s.actions[1]!.requires).toEqual({ gauge: 'deal', gte: 4 });
    expect(s.actions[1]!.failure!.addStates).toBeUndefined(); // 없는 상태는 버린다
    expect(s.ends[0]!.effects).toEqual([{ setFlag: 'cheap_room' }, { relationship: 'npc/ilse', delta: { trust: 5 } }, { reveal: 'claim/altar-cursed', state: 'partial' }]);
    expect(r.flags.map((f) => f.id)).toEqual(['cheap_room']);
    expect(s.image).toBeTruthy();
    expect(s.ends.find((e) => e.id === s.timeoutEnd)).toBeTruthy();
    const w: WorldPackage = { ...sampleWorld, flags: [...(sampleWorld.flags ?? []), ...r.flags], scenes: r.scenes };
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('쓸 수 없는 초안(수치 없음·성공 길 없음)은 버리고 메모를 남긴다, 없는 인물은 빼고 남긴다', () => {
    const r = scenesFromDraft(sampleWorld, [draft({ gauges: [] }), draft({ key: 'b', ends: [] }), draft({ key: 'c', npc: 'nobody', start_knows: 'nope' })]);
    expect(r.scenes.map((s) => s.id)).toEqual(['scene/c']);
    expect(r.scenes[0]!.npcId).toBeUndefined();
    expect(r.notes.length).toBe(2);
  });
  it('무작위로 망가진 초안 200개도 죽지 않고, 남긴 장면은 검사를 통과하고 끝까지 진행된다', () => {
    type S = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, S>; items?: S };
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const words = ['patience', 'deal', '인내심', 'ilse', 'bran', 'nope', '', 'warm', 'village-name'];
    const gen = (s: S, d = 0): unknown => {
      if (s.enum) return s.enum[Math.floor(rnd() * s.enum.length)];
      const t = Array.isArray(s.type) ? s.type[0] : s.type;
      if (t === 'object') { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s.properties ?? {})) if (rnd() < 0.85) o[k] = gen(v, d + 1); return o; }
      if (t === 'array') return d > 5 ? [] : Array.from({ length: Math.floor(rnd() * 4) }, () => gen(s.items ?? {}, d + 1));
      if (t === 'integer') return Math.floor(rnd() * 20) - 5;
      if (t === 'number') return rnd() * 1.5;
      return words[Math.floor(rnd() * words.length)];
    };
    const ch = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
    for (let i = 0; i < 200; i++) {
      const d = gen((SCENES_DRAFT_SCHEMA as S).properties!.scenes!) as SceneDraft[];
      const r = scenesFromDraft(sampleWorld, d);
      const w: WorldPackage = { ...sampleWorld, flags: [...(sampleWorld.flags ?? []), ...r.flags], scenes: r.scenes };
      expect(validateWorld(w).filter((x) => x.level === 'error' && x.path.startsWith('scenes'))).toEqual([]);
      for (const def of r.scenes) {
        let s: GameState = { ...replay(startEvents(w, ch, i).map((event, seq) => ({ saveId: 's', seq, turn: 0, event }))), scene: newRun(def) };
        for (let k = 0; k <= (def.maxRounds ?? 20) && s.scene; k++) {
          const ok = sceneActions(def, s.scene).filter((a) => a.ok);
          s = sceneActionEvents(w, s, ok[k % ok.length]!.action.id).reduce((st, e) => applyEvent(st, e, st.turn), s);
        }
        expect(s.scene, def.name).toBeUndefined();
      }
    }
  });
  it('generateScenes: AI 응답을 세계에 더한다', async () => {
    const llm = { json: async () => ({ scenes: [draft()] }), stream: async () => '' } as unknown as LlmClient;
    const stages: string[] = [];
    const r = await generateScenes(llm, sampleWorld, (s) => stages.push(s));
    expect(r.world.scenes?.map((s) => s.id)).toEqual(['scene/haggle']);
    expect(r.world.flags?.some((f) => f.id === 'cheap_room')).toBe(true);
    expect(stages[0]).toContain('장면');
  });
});

describe('뼈대와 장면을 한 번에 (v0.92)', () => {
  it('withSpine이면 같은 호출에서 뼈대를 받아 GM 메모에 남긴다 (AI 호출 1회)', async () => {
    const { spineOf } = await import('./spine');
    let calls = 0; let system = ''; let hasSpineSchema = false;
    const llm = { stream: async () => '', json: async <T,>(req: { system: string }, schema: Record<string, unknown>) => {
      calls++; system = req.system; hasSpineSchema = 'spine' in ((schema as { properties: object }).properties);
      return { spine: { conflict: '갈등', stakes: '걸린 것', player_hook: '첫 계기', chapters: [{ name: '1장', goal: '목표', climax_kind: 'scene', climax_key: 'a', climax: '담판', lead_in: '계기', on_success: '열림', on_failure: '싸움' }], sides: [] }, scenes: [] } as T;
    } };
    const r = await generateScenes(llm as never, structuredClone(sampleWorld), () => {}, undefined, '', 3, { withSpine: true });
    expect(calls).toBe(1);
    expect(hasSpineSchema).toBe(true);
    expect(system).toContain('이야기 뼈대');
    expect(spineOf(r.world)).toContain('1장 「1장」');
  });
});

describe('뼈대 먼저, 장면은 동시에 (v0.96)', () => {
  const spine = { conflict: '갈등', stakes: '걸린 것', player_hook: '첫 계기', chapters: [
    { name: '1장', goal: '목표', climax_kind: 'scene', climax_key: 'haggle', climax: '담판', lead_in: '계기', on_success: '열림', on_failure: '싸움' },
    { name: '2장', goal: '목표', climax_kind: 'encounter', climax_key: 'fight', climax: '싸움', lead_in: '계기', on_success: '열림', on_failure: '붙잡힘' },
  ], sides: [{ name: '곁가지', ties_to: '1장' }] };
  it('자리 나누기: 고비가 장면인 장 → 사이드 → 인물 관계 (서로 다르게)', async () => {
    const { sceneSlots } = await import('./scenes');
    const slots = sceneSlots(sampleWorld, spine as never, 3);
    expect(slots).toHaveLength(3);
    expect(slots[0]).toContain('"haggle"');
    expect(slots[1]).toContain('곁가지');
    expect(slots[2]).toContain('인물 관계');
    expect(new Set(slots).size).toBe(3);
  });
  it('뼈대 1회 + 장면 3회를 동시에 보내고, 한 장면이 실패해도 나머지는 살린다', async () => {
    const { spineOf } = await import('./spine');
    let inFlight = 0, peak = 0; const labels: string[] = [];
    const llm = { stream: async () => '', json: async <T,>(req: { label?: string; user: string }) => {
      labels.push(req.label ?? '');
      if (req.label === '이야기 뼈대') return spine as T;
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      if (req.label === '장면 2/3') throw new Error('boom');
      expect(req.user).toContain('## 이 호출이 맡은 장면');
      return { scenes: [{ ...draft(), name: `장면 ${req.label}`, key: req.label === '장면 1/3' ? 'haggle' : 'other' }] } as T;
    } };
    const r = await generateScenes(llm as never, structuredClone(sampleWorld), () => {}, undefined, '', 3, { withSpine: true, split: true });
    expect(labels.sort()).toEqual(['이야기 뼈대', '장면 1/3', '장면 2/3', '장면 3/3']);
    expect(peak).toBe(3);
    expect(r.world.scenes).toHaveLength(2);
    expect(spineOf(r.world)).toContain('1장 「1장」');
    expect(r.notes.join(' ')).toContain('1개는 요청이 실패');
  });
  it('뼈대를 못 짜면 한 번에 만드는 길로 간다', async () => {
    let calls = 0;
    const llm = { stream: async () => '', json: async <T,>(req: { label?: string }) => { calls++; if (req.label === '이야기 뼈대') throw new Error('x'); return { spine, scenes: [draft()] } as T; } };
    const r = await generateScenes(llm as never, structuredClone(sampleWorld), () => {}, undefined, '', 3, { withSpine: true, split: true });
    expect(calls).toBe(2);
    expect(r.world.scenes).toHaveLength(1);
  });
});
