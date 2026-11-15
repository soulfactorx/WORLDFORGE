/**
 * 초안 합치기 (v0.131): 저장하지 않은 초안에서 무엇을 가져올지 항목마다 고른다.
 * 기본: 초안에만 있는 것(새로 만든 장소·인물…)은 가져오고, 둘 다 있는데 다른 것은 저장본을 그대로 둔다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { defaultPicks, diffWorlds, mergeWorlds } from '../gm/worldDiff';

export function DraftMerge({ base, draft, origin, draftAt, onApply, onClose, applyLabel = '고른 것 합치기' }: {
  /** 지금 저장본 (또는 편집 중인 세계) */ base: WorldPackage;
  /** 저장하지 않은 초안 */ draft: WorldPackage;
  /** 초안을 시작한 때의 세계 (있으면 초안이 손대지 않은 것은 보이지 않는다) */ origin?: WorldPackage;
  draftAt?: number;
  onApply: (merged: WorldPackage, taken: number) => void;
  onClose: () => void;
  applyLabel?: string;
}) {
  const items = useMemo(() => diffWorlds(base, draft, origin), [base, draft, origin]);
  const [picks, setPicks] = useState(() => defaultPicks(items));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const groups = [...new Set(items.map((i) => i.group))];
  const toggle = (k: string) => setPicks((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="dialog draft-merge" role="dialog" aria-label="초안 합치기">
      <div className="row"><b>🔀 초안 합치기</b><span className="spacer" /><button type="button" onClick={onClose}>닫기</button></div>
      <p className="small muted">
        저장하지 않은 초안{draftAt ? ` (${new Date(draftAt).toLocaleString()})` : ''}에서 가져올 것을 고르세요. <b>초안에서 새로 만들거나 고친 것</b>은 기본으로 가져오고, 저장본에서도 고친 것(<b>둘 다 고침</b>)은 기본으로 저장본을 그대로 둡니다 — 초안 쪽으로 바꾸려면 체크하세요.{origin ? ' 초안이 손대지 않은 것은 목록에 없습니다 (저장본의 새 내용을 되돌리지 않게).' : ''}{' '}
        저장본에만 있는 것은 그대로 남습니다. 합친 뒤 <b>저장</b>을 눌러야 반영됩니다.
      </p>
      {!items.length ? <p className="small">저장본과 다른 곳이 없습니다 — 이 초안은 지워도 잃는 것이 없습니다.</p> : (
        <>
          <div className="row">
            <button type="button" className="small" onClick={() => setPicks(new Set(items.map((i) => i.key)))}>모두 초안 쪽으로</button>
            <button type="button" className="small" onClick={() => setPicks(defaultPicks(items))}>기본으로</button>
            <button type="button" className="small" onClick={() => setPicks(new Set())}>하나도 가져오지 않기</button>
            <span className="small muted">{items.length}곳 중 {picks.size}곳 가져옴</span>
          </div>
          <div className="merge-groups">
            {groups.map((g) => (
              <fieldset key={g}><legend>{g}</legend>
                {items.filter((i) => i.group === g).map((i) => (
                  <label key={i.key} className="check merge-row">
                    <input type="checkbox" checked={picks.has(i.key)} onChange={() => toggle(i.key)} />
                    <span className={`merge-kind ${i.kind}`}>{i.kind === 'added' ? '초안에서 새로 만듦' : i.kind === 'changed' ? '초안에서 고침' : '둘 다 고침'}</span>
                    <span className="merge-label">{i.label}{i.id && i.label !== i.id ? <span className="small muted"> · {i.id}</span> : null}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </>
      )}
      <div className="row merge-foot">
        <button type="button" className="primary" disabled={!items.length} onClick={() => onApply(mergeWorlds(base, draft, picks, origin), picks.size)}>{applyLabel} ({picks.size})</button>
      </div>
    </div>
  );
}
