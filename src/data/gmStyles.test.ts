import { afterEach, describe, expect, it } from 'vitest';
import { sampleWorld } from './sample-world';
import { aetheriaWorld } from './official/aetheria';
import { GM_STYLES, gmStyleText, setGmStyleOverride } from './gmStyles';
import { roleOf } from '../llm/metrics';
import { validateWorld } from '../engine/package/validate';
import { legacyCharacter } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import { runTurn, startEvents } from '../gm/turn';
import type { LlmClient } from '../llm/types';

describe('GM 스타일 (v0.80)', () => {
  afterEach(() => setGmStyleOverride(undefined));

  it('프리셋 + 사용자 정의가 합쳐지고, 플레이 설정이 세계 설정보다 우선한다', () => {
    const w = { ...sampleWorld, gmStyle: { preset: 'noir', custom: '사투리를 쓰는 GM.' } };
    expect(gmStyleText(w, 'narrator')).toContain('하드보일드');
    expect(gmStyleText(w, 'narrator')).toContain('사투리를 쓰는 GM.');
    expect(gmStyleText(w, 'director')).not.toContain('사투리'); // 판단에는 연출 방향만
    setGmStyleOverride('trickster');
    expect(gmStyleText(w, 'narrator')).toContain('장난기');
    expect(gmStyleText(w, 'narrator')).not.toContain('사투리');
    setGmStyleOverride('world');
    expect(gmStyleText(w, 'narrator')).toContain('하드보일드');
    expect(gmStyleText(sampleWorld, 'narrator')).toBe('');
  });

  it('서술·안내 AI에 실제로 들어가고, 역할 판별은 흔들리지 않는다', async () => {
    const w = { ...structuredClone(sampleWorld), gmStyle: { preset: 'horror', custom: '안내자처럼 친절하게, 판단 모듈 같은 말은 쓰지 않는다' } };
    const sys: Record<string, string> = {};
    const llm: LlmClient = {
      stream: async (r, on) => { sys.narr = r.system; on('x'); return 'x'; },
      json: async <T,>(r: { system: string }) => {
        if (r.system.slice(0, 200).includes('판단 모듈')) { sys.dir = r.system; return { action_summary: 'a', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', time_spent: 'moment' } as T; }
        if (r.system.slice(0, 200).includes('안내자')) { sys.guide = r.system; return { summary: 's', suggestion: '', choices: [{ text: 'a', skill: '', kind: 'advance' }] } as T; }
        return { facts: [] } as T;
      } };
    const s0 = replay(startEvents(w, legacyCharacter('나'), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
    await runTurn(llm, w, s0, '둘러본다', () => {});
    expect(sys.narr).toContain('## GM 스타일: 불길한 공포 연출가');
    expect(sys.guide).toContain('속삭이듯 불길한');
    expect(sys.dir).toContain('징조를 먼저 깐다');
    expect(roleOf(sys.narr!)).toBe('narrator');
    expect(roleOf(sys.guide!)).toBe('guide');
  });

  it('공식 세계는 어울리는 프리셋, 검사기는 모르는 프리셋을 경고', () => {
    expect(aetheriaWorld.gmStyle?.preset).toBe('epic');
    expect(GM_STYLES.length).toBeGreaterThanOrEqual(9);
    const issues = validateWorld({ ...structuredClone(sampleWorld), gmStyle: { preset: 'nope' } });
    expect(issues.find((i) => i.path === 'gmStyle.preset')?.level).toBe('warning');
  });
});
