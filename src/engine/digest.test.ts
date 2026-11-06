import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { levelUp } from './character/progression';
import { applyEvent, replay } from './state/state';
import { startEvents } from '../gm/turn';
import { levelUpInfo, openQuestions, recap, rewardDiff, todoThree } from './digest';

const hero = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
const start = () => replay(startEvents(sampleWorld, hero(), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

describe('보상 연출 · 세션 훅 (설계 v4 E2)', () => {
  it('이번 턴 보상: 경험치·돈·아이템·알게 된 것·레벨', () => {
    const before = start();
    let after = applyEvent(before, { type: 'xp_gained', who: 'player', amount: 120, reason: '테스트' }, 1);
    after = applyEvent(after, { type: 'knowledge_revealed', belief: { holder: 'player', claim: 'claim/altar-cursed', state: 'rumor' } }, 1);
    const lines = rewardDiff(sampleWorld, before, after).map((l) => `${l.icon}${l.text}`);
    expect(lines).toContain('✦경험치 +120');
    expect(lines).toContain('📖알게 된 것 1');
  });
  it('레벨업 화면: 새 능력과 새 카드 (파이터 2레벨 → 행동 연쇄)', () => {
    const a = hero();
    const b = levelUp(a, { defer: true }).sheet;
    const info = levelUpInfo(a, b);
    expect(info.levels).toEqual([2]);
    expect(info.features).toContain('행동 연쇄');
    expect(info.cards.map((c) => c.id)).toContain('fighter/action_surge');
    expect(info.hpGain).toBeGreaterThan(0);
  });
  it('지금 할 일 세 갈래와 궁금한 것, 지난 이야기', () => {
    let s = start();
    s = applyEvent(s, { type: 'knowledge_revealed', belief: { holder: 'player', claim: 'claim/altar-cursed', state: 'rumor' } }, 1);
    s = applyEvent(s, { type: 'relationship_changed', npcId: 'npc/bran', name: '브란', delta: { affinity: 6 }, reason: '인사' }, 1);
    const t = todoThree(sampleWorld, s);
    expect(t.main).toContain('낯선 하늘 아래');
    expect(t.bond).toMatch(/가까워질 수 있다/);
    expect(t.bond).not.toContain('브란'); // 아직 이름을 모르면 외형으로
    expect(openQuestions(sampleWorld, s)).toEqual(['숲속 제단은 저주받은 곳이라 가까이 가면 안 된다.']);
    const r = recap(sampleWorld, s);
    expect(r.where).toBe('숲속 공터');
    expect(r.last.length).toBeGreaterThan(10);
    expect(r.questions.length).toBe(1);
  });
});
