import { describe, expect, it } from 'vitest';
import { aetheriaWorld } from '../data/official/aetheria';
import { createCharacter, legacyCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import { activeStorylet } from '../engine/storylets';
import { cardLabel, divergence, phaseLabel, runOfflineTurn } from './offline';
import { startEvents } from './turn';

const start = (seed = 7) => replay(startEvents(aetheriaWorld, legacyCharacter('나'), seed, 'start/summoned').map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

describe('AI 없이 진행 (v0.116)', () => {
  it('첫 카드가 시작부터 펼쳐지고, 갈림길을 고르면 서술과 다음 선택지가 나온다', () => {
    let s = start();
    expect(activeStorylet(aetheriaWorld, s)?.id).toBe('card/ae-two-moons');
    const g = [...s.log].reverse().find((l) => l.kind === 'guide')!;
    const k = g.choiceOptions!.indexOf('card/ae-two-moons#down');
    const r = runOfflineTurn(aetheriaWorld, s, { text: g.choices![k]!, option: 'card/ae-two-moons#down' });
    s = r.state;
    expect(s.player.locationId).toBe('loc/vellos-gate');
    const n = r.events.find((e) => e.type === 'narration');
    expect(n?.type === 'narration' && n.text).toContain('벨로스');
    expect(r.events.at(-1)?.type).toBe('gm_guide');
  });
  it('에테리아: 성향이 다른 세 정책이 40턴 동안 다른 길로 간다', () => {
    const hero = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
    const s0 = replay(startEvents(aetheriaWorld, hero, 7, 'start/summoned').map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    const d = divergence(aetheriaWorld, s0, 40);
    for (const t of d.traces) console.log(`TRACE ${t.policy} turns=${t.turns} stop=${t.stop} phases=${t.phases.map((p) => phaseLabel(aetheriaWorld, p)).join('>')} cards=${t.cards.map((c) => cardLabel(aetheriaWorld, c)).join(', ')} tension=${t.tension.join(',')}\n`);
    console.log(`SCORE ${d.score} overlap=${d.cardOverlap.toFixed(2)} phaseDistinct=${d.phaseDistinct.toFixed(2)} ${d.verdict}\n`);
    expect(d.traces.every((t) => t.turns >= 5)).toBe(true);
    expect(d.score).toBeGreaterThanOrEqual(60);
  });
});
