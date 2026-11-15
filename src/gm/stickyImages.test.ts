import { describe, expect, it } from 'vitest';
import type { NarrationImage } from '../engine/state/events';
import { stickyImages } from './stickyImages';

describe('서술 그림 고정 (v0.137)', () => {
  it('흘러나오는 동안 놓인 그림은 끝난 뒤 다시 골라도 바뀌지 않는다', () => {
    // 글이 길어지면 1문단 인물의 표정 짐작이 바뀌고, 끝에는 AI 표시로 통째로 바뀌는 고르기
    const compute = (text: string) => {
      const n = text.split('\n\n').length;
      const images: NarrationImage[] = n < 3
        ? [{ id: 'bg1', caption: '정원', bg: 'same' }, { id: 'lia-smile', caption: '리아', para: 0 }]
        : [{ id: 'bg2', caption: '정원', bg: 'new' }, { id: 'lia-angry', caption: '리아', para: 0 }, { id: 'bo', caption: '보리', para: 2 }];
      return { images, why: images.map((im) => `까닭 ${im.id}`) };
    };
    const st = stickyImages(compute);
    const during = st.place('하나\n\n둘');
    expect(during.map((i) => i.id)).toEqual(['bg1', 'lia-smile']);
    const end = st.place('하나\n\n둘\n\n셋', true);
    expect(end.map((i) => i.id)).toEqual(['bg1', 'lia-smile', 'bo']);
    const note = st.note({ x: 'y' });
    expect(note.chosen.map((c) => c.why)).toEqual([
      '까닭 bg1 · 서술 중 (2문단까지 나왔을 때) · 서술 맨 앞(배경)',
      '까닭 lia-smile · 서술 중 (2문단까지 나왔을 때) · 1번째 문단',
      '까닭 bo · 서술이 끝난 뒤 · 3번째 문단',
    ]);
    expect(note.skipped.join(' ')).toContain('배경은 이미 보인 것을 그대로');
    expect(note.skipped.join(' ')).toContain('이미 지나간 문단');
  });
  it('자리 없는 그림은 서술 중에는 고정하지 않고, 끝난 뒤에 놓는다', () => {
    let mentioned = false;
    const st = stickyImages(() => ({ images: [mentioned ? { id: 'c', caption: '보리', para: 1 } : { id: 'c', caption: '보리' }], why: ['x'] }));
    expect(st.place('하나')).toEqual([]);
    mentioned = true;
    expect(st.place('하나\n\n보리가', true)).toEqual([{ id: 'c', caption: '보리', para: 1 }]);
  });
});
