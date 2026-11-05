import { describe, expect, it } from 'vitest';
import { moodOf, sfxForLog } from './audio';

describe('연출: 효과음 고르기 (R10)', () => {
  it('기록 한 줄에 맞는 효과음', () => {
    expect(sfxForLog('combat', '늑대 1의 물기 → 나: … → 치명타! 관통 피해 9')).toBe('crit');
    expect(sfxForLog('combat', '나의 롱소드 → 늑대 1: … → 명중 참격 피해 7')).toBe('hit');
    expect(sfxForLog('combat', '나의 롱소드 → 늑대 1: … → 빗나감')).toBe('miss');
    expect(sfxForLog('combat', '… 피해 7 — 늑대 1 쓰러짐')).toBe('down');
    expect(sfxForLog('combat', '나의 치유 물약: HP 6 회복 (3 → 9)')).toBe('heal');
    expect(sfxForLog('progress', '★ 당신은 2레벨이 되었다')).toBe('levelup');
    expect(sfxForLog('progress', '골드 +12 (전리품)')).toBe('coin');
    expect(sfxForLog('quest', '◆ 결정 — 돌아갈 것인가: 남는다')).toBe('decision');
    expect(sfxForLog('quest', '임무 실패 — 일제 호위 (기한이 지났다)')).toBe('fail');
    expect(sfxForLog('omen', '🌑 숲 쪽 하늘이…')).toBe('omen');
    expect(sfxForLog('narration', '당신은 걷는다')).toBeNull();
  });
  it('장르·전투에 맞는 음악 분위기', () => {
    expect([moodOf('wuxia', false), moodOf('romance', false), moodOf(undefined, false), moodOf('wuxia', true)]).toEqual(['wuxia', 'romance', 'fantasy', 'combat']);
  });
});
