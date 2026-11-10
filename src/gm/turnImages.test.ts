import { describe, expect, it } from 'vitest';
import { wuxiaSample } from '../data/sample-genres';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { paragraphsOf } from '../engine/assets';
import type { NarrationImage } from '../engine/state/events';
import { replay } from '../engine/state/state';
import type { LlmClient, LlmRequest } from '../llm/types';
import { type ImagePlacer, runTurn, startEvents } from './turn';

/** 글이 흘러나오는 동안의 그림 (v0.88): 미리 놓은 그림이 끝난 뒤 저장되는 그림과 같은 자리여야 한다 */
const NARR = '당신은 객잔 문턱을 넘는다. 붉은 등롱이 흔들린다.\n\n왕 주모가 행주를 어깨에 걸친다. "어서 오시오, 손님!"\n\n구석 탁자에서 설하연이 찻잔을 내려놓고 이쪽을 본다.';
function mock(): LlmClient {
  return {
    async stream(_req, onText) { for (const part of NARR.split(/(?<=\n\n)/)) onText(part); return NARR; },
    async json<T>(req: LlmRequest) {
      if (req.system.includes('판단 모듈')) return { action_summary: '인사', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [{ npc_id: 'npc/wang', reacting_to: '인사' }], start_encounter: '', rest: 'none', discover: [], set_flags: [], take_items: [], scene_image: '' } as T;
      if (req.system.includes('한 명의 NPC')) return { action: '', dialogue: '어서 오시오, 손님!', shared_claims: [], party_decision: 'none', relationship_change: { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0, reason: '' }, expression: '', give_items: [] } as T;
      if (req.system.includes('안내자')) return { summary: '', suggestion: '', choices: [] } as T;
      return { facts: [], summary: '' } as T;
    },
  };
}

describe('서술과 함께 놓이는 그림 (v0.88)', () => {
  it('문단이 끝날 때마다 놓은 그림은 최종 배치와 같은 그림·같은 자리다', async () => {
    const hero = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
    const state = replay(startEvents(wuxiaSample, hero, 5).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    let place: ImagePlacer | null = null;
    let narrated = 0;
    const r = await runTurn(mock(), wuxiaSample, state, '주모에게 인사한다', () => {}, undefined, () => {}, undefined, undefined, { onImages: (p) => { place = p; }, onNarrated: () => { narrated++; } });
    expect(place).not.toBeNull();
    expect(narrated).toBe(1);
    const saved = (r.events.find((e) => e.type === 'narration') as { images?: NarrationImage[] }).images ?? [];
    expect(saved.length).toBeGreaterThan(1);
    // 다 나온 글로 부르면 저장된 것과 같다
    expect(place!(NARR)).toEqual(saved);
    // 문단이 하나씩 끝날 때: 배경은 처음부터, 인물은 그 인물이 나온 문단이 끝났을 때 — 자리(para)는 최종과 같다
    const paras = paragraphsOf(NARR);
    const byCaption = new Map(saved.filter((x) => !x.bg).map((x) => [x.caption, x]));
    for (let n = 0; n <= paras.length; n++) {
      const sofar = paras.slice(0, n).join('\n\n');
      const now = place!(sofar);
      expect(now.some((x) => x.bg && x.id === saved.find((y) => y.bg)!.id)).toBe(true);
      for (const im of now.filter((x) => !x.bg && x.para !== undefined)) {
        expect(im.para!).toBeLessThan(n);
        expect(byCaption.get(im.caption)).toMatchObject({ para: im.para });
      }
    }
    // 주모는 둘째 문단에서 말하므로 둘째 문단이 끝나면 그 앞에 놓인다
    expect(place!(paras.slice(0, 2).join('\n\n')).find((x) => x.caption === '왕 주모')?.para).toBe(1);
    expect(place!(paras.slice(0, 1).join('\n\n')).find((x) => x.caption === '왕 주모')?.para).toBeUndefined();
  });
});
