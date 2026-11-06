import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CharacterPanel } from './CharacterPanel';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { levelUp } from '../engine/character/progression';
import { applyBuildChoice } from '../engine/character/build';

describe('캐릭터 창: 하위 직업·특성 고르기', () => {
  it('선택 대기 중이면 고를 수 있는 버튼이 보이고, 고른 뒤에는 이름이 보인다', () => {
    let s = createCharacter({ name: '나', classId: 'ranger', method: 'standard', abilities: suggestedStandardArray('ranger'), skills: ['survival', 'perception', 'stealth'] as never });
    while (s.level < 4) s = levelUp(s, { defer: true }).sheet;
    const html = renderToStaticMarkup(<CharacterPanel sheet={s} onChoose={() => {}} />);
    expect(html).toContain('하위 직업 고르기');
    expect(html).toContain('사냥꾼');
    expect(html).toContain('추적자');
    expect(html).toContain('능력치 향상 또는 특성 (4레벨)');
    expect(html).toContain('저격수');
    s = applyBuildChoice(applyBuildChoice(s, 'subclass', 'tracker')!.sheet, 'feat', 'sharpshooter')!.sheet;
    const after = renderToStaticMarkup(<CharacterPanel sheet={s} onChoose={() => {}} />);
    expect(after).not.toContain('하위 직업 고르기');
    expect(after).toContain('(추적자)');
    expect(after).toContain('특성: 저격수');
  });
});

import { sampleWorld } from '../data/sample-world';
import { replay } from '../engine/state/state';
import { startEvents } from '../gm/turn';
describe('캐릭터 창: 명성·등급·칭호', () => {
  it('등급 사다리와 칭호를 보여 준다', () => {
    const sheet = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] as never });
    const st = { ...replay(startEvents(sampleWorld, sheet, 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event }))), titles: ['title/first-win'] };
    const html = renderToStaticMarkup(<CharacterPanel sheet={st.player.sheet} world={sampleWorld} state={st} />);
    expect(html).toContain('모험가 등급 F급');
    expect(html).toContain('🏅 첫 승리');
    expect(html).toContain('명성 2');
  });
});
