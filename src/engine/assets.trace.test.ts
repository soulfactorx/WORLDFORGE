import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { imageNote } from '../debug/trace';
import { contextExpression, expressionTags, mentionedImages, pickCharacterImage, pickSceneImage, traceImages } from './assets';
import type { AssetMeta, WorldPackage } from './schema';

const a = (id: string, characterId: string, tags: string[]): AssetMeta => ({ id, name: `${id}.png`, kind: 'character', characterId, tags, mime: 'image/png', size: 1 });
const npc = sampleWorld.characters[0]!;
const w: WorldPackage = {
  ...sampleWorld,
  assets: [a('img/smile', npc.id, ['smile']), a('img/def', npc.id, ['default']), { id: 'img/loc', name: 'loc.png', kind: 'scene', locationId: sampleWorld.start.locationId, tags: ['night'], mime: 'image/png', size: 1 }],
};

describe('이미지 고른 근거 (v0.57.4)', () => {
  it('표정 짐작 → 태그 일치 → 고른 이미지까지 기록한다', () => {
    const text = `${npc.name}이(가) 활짝 웃었다.`;
    const { result, picks } = traceImages(() => pickCharacterImage(w, npc.id, contextExpression(text, [npc.name], expressionTags(w, npc.id)), '1'));
    expect(result?.id).toBe('img/smile');
    expect(picks[0]).toMatchObject({ step: '표정 짐작', resolved: 'smile' });
    expect(picks[0]!.rule).toContain('웃');
    expect(picks[1]).toMatchObject({ step: '인물 이미지', resolved: 'smile', chosen: 'img/smile', candidates: 1 });
  });
  it('맞는 태그가 없으면 기본 이미지로, 이유를 남긴다', () => {
    const { result, picks } = traceImages(() => pickCharacterImage(w, npc.id, 'angry', '1'));
    expect(result?.id).toBe('img/def');
    expect(picks[0]!.rule).toContain('기본 이미지');
    expect(picks[0]!.wanted).toBe('angry');
  });
  it('장소 이미지·서술 언급도 기록하고, 기록 밖에서는 아무것도 모으지 않는다', () => {
    const { picks } = traceImages(() => { pickSceneImage(w, w.start.locationId, 'night', '1'); return mentionedImages(w, `${npc.name}가 서 있다.`, '1'); });
    expect(picks.map((p) => p.step)).toEqual(expect.arrayContaining(['장소 이미지', '서술 언급', '인물 이미지']));
    expect(picks.find((p) => p.step === '장소 이미지')!.rule).toContain('"night"');
    expect(() => pickCharacterImage(w, npc.id, '', '2')).not.toThrow();
  });
  it('imageNote: 고른 이미지마다 근거와 세부 규칙을 붙인다', () => {
    const { result, picks } = traceImages(() => pickCharacterImage(w, npc.id, 'smile', '1'));
    const n = imageNote([{ id: result!.id, caption: npc.name }], ['말한 인물: NPC 연기 AI가 표정 "smile"을 고름', '(장소 이미지 생략)'], picks);
    expect(n.chosen[0]).toMatchObject({ id: 'img/smile', why: '말한 인물: NPC 연기 AI가 표정 "smile"을 고름' });
    expect(n.chosen[0]!.detail).toContain('태그 "smile"');
    expect(n.skipped).toEqual(['(장소 이미지 생략)']);
  });
});
