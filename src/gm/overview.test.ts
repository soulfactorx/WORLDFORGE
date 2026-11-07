import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import type { WorldPackage } from '../engine/schema';
import { replay } from '../engine/state/state';
import { buildActorContext, buildDirectorContext, buildNarratorContext } from './context';
import { startEvents } from './turn';

describe('세계 개요·GM 메모 (v0.54)', () => {
  const w: WorldPackage = { ...sampleWorld, overview: '공개 배경: 안개 골짜기의 작은 마을.', gmNotes: '숨은 설정: 장로가 소환진을 다시 켰다.' };
  const s = replay(startEvents(w, legacyCharacter('나'), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
  it('개요는 Director·서술(GM 안내 포함)·인물이 모두 받고, GM 메모는 Director만 받는다', () => {
    const d = buildDirectorContext(w, s), n = buildNarratorContext(w, s), a = buildActorContext(w, s, w.characters[0]!);
    for (const ctx of [d, n, a]) expect(ctx).toContain('공개 배경');
    expect(d).toContain('숨은 설정');
    expect(n).not.toContain('숨은 설정');
    expect(a).not.toContain('숨은 설정');
  });
  it('검사기: 길면 경고, 글이 아니면 오류', () => {
    expect(validateWorld({ ...w, overview: 'x'.repeat(3000) }).some((i) => i.level === 'warning' && i.path === 'overview')).toBe(true);
    expect(validateWorld({ ...w, gmNotes: 3 as never }).some((i) => i.level === 'error' && i.path === 'gmNotes')).toBe(true);
  });
  it('공식 세계와 샘플은 모두 개요가 있다', async () => {
    const { BUILTIN } = await import('../storage/packages');
    for (const b of BUILTIN) expect(b.overview?.length, b.manifest.name).toBeGreaterThan(50);
  });
});
