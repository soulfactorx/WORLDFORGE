import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { codexOf } from './codex';
import { applyEvent, replay } from './state/state';
import { startEvents } from '../gm/turn';

describe('도감 (설계 v4 E8)', () => {
  const ch = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
  const start = () => replay(startEvents(sampleWorld, ch, 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
  it('가 본 곳은 이동 기록에서, 결말은 세이브 밖에서 받은 것과 합친다', () => {
    let s = start();
    const first = s.player.locationId;
    const other = sampleWorld.locations.find((l) => l.id !== first)!.id;
    s = applyEvent(s, { type: 'moved', to: other }, 1);
    const c = codexOf(sampleWorld, s, ['ending/none', ...(sampleWorld.endings ?? []).slice(0, 1).map((e) => e.id)]);
    const places = c.find((x) => x.key === 'places')!;
    expect(places.found.map((p) => p.id).sort()).toEqual([first, other].sort());
    expect(places.total).toBe(sampleWorld.locations.length);
    const endings = c.find((x) => x.key === 'endings')!;
    expect(endings.found.length).toBe(Math.min(1, (sampleWorld.endings ?? []).length));
  });
  it('쓰러뜨린 적은 많이 잡은 순서', () => {
    const s = { ...start(), kills: { goblin_warrior: 1, wolf: 3 } };
    const foes = codexOf(sampleWorld, s).find((x) => x.key === 'foes')!;
    expect(foes.found.map((f) => f.n)).toEqual([3, 1]);
  });
});
