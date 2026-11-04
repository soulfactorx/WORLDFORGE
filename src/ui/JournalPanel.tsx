import { knowledgeOf } from '../engine/knowledge/knowledge';
import type { WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';

const LABEL = { rumor: '소문', partial: '들은 이야기', confirmed: '확인됨', mistaken: '잘못 앎', secret: '비밀' } as const;

/** 플레이어 수첩: 플레이어가 알게 된 것만 보여준다 (진위는 보여주지 않는다). */
export function JournalPanel({ world, state }: { world: WorldPackage; state: GameState }) {
  const known = knowledgeOf(world, state.beliefs, 'player');
  return (
    <aside className="sheet">
      <b>수첩</b>
      {known.length === 0 ? (
        <p className="muted small">아직 이 세계에 대해 아는 것이 없다.</p>
      ) : (
        <ul className="journal">
          {known.map((k) => <li key={k.statement}><span className={`tag ${k.state}`}>{LABEL[k.state]}</span> {k.statement}</li>)}
        </ul>
      )}
    </aside>
  );
}
