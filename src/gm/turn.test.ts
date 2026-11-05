import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import type { LlmClient } from '../llm/types';
import { runTurn, startEvents } from './turn';

const start = (w = sampleWorld) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

function mock(narration: string, checkKind = 'ability'): LlmClient & { users: string[] } {
  const users: string[] = [];
  return {
    users,
    stream: async (_r, onText) => { onText(narration); return narration; },
    json: async <T,>(r: { system: string; user: string }) => {
      users.push(r.user);
      if (r.system.includes('판단 모듈')) return { action_summary: '설득', check_kind: checkKind, check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '' } as T;
      if (r.system.includes('안내자')) return { summary: '요약', suggestion: '', choices: [{ text: '설득한다', skill: 'persuasion' }, { text: '본다', skill: 'nope' }] } as T;
      return { facts: [] } as T;
    },
  };
}

describe('턴: 고른 기술 · 서술에 나온 인물 이미지', () => {
  it('플레이어가 고른 기술로 판정하고, 기록에 표시한다', async () => {
    const llm = mock('조용하다.');
    const r = await runTurn(llm, sampleWorld, start(), '문지기를 설득한다', () => {}, undefined, undefined, 'skill:persuasion');
    const check = r.events.find((e) => e.type === 'check_rolled');
    expect(check && check.type === 'check_rolled' && check.skill).toContain('설득');
    expect(r.state.log.find((l) => l.kind === 'player')!.text).toContain('[설득]');
    expect(llm.users[0]).toContain('플레이어가 쓰겠다고 한 것');
    const guide = r.events.at(-1)!;
    expect(guide.type === 'gm_guide' && guide.choiceSkills).toEqual(['persuasion', '']);
  });
  it('판정이 필요 없으면 고른 기술이 있어도 굴리지 않는다', async () => {
    const r = await runTurn(mock('조용하다.', 'none'), sampleWorld, start(), '인사한다', () => {}, undefined, undefined, 'skill:persuasion');
    expect(r.events.some((e) => e.type === 'check_rolled')).toBe(false);
  });
  it('서술에 이름이 나온 인물의 이미지를 보여준다', async () => {
    const w = structuredClone(sampleWorld);
    const far = w.characters.find((c) => c.locationId !== w.start.locationId) ?? w.characters[0]!;
    w.assets = [{ id: 'stock.knight-m--0', name: 'k', kind: 'character', characterId: far.id, tags: ['default'], mime: 'image/svg+xml', size: 0 }];
    const r = await runTurn(mock(`멀리서 ${far.name}의 이야기가 들린다.`, 'none'), w, start(w), '귀를 기울인다', () => {});
    const n = r.events.find((e) => e.type === 'narration');
    expect(n && n.type === 'narration' && n.images).toContainEqual({ id: 'stock.knight-m--0', caption: far.name });
  });
});

describe('여러 인물 이미지', () => {
  it('한 글자 이름·직함으로 나온 인물과 이 장면의 인물을 모두 보여준다', async () => {
    const { mentionedCharacters } = await import('../engine/assets');
    const chars = [{ id: 'npc/yun', name: '윤', background: '직함: 윤 사무소 대표' }, { id: 'npc/finn', name: '핀' }, { id: 'npc/hed', name: '헤드비히', background: '직함: 시녀장' }];
    expect(mentionedCharacters(chars, '핀이 고개를 들자 시녀장이 웃었다. 윤은 담배를 문다.')).toEqual(['npc/finn', 'npc/hed', 'npc/yun']);
    expect(mentionedCharacters(chars, '윤기 나는 머리카락, 핀셋')).toEqual([]);

    const w = structuredClone(sampleWorld);
    const here = w.start.locationId;
    w.characters = w.characters.slice(0, 1).map((c) => ({ ...c, locationId: here }));
    w.characters.push({ ...w.characters[0]!, id: 'npc/b', name: '베르타' }, { ...w.characters[0]!, id: 'npc/c', name: '카를' });
    w.assets = w.characters.map((c, i) => ({ id: `stock.knight-m--${i}`, name: 'k', kind: 'character' as const, characterId: c.id, tags: ['default'], mime: 'image/svg+xml', size: 0 }));
    const r = await runTurn(mock('키 큰 남자가 문 앞을 막아선다.', 'none'), w, start(w), '둘러본다', () => {});
    const n = r.events.find((e) => e.type === 'narration');
    expect(n && n.type === 'narration' && n.images!.length).toBe(3);
  });
});

describe('콘텐츠 등급 안내', () => {
  it('서술·NPC AI에게 세계의 등급 안내를 준다 (성인: 노골적 묘사 허용 + 항상 금지 조항)', async () => {
    const systems: string[] = [];
    const llm: LlmClient = {
      stream: async (r: { system: string }, onText) => { systems.push(r.system); onText('.'); return '.'; },
      json: async <T,>(r: { system: string }) => {
        systems.push(r.system);
        if (r.system.includes('판단 모듈')) return { action_summary: '', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '' } as T;
        return { facts: [] } as T;
      },
    };
    const w = { ...sampleWorld, manifest: { ...sampleWorld.manifest, contentRating: 'mature' as const } };
    await runTurn(llm, w, start(w), '둘러본다', () => {});
    const narr = systems.find((s) => s.includes('서술자'))!;
    expect(narr).toContain('노골적인 묘사를 허용');
    expect(narr).toContain('미성년자');
    systems.length = 0;
    await runTurn(llm, sampleWorld, start(), '둘러본다', () => {});
    expect(systems.find((s) => s.includes('서술자'))).toContain('청소년 이용가');
  });
});

describe('기록관 (실제 모델 평가 반영)', () => {
  it('지어내기 금지 대상은 기록관에게 보여 주지 않고, 기록할 대상이 없으면 부르지 않는다', async () => {
    const w = structuredClone(sampleWorld);
    const gate = w.locations.find((l) => l.improvisation !== 'none')!;
    const none = w.characters.find((c) => c.improvisation === 'none');
    const llm = mock('조용하다.', 'none');
    await runTurn(llm, w, start(w), '주변을 본다', () => {});
    const rec = llm.users.find((u) => u.includes('## 대상 ID'));
    if (rec) {
      expect(rec).toContain(gate.id === start(w).player.locationId ? gate.id : '');
      if (none) expect(rec).not.toContain(`- ${none.id}:`);
    }
    // 모든 대상이 지어내기 금지면 기록관 호출 없음
    for (const l of w.locations) l.improvisation = 'none';
    for (const c of w.characters) c.improvisation = 'none';
    const llm2 = mock('조용하다.', 'none');
    const r = await runTurn(llm2, w, start(w), '주변을 본다', () => {});
    expect(llm2.users.some((u) => u.includes('## 대상 ID'))).toBe(false);
    expect(r.rejected).toEqual([]);
    expect(r.events.at(-1)!.type).toBe('gm_guide');
  });
});

describe('플레이어가 아는 이름 (실제 모델 평가 반영)', () => {
  it('이름을 듣기 전에는 서술 AI에게 이름 대신 외형을 주고, 대사에서 이름이 나오면 알게 된다', async () => {
    const narr: string[] = [];
    const llm: LlmClient = {
      stream: async (r, onText) => { narr.push(r.user); onText('.'); return '.'; },
      json: async <T,>(r: { system: string; user: string }) => {
        if (r.system.includes('판단 모듈')) return { action_summary: '말을 건다', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [{ npc_id: 'npc/bran', reacting_to: '인사' }], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '' } as T;
        if (r.system.includes('한 명의 NPC')) return { action: '', dialogue: narr.length ? '내 이름은 브란이오.' : '무슨 일이오.', shared_claims: [], party_decision: 'none', relationship_change: { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0, reason: '' }, expression: '', give_items: [] } as T;
        if (r.system.includes('안내자')) return { summary: '요약', suggestion: '', choices: [{ text: '본다', skill: '' }] } as T;
        return { facts: [] } as T;
      },
    };
    let s = start();
    s = { ...s, player: { ...s.player, locationId: 'loc/village-gate' } };
    const r1 = await runTurn(llm, sampleWorld, s, '경비병에게 인사한다', () => {});
    expect(narr[0]).not.toContain('브란');
    expect(narr[0]).toContain('턱수염이 희끗한 중년 경비병');
    expect(r1.state.namesKnown).not.toContain('npc/bran');
    const r2 = await runTurn(llm, sampleWorld, r1.state, '이름을 묻는다', () => {});
    expect(r2.events.some((e) => e.type === 'names_learned' && e.ids.includes('npc/bran'))).toBe(true);
    expect(narr[1]).toContain('- 브란 [npc/bran]');
    // 이전 세이브(이름 기록 없음)는 모두 아는 것으로 본다
    const legacy = { ...s, namesKnown: undefined };
    narr.length = 0;
    await runTurn(llm, sampleWorld, legacy, '인사한다', () => {});
    expect(narr[0]).toContain('- 브란 [npc/bran]');
  });
});

describe('조우 판단에 머문 시간 (실제 모델 평가 반영)', () => {
  it('Director는 이 장소에서 몇 번째 턴인지 엔진 확정 값으로 받는다', async () => {
    const users: string[] = [];
    const llm = mock('조용하다.', 'none');
    const orig = llm.json.bind(llm);
    llm.json = (async (r: { system: string; user: string }, ...rest: unknown[]) => { if (r.system.includes('판단 모듈')) users.push(r.user); return (orig as (...a: unknown[]) => unknown)(r, ...rest); }) as typeof llm.json;
    const r1 = await runTurn(llm, sampleWorld, start(), '주변을 본다', () => {});
    expect(users[0]).toContain('이번이 이 장소에서의 첫 턴이다');
    await runTurn(llm, sampleWorld, r1.state, '계속 기다린다', () => {});
    expect(users[1]).toContain('이 장소에서 2번째 턴이다');
  });
});
