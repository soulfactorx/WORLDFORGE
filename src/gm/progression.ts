import { levelForXp, levelUp, MAX_LEVEL } from '../engine/character/progression';
import type { CharacterSheet } from '../engine/character/sheet';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';

export interface XpAward {
  who: string;
  amount: number;
}

/** 경험치 지급 → xp_gained + (필요하면) level_up 이벤트. 한 번에 여러 레벨이 오를 수도 있다. */
export function progressEvents(state: GameState, awards: XpAward[], reason: string, levelCap = MAX_LEVEL): GameEvent[] {
  const events: GameEvent[] = [];
  for (const { who, amount } of awards) {
    if (amount <= 0) continue;
    let sheet: CharacterSheet | undefined = who === 'player' ? state.player.sheet : state.party[who];
    if (!sheet) continue;
    events.push({ type: 'xp_gained', who, amount, reason });
    const xp = (sheet.xp ?? 0) + amount;
    sheet = { ...sheet, xp };
    while (sheet.level < Math.min(MAX_LEVEL, levelCap, levelForXp(xp))) {
      const r = levelUp(sheet);
      sheet = r.sheet;
      events.push({ type: 'level_up', who, sheet, hpGain: r.hpGain, features: r.features });
    }
  }
  return events;
}
