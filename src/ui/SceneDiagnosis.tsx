import { useMemo } from 'react';
import type { CharacterSheet } from '../engine/character/sheet';
import type { WorldPackage } from '../engine/schema';
import { diagnoseScene } from '../gm/sceneDiagnose';
import type { SimPolicy } from '../gm/sceneTest';

/**
 * 안 나오는 끝 안내 (v0.105): 거의 나오지 않는 끝마다 까닭과 고칠 곳을 보여 준다.
 * 비율 맞추기는 숫자만 움직이므로, 길이 막힌 끝은 여기서 알려 주는 것을 손으로 고쳐야 나온다.
 */
export function SceneDiagnosis({ w, sceneId, sheet, policy = 'random' }: { w: WorldPackage; sceneId: string; sheet: CharacterSheet; policy?: SimPolicy }) {
  const list = useMemo(() => { try { return diagnoseScene(w, sceneId, sheet, { policy }); } catch { return []; } }, [w, sceneId, sheet, policy]);
  if (!list.length) return null;
  return (
    <section className="scene-diagnosis" aria-label="안 나오는 끝 안내">
      <b>🔎 안 나오는 끝 — 왜 안 나오고, 무엇을 고치면 되는지</b>
      <p className="small muted">자동 시험 {list[0]!.runs}판에서 1%도 나오지 않은 끝입니다. 이런 끝은 숫자를 맞추는 것만으로는 나오지 않는 경우가 많아, 아래에서 짚은 곳을 고친 뒤 다시 시험하세요.</p>
      {list.map((d) => (
        <div key={d.endId} className="diagnosis-end">
          <p className="diagnosis-name"><b>「{d.name}」</b> <span className="small muted">— {d.runs}판 중 {d.count}번</span></p>
          <ul className="small">
            {d.findings.map((f, i) => (
              <li key={i}>
                <span className="diagnosis-why">{f.why}</span>
                <span className="diagnosis-fix">→ {f.fix}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
