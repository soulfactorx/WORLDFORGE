import { describe, expect, it } from 'vitest';
import { makeCharx } from '../../test/charx';
import { readCharxBundle } from '../../importers/bundle';
import { hasErrors } from '../../engine/package/validate';
import { exportWpk } from '../../storage/packages';
import type { LlmClient } from '../../llm/types';
import { cardToWorld, type CardWorldDraft } from './fromCard';
import { startEvents } from '../turn';
import { legacyCharacter } from '../../engine/character/sheet';

const profile = (n: string) => `### ${n}\n#### Appearance\n은발에 붉은 눈.\n#### Personality\n냉정하다.\n#### Voice\n짧게 말한다.\n#### Background\n오래 일했다.`;
const lore = [
  { comment: '시녀장 헤드비히(Hedwig)', keys: ['헤드비히'], content: profile('Hedwig') },
  { comment: '♀️황제 카르엔야(Karenya)', keys: ['카르엔야'], content: profile('Karenya') },
  { comment: '세계관', keys: ['제국'], content: '## 제국\n발크제파스 제국은 대륙 서쪽에 있다.\n## 황궁\n황궁에는 장미 정원이 있다.' },
  { comment: '상태창 출력 규칙', keys: [], content: 'Absolute rule: end every response with a status window.' },
];
const images = ['Hedwig(F)', 'Hedwig_smile', 'Karenya(F)', 'Karenya(M)', 'garden_rain', 'palace_map', '???'];

const draft: CardWorldDraft = {
  name: '파멸 예정 황궁', premise: '요약', style: '건조하고 우아한 3인칭 궁정 문체.', start_location: 'bedchamber', opening_scene: '비단 이불 속에서 눈을 뜬다.',
  locations: [
    { key: 'bedchamber', name: '황제의 침실', description: '향 냄새.', connections: ['garden'], improvisation: 'none' },
    { key: 'garden', name: '장미 정원', description: '장미 향.', connections: [], improvisation: 'minor' },
  ],
  character_places: [
    { character: 'npc/hedwig', location: 'bedchamber', improvisation: 'none', initial_affinity: 10, initial_trust: 20, companion_class: '', join_condition: '' },
    { character: 'npc/karenya', location: 'nowhere', improvisation: 'none', initial_affinity: 0, initial_trust: 0, companion_class: '', join_condition: '' },
  ],
  timeline: [
    { key: 'ruin', when: '429년 9월 21일', title: '제국 멸망', statement: '제국이 무너진다.', status: 'future', secrecy: 4, protected_topic: '멸망의 날', known_by: ['npc/hedwig', 'npc/ghost'], rumor_by: [] },
    { key: 'ball', when: '429년 6월 20일', title: '무도회', statement: '무도회가 열린다.', status: 'past', secrecy: 0, protected_topic: '', known_by: [], rumor_by: ['npc/hedwig'] },
  ],
  starts: [
    { key: 'karenya', name: '황제에게 빙의', description: '당신은 황제가 되었다.', location: 'bedchamber', opening_scene: '거울 속 얼굴이 낯설다.', knows: ['ruin', 'ball'] },
    { key: 'native', name: '이 세계 사람', description: '시녀로 시작한다.', location: 'garden', opening_scene: '정원을 쓸고 있다.', knows: [] },
  ],
  plot_request: '멸망을 막는다.',
  calendar: { era: '제국력', start_year: 429, start_month: 6, start_day: 13, countdown_label: '파멸', countdown_year: 429, countdown_month: 9, countdown_day: 21 },
};

function mockLlm(seen: string[]): LlmClient {
  return {
    stream: async () => '',
    json: async <T,>(req: { system: string; user: string }) => {
      seen.push(req.user);
      if (req.system.includes('다른 플랫폼용 캐릭터 카드')) return draft as T;
      if (req.system.includes('이미지 정리')) return { items: [{ index: 0, kind: 'character', character: 'npc/hedwig', location: '', tags: ['Angry!'] }] } as T;
      return { encounters: [], flags: [], quests: [{ key: 'save', name: '멸망 막기', kind: 'main', start: { op: 'all', items: [] }, stages: [{ objective: '진실을 안다', hint: '', complete: { op: 'all', items: [{ type: 'knows', ref: 'ruin', min: '', axis: '', value: 0 }] } }], reward_xp: 100 }],
        endings: [{ key: 'saved', name: '구원', condition: { op: 'all', items: [{ type: 'quest_done', ref: 'save', min: '', axis: '', value: 0 }] }, epilogue: '제국은 살아남았다.' }] } as T;
    },
  };
}

describe('cardToWorld', () => {
  it('카드 전체 → 개인용 세계 (인물·장소·연표·시작 방식·문체·이미지·임무)', async () => {
    const b = await readCharxBundle(makeCharx(100, images.length, { lore, images }), 'w.charx');
    const seen: string[] = [];
    const r = await cardToWorld(mockLlm(seen), b, { contentRating: 'teen', classifyImages: true, withScenario: true }, () => {});
    const w = r.world;
    expect(hasErrors(r.issues)).toBe(false);
    expect(w.manifest.private?.source).toContain('세계');
    expect(() => exportWpk(w)).toThrow('개인용');
    // 인물은 원문 프로필을 그대로 쓴다
    const hed = w.characters.find((c) => c.id === 'npc/hedwig')!;
    expect(hed.appearance).toContain('은발');
    expect(hed.locationId).toBe('loc/bedchamber');
    expect(w.characters.find((c) => c.id === 'npc/karenya')!.locationId).toBe(w.start.locationId);
    expect(w.characters.find((c) => c.id === 'npc/karenya')!.gender).toBe('F');
    // 연표 → 비밀 사실 + 아는 인물
    expect(w.facts.some((f) => f.protectedTopic === '멸망의 날')).toBe(true);
    expect(w.beliefs).toContainEqual({ holder: 'npc/hedwig', claim: 'claim/ruin', state: 'secret' });
    // 아는 사람이 없는 지난 공공연한 사건은 모두가 안다
    expect(w.beliefs.filter((x) => x.claim === 'claim/ball').map((x) => x.state)).toEqual(['confirmed', 'confirmed']);
    expect(w.beliefs.some((x) => x.holder === 'npc/ghost')).toBe(false);
    // 시작 방식
    expect(w.starts!.map((s) => s.id)).toEqual(['start/karenya', 'start/native']);
    expect(w.starts![0]!.knows).toEqual(['claim/ruin', 'claim/ball']);
    expect(w.style).toContain('궁정');
    expect(w.calendar).toEqual({ era: '제국력', year: 429, month: 6, day: 13, countdown: { label: '파멸', year: 429, month: 9, day: 21 } });
    // 이미지: 이름 규칙 + AI 분류 + 표지
    const kinds = Object.fromEntries(w.assets!.map((a) => [a.name, `${a.kind}:${a.characterId ?? a.locationId ?? ''}:${a.tags.join(',')}`]));
    expect(kinds['Hedwig_smile']).toBe('character:npc/hedwig:smile');
    expect(kinds['garden_rain']).toBe('scene:loc/garden:rain');
    expect(kinds['palace_map']).toMatch(/^map/);
    expect(kinds['cover']).toMatch(/^cover/);
    expect(r.images.length).toBe(w.assets!.length);
    expect((await r.images.find((x) => x.id === w.assets!.find((a) => a.name === 'cover')!.id)!.read()).size).toBe(100);
    // 임무
    expect(w.quests![0]!.stages[0]!.complete).toEqual({ knows: 'claim/ruin' });
    // AI 지시문 항목은 넣지 않는다
    expect(seen[0]).not.toContain('Absolute rule');
    expect(seen[0]).toContain('발크제파스');
    // 시작 방식으로 게임 시작: 장소·첫 장면·처음부터 아는 것
    const ev = startEvents(w, legacyCharacter('나'), 1, 'start/native');
    expect(ev[0]).toMatchObject({ type: 'game_started', locationId: 'loc/garden', startId: 'start/native' });
    expect(ev[1]).toMatchObject({ type: 'narration' });
    expect((ev[1] as { text: string }).text).toContain('정원을 쓸고');
    const ev2 = startEvents(w, legacyCharacter('나'), 1, 'start/karenya');
    expect(ev2.filter((e) => e.type === 'knowledge_revealed').length).toBe(2);
    expect(w.assets!.find((a) => a.name === '???')).toMatchObject({ kind: 'character', characterId: 'npc/hedwig', tags: ['angry'] });
  });
});

describe('보완·이미지 대체', () => {
  it('아무도 모르는 지식을 이름이 나오는 인물에게 연결하고, 말한 인물 이미지가 없으면 다른 이미지를 보여준다', async () => {
    const { fillOrphanKnowledge } = await import('./fromCard');
    const { fallbackImage } = await import('../turn');
    const { sampleWorld } = await import('../../data/sample-world');
    const { applyEvent, initialState } = await import('../../engine/state/state');
    const w = structuredClone(sampleWorld);
    const npc = w.characters[0]!;
    w.claims.push({ id: 'claim/orphan', statement: `[416년] ${npc.name}이(가) 처음 궁에 왔다.`, truth: 'true' }, { id: 'claim/nobody', statement: '아무 관련 없는 일', truth: 'true' });
    w.facts.push({ id: 'fact/x', statement: '비밀', secrecy: 4, protectedTopic: '그 일' });
    const r = fillOrphanKnowledge(w);
    expect(r.world.beliefs).toContainEqual({ holder: npc.id, claim: 'claim/orphan', state: 'confirmed' });
    expect(r.world.beliefs.some((b) => b.claim === 'claim/nobody')).toBe(false);
    expect(r.world.facts.find((f) => f.id === 'fact/x')!.subjects!.length).toBe(w.characters.length);
    // 이미지 대체: 이 장소 인물 → 지도 → 표지
    const s = applyEvent(initialState(), { type: 'game_started', packageId: w.manifest.id, packageVersion: '1', seed: 1, locationId: npc.locationId, playerName: 'p' }, 0);
    w.assets = [{ id: 'm', name: 'map', kind: 'map', tags: [], mime: 'image/png', size: 1 }, { id: 'c', name: 'cover', kind: 'cover', tags: [], mime: 'image/png', size: 1 }];
    expect(fallbackImage(w, s, '1')!.id).toBe('m');
    w.assets.push({ id: 'p', name: 'x', kind: 'character', characterId: npc.id, tags: ['default'], mime: 'image/png', size: 1 });
    expect(fallbackImage(w, s, '1')).toEqual({ id: 'p', caption: npc.name });
  });
});
