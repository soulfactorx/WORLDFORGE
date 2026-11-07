/** 시간 흐름 설정 (v0.58) — 편집기 기본 탭 */
import type { TimeRules, WorldPackage } from '../engine/schema';
import { fmtMinutes, TIME_DEFAULTS, TIME_STEPS, type TimeSpent, timeRules } from '../engine/time';

export function TimeFieldset({ w, set }: { w: WorldPackage; set: (p: Partial<WorldPackage>) => void }) {
  const r = timeRules(w);
  const t = w.time ?? {};
  const up = (p: Partial<TimeRules>) => { const n = { ...t, ...p }; for (const k of Object.keys(n) as (keyof TimeRules)[]) if (n[k] === undefined) delete n[k]; set({ time: Object.keys(n).length ? n : undefined }); };
  const num = (v: string) => (v === '' ? undefined : Math.max(0, Math.round(Number(v)) || 0));
  return (
    <fieldset className="time-rules"><legend>시간 흐름 — 한 턴에 게임 속 시간이 얼마나 흐르나</legend>
      <label>방식
        <select value={r.mode} onChange={(e) => up({ mode: e.target.value === 'fixed' ? 'fixed' : undefined })}>
          <option value="ai">행동에 따라 (GM 판단 AI가 잠깐·짧게·오래·몇 시간 중에서 고름) — 기본</option>
          <option value="fixed">턴마다 같은 시간</option>
        </select>
      </label>
      {r.mode === 'fixed'
        ? <label>턴마다 (분)<input type="number" min={0} value={t.perTurn ?? ''} placeholder={String(TIME_DEFAULTS.perTurn)} onChange={(e) => up({ perTurn: num(e.target.value) })} /></label>
        : (
          <div className="row">
            {(Object.keys(TIME_STEPS) as TimeSpent[]).map((k) => (
              <label key={k} title={TIME_STEPS[k].desc}>{TIME_STEPS[k].label} (분)
                <input type="number" min={0} value={t.steps?.[k] ?? ''} placeholder={String(TIME_STEPS[k].minutes)} onChange={(e) => { const steps = { ...t.steps, [k]: num(e.target.value) }; for (const x of Object.keys(steps) as TimeSpent[]) if (steps[x] === undefined) delete steps[x]; up({ steps: Object.keys(steps).length ? steps : undefined }); }} />
              </label>
            ))}
          </div>
        )}
      <div className="row">
        <label>이동할 때 더하는 분<input type="number" min={0} value={t.move ?? ''} placeholder={String(TIME_DEFAULTS.move)} onChange={(e) => up({ move: num(e.target.value) })} /></label>
        <label>한 턴 최대 (분)<input type="number" min={0} value={t.maxPerTurn ?? ''} placeholder={String(TIME_DEFAULTS.maxPerTurn)} onChange={(e) => up({ maxPerTurn: num(e.target.value) })} /></label>
      </div>
      <p className="small muted">
        {r.mode === 'fixed' ? `턴마다 ${fmtMinutes(r.perTurn)}` : (Object.keys(TIME_STEPS) as TimeSpent[]).map((k) => `${TIME_STEPS[k].label} ${fmtMinutes(r.steps[k])}(${TIME_STEPS[k].desc})`).join(' · ')}
        {` · 이동 +${fmtMinutes(r.move)} · 한 턴 최대 ${fmtMinutes(r.maxPerTurn)}. 휴식은 따로: 짧은 휴식 1시간, 긴 휴식 8시간. 상점 이용 1시간, 전투 패배 1시간.`}
        {' '}흐른 시간은 인물 일정·진행 시계·연표 사건·달력에 그대로 반영됩니다.
      </p>
    </fieldset>
  );
}
