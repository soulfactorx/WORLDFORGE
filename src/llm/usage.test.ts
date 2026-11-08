import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { metrics } from './metrics';
import { clearUsage, dayKey, groupUsage, loadUsage, setUsageScope } from './usage';

describe('AI 사용량 기록 (v0.76)', () => {
  it('호출마다 지금 화면의 세계관·세이브·영역과 함께 남고, 거르고 묶을 수 있다', async () => {
    await clearUsage();
    setUsageScope({ world: 'w.a', worldName: '에테리아', saveId: 's1', area: 'play' });
    metrics.addCall({ at: Date.now(), role: 'narrator', model: 'm', ms: 1000, input: 100, output: 50, calls: 1, ok: true, label: '서술' });
    setUsageScope({ area: 'settings' });
    metrics.addCall({ at: Date.now(), role: 'other', model: 'm', ms: 500, input: 10, output: 5, calls: 1, ok: false, error: 'x' });
    await new Promise((r) => setTimeout(r, 50));
    const all = await loadUsage();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.role === 'narrator')).toMatchObject({ world: 'w.a', worldName: '에테리아', saveId: 's1', area: 'play', label: '서술' });
    expect(await loadUsage({ world: 'w.a' })).toHaveLength(1);
    expect(await loadUsage({ world: '' })).toHaveLength(1);
    const byWorld = groupUsage(all, (r) => r.world ?? '');
    expect(byWorld.map((b) => [b.key, b.n, b.fail, b.input])).toEqual(expect.arrayContaining([['w.a', 1, 0, 100], ['', 1, 1, 10]]));
    expect(groupUsage(all, (r) => dayKey(r.at))).toHaveLength(1);
    await clearUsage({ world: '' });
    expect(await loadUsage()).toHaveLength(1);
  });
});
