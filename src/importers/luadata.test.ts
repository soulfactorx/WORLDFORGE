import { describe, expect, it } from 'vitest';
import { extractLuaData } from './luadata';

const code = `
-- 주석
local RUIN_YEAR, RUIN_DAY = 429, 243
local MONTH_START = {0, 31, 59}
EVENTS = {
    { id = "E0", ongoing = true, from = 82, title = "준비", knows = "Daphneya",
      plot = "Daphneya is \\"quietly\\" preparing." },
    { id = "E2", day = 75, date = "7.08", needs = {"E0"}, plot = [[긴
문자열]] },
    -- 주석 줄
}
local TABLE2 = { ["키"] = 1, name = 'x'; nested = { a = nil } }
local function helper(x) return x end
local computed = helper(3)
local expr = 1 + 2
os.execute("rm -rf /")
`;

describe('Lua 데이터 추출 (실행 없음)', () => {
  it('리터럴 대입만 꺼낸다', () => {
    const d = extractLuaData(code);
    expect(d.RUIN_YEAR).toBe(429);
    expect(d.RUIN_DAY).toBe(243);
    expect(d.MONTH_START).toEqual([0, 31, 59]);
    const ev = d.EVENTS as Record<string, unknown>[];
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ id: 'E0', ongoing: true, from: 82, knows: 'Daphneya', plot: 'Daphneya is "quietly" preparing.' });
    expect(ev[1]).toMatchObject({ id: 'E2', day: 75, needs: ['E0'], plot: '긴\n문자열' });
    expect(d.TABLE2).toEqual({ 키: 1, name: 'x', nested: { a: null } });
    expect(d.computed).toBeUndefined();
    expect(d.expr).toBeUndefined();
  });
});
