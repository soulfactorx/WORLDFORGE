/** GM 즉흥 등장 설정 (v0.128): 편집기와 마법사가 함께 쓴다 */
import type { ImprovSettings } from '../engine/schema';

export const IMPROV_LEVELS: [NonNullable<ImprovSettings['level']>, string][] = [['off', '끔 — 정해 둔 것만'], ['rare', '가끔'], ['normal', '보통 (기본)'], ['often', '자주']];
export const IMPROV_MONSTERS: [NonNullable<ImprovSettings['monsters']>, string][] = [['danger', '위험한 곳에서만 (기본)'], ['anywhere', '어디서나'], ['off', '없음']];

export function ImprovFields({ value, onChange, genreHint }: { value: ImprovSettings | undefined; onChange: (v: ImprovSettings | undefined) => void; genreHint?: string }) {
  const v = value ?? {};
  const set = (p: Partial<ImprovSettings>) => {
    const n = { ...v, ...p };
    for (const k of Object.keys(n) as (keyof ImprovSettings)[]) if (n[k] === undefined || n[k] === '') delete n[k];
    onChange(Object.keys(n).length ? n : undefined);
  };
  const off = v.level === 'off';
  return (
    <fieldset className="improv-fields">
      <legend>🎲 GM 즉흥 등장 · 돌발 사건</legend>
      <p className="small muted">여기서 정한 인물·적은 <b>주요 등장인물</b>입니다. 그 밖에 GM이 세계관에 맞는 <b>엑스트라 인물</b>(행인·상인·여행자…)이나 <b>몬스터</b>를 즉흥으로 내보내 돌발 사건을 만듭니다. 언제·무엇이 일어날지는 엔진이 굴리고, 누가·어떻게는 AI가 세계에 맞게 지어냅니다 (세계의 중요한 사실·주요 인물의 비밀은 새로 만들지 않습니다).</p>
      <label>얼마나 자주
        <select value={v.level ?? 'normal'} onChange={(e) => set({ level: e.target.value === 'normal' ? undefined : e.target.value as ImprovSettings['level'] })}>
          {IMPROV_LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {!off && (
        <>
          <label className="check"><input type="checkbox" checked={v.extras ?? true} onChange={(e) => set({ extras: e.target.checked ? undefined : false })} /> 엑스트라 인물이 즉흥으로 나타나 말을 걸고 작은 일을 만든다</label>
          <label>몬스터·적의 즉흥 기습 <span className="small muted">— 위험한 곳 = 조우(전투)를 정해 둔 장소</span>
            <select value={v.monsters ?? 'danger'} onChange={(e) => set({ monsters: e.target.value === 'danger' ? undefined : e.target.value as ImprovSettings['monsters'] })}>
              {IMPROV_MONSTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>이 세계에 흔한 사람들 <span className="small muted">— 선택, GM이 엑스트라를 지어낼 때 참고</span>
            <input value={v.cast ?? ''} placeholder={genreHint === 'wuxia' ? '예: 표국 표사, 떠돌이 낭인, 주막 점소이' : '예: 순례자, 밀수꾼, 마을 경비병, 떠돌이 약장수'} onChange={(e) => set({ cast: e.target.value })} />
          </label>
          {(v.monsters ?? 'danger') !== 'off' && (
            <label>이 세계에 흔한 적 <span className="small muted">— 선택, 기습을 묘사할 때 참고 (전투 수치는 장르의 적에서 엔진이 고른다)</span>
              <input value={v.foes ?? ''} placeholder="예: 굶주린 늑대 무리, 산적, 들개" onChange={(e) => set({ foes: e.target.value })} />
            </label>
          )}
        </>
      )}
      <p className="small muted">{off ? '돌발 사건이 일어나지 않습니다 (직접 정한 돌발 사건 표도 쉽니다).' : '이동할 때·쉴 때·한동안 아무 일도 없을 때 굴립니다. 같은 일이 연달아 일어나지 않게 쉬는 턴이 있습니다.'}</p>
    </fieldset>
  );
}
