import { describe, expect, it } from 'vitest';
import raw from '../public/manifest.webmanifest?raw';

describe('웹앱 매니페스트', () => {
  it('화면 방향을 정하지 않는다 — 휴대폰의 회전 고정 설정을 따른다 ("any"는 안드로이드에서 회전 고정을 무시한다)', () => {
    const m = JSON.parse(raw);
    expect(m.orientation).toBeUndefined();
    expect(m.display).toBe('standalone');
  });
});
