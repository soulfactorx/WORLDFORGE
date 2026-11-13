/** 시간 흐름 설정 — 편집기 기본 탭 (v0.112: 분 단위 설정을 없애고 세계 시간 속도 하나만) */
import type { WorldPackage } from '../engine/schema';
import { fmtMinutes, MOVE_MINUTES, PACE, type Pace, paceOf, TIME_STEPS, type TimeSpent } from '../engine/time';

export function TimeFieldset({ w, set }: { w: WorldPackage; set: (p: Partial<WorldPackage>) => void }) {
  const pace = paceOf(w);
  const mul = PACE[pace].mul;
  return (
    <fieldset className="time-rules"><legend>시간 흐름 — 한 턴은 다음 갈림길까지</legend>
      <label>세계 시간 속도
        <select value={pace} onChange={(e) => set({ time: e.target.value === 'normal' ? undefined : { pace: e.target.value as Pace } })}>
          {(Object.keys(PACE) as Pace[]).map((k) => <option key={k} value={k}>{PACE[k].label}{k === 'normal' ? ' (기본)' : ` (×${PACE[k].mul})`}</option>)}
        </select>
      </label>
      <p className="small muted">
        GM 판단 AI가 턴마다 길이를 고릅니다: {(Object.keys(TIME_STEPS) as TimeSpent[]).map((k) => `${TIME_STEPS[k].label} ${fmtMinutes(TIME_STEPS[k].minutes * mul)}`).join(' · ')} · 이동 +{fmtMinutes(MOVE_MINUTES * mul)}.
        {' '}휴식은 따로 (짧은 휴식 1시간, 긴 휴식 8시간). 흐른 시간은 인물 일정·진행 시계·세력 행동·연표 사건·달력에 그대로 반영됩니다.
      </p>
    </fieldset>
  );
}
