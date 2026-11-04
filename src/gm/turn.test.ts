import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { runTurn, startEvents } from './turn';

const start = (w = sampleWorld) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

function mock(narration: string, checkKind = 'ability'): LlmClient & { users: string[] } {
  const users: string[] = [];
  return {
    users,
    stream: async (_r, onText) => { onText(narration); return narration; },
    json: async <T,>(r: { system: string; user: string }) => {
      users.push(r.user);
      if (r.system.includes('판단 모듈')) return { action_summary: '설득', check_kind: checkKind, check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '' } as T;
      if (r.system.includes('안내자')) return { summary: '요약', suggestion: '', choices: [{ text: '설득한다', skill: 'persuasion' }, { text: '본다', skill: 'nope' }] } as T;
      return { facts: [] } as T;
    },
  };
}

describe('턴: 고른 기술 · 서술에 나온 인물 이미지', () => {
  it('플레이어가 고른 기술로 판정하고, 기록에 표시한다', async () => {
    const llm = mock('조용하다.');
    const r = await runTurn(llm, sampleWorld, start(), '문지기를 설득한다', () => {}, undefined, undefined, 'skill:persuasion');
    const check = r.events.find((e) => e.type === 'check_rolled');
    expect(check && check.type === 'check_rolled' && check.skill).toContain('설득');
    expect(r.state.log.find((l) => l.kind === 'player')!.text).toContain('[설득]');
    expect(llm.users[0]).toContain('플레이어가 쓰겠다고 한 것');
    const guide = r.events.at(-1)!;
    expect(guide.type === 'gm_guide' && guide.choiceSkills).toEqual(['persuasion', '']);
  });
  it('판정이 필요 없으면 고른 기술이 있어도 굴리지 않는다', async () => {
    const r = await runTurn(mock('조용하다.', 'none'), sampleWorld, start(), '인사한다', () => {}, undefined, undefined, 'skill:persuasion');
    expect(r.events.some((e) => e.type === 'check_rolled')).toBe(false);
  });
  it('서술에 이름이 나온 인물의 이미지를 보여준다', async () => {
    const w = structuredClone(sampleWorld);
    const far = w.characters.find((c) => c.locationId !== w.start.locationId) ?? w.characters[0]!;
    w.assets = [{ id: 'stock.knight-m--0', name: 'k', kind: 'character', characterId: far.id, tags: ['default'], mime: 'image/svg+xml', size: 0 }];
    const r = await runTurn(mock(`멀리서 ${far.name}의 이야기가 들린다.`, 'none'), w, start(w), '귀를 기울인다', () => {});
    const n = r.events.find((e) => e.type === 'narration');
    expect(n && n.type === 'narration' && n.images).toContainEqual({ id: 'stock.knight-m--0', caption: far.name });
  });
});
