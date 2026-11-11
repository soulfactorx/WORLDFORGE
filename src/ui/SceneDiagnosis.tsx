import { useMemo } from 'react';
import type { CharacterSheet } from '../engine/character/sheet';
import type { SceneDef, WorldPackage } from '../engine/schema';
import { diagnoseScene } from '../gm/sceneDiagnose';
import type { SimPolicy } from '../gm/sceneTest';

/**
 * 안 나오는 끝 안내 (v0.105): 거의 나오지 않는 끝마다 까닭과 고칠 곳을 보여 준다.
 * 비율 맞추기는 숫자만 움직이므로, 길이 막힌 끝은 여기서 알려 주는 것을 손으로 고쳐야 나온다.
 */
export function SceneDiagnosis({ w, sceneId, sheet, policy = 'random', onApply }: { w: WorldPackage; sceneId: string; sheet: CharacterSheet; policy?: SimPolicy; /** 눌러서 바로 고치기 (v0.106): 고친 장면을 받는다 */ onApply?: (d: SceneDef) => void }) {
  const def = (w.scenes ?? []).find((s) => s.id === sceneId);
  const list = useMemo(() => { try { return diagnoseScene(w, sceneId, sheet, { policy }); } catch { return []; } }, [w, sceneId, sheet, policy]);
  if (!list.length) return null;
  return (
    <section className="scene-diagnosis" aria-label="안 나오는 끝 안내">
      <b>🔎 안 나오는 끝 — 왜 안 나오고, 무엇을 고치면 되는지</b>
      <p className="small muted">자동 시험 {list[0]!.runs}판에서 1%도 나오지 않은 끝입니다. 이런 끝은 숫자를 맞추는 것만으로는 나오지 않는 경우가 많아, 아래에서 짚은 곳을 고친 뒤 다시 시험하세요.{onApply ? ' 🔧 버튼은 그 자리에서 바로 고치고 다시 시험합니다 (편집기의 되돌리기로 되돌릴 수 있습니다).' : ''}</p>
      {list.map((d) => (
        <div key={d.endId} className="diagnosis-end">
          <p className="diagnosis-name"><b>「{d.name}」</b> <span className="small muted">— {d.runs}판 중 {d.count}번</span></p>
          <ul className="small">
            {d.findings.map((f, i) => (
              <li key={i}>
                <span className="diagnosis-why">{f.why}</span>
                <span className="diagnosis-fix">→ {f.fix}</span>
                {onApply && def && f.quick && f.quick.length > 0 && (
                  <span className="diagnosis-quick">
                    {f.quick.map((q) => <button key={q.label} type="button" onClick={() => onApply(q.apply(def))} title="이 장면에 바로 적용하고 다시 시험합니다">🔧 {q.label}</button>)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
