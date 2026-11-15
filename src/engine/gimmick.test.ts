import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from './character/sheet';
import { applyEvent, type GameState, replay } from './state/state';
import { startEvents } from '../gm/turn';
import { abandonSceneEvents, sceneActionEvents, startSceneEvents } from '../gm/scene';
import { availableScenes } from './scene';
import { closedHere, closedReason } from './phase';
import { answerMatches, gimmickScene, shuffledOrder } from './gimmick';
import { validateWorld } from './package/validate';
import type { Gimmick, WorldPackage } from './schema';

const hero = () => createCharacter({ name: '나', classId: 'rogue', method: 'standard', abilities: suggestedStandardArray('rogue'), skills: ['perception', 'sleight_of_hand', 'acrobatics', 'investigation'] });
const from = sampleWorld.start.locationId;
const to = sampleWorld.locations.find((l) => l.id === from)!.connections[0]!;
const withG = (g: Gimmick, id = 'scene/g'): WorldPackage => ({ ...sampleWorld, scenes: [...(sampleWorld.scenes ?? []), gimmickScene({ id, name: '시험 기믹', locationId: from }, { guards: to, ...g })] });
const start = (w: WorldPackage) => replay(startEvents(w, hero(), 5).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const act = (w: WorldPackage, s: GameState, id: string, answer?: string) => sceneActionEvents(w, s, id, answer).reduce((x, e) => applyEvent(x, e, x.turn), s);
const begin = (w: WorldPackage, s: GameState) => startSceneEvents(w, s, 'scene/g').reduce((x, e) => applyEvent(x, e, x.turn), s);

describe('함정·퍼즐 기믹 (v0.129)', () => {
  it('모든 종류가 오류 없는 장면이 된다', () => {
    for (const g of [
      { kind: 'trap', intro: '바닥의 돌 하나가 조금 솟아 있다', damage: '2d6' },
      { kind: 'riddle', intro: '문에 글이 새겨져 있다', question: '아침엔 네 발?', answers: ['사람'] },
      { kind: 'sequence', intro: '레버 셋', steps: ['해', '달', '별'] },
      { kind: 'device', intro: '봉인', check: { check: 'skill:arcana', dc: 12 }, goal: 2 },
    ] as Gimmick[]) expect(validateWorld(withG(g)).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('수수께끼: 답이 맞으면 풀리고 길이 열린다, 틀리면 기회가 줄고 다친다', () => {
    const w = withG({ kind: 'riddle', intro: '문', question: '?', answers: ['그림자', 'shadow'], tries: 2, damage: '3' });
    let s = start(w);
    expect(closedHere(w, s, to)).toBe(true);
    expect(closedReason(w, s, to)).toContain('풀어야');
    s = begin(w, s);
    const hp = s.player.sheet.hp;
    s = act(w, s, 'answer', '빛');
    expect(s.scene!.gauges.tries).toBe(1);
    expect(s.player.sheet.hp).toBe(Math.max(1, hp - 3));
    s = act(w, s, 'answer', ' Shadow! ');
    expect(s.sceneResults?.['scene/g']?.outcome).toBe('success');
    expect(closedHere(w, s, to)).toBe(false);
  });
  it('순서 맞추기: 틀리면 처음부터, 맞는 순서면 풀린다', () => {
    const w = withG({ kind: 'sequence', intro: '레버', steps: ['해', '달', '별'], mistakes: 3 });
    let s = begin(w, start(w));
    s = act(w, s, 'step1');
    expect(s.scene!.gauges).toMatchObject({ step: 0, miss: 1 });
    for (const i of [0, 1, 2]) s = act(w, s, `step${i}`);
    expect(s.sceneResults?.['scene/g']?.outcome).toBe('success');
    // 화면 순서는 정답 순서가 아니다
    expect(shuffledOrder(3, 'scene/g')).not.toEqual([0, 1, 2]);
  });
  it('함정: 그냥 지나가면 걸려 다치지만 지나간 것으로 친다 · 그만두면 다시 할 수 있다', () => {
    const w = withG({ kind: 'trap', intro: '낌새', damage: '4' });
    let s = start(w);
    // 그 장소에 있으면 저절로 시작한다 (여기서는 시작 장소라 게임 시작과 함께)
    expect(s.scene?.sceneId).toBe('scene/g');
    s = abandonSceneEvents(w, s).reduce((x, e) => applyEvent(x, e, x.turn), s);
    expect(availableScenes(w, s, { auto: true }).map((d) => d.id)).not.toContain('scene/g');
    expect(availableScenes(w, s, { auto: false }).map((d) => d.id)).toContain('scene/g');
    s = begin(w, s);
    const hp = s.player.sheet.hp;
    s = act(w, s, 'rush');
    expect(s.sceneResults?.['scene/g']?.outcome).toBe('failure');
    expect(s.player.sheet.hp).toBe(Math.max(1, hp - 4));
    expect(closedHere(w, s, to)).toBe(false);
  });
  it('답 비교는 띄어쓰기·문장부호·대소문자를 무시한다', () => {
    expect(answerMatches(['검은 고양이'], '검은고양이.')).toBe(true);
    expect(answerMatches(['x'], '')).toBe(false);
  });
});
