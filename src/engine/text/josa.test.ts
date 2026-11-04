import { describe, expect, it } from 'vitest';
import { josa } from './josa';

describe('josa', () => {
  it('받침에 따라 조사를 고른다', () => {
    expect(josa('브란', '이/가')).toBe('브란이');
    expect(josa('일제', '이/가')).toBe('일제가');
    expect(josa('일제', '은/는')).toBe('일제는');
    expect(josa('브란', '은/는')).toBe('브란은');
    expect(josa('마을', '으로/로')).toBe('마을로');
    expect(josa('숲', '으로/로')).toBe('숲으로');
    expect(josa('Bran', '이/가')).toBe('Bran이(가)');
  });
});
