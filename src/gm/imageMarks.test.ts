import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { paragraphsOf } from '../engine/assets';
import { replay } from '../engine/state/state';
import type { WorldPackage } from '../engine/schema';
import { imageMenu, marksToImages, mergeMarkedImages, readMarks, stripMarks } from './imageMarks';
import { startEvents } from './turn';

const npc = sampleWorld.characters[0]!;
function world(): WorldPackage {
  const w = structuredClone(sampleWorld);
  const a = (id: string, tags: string[]) => ({ id, name: id, kind: 'character' as const, characterId: npc.id, tags, mime: 'image/png', size: 1 });
  w.assets = [a('img/def', ['default']), a('img/smile', ['smile']), a('img/angry', ['angry']), a('img/eat', ['eating'])];
  return w;
}
const start = (w: WorldPackage) => replay(startEvents(w, legacyCharacter('나'), 7).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));

describe('서술 속 그림 표시 (v0.119)', () => {
  const raw = `바람이 분다.\n\n[[그림 ${npc.id} eating]]\n${npc.name}이 빵을 뜯는다.\n\n[[그림 ${npc.id} 기쁨]]\n\n그가 웃는다.`;
  it('표시를 지우고, 표시가 붙는 문단 번호를 지운 글 기준으로 센다', () => {
    const clean = stripMarks(raw);
    expect(clean).not.toContain('[[');
    expect(paragraphsOf(clean.trim()).map((p) => p.trim())).toEqual(['바람이 분다.', `${npc.name}이 빵을 뜯는다.`, '그가 웃는다.']);
    expect(readMarks(raw).map((m) => [m.kind, m.tag, m.para])).toEqual([['char', 'eating', 1], ['char', '기쁨', 2]]);
    expect(stripMarks('글 [[그림 npc/a sm')).toBe('글 ');
  });
  it('태그로 그 인물의 이미지를 고른다 — 같은 뜻의 태그(기쁨 → smile)도', () => {
    const w = world();
    const imgs = marksToImages(w, start(w), raw, '1');
    expect(imgs.map((i) => [i.id, i.para])).toEqual([['img/eat', 1], ['img/smile', 2]]);
  });
  it('표시가 없으면 엔진의 짐작을 그대로, 있으면 표시한 것으로 (배경은 엔진의 것을 이어서)', () => {
    const w = world();
    const s = start(w);
    const fb = () => [{ id: 'bg/x', caption: '장소', bg: 'same' as const }, { id: 'img/def', caption: npc.name, para: 0 }];
    expect(mergeMarkedImages(w, s, '그냥 글', '1', fb)).toEqual(fb());
    expect(mergeMarkedImages(w, s, raw, '1', fb).map((i) => i.id)).toEqual(['bg/x', 'img/eat', 'img/smile']);
  });
  it('AI에게 인물별 태그 목록을 준다', () => {
    const w = world();
    expect(imageMenu(w, start(w), [npc])).toContain('eating');
  });
});
