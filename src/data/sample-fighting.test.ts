import { describe, expect, it } from 'vitest';
import { createCharacter } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import { newRun, sceneActions } from '../engine/scene';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type GameState, replay } from '../engine/state/state';
import { sceneActionEvents } from '../gm/scene';
import { simulateWorld } from '../gm/simulate';
import { startEvents } from '../gm/turn';
import { fightingSample } from './sample-fighting';
import { stockDataUrl } from './stockart';

const ch = () => createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, skills: ['athletics', 'insight'] });
const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e, st.turn), s);

describe('격투 샘플: 파이널 벨', () => {
  it('검사기: 오류·경고 없음', () => {
    const issues = validateWorld(fightingSample);
    if (issues.length) console.log(issues);
    expect(issues).toEqual([]);
  });

  it('이미지가 모두 그려진다', () => {
    for (const a of fightingSample.assets!) expect(stockDataUrl(a.id), a.id).toBeTruthy();
  });

  it('대결마다 여러 시드·순서로 끝까지 진행된다', () => {
    const w = fightingSample;
    expect(w.scenes!.length).toBeGreaterThanOrEqual(6);
    for (const def of w.scenes!) {
      for (let seed = 1; seed <= 6; seed++) {
        for (const stride of [1, 3, 7]) {
          let s: GameState = { ...replay(startEvents(w, ch(), seed).map((event, seq) => ({ saveId: 's', seq, turn: 0, event }))), scene: newRun(def) };
          for (let i = 0; i <= (def.maxRounds ?? 20) && s.scene; i++) {
            const opts = sceneActions(def, s.scene).filter((a) => a.ok);
            expect(opts.length, `${def.name}: 고를 행동이 없다`).toBeGreaterThan(0);
            s = apply(s, sceneActionEvents(w, s, opts[(i * stride + seed) % opts.length]!.action.id));
          }
          expect(s.scene, `${def.name} seed ${seed} stride ${stride}`).toBeUndefined();
          expect(s.sceneResults?.[def.id]).toBeTruthy();
        }
      }
    }
  });

  it('시뮬레이터가 10일을 돌린다', () => {
    const r = simulateWorld(fightingSample, 10);
    expect(r.days.length).toBeGreaterThan(1);
  });
});
