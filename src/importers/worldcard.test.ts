import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { sampleWorld } from '../data/sample-world';
import { validateWorld } from '../engine/package/validate';
import { parseCardFile, replaceMacros } from './charx';
import { defaultLoreChoices } from './toWorld';
import { analyzeEntries, dropExplicit, findImage, isWorldCard, profileFields, worldCardToEntities } from './worldcard';

/** 실제 RisuAI 세계관 카드의 구조를 흉내 낸 합성 카드 (원본 파일은 저장소에 넣지 않는다) */
const entry = (name: string, content: string, extra = {}) => ({ keys: [], content, enabled: true, name, comment: name, mode: 'normal', ...extra });
const profile = (latin: string, sex: string) => `{{#when::kc_p_${latin}::tisnot::1}}\n<${latin}>\n### ${latin} Example\n\n#### Basic\n- Sex: ${sex}\n- Role: Knight\n\n#### Appearance\n- Body: Tall.\n- Intimate: (explicit)\n\n#### Voice\n- Calm, few words. Calls {{user}} "Your Majesty."\n\n#### Personality\nLoyal to a fault.\n{{/when}}`;
const card = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: '테스트 시뮬레이터', description: '### Core Setting\n- Absolute rule: 테스트 시뮬레이터 is the name of the roleplaying simulator, not the character.',
    personality: '', scenario: '', first_mes: '◆▶◆\n::is::fm_free}}\n{{user}} was dreaming.', mes_example: '',
    character_book: { entries: [
      entry('⚙️시스템', '', { mode: 'folder' }),
      entry('상태창', '### STATUS RULE\n- End every response with exactly one STATUS line.'),
      entry('에셋출력식', 'Show it with an image tag: <img src="Hedwig">'),
      entry('세계관', '### The World\n- Mana and spirits.\n### Politics\n- The Emperor rules.'),
      entry('♂️헤드비히(Hedwig)', profile('Hedwig', 'Male')),
      entry('♀️헤드비히(Hedwig)', profile('Hedwig', 'Female')),
      entry('♀️시녀장 셀레니아(Selenia)', profile('Selenia', 'Female')),
      entry('♂️카르엔야(NPC 버전)', '### Karenya Valkzephas\n#### Appearance\n- Silver hair.\n'.padEnd(900, '.')),
      entry('빙의상태 카르엔야 설정(공식 외모)', '### Immediately After\n당신 is not Karenya of yesterday.'),
    ] },
    extensions: { risuai: { backgroundHTML: '<style>x</style>', toggles: 'a=1' }, depth_prompt: { depth: 0, prompt: 'hidden' } },
    assets: [
      { type: 'icon', uri: 'embeded://assets/icon/image/main.png', name: 'main', ext: 'png' },
      { type: 'x-risu-asset', uri: 'embeded://assets/other/image/Hedwig(M).webp', name: 'Hedwig(M)', ext: 'webp' },
      { type: 'x-risu-asset', uri: 'embeded://assets/other/image/Hedwig(F).webp', name: 'Hedwig(F)', ext: 'webp' },
    ],
  },
};
const zip = () => zipSync({
  'card.json': strToU8(JSON.stringify(card)), 'module.risum': new Uint8Array([1, 2, 3]),
  'assets/icon/image/main.png': new Uint8Array([137, 80, 78, 71]), 'assets/other/image/Hedwig(M).webp': new Uint8Array([1]), 'assets/other/image/Hedwig(F).webp': new Uint8Array([2]),
});

describe('실제 RisuAI 카드 형태', () => {
  it('표지 JPEG 뒤에 zip이 붙은 CHARX도 읽는다', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, ...new Array(500).fill(7)]);
    const z = zip();
    const poly = new Uint8Array(jpeg.length + z.length);
    poly.set(jpeg); poly.set(z, jpeg.length);
    const { card: c, error } = parseCardFile('x.charx', poly);
    expect(error).toBeUndefined();
    expect(c!.name).toBe('테스트 시뮬레이터');
    expect(c!.images.map((i) => i.name)).toEqual(['main', 'Hedwig(M)', 'Hedwig(F)']);
    expect(c!.unsupported.join(' / ')).toMatch(/배경 HTML.*토글.*깊이 프롬프트.*module\.risum/);
  });
  it('중첩 CBS·HTML 태그·잔여 줄을 지운다', () => {
    expect(replaceMacros('{{#when::{{equal::{{getglobalvar::t}}::2}}}}내용{{/when}} <img src="a"> <Hedwig>끝</Hedwig>', 'X')).toBe('내용 끝');
    expect(replaceMacros('◆\n::is::fm_free}}\n{{user}}는 꿈을 꾼다.', 'X')).toBe('◆\n\n당신은 꿈을 꾼다.');
  });
  it('세계관 카드 분석: 인물·설정·AI 지시문, 같은 인물의 다른 버전, 초상화 연결', () => {
    const { card: c } = parseCardFile('x.charx', zip());
    const an = analyzeEntries(c!);
    expect(isWorldCard(c!, an)).toBe(true);
    const by = (n: string) => an.find((a) => c!.lore[a.index]!.name === n)!;
    expect(by('상태창').kind).toBe('instruction');
    expect(by('에셋출력식').choice).toBe('skip');
    expect(by('세계관').kind).toBe('world');
    expect(by('♂️헤드비히(Hedwig)')).toMatchObject({ kind: 'character', choice: 'character', displayName: '헤드비히', latin: 'Hedwig', gender: 'M' });
    expect(by('♀️헤드비히(Hedwig)').choice).toBe('skip');
    expect(by('♀️시녀장 셀레니아(Selenia)')).toMatchObject({ displayName: '셀레니아', title: '시녀장', gender: 'F' });
    expect(by('♂️카르엔야(NPC 버전)')).toMatchObject({ kind: 'character', displayName: '카르엔야', latin: 'Karenya' });
    expect(by('빙의상태 카르엔야 설정(공식 외모)').kind).toBe('world');
    expect(findImage(c!, by('♀️헤드비히(Hedwig)'))?.name).toBe('Hedwig(F)');
    // 단일 인물 모드에서도 AI 지시문은 기본 제외
    expect(defaultLoreChoices(c!)[c!.lore.findIndex((e) => e.name === '상태창')]).toBe('skip');
  });
  it('프로필 구역 → 인물 필드, 성인 등급이 아니면 노골적 줄 제외', () => {
    const e = { name: 'x', keys: [], enabled: true, content: profile('Hedwig', 'Male') };
    const f = profileFields(e, '헤드비히', false);
    expect(f.appearance).toBe('- Body: Tall.');
    expect(f.speech).toContain('Calls 당신 "Your Majesty."');
    expect(f.personality).toBe('Loyal to a fault.');
    expect(f.background).toContain('[Basic] - Sex: Male');
    expect(JSON.stringify(f)).not.toMatch(/Intimate|\{\{|<Hedwig>/);
    expect(profileFields(e, '헤드비히', true).appearance).toContain('Intimate');
    expect(dropExplicit('- Intimate: x\n- Body: y')).toBe('- Body: y');
  });
  it('여러 인물 + 세계 지식으로 변환, 검사 오류 없음', () => {
    const { card: c } = parseCardFile('x.charx', zip());
    const an = analyzeEntries(c!);
    const r = worldCardToEntities(c!, sampleWorld, an, { choices: an.map((a) => a.choice), locationId: 'loc/inn', mature: false });
    expect(r.characters.map((x) => x.name)).toEqual(['헤드비히', '셀레니아', '카르엔야']);
    expect(r.characters[1]!.background).toMatch(/^직함: 시녀장/);
    expect(r.claims.length).toBeGreaterThanOrEqual(3); // 세계관 2구역 + 빙의 설정
    expect(r.beliefs).toHaveLength(r.claims.length * 3);
    const merged = { ...sampleWorld, characters: [...sampleWorld.characters, ...r.characters], claims: [...sampleWorld.claims, ...r.claims], beliefs: [...sampleWorld.beliefs, ...r.beliefs] };
    expect(validateWorld(merged).filter((i) => i.level === 'error')).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/STATUS RULE|image tag|Absolute rule|hidden/);
  });
});
