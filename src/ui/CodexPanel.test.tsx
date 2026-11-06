import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import { startEvents } from '../gm/turn';
import { CodexPanel } from './CodexPanel';
import { XpBar } from './Rewards';

describe('도감 · 경험치 막대 (설계 v4 E8)', () => {
  const ch = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
  it('도감은 분류마다 모은 수/전체를 보인다', () => {
    const s = { ...replay(startEvents(sampleWorld, ch, 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event }))), kills: { wolf: 2 } };
    const html = renderToStaticMarkup(<CodexPanel world={sampleWorld} state={s} />);
    expect(html).toContain('쓰러뜨린 적');
    expect(html).toContain(`1/${sampleWorld.locations.length}`);
    expect(html).toContain('×2');
  });
  it('경험치 막대: 다음 레벨까지의 비율', () => {
    expect(renderToStaticMarkup(<XpBar sheet={{ ...ch, level: 1, xp: 150 }} />)).toContain('50%');
  });
});
