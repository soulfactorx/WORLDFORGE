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
  it('흘러나오는 동안 놓인 그림은 저장되는 그림에 그대로 — 같은 그림·같은 자리 (v0.137 고정)', async () => {
    const hero = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
    const state = replay(startEvents(wuxiaSample, hero, 5).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    let place: ImagePlacer | null = null;
    let narrated = 0;
    // 화면이 하는 대로: 글이 흘러나오는 동안 끝난 문단까지로 그림을 놓는다
    let sofar = '';
    const shown: NarrationImage[][] = [];
    const onText = (d: string) => {
      sofar += d;
      const cut = sofar.lastIndexOf('\n\n');
      if (place && cut > 0) shown.push([...place(sofar.slice(0, cut))]);
    };
    const r = await runTurn(mock(), wuxiaSample, state, '주모에게 인사한다', onText, undefined, () => {}, undefined, undefined, { onImages: (p) => { place = p; }, onNarrated: () => { narrated++; } });
    expect(place).not.toBeNull();
    expect(narrated).toBe(1);
    const saved = (r.events.find((e) => e.type === 'narration') as { images?: NarrationImage[] }).images ?? [];
    expect(saved.length).toBeGreaterThan(1);
    expect(shown.length).toBeGreaterThan(0);
    // 흘러나오는 동안 보인 그림은 모두 저장된 목록에 같은 자리로 있다 (끝난 뒤 바뀌지 않는다)
    for (const step of shown) for (const im of step) expect(saved).toContainEqual(im);
    // 배경은 처음부터, 주모는 둘째 문단에
    expect(shown[0]!.some((x) => x.bg)).toBe(true);
    expect(saved.find((x) => x.caption === '왕 주모')?.para).toBe(1);
    expect(paragraphsOf(NARR).length).toBe(3);
  });
});
