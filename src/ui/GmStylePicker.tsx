/**
 * GM 스타일 고르기 (v0.80): 프리셋 카드 + 사용자 정의 연출 지시.
 */
import { GM_STYLES } from '../data/gmStyles';
import type { WorldPackage } from '../engine/schema';

export function GmStylePicker({ w, onChange }: { w: WorldPackage; onChange: (v: WorldPackage['gmStyle']) => void }) {
  const cur = w.gmStyle ?? {};
  const set = (p: Partial<NonNullable<WorldPackage['gmStyle']>>) => {
    const next = { ...cur, ...p };
    if (!next.preset) delete next.preset;
    if (!next.custom?.trim()) delete next.custom;
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <fieldset className="gm-style">
      <legend>GM 스타일 — 이 세계를 연출하는 GM의 성격 (서술·선택지·장면·전투에 적용, 규칙은 그대로)</legend>
      <div className="gm-style-grid" role="radiogroup" aria-label="GM 스타일 프리셋">
        <button type="button" role="radio" aria-checked={!cur.preset} className={`gm-style-card${!cur.preset ? ' on' : ''}`} onClick={() => set({ preset: undefined })}>
          <b>⚪ 기본</b><span className="small muted">따로 정하지 않음 (정석 이야기꾼과 비슷)</span>
        </button>
        {GM_STYLES.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={cur.preset === g.id} className={`gm-style-card${cur.preset === g.id ? ' on' : ''}`} onClick={() => set({ preset: g.id })}>
            <b>{g.emoji} {g.name}</b><span className="small muted">{g.blurb}</span>
          </button>
        ))}
      </div>
      <label>사용자 정의 연출 (선택, 800자까지 — 프리셋에 더해진다)
        <textarea rows={3} value={cur.custom ?? ''} maxLength={800} placeholder="예: 사투리를 쓰는 능청스러운 GM. 장면마다 계절과 날씨를 꼭 한 줄 넣고, 인물들의 속마음은 말하지 않는다."
          onChange={(e) => set({ custom: e.target.value })} />
      </label>
      <p className="small muted">플레이 중에도 <b>소리·화면</b> 설정에서 이 기기만 다른 GM 스타일로 바꿔 볼 수 있습니다.</p>
    </fieldset>
  );
}
