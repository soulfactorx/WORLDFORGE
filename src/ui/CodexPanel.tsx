import { useState } from 'react';
import { codexOf } from '../engine/codex';
import type { WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';
import { endingsSeen } from './collection';
import { useRs } from './reskin';

/** 도감 (설계 v4 E8): 쓰러뜨린 적·가 본 곳·만난 사람·확인한 사실·칭호·결말 */
export function CodexPanel({ world, state }: { world: WorldPackage; state: GameState }) {
  const rs = useRs();
  const sections = codexOf(world, state, endingsSeen(world.manifest.id));
  const [open, setOpen] = useState<string>('foes');
  return (
    <aside className="sheet codex">
      <div className="codex-tabs">
        {sections.map((s) => (
          <button key={s.key} type="button" className={open === s.key ? 'on' : undefined} aria-pressed={open === s.key} onClick={() => setOpen(s.key)}>
            {s.label} <span className="small muted">{s.total === null ? s.found.reduce((a, e) => a + (e.n ?? 1), 0) : `${s.found.length}/${s.total}`}</span>
          </button>
        ))}
      </div>
      {sections.filter((s) => s.key === open).map((s) => (
        <div key={s.key}>
          {s.total !== null && s.total > 0 && <div className="codex-bar" aria-hidden="true"><span style={{ width: `${Math.round((s.found.length / s.total) * 100)}%` }} /></div>}
          {s.found.length === 0 ? <p className="muted small">아직 없다.</p> : (
            <ul className="small codex-list">
              {s.found.map((e) => <li key={e.id}><b>{rs(e.name)}</b>{e.n !== undefined && <span className="muted"> ×{e.n}</span>}{e.note && <span className="muted"> — {rs(e.note)}</span>}</li>)}
            </ul>
          )}
          {s.key === 'endings' && s.total !== null && s.found.length < s.total && <p className="small muted">아직 보지 못한 결말이 {s.total - s.found.length}개 있다. 다른 선택을 하면 다른 끝에 닿을지도 모른다.</p>}
        </div>
      ))}
    </aside>
  );
}
