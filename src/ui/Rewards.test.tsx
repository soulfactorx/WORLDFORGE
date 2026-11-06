import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LevelUpDialog } from './Rewards';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { levelUp } from '../engine/character/progression';
import { levelUpInfo } from '../engine/digest';

describe('레벨업 화면', () => {
  it('새 레벨·HP·새 능력·새 카드, 고를 것이 있으면 캐릭터 창 버튼', () => {
    let a = createCharacter({ name: '나', classId: 'wizard', method: 'standard', abilities: suggestedStandardArray('wizard'), skills: ['arcana', 'history'] });
    a = levelUp(levelUp(a, { defer: true }).sheet, { defer: true }).sheet; // 3레벨 직전 상태 만들기
    const b = levelUp({ ...a, level: 2 }, { defer: true }).sheet;
    const html = renderToStaticMarkup(<LevelUpDialog info={levelUpInfo({ ...a, level: 2 }, b)} sheet={b} rs={(s) => s} onClose={() => {}} onSheet={() => {}} />);
    expect(html).toContain('★ 3레벨');
    expect(html).toContain('작열 광선');
    expect(html).toContain('고를 것 1개');
  });
});
