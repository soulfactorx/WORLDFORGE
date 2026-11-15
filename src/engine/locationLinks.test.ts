import { describe, expect, it } from 'vitest';
import type { Location } from './schema';
import { makeTwoWay, oneWayLinks, setLink, tidyLinks } from './locationLinks';

const L = (id: string, connections: string[] = []): Location => ({ id, name: id, description: '', connections });

describe('장소 길은 양쪽으로 (v0.128)', () => {
  it('잇기·끊기는 양쪽 모두', () => {
    let ls = [L('a'), L('b'), L('c')];
    ls = setLink(ls, 'a', 'b', true);
    expect(ls.map((l) => l.connections)).toEqual([['b'], ['a'], []]);
    ls = setLink(ls, 'b', 'a', false);
    expect(ls.map((l) => l.connections)).toEqual([[], [], []]);
  });
  it('한쪽만 이어진 길 찾기·고치기', () => {
    const ls = [L('a', ['b', 'c']), L('b'), L('c', ['a'])];
    expect(oneWayLinks(ls)).toEqual([['a', 'b']]);
    expect(makeTwoWay(ls).find((l) => l.id === 'b')!.connections).toEqual(['a']);
    expect(oneWayLinks(makeTwoWay(ls))).toEqual([]);
  });
  it('장소를 지우거나 ID를 바꾸면 다른 장소의 길도', () => {
    const prev = [L('a', ['b']), L('b', ['a', 'c']), L('c', ['b'])];
    expect(tidyLinks(prev, prev.filter((l) => l.id !== 'b')).map((l) => l.connections)).toEqual([[], []]);
    const renamed = prev.map((l) => (l.id === 'b' ? { ...l, id: 'hall' } : l));
    expect(tidyLinks(prev, renamed).map((l) => l.connections)).toEqual([['hall'], ['a', 'c'], ['hall']]);
  });
});
