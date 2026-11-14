import { describe, expect, it } from 'vitest';
import type { AssetMeta } from '../engine/schema';
import { applyScriptHints, linkFromScripts } from './scriptLinks';
import { extractLuaData } from './luadata';

const chars = [{ id: 'npc/lia', aliases: ['리아', 'Lia'] }, { id: 'npc/yun', aliases: ['윤세아'] }, { id: 'npc/bo', aliases: ['보리'] }];
const locs = [{ id: 'loc/town', aliases: ['마을'] }];
const names = ['a01', 'a02', 'a03', 'c1_웃음', 'c1_화남', 'c2_웃음', 'img_034', 'img_035', 'img_036', 'img_040', 'x9', 'bg7'];
const hint = (m: Map<string, unknown>, n: string) => m.get(n) as { characterId?: string; locationId?: string; tags: string[]; via: string } | undefined;

describe('카드 스크립트에서 이미지 연결 (v0.124)', () => {
  it('① 정규식: 고정 이름과 잡은 값을 쓰는 이름', () => {
    const m = linkFromScripts(names, chars, locs, { rules: [
      { in: '\\[리아:웃음\\]', out: '<img src="{{raw::a01}}">', comment: '리아 웃음' },
      { in: '<세아_화남>', out: '{{img::a02}}' },
      { in: '\\[리아:(.+?)\\]', out: '{{raw::c1_$1}}' },
      { in: '\\[(.+?):(.+?)\\]', out: '{{raw::$1_$2}}' }, // 이름 전체가 잡은 값 — 단서 없음
    ] });
    expect(hint(m, 'a01')).toMatchObject({ characterId: 'npc/lia', tags: ['웃음'], via: 'regex' });
    expect(hint(m, 'a02')).toMatchObject({ characterId: 'npc/yun', tags: ['화남'] });
    expect(hint(m, 'c1_화남')).toMatchObject({ characterId: 'npc/lia', tags: ['화남'] });
    expect(hint(m, 'c2_웃음')).toBeUndefined();
  });
  it('② Lua 표: 거쳐 온 열쇠와 이름 칸', () => {
    const lua = extractLuaData(`
local emo = { lia = { happy = "img_034", sad = "img_035" }, ["윤세아"] = { angry = "img_036.png" } }
local cast = { { name = "보리", default = "img_040" } }
`);
    const m = linkFromScripts(names, chars, locs, { luaData: lua });
    expect(hint(m, 'img_034')).toMatchObject({ characterId: 'npc/lia', tags: ['happy'], via: 'lua' });
    expect(hint(m, 'img_036')).toMatchObject({ characterId: 'npc/yun', tags: ['angry'] });
    expect(hint(m, 'img_040')).toMatchObject({ characterId: 'npc/bo', tags: ['default'] });
  });
  it('③ 로어북 글: 토막 → 줄 → 제목 → 항목 이름', () => {
    const m = linkFromScripts(names, chars, locs, { texts: [
      { name: '이미지 목록', content: '## 리아\n웃음: a01, 화남: a02\n\n보리 슬픔 a03 / 윤세아 놀람 x9' },
      { name: '마을', keys: ['마을'], content: '밤 풍경은 bg7 을 쓴다' },
    ] });
    expect(hint(m, 'a01')).toMatchObject({ characterId: 'npc/lia', tags: ['웃음'], via: 'text' });
    expect(hint(m, 'a02')).toMatchObject({ characterId: 'npc/lia', tags: ['화남'] });
    expect(hint(m, 'a03')).toMatchObject({ characterId: 'npc/bo', tags: ['슬픔'] });
    expect(hint(m, 'x9')).toMatchObject({ characterId: 'npc/yun', tags: ['놀람'] });
    expect(hint(m, 'bg7')).toMatchObject({ locationId: 'loc/town' });
  });
  it('정규식 단서가 글 단서보다 먼저', () => {
    const m = linkFromScripts(names, chars, locs, { rules: [{ in: '보리', out: '{{raw::a01}}' }], texts: [{ name: '', content: '리아 a01' }] });
    expect(hint(m, 'a01')!.characterId).toBe('npc/bo');
  });
  it('적용: 분류 안 됨만 바꾸고, 기본 모습만 있는 같은 인물 그림엔 태그만', () => {
    const a = (name: string, extra: Partial<AssetMeta> = {}): AssetMeta => ({ id: name, name, kind: 'other', tags: [], mime: 'image/png', size: 1, ...extra });
    const hints = new Map([
      ['a01', { characterId: 'npc/lia', tags: ['웃음'], via: 'regex' as const, from: '' }],
      ['a02', { characterId: 'npc/lia', tags: ['화남'], via: 'text' as const, from: '' }],
      ['a03', { tags: ['슬픔'], via: 'text' as const, from: '' }],
      ['a04', { characterId: 'npc/yun', tags: ['놀람'], via: 'lua' as const, from: '' }],
    ]);
    const r = applyScriptHints([a('a01'), a('a02', { kind: 'character', characterId: 'npc/lia', tags: ['default'] }), a('a03'), a('a04', { kind: 'character', characterId: 'npc/lia', tags: ['smile'] })], hints, { mainCharacterId: 'npc/lia' });
    expect(r.assets.map((x) => [x.kind, x.characterId, x.tags.join()])).toEqual([
      ['character', 'npc/lia', '웃음'], ['character', 'npc/lia', '화남'], ['character', 'npc/lia', '슬픔'], ['character', 'npc/lia', 'smile'],
    ]);
    expect(r.stats).toEqual({ regex: 1, lua: 0, text: 2 });
  });
});

describe('charx 파일 전체 경로 (v0.124)', () => {
  it('카드의 정규식·트리거 Lua·로어북에서 연결을 읽는다', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const { readCharxBundle } = await import('./bundle');
    const { bundleSources } = await import('./scriptLinks');
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const card = { spec: 'chara_card_v3', data: {
      name: '리아와 친구들', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
      assets: ['a01', 'a02', 'a03'].map((n) => ({ type: 'x-risu-asset', name: n, ext: 'png', uri: `embeded://assets/other/image/${n}.png` })),
      character_book: { entries: [{ keys: ['보리'], content: '보리 슬픔: a03', name: '보리 이미지' }] },
      extensions: { risuai: {
        customScripts: [{ comment: '리아 웃음', in: '\\[리아:웃음\\]', out: '{{raw::a01}}', type: 'editdisplay' }],
        triggerscript: [{ effect: [{ type: 'triggerlua', code: 'local emo = { ["윤세아"] = { angry = "a02" } }' }] }],
      } },
    } };
    const zip = zipSync({ 'card.json': strToU8(JSON.stringify(card)), 'assets/other/image/a01.png': png, 'assets/other/image/a02.png': png, 'assets/other/image/a03.png': png });
    const b = await readCharxBundle(new Blob([zip]), 'c.charx');
    expect(b.regexRules).toHaveLength(1);
    const m = linkFromScripts(b.assets.map((a) => a.name), chars, locs, bundleSources(b));
    expect(hint(m, 'a01')).toMatchObject({ characterId: 'npc/lia', via: 'regex' });
    expect(hint(m, 'a02')).toMatchObject({ characterId: 'npc/yun', tags: ['angry'], via: 'lua' });
    expect(hint(m, 'a03')).toMatchObject({ characterId: 'npc/bo', tags: ['슬픔'], via: 'text' });
  });
});
