import { describe, expect, it } from 'vitest';
import { linkWarnings, flowWarnings } from '../engine/package/flow';
import { validateWorld } from '../engine/package/validate';
import { autoPlay } from '../gm/autoplay';
import { STOCK_ART } from './stockart';
import { MORE_SAMPLES } from './sample-more';

describe('장르 샘플 세계 2 (v0.87)', () => {
  for (const w of MORE_SAMPLES) {
    describe(w.manifest.name, () => {
      it('검사기를 통과하고, 이야기 연결에 빈 곳이 없다', () => {
        const issues = validateWorld(w);
        expect(issues.filter((i) => i.level === 'error').map((i) => `${i.path}: ${i.message}`)).toEqual([]);
        expect(linkWarnings(w)).toEqual([]);
        expect(flowWarnings(w).filter((x) => x.includes('세우는 곳이 없습니다'))).toEqual([]);
        expect(w.overview!.length).toBeGreaterThan(50);
      });
      it('내장 그림이 실제로 있다', () => {
        const ids = new Set(STOCK_ART.map((a) => a.id));
        for (const a of w.assets ?? []) expect(ids.has(a.id.replace(/^stock\./, '').replace(/--\d+$/, '')), a.id).toBe(true);
        for (const c of w.characters) expect(w.assets!.some((a) => a.characterId === c.id), c.name).toBe(true);
        for (const l of w.locations) expect(w.assets!.some((a) => a.locationId === l.id), l.name).toBe(true);
      });
      it('자동 플레이로 결말에 닿을 수 있다', async () => {
        const r = await autoPlay(w, { runs: 30, steps: 400, seed: 11 });
        expect(Object.keys(r.endings).length, JSON.stringify({ quests: r.quests, noEnding: r.noEnding })).toBeGreaterThan(0);
      });
    });
  }
});
