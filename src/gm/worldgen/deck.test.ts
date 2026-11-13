import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../../data/sample-world';
import { validateWorld } from '../../engine/package/validate';
import type { LlmClient } from '../../llm/types';
import { type DeckDraft, deckFromDraft, generateDeck } from './deck';

const npc = sampleWorld.characters[0]!.id.replace(/^[a-z]+\//, '');
const draft: DeckDraft = {
  axes: [{ key: 'mist', name: '안개의 뜻', low: '안개를 걷는다', high: '안개와 하나 된다' }],
  phases: [
    { key: 'calm', name: '잔잔한 골짜기', tone: '평온하다.', announce: '', tint: 'calm', music: 'calm', when: [{ kind: 'drama_lte', ref: '', value: 3 }], from: [] },
    { key: 'fog', name: '짙은 안개', tone: '아무것도 보이지 않는다.', announce: '안개가 내려앉았다.', tint: 'dark', music: 'dark', when: [{ kind: 'axis_gte', ref: 'mist', value: 2 }], from: ['calm'] },
  ],
  cards: [
    { key: 'altar', title: '제단의 속삭임', situation: '제단이 웅웅거린다.', phases: [], location: '', quest: '', when: [], twist: false, options: [
      { key: 'a', label: '손을 얹는다', stake: 'theme_high', stake_ref: 'mist', check_skill: 'arcana', check_dc: 'medium', success: [{ kind: 'axis', ref: 'mist', value: 2 }, { kind: 'open_card', ref: 'echo', value: 2 }], fail: [] },
      { key: 'b', label: '물러난다', stake: 'defuse', stake_ref: '', check_skill: '', check_dc: 'easy', success: [], fail: [] },
      { key: 'c', label: '그를 부른다', stake: 'bond', stake_ref: npc, check_skill: '', check_dc: 'easy', success: [{ kind: 'trust', ref: npc, value: 5 }], fail: [] },
    ] },
    { key: 'echo', title: '메아리', situation: '누군가 대답한다.', phases: ['fog'], location: 'nowhere', quest: '', when: [{ kind: 'chose', ref: 'altar#a', value: 0 }], twist: true, options: [
      { key: 'a', label: '대답한다', stake: 'escalate', stake_ref: '', check_skill: '', check_dc: 'easy', success: [{ kind: 'drama', ref: '', value: 2 }], fail: [] },
      { key: 'b', label: '귀를 막는다', stake: 'escalate', stake_ref: '', check_skill: 'nope', check_dc: 'easy', success: [{ kind: 'reveal', ref: 'claim-none', value: 0 }], fail: [] },
    ] },
    { key: 'bad', title: '', situation: '', phases: [], location: '', quest: '', when: [], twist: false, options: [] },
  ],
};

describe('AI 국면·갈래 카드 생성 (v0.116)', () => {
  it('초안의 참조를 고치고, 고칠 수 없는 것은 버리며, 검사기를 통과한다', () => {
    const r = deckFromDraft(sampleWorld, draft);
    expect(r.vars[0]).toMatchObject({ id: 'axis_mist', poles: ['안개를 걷는다', '안개와 하나 된다'] });
    expect(r.phases.map((p) => p.id)).toEqual(['phase/fog', 'phase/calm']); // 시작 국면이 맨 아래
    expect(r.storylets).toHaveLength(2);
    const echo = r.storylets.find((c) => c.id === 'card/echo')!;
    expect(echo.when).toEqual({ storylet: 'card/altar', is: 'a' });
    expect(echo.locationId).toBeUndefined();
    expect(echo.options[1]!.stake).toBeUndefined(); // 같은 카드에서 같은 것을 거는 갈림길
    expect(echo.options[1]!.check).toBeUndefined();
    const w = { ...sampleWorld, vars: [...(sampleWorld.vars ?? []), ...r.vars], phases: r.phases, storylets: r.storylets };
    expect(validateWorld(w).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('세계에 더한다 (이미 있는 국면은 덮지 않는다)', async () => {
    const llm: LlmClient = { stream: async () => '', json: async <T,>() => draft as T };
    const r = await generateDeck(llm, sampleWorld, () => {});
    expect(r.world.storylets).toHaveLength(2);
    expect(r.world.phases).toHaveLength(2);
    const again = await generateDeck(llm, r.world, () => {});
    expect(again.world.phases).toEqual(r.world.phases);
  });
});
